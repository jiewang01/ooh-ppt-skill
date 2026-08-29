"""回测引擎：A 股 T+1 / 涨跌停 / 手续费 / 滑点。"""
from __future__ import annotations
import pandas as pd
import pytest

from src.infra.data.sources.base import SyntheticSource
from src.primitives.backtest.engine import BacktestEngine
from src.primitives.backtest.strategy import MACross, RSIBounce


@pytest.fixture
def bars():
    src = SyntheticSource(seed=7)
    return src.get_daily("600519.SH", "2022-01-01", "2024-12-31")


def test_ma_cross_runs(bars):
    e = BacktestEngine(bars, MACross(5, 20), cash=1_000_000)
    r = e.run()
    assert len(r.equity_curve) == len(bars)
    assert r.metrics.final_equity > 0
    # final_cash + 仓位 = 总资产
    assert abs(r.metrics.final_cash + r.metrics.final_position_value
               - r.metrics.final_equity) < 0.1


def test_ma_cross_metrics_populated(bars):
    e = BacktestEngine(bars, MACross(5, 20))
    r = e.run()
    for k in ("total_return", "annual_return", "sharpe", "sortino",
              "max_drawdown", "calmar", "volatility"):
        assert isinstance(getattr(r.metrics, k), float)
    assert r.metrics.n_bars == len(bars)


def test_rsi_bounce_runs(bars):
    e = BacktestEngine(bars, RSIBounce(14, 30, 70))
    r = e.run()
    assert len(r.equity_curve) == len(bars)
    assert r.metrics.final_equity > 0


def test_invalid_ma_params():
    with pytest.raises(ValueError):
        MACross(fast=20, slow=5)
    with pytest.raises(ValueError):
        MACross(fast=0, slow=5)
