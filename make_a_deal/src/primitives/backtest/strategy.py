"""L2 策略：基类 + 均线交叉 + 简化 RSI 超卖反弹。"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
import pandas as pd
import numpy as np


class Signal(Enum):
    LONG = 1
    SHORT = -1
    FLAT = 0


@dataclass
class TradeAction:
    index: int         # 行号（对应 bar DataFrame 位置）
    date: pd.Timestamp
    signal: Signal
    price: float
    size: float        # 股数（整数）


class BaseStrategy(ABC):
    @abstractmethod
    def generate_signals(self, bars: pd.DataFrame) -> list[TradeAction]:
        ...


class MACross(BaseStrategy):
    """快慢均线金叉买入，死叉卖出。"""

    def __init__(self, fast: int = 5, slow: int = 20):
        if fast <= 0 or slow <= 0 or fast >= slow:
            raise ValueError("fast/slow 需满足 0 < fast < slow")
        self.fast = fast
        self.slow = slow

    def generate_signals(self, bars: pd.DataFrame) -> list[TradeAction]:
        close = bars["close"]
        f_ma = close.rolling(self.fast, min_periods=1).mean()
        s_ma = close.rolling(self.slow, min_periods=1).mean()
        diff = f_ma - s_ma
        prev = diff.shift(1)
        # 金叉：prev<=0 && diff>0；死叉：prev>=0 && diff<0
        signals = []
        for i in range(1, len(bars)):
            d = diff.iloc[i]
            p = prev.iloc[i] if i >= 1 else None
            if pd.isna(d) or pd.isna(p):
                continue
            if p <= 0 and d > 0:
                signals.append(TradeAction(
                    i, bars.index[i], Signal.LONG,
                    float(close.iloc[i]), 0))
            elif p >= 0 and d < 0:
                signals.append(TradeAction(
                    i, bars.index[i], Signal.SHORT,
                    float(close.iloc[i]), 0))
        return signals


class RSIBounce(BaseStrategy):
    """RSI < 30 买入，RSI > 70 卖出（简化）。"""

    def __init__(self, period: int = 14, oversold: float = 30,
                 overbought: float = 70):
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    @staticmethod
    def _rsi(close: pd.Series, period: int) -> pd.Series:
        delta = close.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        return 100 - (100 / (1 + rs))

    def generate_signals(self, bars: pd.DataFrame) -> list[TradeAction]:
        rsi = self._rsi(bars["close"], self.period)
        close = bars["close"]
        signals: list[TradeAction] = []
        for i in range(self.period, len(bars)):
            val = rsi.iloc[i]
            prev = rsi.iloc[i - 1] if i > 0 else np.nan
            if pd.isna(val) or pd.isna(prev):
                continue
            if prev >= self.oversold and val < self.oversold:
                signals.append(TradeAction(
                    i, bars.index[i], Signal.LONG,
                    float(close.iloc[i]), 0))
            elif prev <= self.overbought and val > self.overbought:
                signals.append(TradeAction(
                    i, bars.index[i], Signal.SHORT,
                    float(close.iloc[i]), 0))
        return signals


__all__ = ["Signal", "TradeAction", "BaseStrategy", "MACross", "RSIBounce"]
