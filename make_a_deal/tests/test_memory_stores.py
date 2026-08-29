"""MemoryStore 单元测试（Defender：正常写入 + Attacker 异常路径）。"""
from __future__ import annotations
import os
import tempfile
import pytest

from src.memory.stores import MemoryStore


@pytest.fixture
def tmp_jsonl(tmp_path):
    return str(tmp_path / "m.jsonl")


def test_append_and_all(tmp_jsonl):
    s = MemoryStore(tmp_jsonl, dedup_keys=("a",))
    assert s.append({"a": 1, "b": "x"}) is True
    assert s.append({"a": 2, "b": "y"}) is True
    assert len(s.all_records()) == 2


def test_dedup_by_key(tmp_jsonl):
    s = MemoryStore(tmp_jsonl, dedup_keys=("a",))
    assert s.append({"a": 1, "b": "x"}) is True
    assert s.append({"a": 1, "b": "z"}) is False  # 同 a=1 → 指纹冲突
    assert len(s.all_records()) == 1


def test_search_keyword(tmp_jsonl):
    s = MemoryStore(tmp_jsonl, dedup_keys=("id",))
    s.append({"id": 1, "text": "均线交叉 动量因子"})
    s.append({"id": 2, "text": "RSI 超卖反弹"})
    hits = s.search_keyword("均线")
    assert len(hits) == 1 and hits[0]["id"] == 1


def test_search_similar(tmp_jsonl):
    s = MemoryStore(tmp_jsonl, dedup_keys=("id",))
    s.append({"id": 1, "formula": "rank(close.pct_change(20))"})
    s.append({"id": 2, "formula": "mean(volume) over 10 days"})
    hits = s.search_similar("rank(close.pct_change(20))",
                            text_fields=("formula",), threshold=0.5)
    assert len(hits) >= 1 and hits[0][1]["id"] == 1


def test_purge_safety(tmp_jsonl):
    s = MemoryStore(tmp_jsonl, dedup_keys=("id",))
    for i in range(10):
        s.append({"id": i})
    # 删 6 / 10 = 超过半数 → 拦截
    with pytest.raises(RuntimeError):
        s.purge(lambda r: r["id"] < 6)
    # 删 5 / 10 = 恰好半数（不超过）→ ok ？实测实现是 > total // 2
    # total // 2 = 5，removed=5 → 不触发
    removed = s.purge(lambda r: r["id"] < 5)
    assert removed == 5 and len(s.all_records()) == 5


def test_atomic_write_no_dupes(tmp_jsonl):
    s = MemoryStore(tmp_jsonl, dedup_keys=("k",))
    n = 100
    oks = sum(1 for i in range(n) if s.append({"k": 42, "i": i}))
    assert oks == 1
    assert len(s.all_records()) == 1
