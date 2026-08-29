"""审计轨迹：submit → approve → 注册闸门 / reject / revoke。"""
from __future__ import annotations
import pytest

from src.governance.audit import AuditTrail, AuditStatus


@pytest.fixture
def au(tmp_path):
    return AuditTrail(str(tmp_path / "a.jsonl"))


def test_submit_requires_evidence(au):
    with pytest.raises(ValueError):
        au.submit("strategy", "S", "rules")


def test_submit_invalid_type(au):
    with pytest.raises(ValueError):
        au.submit("something_wrong", "S", "r", evidence={"a": 1})


def test_approve_happy_path(au):
    ev = {"total_return": 0.1}
    assert au.submit("factor", "F", "formula", evidence=ev) is True
    assert au.is_approved("F", "formula") is False
    assert au.approve("F", "formula", reviewer="human") is True
    assert au.is_approved("F", "formula") is True


def test_approve_no_pending(au):
    # 没有 submit 直接 approve → False
    assert au.approve("nothing", "x", reviewer="human") is False


def test_approve_twice(au):
    au.submit("factor", "F", "formula", evidence={"a": 1})
    assert au.approve("F", "formula", reviewer="a") is True
    assert au.approve("F", "formula", reviewer="b") is False


def test_reject(au):
    au.submit("strategy", "S", "r", evidence={"a": 1})
    assert au.reject("S", "r", reviewer="h", reason="夏普太低") is True
    assert au.is_approved("S", "r") is False


def test_revoke(au):
    au.submit("strategy", "S", "r", evidence={"a": 1})
    au.approve("S", "r", reviewer="h")
    assert au.is_approved("S", "r") is True
    assert au.revoke("S", "r", reviewer="h2", reason="样本外失活") is True
    assert au.is_approved("S", "r") is False


def test_list_pending(au):
    au.submit("factor", "F1", "f1", evidence={"a": 1})
    au.submit("strategy", "S1", "s1", evidence={"a": 1})
    au.approve("F1", "f1", reviewer="h")
    pending = au.list_pending()
    assert len(pending) == 1 and pending[0]["name"] == "S1"
