"""L2 风控：组合层风控闸门 + 止损链。

- MaxDrawdownGate：组合回撤超过阈值 → 强制平仓
- MaxPositionPctGate：单标的仓位上限
- StopLossChain：A 股 T+1 下，次日止损/止盈
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import pandas as pd


@dataclass
class RiskDecision:
    stop_all: bool = False
    reduce_pct: float = 0.0        # 0~1：需要减仓的比例
    reasons: list[str] = field(default_factory=list)


class BaseRiskGate(ABC):
    @abstractmethod
    def check(self, context: dict[str, Any]) -> RiskDecision:
        ...


class MaxDrawdownGate(BaseRiskGate):
    """组合累计回撤超过阈值 → 全平。"""

    def __init__(self, max_dd: float = 0.15):
        self.max_dd = max_dd

    def check(self, context: dict[str, Any]) -> RiskDecision:
        curve = context.get("equity_curve")
        if curve is None or len(curve) < 2:
            return RiskDecision()
        peak = curve.cummax()
        cur_dd = (curve.iloc[-1] - peak.iloc[-1]) / peak.iloc[-1] \
            if peak.iloc[-1] else 0
        if cur_dd <= -self.max_dd:
            return RiskDecision(stop_all=True, reduce_pct=1.0,
                                reasons=[f"回撤触发：{cur_dd*100:.2f}% ≤ -{self.max_dd*100:.1f}%"])
        return RiskDecision()


class MaxPositionPctGate(BaseRiskGate):
    """单标的仓位占比上限。"""

    def __init__(self, max_pct: float = 0.30):
        self.max_pct = max_pct

    def check(self, context: dict[str, Any]) -> RiskDecision:
        pos = context.get("position_value", 0)
        eq = context.get("equity", 0)
        if eq <= 0:
            return RiskDecision()
        pct = pos / eq
        if pct > self.max_pct:
            need = min(1.0, (pct - self.max_pct) / pct)
            return RiskDecision(reduce_pct=need,
                                reasons=[f"单标的仓位 {pct*100:.1f}% > {self.max_pct*100:.0f}%"])
        return RiskDecision()


class StopLossChain:
    """止损链：A 股 T+1，次日按开盘价执行。"""

    def __init__(self, stop_loss_pct: float = 0.07, take_profit_pct: float = 0.20,
                 trailing_stop_pct: float = 0.08):
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.trailing_stop_pct = trailing_stop_pct

    def should_exit(self, avg_cost: float, cur_price: float,
                    peak_price: float) -> tuple[bool, str]:
        if avg_cost <= 0:
            return False, ""
        ret = (cur_price - avg_cost) / avg_cost
        if ret <= -self.stop_loss_pct:
            return True, f"止损 {ret*100:.2f}%（阈值 -{self.stop_loss_pct*100:.1f}%）"
        if ret >= self.take_profit_pct:
            return True, f"止盈 {ret*100:.2f}%（阈值 {self.take_profit_pct*100:.0f}%）"
        if peak_price > 0:
            dd_from_peak = (cur_price - peak_price) / peak_price
            if dd_from_peak <= -self.trailing_stop_pct:
                return True, f"移动止损 回撤{dd_from_peak*100:.2f}%"
        return False, ""


class RiskManager:
    """综合风控：组合闸门 + 止损链。"""

    def __init__(self, gates: list[BaseRiskGate] | None = None,
                 stop_chain: StopLossChain | None = None):
        self.gates = gates or [
            MaxDrawdownGate(0.15),
            MaxPositionPctGate(0.30),
        ]
        self.stop_chain = stop_chain or StopLossChain()

    def portfolio_check(self, context: dict[str, Any]) -> RiskDecision:
        agg = RiskDecision()
        for g in self.gates:
            r = g.check(context)
            agg.reasons += r.reasons
            if r.stop_all:
                agg.stop_all = True
            agg.reduce_pct = max(agg.reduce_pct, r.reduce_pct)
        return agg


__all__ = [
    "RiskDecision", "BaseRiskGate",
    "MaxDrawdownGate", "MaxPositionPctGate",
    "StopLossChain", "RiskManager",
]
