"""L4 治理：人审闸门 + 目标校验。

用于需要人工确认的节点（审核策略上线、变更目标等）。
自动化流程里可以直接跳过（Decision.AUTO_APPROVE 兜底）。
"""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum


class Decision(Enum):
    AUTO_APPROVE = "auto_approve"   # 流程自动放行
    APPROVE = "approve"
    REJECT = "reject"
    REVISE = "revise"               # 修订后再提交


@dataclass
class HumanGateResult:
    decision: Decision
    comment: str = ""


class HumanGate:
    """人审闸门：当前为自动模式（防卡流程），
    后续可以接飞书/钉钉/邮件让真人审批。"""

    def __init__(self, auto_approve: bool = True):
        self.auto_approve = auto_approve

    def ask(self, subject: str, detail: str = "",
            timeout_seconds: int = 0) -> HumanGateResult:
        # 当前只支持自动通过；真实环境把这里换成前端交互/审批 API
        if self.auto_approve:
            return HumanGateResult(Decision.AUTO_APPROVE,
                                   "自动通过（HumanGate.auto_approve=True）")
        return HumanGateResult(Decision.REJECT,
                               "人审未接入当前环境，默认拒绝")


__all__ = ["Decision", "HumanGateResult", "HumanGate"]
