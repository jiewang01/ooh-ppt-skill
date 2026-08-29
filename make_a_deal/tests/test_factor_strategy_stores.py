"""FactorStore / StrategyStore 注册前查重测试。"""
from __future__ import annotations
import pytest

from src.memory.factor_strategy_stores import FactorStore, StrategyStore


@pytest.fixture
def fs(tmp_path):
    return FactorStore(str(tmp_path / "f.jsonl"))


@pytest.fixture
def ss(tmp_path):
    return StrategyStore(str(tmp_path / "s.jsonl"))


def test_factor_register_and_check(fs):
    assert fs.register("动量", "rank(close.pct_change(20))") is True
    dup = fs.check_before_register("动量", "rank(close.pct_change(20))")
    assert dup.exact_dup is True


def test_factor_same_name_different_formula(fs):
    fs.register("动量", "rank(close.pct_change(20))")
    dup = fs.check_before_register("动量", "rank(close.pct_change(10))")
    assert dup.exact_dup is False
    # 同名 → 会以 score=1.0 出现在 similar
    assert any(s == 1.0 for s, _ in dup.similar)


def test_factor_similar_formula(fs):
    fs.register("动量A", "rank(close.pct_change(20))")
    dup = fs.check_before_register("动量B", "rank(close.pct_change(20))")
    # 公式完全相同（不同名）→ 相似命中
    assert dup.exact_dup is False
    assert len(dup.similar) >= 1


def test_strategy_register_dup(ss):
    rules = "buy when MA5>MA20, sell otherwise"
    assert ss.register("MA交叉", rules, desc="demo") is True
    dup = ss.check_before_register("MA交叉", rules)
    assert dup.exact_dup is True


def test_strategy_dup_returns_false(ss):
    rules = "buy rsi<30"
    assert ss.register("R", rules) is True
    assert ss.register("R", rules) is False  # 指纹去重
