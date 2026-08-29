"""L3 工具注册表：白名单 + schema 校验。"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable
import jsonschema  # type: ignore


@dataclass
class ToolResult:
    ok: bool
    value: Any = None
    error: str = ""


@dataclass
class ToolSpec:
    name: str
    fn: Callable[..., Any]
    desc: str = ""
    input_schema: dict = field(default_factory=dict)  # JSON Schema（属性）

    def validate(self, kwargs: dict[str, Any]) -> list[str]:
        if not self.input_schema:
            return []
        schema = {
            "type": "object",
            "properties": self.input_schema,
            "additionalProperties": False,
            "required": [k for k, v in self.input_schema.items()
                         if isinstance(v, dict) and v.get("required")],
        }
        errs: list[str] = []
        try:
            jsonschema.validate(kwargs, schema)
        except jsonschema.ValidationError as e:
            errs.append(e.message)
        return errs


class ToolRegistry:
    """白名单工具注册表：仅 register 过的工具可被 call。"""

    def __init__(self):
        self._tools: dict[str, ToolSpec] = {}

    def register(self, name: str, fn: Callable[..., Any], *, desc: str = "",
                 input_schema: dict | None = None) -> "ToolRegistry":
        self._tools[name] = ToolSpec(name=name, fn=fn, desc=desc,
                                     input_schema=input_schema or {})
        return self

    def has(self, name: str) -> bool:
        return name in self._tools

    def list(self) -> list[dict]:
        return [{"name": t.name, "desc": t.desc,
                 "input_schema": t.input_schema}
                for t in self._tools.values()]

    def call(self, name: str, kwargs: dict[str, Any] | None = None) -> ToolResult:
        if name not in self._tools:
            return ToolResult(False, error=f"未注册的工具：{name}（白名单外被拦截）")
        spec = self._tools[name]
        kw = kwargs or {}
        errs = spec.validate(kw)
        if errs:
            return ToolResult(False, error="; ".join(errs))
        try:
            out = spec.fn(**kw)
            return ToolResult(True, value=out)
        except Exception as e:  # noqa: BLE001
            return ToolResult(False, error=f"{type(e).__name__}: {e}")


__all__ = ["ToolResult", "ToolSpec", "ToolRegistry"]
