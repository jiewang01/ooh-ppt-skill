"""偏差校正：四类偏差检出。"""
from __future__ import annotations
from src.agent.bias_correction import BiasCorrector, BiasType


bc = BiasCorrector()


def test_no_evidence_detected():
    r = bc.check(hypothesis="随便的假设", evidence_text="")
    assert r.has_bias
    assert any(b.bias == BiasType.NO_EVIDENCE for b in r.detected)


def test_short_evidence_detected():
    r = bc.check(hypothesis="x", evidence_text="ok")
    assert any(b.bias == BiasType.NO_EVIDENCE and b.score > 0.5
               for b in r.detected)


def test_overfit_by_params_ratio():
    r = bc.check(hypothesis="H", evidence_text="回测结果为正",
                 n_params=20, n_samples=100)  # 20% → 超限
    assert any(b.bias == BiasType.OVERFIT for b in r.detected)


def test_recency_by_lookback_ratio():
    r = bc.check(hypothesis="H", evidence_text="ok",
                 lookback_days=60, total_days=500)  # 12% < 30%
    assert any(b.bias == BiasType.RECENCY for b in r.detected)


def test_recency_words():
    r = bc.check(hypothesis="最近一个月收益率不错，一定有效",
                 evidence_text="最近数据支持")
    assert any(b.bias == BiasType.RECENCY for b in r.detected)


def test_confirmation_absolute_words():
    r = bc.check(hypothesis="该策略必然盈利，所有样本都支持",
                 evidence_text="一定赚")
    assert any(b.bias == BiasType.CONFIRMATION for b in r.detected)


def test_clean_hypothesis_no_bias():
    r = bc.check(
        hypothesis="MA(5)/MA(20) 交叉在震荡市可能有效",
        evidence_text="sharpe=1.35, max_drawdown=0.07, n_trades=32, "
                      "样本内 2020-2023，样本外 2024H1 一致",
        n_params=2, n_samples=1000,
        lookback_days=1500, total_days=1500,
    )
    # 没有 score > 0.5 的严重偏差
    assert not r.has_bias
