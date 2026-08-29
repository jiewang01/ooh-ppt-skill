"""L1 行情源基类 + 合成行情（用于离线演示、冒烟测试）。

真实数据接 akshare / tushare，用 `AkshareSource` / `TushareSource`，
当前实现 `SyntheticSource` 保证不依赖外部 API 就能跑。
"""
from __future__ import annotations
import os
import pickle
from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class BarData:
    df: pd.DataFrame       # 列: open/high/low/close/volume/amount
    code: str
    source: str


class BaseSource(ABC):
    @abstractmethod
    def get_daily(self, code: str, start: str, end: str) -> pd.DataFrame:
        ...


class SyntheticSource(BaseSource):
    """几何布朗运动合成行情，确定性随机（固定 seed 可复现）。"""

    def __init__(self, seed: int = 42, start_price: float = 100.0,
                 mu: float = 0.08, sigma: float = 0.25):
        self.seed = seed
        self.start_price = start_price
        self.mu = mu
        self.sigma = sigma

    def get_daily(self, code: str, start: str, end: str) -> pd.DataFrame:
        dates = pd.bdate_range(start=start, end=end)
        rng = np.random.default_rng(self.seed + hash(code) % 2**31)
        n = len(dates)
        dt = 1 / 252
        drift = (self.mu - 0.5 * self.sigma ** 2) * dt
        shocks = rng.normal(0, self.sigma * np.sqrt(dt), n)
        log_returns = drift + shocks
        close = self.start_price * np.exp(np.cumsum(log_returns))
        high = close * (1 + np.abs(rng.normal(0, 0.01, n)))
        low = close * (1 - np.abs(rng.normal(0, 0.01, n)))
        open_ = np.concatenate([[close[0]], close[:-1]])
        open_ = open_ * (1 + rng.normal(0, 0.003, n))
        volume = (1_000_000 + rng.integers(0, 5_000_000, n)).astype(float)
        amount = volume * close * (0.95 + rng.uniform(0, 0.1, n))
        df = pd.DataFrame({
            "open": open_, "high": high, "low": low,
            "close": close, "volume": volume, "amount": amount,
        }, index=pd.DatetimeIndex(dates, name="date"))
        return df


class ParquetCache:
    """简单 Parquet 缓存：每个 code 一个文件。"""

    def __init__(self, dir_: str):
        self.dir = dir_
        os.makedirs(dir_, exist_ok=True)

    def _path(self, code: str) -> str:
        return os.path.join(self.dir, f"{code}.parquet")

    def get(self, code: str):
        p = self._path(code)
        if os.path.exists(p):
            return pd.read_parquet(p)
        return None

    def put(self, code: str, df: pd.DataFrame) -> None:
        df.to_parquet(self._path(code))


__all__ = ["BarData", "BaseSource", "SyntheticSource", "ParquetCache"]
