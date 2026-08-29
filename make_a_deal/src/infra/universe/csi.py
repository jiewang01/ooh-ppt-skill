"""L1 Universe：沪深 300/500/50 成分股。

真实环境接 tushare.index_basic()，此处提供 mock 用于离线演示。
"""
from __future__ import annotations
import pandas as pd


MOCK_CODES = {
    "csi300": [
        "600519.SH", "601318.SH", "600036.SH", "000858.SZ",
        "000001.SZ", "600276.SH", "601888.SH", "000333.SZ",
        "601166.SH", "000651.SZ",
    ],
    "csi500": [
        "002027.SZ", "002352.SZ", "300015.SZ", "300059.SZ",
        "002120.SZ", "002460.SZ", "300750.SZ", "000100.SZ",
        "601899.SH", "600009.SH",
    ],
    "csi50": [
        "600519.SH", "601318.SH", "600036.SH", "601398.SH",
        "600900.SH", "000858.SZ", "601888.SH", "000333.SZ",
        "601166.SH", "600276.SH",
    ],
}


def get_universe(name: str) -> pd.DataFrame:
    """返回 columns=[code, name] 的 DataFrame。"""
    codes = MOCK_CODES.get(name.lower()) or MOCK_CODES["csi300"]
    return pd.DataFrame({
        "code": codes,
        "name": [f"股票{i+1}" for i in range(len(codes))],
    })


__all__ = ["get_universe"]
