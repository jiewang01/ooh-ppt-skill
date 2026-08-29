#!/usr/bin/env python3
"""MCP Server 入口：将 make_a_deal 工具暴露为 MCP 协议服务。

供 Trae / Claude Code / Codex 等外部 Agent 通过 MCP 协议调用。

运行方式（stdio 传输）：
    python mcp_server.py

Trae 配置（.trae/mcp.json 或设置界面）：
{
  "mcpServers": {
    "make_a_deal": {
      "command": "python",
      "args": ["/path/to/make_a_deal/mcp_server.py"],
      "env": { "TUSHARE_TOKEN": "your_token" }
    }
  }
}
"""
from __future__ import annotations
import os
import sys

# 确保项目根目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

from src.tools.mcp_server import MCPServer, _to_jsonable
from src.tools.pipeline import run_pipeline, make_synthetic_panel
from src.primitives.factors.alpha101 import compute_all
from src.primitives.backtest.engine import BacktestEngine
from src.primitives.backtest.strategy import MACross
from src.governance.sandbox import Sandbox, SandboxConfig
from src.governance.audit import AuditTrail
from src.memory.factor_strategy_stores import FactorStore, StrategyStore

# 本地存储路径
_REPO = os.path.dirname(os.path.abspath(__file__))
_DATA = os.path.join(_REPO, "data")
_FACTOR_STORE = os.path.join(_DATA, "factor_store.jsonl")
_STRATEGY_STORE = os.path.join(_DATA, "strategy_store.jsonl")
_AUDIT_TRAIL = os.path.join(_DATA, "audit_trail.jsonl")

_factor_store = FactorStore(_FACTOR_STORE)
_strategy_store = StrategyStore(_STRATEGY_STORE)
_audit = AuditTrail(_AUDIT_TRAIL)

mcp = FastMCP("make_a_deal")


# ---------------------------------------------------------------- L1-L4 工具
@mcp.tool()
def run_quant_pipeline() -> str:
    """端到端量化 pipeline：合成数据→因子→回测→风控→偏差校正→审计。
    返回各步骤执行状态和回测指标。
    """
    res = run_pipeline()
    steps = [{"name": s.name, "ok": s.ok, "result": s.result,
              "error": s.error} for s in res.steps]
    return _to_jsonable({
        "ok": res.ok,
        "stop_reason": res.stop_reason,
        "steps": steps,
    })


@mcp.tool()
def compute_alpha_factors(code: str, n_days: int = 250) -> str:
    """计算 Alpha101 因子（使用合成数据演示）。
    Args:
        code: 股票代码（如 600519）
        n_days: 天数（默认 250）
    Returns:
        因子统计摘要 JSON
    """
    panel = make_synthetic_panel(n_days=n_days, n_stocks=1)
    panel = panel.rename(
        {panel.index.get_level_values("code")[0]: code}, level="code")
    factors = compute_all(panel)
    summary = {col: {
        "mean": float(factors[col].mean()) if factors[col].count() else None,
        "std": float(factors[col].std()) if factors[col].count() else None,
    } for col in factors.columns}
    return _to_jsonable({"n_factors": len(factors.columns),
                         "summary": summary})


@mcp.tool()
def backtest_ma_cross(code: str, fast: int = 5, slow: int = 20,
                      cash: float = 100000) -> str:
    """均线交叉回测（使用合成数据演示）。
    Args:
        code: 股票代码
        fast: 快线天数（默认 5）
        slow: 慢线天数（默认 20）
        cash: 初始资金（默认 100000）
    Returns:
        回测指标 JSON（total_return, sharpe, max_drawdown, ...）
    """
    panel = make_synthetic_panel(n_days=250, n_stocks=1)
    first_code = panel.index.get_level_values("code").unique()[0]
    px = panel.xs(first_code, level="code")
    strategy = MACross(fast=fast, slow=slow)
    engine = BacktestEngine(px, strategy, cash=cash, code=code)
    result = engine.run()
    return _to_jsonable(result.metrics)


@mcp.tool()
def sandbox_execute(code: str, timeout: int = 10) -> str:
    """在沙箱中安全执行 Python 代码。
    禁止 os/subprocess/socket；open() 限工作目录；eval/exec 移除。
    Args:
        code: Python 代码字符串
        timeout: 超时秒数（默认 10）
    Returns:
        执行结果 JSON（ok, stdout, stderr, exit_code）
    """
    sb = Sandbox(SandboxConfig(timeout=timeout))
    res = sb.run(code)
    return _to_jsonable({
        "ok": res.ok,
        "stdout": res.stdout,
        "stderr": res.stderr,
        "exit_code": res.exit_code,
        "timed_out": res.timed_out,
        "error": res.error,
    })


