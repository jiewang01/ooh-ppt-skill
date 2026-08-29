"""L3 四阶闭环执行器：假设 → 验证 → 解读 → 迭代。"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

from .bias_correction import BiasCorrector, BiasCheckResult
from .planner import LLMPlanner, Plan, PlanStep, StepKind


@dataclass
class StepResult:
    step: PlanStep
    ok: bool
    result: Any = None
    error: str = ""
    bias: BiasCheckResult | None = None


@dataclass
class LoopResult:
    plan: Plan
    results: list[StepResult] = field(default_factory=list)
    ok: bool = False
    stop_reason: str = ""

    def summary(self) -> dict:
        return {
            "goal": self.plan.goal,
            "ok": self.ok,
            "stop_reason": self.stop_reason,
            "n_steps": len(self.results),
            "steps": [
                {"kind": r.step.kind.value, "ok": r.ok,
                 "error": r.error,
                 "has_bias": r.bias.has_bias if r.bias else False}
                for r in self.results
            ],
        }


class AgentLoop:
    """四阶闭环执行器（v0.8.0）。

    失控防护：
    - 最大迭代次数 max_iterations；
    - 任一步骤连续失败 max_retries 次则中断；
    - 偏差校正有严重偏差（score > 0.8）则强制停止。
    """

    def __init__(self, max_iterations: int = 4, max_retries: int = 2,
                 bias_score_stop: float = 0.8):
        self.planner = LLMPlanner()
        self.bias = BiasCorrector()
        self.max_iterations = max_iterations
        self.max_retries = max_retries
        self.bias_score_stop = bias_score_stop

    def run(self, goal: str, *, tool_callback=None,
            hypothesis_text: str = "",
            evidence_text: str = "",
            extra_bias_kwargs: dict | None = None) -> LoopResult:
        plan = self.planner.build(goal)
        loop = LoopResult(plan=plan)

        for it in range(self.max_iterations):
            iteration_ok = True
            for step in plan.steps:
                retries = 0
                while True:
                    step_res = StepResult(step=step, ok=False)
                    try:
                        if step.kind == StepKind.HYPOTHESIS:
                            step_res.ok = bool(hypothesis_text or it > 0)
                            step_res.result = {"hypothesis": hypothesis_text or "默认假设"}
                        elif step.kind == StepKind.VALIDATE:
                            if tool_callback:
                                step_res.result = tool_callback(step, "validate")
                                step_res.ok = True
                            else:
                                step_res.ok = True
                                step_res.result = {"metrics": {"mock": True}}
                        elif step.kind == StepKind.INTERPRET:
                            bw = extra_bias_kwargs or {}
                            bc = self.bias.check(
                                hypothesis=hypothesis_text,
                                evidence_text=evidence_text, **bw)
                            step_res.bias = bc
                            if bc.detected:
                                worst = max(b.score for b in bc.detected)
                                step_res.ok = worst <= self.bias_score_stop
                            else:
                                step_res.ok = True
                            step_res.result = bc.to_dict()
                        elif step.kind == StepKind.ITERATE:
                            if tool_callback:
                                step_res.result = tool_callback(step, "register")
                            step_res.ok = True
                    except Exception as e:  # noqa: BLE001
                        step_res.error = f"{type(e).__name__}: {e}"

                    loop.results.append(step_res)
                    if step_res.ok:
                        break
                    retries += 1
                    if retries >= self.max_retries:
                        loop.stop_reason = (
                            f"步骤 {step.kind.value} 连续失败 {retries} 次")
                        loop.ok = False
                        return loop
                    iteration_ok = False

                # INTERPRET 有严重偏差 → 立即终止
                if step.kind == StepKind.INTERPRET and step_res.bias and \
                        any(b.score > self.bias_score_stop
                            for b in step_res.bias.detected):
                    loop.stop_reason = "偏差校正检出严重偏差，强制中止"
                    loop.ok = False
                    return loop

            if iteration_ok:
                loop.ok = True
                loop.stop_reason = f"第 {it+1} 轮闭环全部通过"
                return loop

        loop.stop_reason = f"达到最大迭代 {self.max_iterations} 次仍未全通过"
        return loop


__all__ = ["StepResult", "LoopResult", "AgentLoop"]
