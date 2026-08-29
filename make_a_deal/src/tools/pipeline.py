"""v1.0 端到端 Pipeline Demo：

合成数据 → 因子 → 回测 → 风控 → 偏差校正 → 审计入库（若回测指标达标）。
全程无外部 API 依赖，可离线跑通。
"""
from __future__ import annotations
import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..infra.data.sources.base import SyntheticSource
from ..infra.universe.csi import get_universe
from ..primitives.factors.alpha101 import compute_all
from ..primitives.backtest.engine import BacktestEngine, BacktestResult
from ..primitives.backtest.strategy import MACross
from ..primitives.risk.gates import RiskManager, RiskDecision
from ..agent.bias_correction import BiasCorrector, BiasCheckResult
from ..agent.loop import AgentLoop, LoopResult
from ..governance.audit import AuditTrail
from ..memory.factor_strategy_stores import FactorStore, StrategyStore


@dataclass
class StepState:
    name: str
    ok: bool = False
    result: dict | None = None
    error: str = ""


@dataclass
class PipelineResult:
    ok: bool = False
    stop_reason: str = ""
    steps: list[StepState] = field(default_factory=list)
    bt_result: BacktestResult | None = None
    bias_result: BiasCheckResult | None = None
    loop_result: LoopResult | None = None

    def summary(self) -> dict:
        steps = [{"name": s.name, "ok": s.ok, "error": s.error,
                  "result_keys": list(s.result.keys())[:8] if s.result else []}
                 for s in self.steps]
        metrics = (self.bt_result.metrics.__dict__.copy()
                   if self.bt_result and self.bt_result.metrics else {})
        return {
            "ok": self.ok,
            "stop_reason": self.stop_reason,
            "n_steps": len(self.steps),
            "steps": steps,
            "backtest_metrics": metrics,
            "bias": self.bias_result.to_dict() if self.bias_result else None,
        }


# ---------------------------------------------------------------- helpers
def make_synthetic_panel(n_days: int = 252, n_stocks: int = 10,
                         start: str = "2020-01-01",
                         end: str = "2024-12-31",
                         seed: int = 42) -> pd.DataFrame:
    """构造 MultiIndex(date, code) × OHLCV panel（合成数据）。"""
    uni = get_universe("csi300")
    codes = list(uni["code"].iloc[:n_stocks])
    src = SyntheticSource(seed=seed)
    dfs: list[pd.DataFrame] = []
    for i, code in enumerate(codes):
        # 每天数不严格相等（bdate_range 会按年份变化），但这里统一按参数控制范围
        df = src.get_daily(code, start, end)
        if len(df) > n_days:
            df = df.iloc[-n_days:]
        df = df.assign(code=code)
        dfs.append(df.set_index([df.index, "code"]))
    panel = pd.concat(dfs)
    panel.index = panel.index.set_names(["date", "code"])
    return panel.sort_index()