# ---------------------------------------------------------------- 反向入库（Agent → 本地 repo）
@mcp.tool()
def check_duplicate(artifact_type: str, name: str, content: str) -> str:
    """注册前查重：检查因子/策略是否已存在或高度相似。

    Agent 发现好策略/因子后，先调用此工具查重，避免重复注册。
    Args:
        artifact_type: "factor" 或 "strategy"
        name: 因子/策略名称
        content: factor→公式表达式, strategy→规则文本
    Returns:
        {"exact_dup": bool, "similar": [(score, record), ...]}
    """
    if artifact_type == "factor":
        dup = _factor_store.check_before_register(name, content)
    elif artifact_type == "strategy":
        dup = _strategy_store.check_before_register(name, content)
    else:
        return _to_jsonable({"error": "artifact_type 须 factor/strategy"})
    return _to_jsonable({
        "exact_dup": dup.exact_dup,
        "similar_count": len(dup.similar),
        "similar": [{"score": s, "record": r} for s, r in dup.similar[:5]],
    })


@mcp.tool()
def submit_for_audit(artifact_type: str, name: str, content: str,
                     evidence: str = "") -> str:
    """提交因子/策略到审计轨迹（须附回测证据）。

    Agent 跑完回测发现好策略 → 调用此工具提交审计。
    无 evidence 的提交会被拒绝（防拍脑袋通过）。
    Args:
        artifact_type: "factor" 或 "strategy"
        name: 因子/策略名称
        content: factor→公式表达式, strategy→规则文本
        evidence: JSON 字符串，如 '{"total_return":0.15,"sharpe":1.2,"max_drawdown":0.08}'
    Returns:
        {"submitted": bool, "msg": "..."}
    """
    import json
    try:
        ev = json.loads(evidence) if evidence else {}
    except json.JSONDecodeError:
        ev = {"raw": evidence}
    try:
        ok = _audit.submit(artifact_type, name, content, evidence=ev)
        return _to_jsonable({"submitted": ok,
                             "msg": "已提交，待审核" if ok else "重复提交（已有 pending）"})
    except ValueError as e:
        return _to_jsonable({"submitted": False, "msg": str(e)})


@mcp.tool()
def approve_audit(name: str, content: str, reviewer: str = "agent",
                  version: str = "") -> str:
    """审核通过 pending 中的因子/策略（人审或 Agent 辅助审）。

    安全：只批准已有 pending 记录的 artifact，不可凭空通过。
    Args:
        name: 因子/策略名称
        content: factor→公式, strategy→规则
        reviewer: 审核人标识
        version: 版本号（可选）
    Returns:
        {"approved": bool, "msg": "..."}
    """
    ok = _audit.approve(name, content, reviewer, version)
    return _to_jsonable({"approved": ok,
                         "msg": "已通过，可注册" if ok else "无 pending 记录或已审核"})


@mcp.tool()
def register_artifact(artifact_type: str, name: str, content: str,
                      reviewer: str = "", desc: str = "",
                      version: str = "") -> str:
    """将审计通过的因子/策略注册到本地 repo（持久化 JSONL）。

    安全：register 前检查 AuditTrail 是否已 approve；
    未通过审计的 artifact 拒绝注册。
    Args:
        artifact_type: "factor" 或 "strategy"
        name: 因子/策略名称
        content: factor→公式, strategy→规则
        reviewer: 审核人（须与 approve_audit 中的 reviewer 一致）
        desc: 描述（可选）
        version: 版本号（可选）
    Returns:
        {"registered": bool, "msg": "..."}
    """
    # 审计闸门：未通过 → 拒绝
    if not _audit.is_approved(name, content, version):
        return _to_jsonable({"registered": False,
                             "msg": "未通过审计，拒绝注册。请先 submit_for_audit → approve_audit"})

    if artifact_type == "factor":
        ok = _factor_store.register(name, content, desc=desc, version=version)
    elif artifact_type == "strategy":
        ok = _strategy_store.register(name, content, desc=desc, version=version)
    else:
        return _to_jsonable({"registered": False, "msg": "artifact_type 须 factor/strategy"})

    return _to_jsonable({"registered": ok,
                         "msg": "注册成功" if ok else "重复注册（指纹去重拦截）"})


@mcp.tool()
def list_artifacts(artifact_type: str = "") -> str:
    """列出本地 repo 中已注册的因子/策略。

    Args:
        artifact_type: "factor"、"strategy" 或空（全部）
    Returns:
        {"count": int, "items": [...]}
    """
    items = []
    if artifact_type in ("", "factor"):
        items += _factor_store.all_factors()
    if artifact_type in ("", "strategy"):
        items += _strategy_store.all_strategies()
    return _to_jsonable({"count": len(items), "items": items})


if __name__ == "__main__":
    os.makedirs(_DATA, exist_ok=True)
    mcp.run(transport="stdio")
