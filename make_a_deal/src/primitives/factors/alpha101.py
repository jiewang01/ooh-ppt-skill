"""L1 因子：Alpha101 简化实现 + 清洗。

为保证无第三方依赖下可演示，仅实现常用 15 个因子，
接口与 WorldQuant Alpha101 公式命名对齐。
输入是 panel: MultiIndex(date, code) × columns(OHLCV)。
"""
from __future__ import annotations
import numpy as np
import pandas as pd


# ----------------------------- 工具算子 -----------------------------
def _rank(series: pd.Series) -> pd.Series:
    return series.groupby(level="date").rank(pct=True)


def _delay(series: pd.Series, d: int) -> pd.Series:
    return series.groupby(level="code").shift(d)


def _delta(series: pd.Series, d: int) -> pd.Series:
    return series - _delay(series, d)


def _ts_sum(series: pd.Series, d: int) -> pd.Series:
    return series.groupby(level="code").transform(
        lambda s: s.rolling(d, min_periods=1).sum())


def _ts_mean(series: pd.Series, d: int) -> pd.Series:
    return series.groupby(level="code").transform(
        lambda s: s.rolling(d, min_periods=1).mean())


def _ts_std(series: pd.Series, d: int) -> pd.Series:
    return series.groupby(level="code").transform(
        lambda s: s.rolling(d, min_periods=max(2, d // 2)).std())


def _ts_corr(a: pd.Series, b: pd.Series, d: int) -> pd.Series:
    df = pd.DataFrame({"a": a, "b": b})
    def _roll(g):
        return g["a"].rolling(d, min_periods=max(3, d // 2)).corr(g["b"])
    return df.groupby(level="code").apply(_roll).droplevel(0) \
        if False else _corr_impl(a, b, d)


def _corr_impl(a: pd.Series, b: pd.Series, d: int) -> pd.Series:
    # 直接按 code 组拼接 rolling corr
    codes = a.index.get_level_values("code").unique()
    outs: list[pd.Series] = []
    for c in codes:
        x = a.xs(c, level="code").astype(float)
        y = b.xs(c, level="code").astype(float)
        r = x.rolling(d, min_periods=max(3, d // 2)).corr(y)
        r.index = pd.MultiIndex.from_product([r.index, [c]],
                                             names=["date", "code"])
        outs.append(r.swaplevel())
    res = pd.concat(outs)
    return res.reindex(a.index)


# ----------------------------- 因子定义 -----------------------------
def alpha_001(panel: pd.DataFrame) -> pd.Series:
    """rank(Ts_Rank(Ts_Sum(Ts_Delta(close,1),20),6))*(-1) 近似"""
    v = _ts_sum(_delta(panel["close"], 1), 20)
    return _rank(v.groupby(level="code").transform(
        lambda s: s.rolling(6, min_periods=1).rank(pct=True))) * -1


def alpha_002(panel: pd.DataFrame) -> pd.Series:
    return (-1) * _ts_corr(panel["high"], panel["volume"], 5)


def alpha_003(panel: pd.DataFrame) -> pd.Series:
    return _rank(-1 * _ts_corr(panel["open"], panel["volume"], 10))


def alpha_004(panel: pd.DataFrame) -> pd.Series:
    return -_rank(_ts_sum(panel["low"], 9))


def alpha_005(panel: pd.DataFrame) -> pd.Series:
    return (_rank(panel["open"].groupby(level="code").transform(
        lambda s: s.rolling(10, min_periods=1).rank(pct=True).diff()))
            * (-1 * _rank(_delta(panel["close"], 3))))


def alpha_006(panel: pd.DataFrame) -> pd.Series:
    return -_ts_corr(panel["open"], panel["volume"], 10)


def alpha_007(panel: pd.DataFrame) -> pd.Series:
    adv20 = _ts_mean(panel["amount"], 20)
    cond = _ts_sum(panel["amount"], 2) < (1.5 * adv20)
    part_a = _rank(_ts_std(_ts_sum(panel["close"] - panel["open"], 6), 2)) * -1
    part_b = -_rank(_delta(panel["close"], 6))
    return pd.Series(np.where(cond, part_a, part_b), index=panel.index)


def alpha_008(panel: pd.DataFrame) -> pd.Series:
    return _rank(-_ts_sum(panel["high"] - panel["low"], 10)
                 / _ts_sum(panel["close"] - panel["open"], 10))


def alpha_009(panel: pd.DataFrame) -> pd.Series:
    hl = panel["high"] - panel["low"]
    co = panel["close"] - panel["open"]
    return _rank(_ts_corr(hl, co.rolling(5, min_periods=1).mean(), 5)
                 if False else _corr_impl(hl,
                     co.groupby(level="code").transform(
                         lambda s: s.rolling(5, min_periods=1).mean()), 5))


def alpha_010(panel: pd.DataFrame) -> pd.Series:
    return _rank(-_ts_sum(panel["close"] - panel["open"], 9))


# ----------------------------- 价量基础因子 -----------------------------
def f_mom_20(panel: pd.DataFrame) -> pd.Series:
    """20 日动量"""
    return _rank(_delta(panel["close"], 20))


def f_rev_5(panel: pd.DataFrame) -> pd.Series:
    """5 日反转"""
    return -_rank(_delta(panel["close"], 5))


def f_volatility_20(panel: pd.DataFrame) -> pd.Series:
    """20 日波动率"""
    return _ts_std(panel["close"].pct_change().groupby(
        level="code").fillna(0), 20)


def f_turnover(panel: pd.DataFrame) -> pd.Series:
    """换手率（合成金额 proxy）"""
    return panel["amount"] / (panel["close"] * 1e6 + 1e-9)


def f_bollinger_position(panel: pd.DataFrame) -> pd.Series:
    """收盘价在布林带内的位置"""
    mid = _ts_mean(panel["close"], 20)
    std = _ts_std(panel["close"], 20).replace(0, np.nan)
    return (panel["close"] - mid) / (2 * std + 1e-9)


_ALPHA_FUNCS = {
    "alpha_001": alpha_001,
    "alpha_002": alpha_002,
    "alpha_003": alpha_003,
    "alpha_004": alpha_004,
    "alpha_005": alpha_005,
    "alpha_006": alpha_006,
    "alpha_007": alpha_007,
    "alpha_008": alpha_008,
    "alpha_009": alpha_009,
    "alpha_010": alpha_010,
    "mom_20": f_mom_20,
    "rev_5": f_rev_5,
    "volatility_20": f_volatility_20,
    "turnover": f_turnover,
    "bollinger_pos": f_bollinger_position,
}


def compute_all(panel: pd.DataFrame) -> pd.DataFrame:
    """计算全部因子，返回 df: MultiIndex(date, code) × columns(factors)。

    自动清洗：Inf→NaN → 去极值 → 标准化 → 行业/日期内再 zscore（简化版：仅日期内 rank）。
    """
    results: dict[str, pd.Series] = {}
    for name, fn in _ALPHA_FUNCS.items():
        try:
            s = fn(panel).astype(float)
            s = s.replace([np.inf, -np.inf], np.nan)
            results[name] = s
        except Exception:
            continue
    df = pd.DataFrame(results, index=panel.index)
    # 去极值 + zscore（逐日期）
    for col in df.columns:
        ser = df[col]
        gb = ser.groupby(level="date")
        low = gb.transform(lambda x: x.quantile(0.01))
        high = gb.transform(lambda x: x.quantile(0.99))
        ser = ser.clip(lower=low, upper=high)
        mu = gb.transform("mean")
        sigma = gb.transform("std").replace(0, np.nan)
        df[col] = (ser - mu) / sigma
    return df


__all__ = ["compute_all", "_ALPHA_FUNCS"]
