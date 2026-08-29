"""v1.0 MCP 工具封装：把 make_a_deal 能力包装成 schema + 白名单 + JSON 安全序列化。

提供两部分：
1) `MCPServer` 类：通用白名单 registry 包装，call 返回 JSON 安全；
2) `_to_jsonable`：递归序列化 numpy/pandas → 纯 list/dict/str/number/bool。
"""
from __future__ import annotations
from dataclasses import dataclass
import json
from typing import Any

import numpy as np
import pandas as pd

from ..agent.tool_registry import ToolRegistry, ToolResult


# ---------------------------------------------------------------- 序列化
def _to_jsonable(x: Any, depth: int = 0) -> Any:
    if depth > 10:
        return str(x)
    if x is None or isinstance(x, (bool, int, float, str)):
        if isinstance(x, float) and (np.isnan(x) or np.isinf(x)):
            return None
        return x
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        v = float(x)
        return None if (np.isnan(v) or np.isinf(v)) else v
    if isinstance(x, np.ndarray):
        return _to_jsonable(x.tolist(), depth + 1)
    if isinstance(x, pd.Series):
        return _to_jsonable(list(x.values), depth + 1)
    if isinstance(x, pd.DataFrame):
        return _to_jsonable(x.to_dict(orient="list"), depth + 1)
    if isinstance(x, (pd.Timestamp, pd.Timedelta)):
        return str(x)
    if isinstance(x, (list, tuple, set, frozenset)):
        return [_to_jsonable(v, depth + 1) for v in list(x)]
    if isinstance(x, dict):
        return {str(k): _to_jsonable(v, depth + 1) for k, v in x.items()}
    if hasattr(x, "to_dict"):
        try:
            return _to_jsonable(x.to_dict(), depth + 1)
        except Exception:  # noqa: BLE001
            pass
    if hasattr(x, "__dict__"):
        try:
            return _to_jsonable(vars(x), depth + 1)
        except Exception:  # noqa: BLE001
            pass
    try:
        json.dumps(x, ensure_ascii=False)
        return x
    except (TypeError, ValueError):
        return str(x)


# ---------------------------------------------------------------- MCPServer
@dataclass
class MCPToolResult:
    ok: bool
    value: Any = None
    error: str = ""

    def to_json(self) -> str:
        return json.dumps(_to_jsonable({
            "ok": self.ok, "value": self.value, "error": self.error,
        }), ensure_ascii=False)


class MCPServer:
    """MCP 工具封装：白名单注册 + schema 校验 + JSON 安全序列化。"""

    def __init__(self):
        self._reg = ToolRegistry()

    def register(self, name: str, fn, *, desc: str = "",
                 input_schema: dict | None = None) -> "MCPServer":
        self._reg.register(name, fn, desc=desc, input_schema=input_schema)
        return self

    def list_tools(self) -> list[dict]:
        """按 MCP tools/list 协议格式。"""
        return [
            {
                "name": t["name"],
                "description": t["desc"],
                "inputSchema": {
                    "type": "object",
                    "properties": t["input_schema"] or {},
                },
            }
            for t in self._reg.list()
        ]

    def call(self, name: str, kwargs: dict | None = None) -> MCPToolResult:
        r: ToolResult = self._reg.call(name, kwargs or {})
        return MCPToolResult(ok=r.ok, value=_to_jsonable(r.value), error=r.error)

    def call_json(self, name: str, kwargs: dict | None = None) -> str:
        return self.call(name, kwargs).to_json()


__all__ = ["MCPToolResult", "MCPServer", "_to_jsonable"]
