"""沙箱攻击：Attacker 路径全部被拦截。"""
from __future__ import annotations
from src.governance.sandbox import Sandbox, SandboxConfig


def run(code, timeout=5):
    return Sandbox(SandboxConfig(timeout=timeout)).run(code)


def test_basic_python_allowed():
    r = run("print(1+2)")
    assert r.ok and r.stdout.strip() == "3"


def test_numpy_allowed():
    r = run("import numpy as np; print(int(np.array([1,2,3]).sum()))")
    assert r.ok and "6" in r.stdout


def test_forbid_os_module_import():
    r = run("import os; os.listdir('/')")
    assert r.ok is False
    assert "白名单外模块" in r.stderr or "ImportError" in r.stderr


def test_forbid_subprocess_import():
    r = run("import subprocess")
    assert r.ok is False


def test_forbid_absolute_open():
    # open 被限制为相对路径；这里应抛 PermissionError
    r = run("f = open('/etc/hostname')")
    assert r.ok is False and ("PermissionError" in r.stderr
                              or "禁止绝对路径" in r.stderr)


def test_forbid_write_mode():
    r = run("f = open('x.txt', 'w')")
    assert r.ok is False and ("禁止写文件" in r.stderr
                              or "PermissionError" in r.stderr)


def test_eval_removed():
    r = run("print(eval('1+1'))")
    # eval 不在 builtins → NameError
    assert r.ok is False and "NameError" in r.stderr


def test_exec_removed():
    r = run("exec('print(1)')")
    assert r.ok is False and "NameError" in r.stderr


def test_timeout_hard_kill():
    r = run("while True: pass", timeout=1)
    assert r.timed_out is True or r.ok is False
