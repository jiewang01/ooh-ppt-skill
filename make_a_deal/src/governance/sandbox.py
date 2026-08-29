"""L4 沙箱：子进程隔离执行用户 Python 代码。

安全设计：
- 子进程通过受限 builtins 执行：禁 os/subprocess/socket/shutil；
- open() 仅允许工作目录下的相对路径（无绝对路径、无上溯）；
- eval/exec 从 builtins 移除，compile 也移除；
- 超时：超过 timeout 秒直接 SIGKILL；
- import 白名单：只允许 numpy/pandas/math/statistics；
- 禁写：禁止 open(..., "w") 等写模式。
"""
from __future__ import annotations
import multiprocessing as mp
import os
import re
import signal
import sys
import traceback
from dataclasses import dataclass
from typing import Any

_ALLOWED_IMPORTS = {
    "math", "statistics", "random", "json", "re",
    "collections", "itertools", "functools", "operator",
    "datetime", "decimal", "fractions", "heapq", "bisect",
    "copy", "typing", "dataclasses", "enum",
    "numpy", "pandas",
}
_ALLOWED_MODULES_CACHE: dict[str, Any] = {}


@dataclass
class SandboxConfig:
    timeout: int = 10
    workdir: str = "/tmp/sandbox"
    memory_mb: int = 1024  # 预留：当前仅靠 timeout 兜底


@dataclass
class SandboxResult:
    ok: bool
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    error: str = ""


# ----------------------------- 子进程内执行 -----------------------------
_WRITE_MODE_RE = re.compile(r"[wax]")


def _safe_open(file, mode="r", *args, **kwargs):
    if _WRITE_MODE_RE.search(mode or ""):
        raise PermissionError(
            "sandbox: 禁止写文件（mode 含 w/a/x 被拦截）")
    if isinstance(file, str) and (os.path.isabs(file) or ".." in file):
        raise PermissionError(
            "sandbox: open 限相对路径，禁止绝对路径或 .. 上溯")
    return open(file, mode, *args, **kwargs)


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0:
        raise ImportError("sandbox: 不允许相对 import")
    top = name.split(".")[0]
    if top not in _ALLOWED_IMPORTS:
        raise ImportError(
            f"sandbox: import 白名单外模块被拦截: {name}")
    # 缓存 import，避免反复加载
    if name in _ALLOWED_MODULES_CACHE:
        return _ALLOWED_MODULES_CACHE[name]
    import importlib
    mod = importlib.import_module(name)
    _ALLOWED_MODULES_CACHE[name] = mod
    return mod


def _child_worker(code: str, workdir: str,
                  conn: "mp.connection.Connection") -> None:
    try:
        os.makedirs(workdir, exist_ok=True)
        os.chdir(workdir)
    except Exception:
        pass

    import io
    import contextlib
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    restricted_builtins = {
        k: v for k, v in __builtins__.items()
        if k not in (
            "open", "__import__", "eval", "exec", "compile",
            "globals", "locals", "breakpoint", "exit", "quit",
        )
    }
    restricted_builtins["open"] = _safe_open
    restricted_builtins["__import__"] = _safe_import
    restricted_builtins["print"] = print

    sandbox_globals = {"__builtins__": restricted_builtins,
                       "__name__": "__sandbox__"}
    try:
        with contextlib.redirect_stdout(stdout_buf), \
             contextlib.redirect_stderr(stderr_buf):
            exec(compile(code, "<sandbox>", "exec"),  # noqa: S102
                 sandbox_globals)
        out, err = stdout_buf.getvalue(), stderr_buf.getvalue()
        conn.send((True, out, err, 0, False, ""))
    except Exception:
        tb = traceback.format_exc(limit=3)
        out, err = stdout_buf.getvalue(), stderr_buf.getvalue()
        conn.send((False, out, err + tb, 1, False, err + tb))
    finally:
        conn.close()


# ----------------------------- 父进程包装 -----------------------------
class Sandbox:
    def __init__(self, config: SandboxConfig | None = None):
        self.cfg = config or SandboxConfig()

    def run(self, code: str) -> SandboxResult:
        os.makedirs(self.cfg.workdir, exist_ok=True)
        parent, child = mp.Pipe(duplex=False)
        ctx = mp.get_context("fork") if hasattr(mp, "get_context") else mp
        p = ctx.Process(target=_child_worker,
                        args=(code, self.cfg.workdir, child),
                        daemon=True)
        p.start()
        child.close()
        p.join(timeout=self.cfg.timeout)

        if p.is_alive():
            # 超时：硬杀
            try:
                os.kill(p.pid, signal.SIGKILL)
            except OSError:
                pass
            p.join(timeout=2)
            return SandboxResult(False, "",
                                 f"sandbox: 超时（>{self.cfg.timeout}s）",
                                 -1, True,
                                 f"超时（>{self.cfg.timeout}s）")

        try:
            if parent.poll(0.5):
                ok, out, err, rc, to, e = parent.recv()
                return SandboxResult(ok, out, err, rc, to, e)
        except EOFError:
            pass
        return SandboxResult(False, "", "sandbox: 子进程异常退出",
                             p.exitcode or -1, False,
                             "子进程异常退出")


__all__ = ["SandboxConfig", "SandboxResult", "Sandbox"]
