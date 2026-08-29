"""L3 计划器：把自然语言目标拆解成四阶闭环（假设→验证→解读→迭代）。"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
import re


class StepKind(Enum):
    HYPOTHESIS = "hypothesis"
    VALIDATE = "validate"
    INTERPRET = "interpret"
    ITERATE = "iterate"


@dataclass
class PlanStep:
    kind: StepKind
    description: str
    tool: str = ""
    params: dict = field(default_factory=dict)
    checks: list[str] = field(default_factory=list)


@dataclass
class Plan:
    goal: str
    steps: list[PlanStep] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"goal": self.goal,
                "steps": [{"kind": s.kind.value, "description": s.description,
                           "tool": s.tool, "params": s.params,
                           "checks": s.checks} for s in self.steps]}


class LLMPlanner:
    """轻量启发式 Planner（不依赖 LLM API 时也能工作）：
    基于关键词映射出标准四阶闭环步骤。"""

    KEYWORDS = {
        StepKind.HYPOTHESIS:
            ["因子", "策略", "alpha", "假设", "设计", "formula", "rules"],
        StepKind.VALIDATE:
            ["回测", "验证", "backtest", "回测指标", "样本外", "wfo"],
        StepKind.INTERPRET:
            ["归因", "解读", "偏差", "bias", "解释", "分析", "原因"],
        StepKind.ITERATE:
            ["迭代", "改进", "优化", "注册", "入库", "登记", "反向入库"],
    }

    @staticmethod
    def _detect_kind(text: str) -> StepKind:
        t = text.lower()
        best = StepKind.HYPOTHESIS
        best_count = 0
        for k, words in LLMPlanner.KEYWORDS.items():
            cnt = sum(1 for w in words if w in t)
            if cnt > best_count:
                best = k
                best_count = cnt
        return best

    def build(self, goal: str) -> Plan:
        goal = (goal or "").strip()
        plan = Plan(goal=goal or "默认目标：生成因子并回测验证")

        # 步骤 1：假设
        plan.steps.append(PlanStep(
            StepKind.HYPOTHESIS,
            "写出因子公式/策略规则，明确假设逻辑与适用市场状态",
            checks=["公式语法可解析", "逻辑非 tautology"],
        ))
        # 步骤 2：验证
        plan.steps.append(PlanStep(
            StepKind.VALIDATE,
            "跑回测：T+1 / 涨跌停 / 手续费，样本外 WFO 验证",
            tool="backtest",
            checks=["sharpe ≥ 1.0 或基准胜率 ≥ 55%",
                    "max_drawdown ≤ 20%"],
        ))
        # 步骤 3：解读 + 偏差校正
        plan.steps.append(PlanStep(
            StepKind.INTERPRET,
            "做 Brinson 归因 + 偏差校正（近因/确认/空证据/过拟合）",
            tool="bias_correction",
            checks=["bias_correction 未检出严重偏差（score ≤ 0.5）"],
        ))
        # 步骤 4：迭代 → 审计 → 注册
        plan.steps.append(PlanStep(
            StepKind.ITERATE,
            "如通过：查重 → 提交审计 → 审核 → 注册到本地 repo；"
            "不通过：修订公式/参数回到步骤 1",
            tool="register_artifact",
            checks=["审计 approved", "register 返回 registered=True"],
        ))
        return plan

    def validate(self, plan: Plan) -> list[str]:
        issues: list[str] = []
        if not plan.goal:
            issues.append("goal 为空")
        kinds = [s.kind for s in plan.steps]
        for need in (StepKind.HYPOTHESIS, StepKind.VALIDATE,
                     StepKind.INTERPRET, StepKind.ITERATE):
            if need not in kinds:
                issues.append(f"缺少 {need.value} 步骤")
        return issues


__all__ = ["StepKind", "PlanStep", "Plan", "LLMPlanner"]