# ---------------------------------------------------------------- 主流程
def run_pipeline(*, code: str = "600519.SH",
                 n_days: int = 504,
                 fast: int = 5, slow: int = 20,
                 cash: float = 1_000_000,
                 data_dir: str = "data",
                 auto_register_passing: bool = False,
                 ) -> PipelineResult:
    os.makedirs(data_dir, exist_ok=True)
    factor_store = FactorStore(os.path.join(data_dir, "factor_store.jsonl"))
    strategy_store = StrategyStore(os.path.join(data_dir, "strategy_store.jsonl"))
    audit = AuditTrail(os.path.join(data_dir, "audit_trail.jsonl"))

    res = PipelineResult()
    risk = RiskManager()
    bias = BiasCorrector()

    # Step 1: 数据加载
    s = StepState(name="load_data")
    try:
        panel = make_synthetic_panel(n_days=n_days, n_stocks=1)
        if code:
            old_code = panel.index.get_level_values("code").unique()[0]
            panel = panel.rename(index={old_code: code}, level="code")
        s.ok = True
        s.result = {"n_bars": len(panel), "codes": list(
            panel.index.get_level_values("code").unique())}
    except Exception as e:  # noqa: BLE001
        s.error = f"{type(e).__name__}: {e}"
        res.steps.append(s)
        res.stop_reason = "数据加载失败"
        return res
    res.steps.append(s)

    # Step 2: 因子计算
    s = StepState(name="compute_factors")
    try:
        factors = compute_all(panel)
        s.ok = True
        s.result = {"n_factors": len(factors.columns),
                    "n_rows": len(factors)}
    except Exception as e:  # noqa: BLE001
        s.error = f"{type(e).__name__}: {e}"
        res.steps.append(s)
        res.stop_reason = "因子计算失败"
        return res
    res.steps.append(s)

    # Step 3: 回测
    s = StepState(name="backtest")
    try:
        bars = panel.xs(code, level="code") if code else panel.xs(
            panel.index.get_level_values("code").unique()[0], level="code")
        strategy = MACross(fast=fast, slow=slow)
        engine = BacktestEngine(bars, strategy, code=code, cash=cash)
        bt = engine.run()
        res.bt_result = bt
        s.ok = True
        s.result = {k: (round(v, 6) if isinstance(v, float) else v)
                    for k, v in bt.metrics.__dict__.items()}
    except Exception as e:  # noqa: BLE001
        s.error = f"{type(e).__name__}: {e}"
        res.steps.append(s)
        res.stop_reason = "回测失败"
        return res
    res.steps.append(s)

    # Step 4: 风控闸门
    s = StepState(name="risk_check")
    try:
        ctx = {
            "equity_curve": bt.equity_curve,
            "equity": float(bt.equity_curve.iloc[-1]),
            "position_value": bt.metrics.final_position_value,
        }
        rd: RiskDecision = risk.portfolio_check(ctx)
        s.ok = not rd.stop_all and rd.reduce_pct < 0.5
        s.result = {"stop_all": rd.stop_all,
                    "reduce_pct": rd.reduce_pct,
                    "reasons": rd.reasons}
    except Exception as e:  # noqa: BLE001
        s.error = f"{type(e).__name__}: {e}"
        res.steps.append(s)
        res.stop_reason = "风控失败"
        return res
    res.steps.append(s)

    # Step 5: 偏差校正
    s = StepState(name="bias_correction")
    try:
        hypothesis = f"均线交叉 {fast}/{slow}，标的 {code}"
        evidence_text = (
            f"total_return={bt.metrics.total_return:.4f}, "
            f"sharpe={bt.metrics.sharpe:.4f}, "
            f"max_drawdown={bt.metrics.max_drawdown:.4f}, "
            f"n_trades={bt.metrics.n_trades}")
        bc = bias.check(
            hypothesis=hypothesis,
            evidence_text=evidence_text,
            equity_curve=bt.equity_curve,
            n_params=2, n_samples=len(bt.equity_curve),
            lookback_days=len(bt.equity_curve),
            total_days=len(bt.equity_curve),
        )
        res.bias_result = bc
        worst = max((b.score for b in bc.detected), default=0.0)
        s.ok = worst <= 0.7
        s.result = bc.to_dict()
    except Exception as e:  # noqa: BLE001
        s.error = f"{type(e).__name__}: {e}"
        res.steps.append(s)
        res.stop_reason = "偏差校正失败"
        return res
    res.steps.append(s)

    # Step 6: 审计（达标则 submit + approve + 可选注册）
    s = StepState(name="audit_register")
    try:
        metrics_pass = (
            bt.metrics.sharpe >= 0.5 or bt.metrics.total_return >= 0.0)
        rules = (f"MA({fast})-MA({slow}) Cross: "
                 f"buy on golden cross, sell on death cross")
        evidence_payload = {k: (round(v, 6) if isinstance(v, (int, float))
                                and not isinstance(v, bool) else v)
                            for k, v in bt.metrics.__dict__.items()}
        evidence_payload["bias"] = bc.to_dict() if bc else {}
        submitted = False
        approved = False
        registered = False
        if metrics_pass:
            submitted = audit.submit("strategy",
                                     f"ma_cross_{fast}_{slow}",
                                     rules,
                                     evidence=evidence_payload)
            approved = audit.approve(f"ma_cross_{fast}_{slow}", rules,
                                     reviewer="pipeline-auto")
            if auto_register_passing and approved:
                registered = strategy_store.register(
                    f"ma_cross_{fast}_{slow}", rules,
                    desc=f"自动注册于 pipeline，sharpe={bt.metrics.sharpe:.3f}",
                    version="v1")
        s.ok = True
        s.result = {"metrics_pass": metrics_pass,
                    "submitted": submitted,
                    "approved": approved,
                    "registered": registered}
    except Exception as e:  # noqa: BLE001
        s.error = f"{type(e).__name__}: {e}"
        res.steps.append(s)
        res.stop_reason = "审计失败"
        return res
    res.steps.append(s)

    # Step 7: 四阶闭环（收尾验证，不使用 LLM 时为启发式 checker）
    s = StepState(name="agent_loop")
    try:
        loop = AgentLoop()
        lr = loop.run(
            goal=f"验证均线交叉 {fast}/{slow} 策略并入库",
            hypothesis_text=f"均线交叉 {fast}/{slow} 在标的 {code} 上能获得正收益",
            evidence_text=(
                f"total_return={bt.metrics.total_return:.4f}, "
                f"sharpe={bt.metrics.sharpe:.4f}"),
            extra_bias_kwargs={
                "n_params": 2, "n_samples": len(bt.equity_curve),
                "lookback_days": len(bt.equity_curve),
                "total_days": len(bt.equity_curve),
            },
        )
        res.loop_result = lr
        s.ok = lr.ok
        s.result = lr.summary()
    except Exception as e:  # noqa: BLE001
        s.error = f"{type(e).__name__}: {e}"
        res.steps.append(s)
        res.stop_reason = "AgentLoop 失败"
        return res
    res.steps.append(s)

    res.ok = all(st.ok for st in res.steps)
    res.stop_reason = res.stop_reason or ("全部通过" if res.ok else "有步骤失败")
    return res


__all__ = ["PipelineResult", "make_synthetic_panel", "run_pipeline"]
