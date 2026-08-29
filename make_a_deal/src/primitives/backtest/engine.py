"""L2 事件驱动回测引擎：A 股 T+1 / 涨跌停 / 手续费 / 滑点。"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .strategy import BaseStrategy, Signal


@dataclass
class Order:
    idx: int
    date: pd.Timestamp
    price: float          # 下单价（明日开盘执行）
    size: int
    direction: int        # +1 买 / -1 卖


@dataclass
class Fill:
    date: pd.Timestamp
    price: float
    size: int
    direction: int
    commission: float
    reason: str = ""


@dataclass
class BacktestMetrics:
    total_return: float = 0.0
    annual_return: float = 0.0
    sharpe: float = 0.0
    sortino: float = 0.0
    max_drawdown: float = 0.0
    calmar: float = 0.0
    volatility: float = 0.0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    n_trades: int = 0
    n_bars: int = 0
    final_equity: float = 0.0
    final_cash: float = 0.0
    final_position_value: float = 0.0


@dataclass
class BacktestResult:
    equity_curve: pd.Series
    fills: list[Fill] = field(default_factory=list)
    trades: list[dict] = field(default_factory=list)
    metrics: BacktestMetrics = field(default_factory=BacktestMetrics)
    code: str = ""


class BacktestEngine:
    """单标的事件驱动回测。

    A 股规则：
    - T+1：今日买入，明日及以后可卖出；
    - 涨跌停：涨停不买、跌停不卖（简化：以 close 涨跌≥9.8%近似）；
    - 手续费：万三佣金（最低 5 元）+ 千一印花税（仅卖出）；
    - 滑点：0.1%。
    """

    def __init__(self, bars: pd.DataFrame, strategy: BaseStrategy,
                 code: str = "", cash: float = 1_000_000,
                 commission_rate: float = 0.0003,
                 stamp_duty_rate: float = 0.001,
                 slippage: float = 0.001,
                 limit_move: float = 0.098):
        self.bars = bars.sort_index()
        self.strategy = strategy
        self.code = code
        self.cash = float(cash)
        self.commission_rate = commission_rate
        self.stamp_duty_rate = stamp_duty_rate
        self.slippage = slippage
        self.limit_move = limit_move
        self._buy_pending: list[int] = []  # T+1 可卖池：记录 buy bar 的 idx

    # ----------------------------- 主流程 -----------------------------
    def run(self) -> BacktestResult:
        actions = self.strategy.generate_signals(self.bars)
        actions_sorted = sorted(actions, key=lambda a: a.index)

        equity: list[float] = []
        fills: list[Fill] = []
        pos = 0
        avg_cost = 0.0
        sellable = 0  # 已过 T+1 的可卖股数

        n = len(self.bars)
        for i, (ts, bar) in enumerate(self.bars.iterrows()):
            open_ = float(bar["open"])
            close = float(bar["close"])
            prev_close = float(
                self.bars["close"].iloc[i - 1] if i > 0 else close)

            # 涨跌幅（基于前收）
            chg = (close - prev_close) / prev_close if prev_close else 0
            limit_up = chg >= self.limit_move
            limit_down = chg <= -self.limit_move

            # 处理挂单（今日按 open±滑点执行）
            pending_orders = [a for a in actions_sorted
                              if a.index == i - 1]  # 昨信号今执行
            for act in pending_orders:
                # T+1 卖出判定
                if act.signal == Signal.SHORT and sellable <= 0:
                    continue
                exec_price = open_
                if act.signal == Signal.LONG:
                    if limit_up:
                        continue
                    exec_price *= (1 + self.slippage)
                    size = int(self.cash // (exec_price * (1 + self.commission_rate) + 0.0001) / 100) * 100
                    if size <= 0:
                        continue
                    commission = max(5.0, size * exec_price * self.commission_rate)
                    cost = size * exec_price + commission
                    if cost > self.cash:
                        continue
                    self.cash -= cost
                    pos += size
                    avg_cost = ((avg_cost * (pos - size)) + (size * exec_price)) / pos if pos else 0
                    fills.append(Fill(ts, exec_price, size, 1, commission, "T+1挂"))
                    self._buy_pending.append(i)  # 下个交易日可卖
                elif act.signal == Signal.SHORT:
                    if limit_down:
                        continue
                    exec_price *= (1 - self.slippage)
                    size = min(sellable, pos)
                    if size <= 0:
                        continue
                    commission = max(5.0, size * exec_price * self.commission_rate)
                    stamp = size * exec_price * self.stamp_duty_rate
                    revenue = size * exec_price - commission - stamp
                    self.cash += revenue
                    pos -= size
                    fills.append(Fill(ts, exec_price, size, -1,
                                      commission + stamp, "T+1挂卖"))
                    sellable -= size

            # T+1 解锁：昨天及之前买的仓位可卖
            while self._buy_pending and self._buy_pending[0] < i:
                unlocked = self._buy_pending.pop(0)
                # 解锁的股数近似：按整批成交为 100 股为单位时，粗略累加总买股
                # 简化处理：sellable = 累计已买入且可卖的股数
                # 这里用 fills 回溯更准确：
            sellable = self._count_sellable(i, fills)

            # 收盘市值
            position_value = pos * close
            equity.append(self.cash + position_value)

        curve = pd.Series(equity, index=self.bars.index, dtype=float)
        trades = self._extract_round_trips(fills)
        metrics = self._metrics(curve, trades)
        metrics.final_cash = self.cash
        metrics.final_position_value = pos * (float(self.bars["close"].iloc[-1])
                                              if len(self.bars) else 0)
        metrics.final_equity = float(curve.iloc[-1]) if len(curve) else 0
        metrics.n_bars = len(self.bars)
        return BacktestResult(equity_curve=curve, fills=fills,
                              trades=trades, metrics=metrics,
                              code=self.code)

    # ----------------------------- 内部工具 -----------------------------
    def _count_sellable(self, bar_idx: int, fills: list[Fill]) -> int:
        """T+1：今天买的股数今天不可卖；fill.date 严格小于当前 bar.date 才算。"""
        cur_date = self.bars.index[bar_idx] if bar_idx < len(self.bars) else None
        total = 0
        for f in fills:
            if f.direction == 1 and (cur_date is None or f.date < cur_date):
                total += f.size
            elif f.direction == -1:
                total -= f.size
        return max(0, total)

    @staticmethod
    def _extract_round_trips(fills: list[Fill]) -> list[dict]:
        """把买卖 fills 配成闭合交易，计算单笔盈亏。"""
        bought: list[Fill] = []
        trades: list[dict] = []
        sold_qty = 0
        for f in fills:
            if f.direction == 1:
                bought.append(f)
            else:
                remain = f.size
                pnl_total = 0
                sold_qty += remain
                while remain > 0 and bought:
                    b = bought[0]
                    take = min(remain, b.size)
                    buy_cost = take * b.price + (b.commission * take / b.size if b.size else 0)
                    sell_rev = take * f.price - (f.commission * take / f.size if f.size else 0)
                    pnl = sell_rev - buy_cost
                    pnl_total += pnl
                    b.size -= take
                    remain -= take
                    if b.size <= 0:
                        bought.pop(0)
                trades.append({
                    "sell_date": str(f.date.date()),
                    "size": f.size,
                    "avg_buy": 0.0,
                    "sell_price": f.price,
                    "pnl": pnl_total,
                    "return": pnl_total / max(1e-9, f.size * f.price),
                })
        return trades

    @staticmethod
    def _metrics(curve: pd.Series, trades: list[dict]) -> BacktestMetrics:
        m = BacktestMetrics()
        m.n_trades = len(trades)
        if len(curve) < 2:
            return m
        rets = curve.pct_change().dropna()
        total = float(curve.iloc[-1] / curve.iloc[0] - 1)
        m.total_return = total
        years = max(1 / 252, (curve.index[-1] - curve.index[0]).days / 365.25)
        m.annual_return = (1 + total) ** (1 / years) - 1 if years > 0 else 0
        m.volatility = float(rets.std()) * np.sqrt(252) if len(rets) else 0
        m.sharpe = (float(rets.mean()) * 252) / (m.volatility + 1e-9)
        down_rets = rets[rets < 0]
        m.sortino = (float(rets.mean()) * 252) / (
            float(down_rets.std()) * np.sqrt(252) + 1e-9) if len(down_rets) else 0
        peak = curve.cummax()
        dd = (curve - peak) / peak
        m.max_drawdown = float(-dd.min()) if len(dd) else 0
        m.calmar = m.annual_return / (m.max_drawdown + 1e-9)
        if trades:
            wins = [t for t in trades if t["pnl"] > 0]
            m.win_rate = len(wins) / len(trades)
            gross_profit = sum(t["pnl"] for t in wins)
            gross_loss = abs(sum(t["pnl"] for t in trades if t["pnl"] < 0))
            m.profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        return m


__all__ = ["Order", "Fill", "BacktestMetrics", "BacktestResult", "BacktestEngine"]
