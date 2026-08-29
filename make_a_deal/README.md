# make_a_deal

> 日线级别 A 股量化分析 · AI 驱动

LLM 是研究员，框架是研究工具箱 + 实验台 + 记忆库。任何变更经 **Defender / Attacker / Judge** 三角色对抗（见 [blueprint.md](./blueprint.md)）。

## 当前版本

**v1.0.0** — L1-L4 四层架构全部就位 + MCP 工具协议 + 反向入库

| 层 | 版本 | 能力 |
|----|------|------|
| L1 数据层 | v0.2–v0.3 | 多源行情（akshare/tushare）+ Parquet 缓存 + 增量 + universe + 因子库（Alpha101 + 价量）+ 清洗 |
| L2 回测层 | v0.4–v0.5 | 事件驱动回测 + A 股规则（涨跌停/T+1/手续费/滑点）+ 风控闸门（回撤/仓位上限）+ 止损链 |
| L3 Agent 层 | v0.6–v0.8 | 四阶闭环（假设→验证→解读→迭代）+ 失控防护 + 偏差校正（近因/确认/空证据/过拟合）+ 记忆库（MemoryStore/因子策略查重/经验自学习） |
| L4 治理层 | v0.9 | 沙箱隔离执行（禁网/禁写/import白名单）+ 审计卡点（证据强制+append-only）+ 人审闸门 |
| 工具化 + 反向入库 | v1.0 | MCP 协议封装 + 端到端 pipeline + Dockerfile + 反向入库（外部 Agent 发现好策略回写本地 repo） |

## 目录

```
src/
├── infra/                  # L1 数据层
│   ├── data/sources/       #   akshare/tushare/Synthetic 行情源
│   ├── data/               #   Parquet 缓存（ParquetCache）
│   ├── universe/           #   CSI300/500/50 股票池
│   └── config/             #   YAML 配置加载
├── primitives/             # L1-L2 原语
│   ├── factors/            #   Alpha101 因子（15 个）+ 去极值 zscore 清洗
│   ├── backtest/           #   事件驱动引擎 + MACross/RSIBounce 策略
│   └── risk/               #   风控闸门（回撤/仓位）+ 止损链（止盈/止损/移动止损）
├── agent/                  # L3 Agent 层
│   ├── loop.py             #   四阶闭环执行器（失控防护/严重偏差即停）
│   ├── planner.py          #   计划生成 + 校验（标准四阶步骤）
│   ├── tool_registry.py    #   白名单工具注册表 + JSON Schema 校验
│   └── bias_correction.py  #   偏差检测（近因/确认/空证据/过拟合）
├── memory/                 # L3 记忆库
│   ├── stores.py           #   MemoryStore 基座（原子写/指纹去重/相似检索/Purge 护栏）
│   ├── factor_strategy_stores.py  # 因子/策略注册前查重（同名/相似）
│   └── experience_store/   #   Attacker 经验库（失败案例自学习）
├── governance/             # L4 治理层
│   ├── sandbox.py          #   子进程隔离（禁网/禁写/import白名单/超时硬杀）
│   ├── audit.py            #   入库前审计卡点（证据强制 + append-only + 撤回）
│   └── human_interface.py  #   人审闸门
└── tools/                  # v1.0 MCP 工具封装
    ├── mcp_server.py       #   MCPServer（注册→校验→JSON 安全序列化）
    └── pipeline.py         #   端到端 pipeline demo（合成数据→因子→回测→风控→偏差→审计）
config/data.yml
tests/
Dockerfile
mcp_server.py               # MCP 入口（9 个工具：L1-L4 + 反向入库 5）
blueprint.md                # v1.0 对抗蓝图 & 安全设计
```

## 安装

```bash
pip install -r requirements.txt
export TUSHARE_TOKEN=xxx   # 可选，用 tushare 时点成分防幸存者偏差
```

## 快速开始

### 端到端 Pipeline（合成数据，离线）

```python
from src.tools.pipeline import run_pipeline

res = run_pipeline()
print(res.summary())
# ✅ load_data → ✅ compute_factors → ✅ backtest → ✅ risk_check
# ✅ bias_correction → ✅ audit_register → ✅ agent_loop
```

### 回测单标的

```python
from src.primitives.backtest.engine import BacktestEngine
from src.primitives.backtest.strategy import MACross
from src.infra.data.sources.base import SyntheticSource

src = SyntheticSource()
bars = src.get_daily("600519.SH", "2020-01-01", "2024-12-31")
engine = BacktestEngine(bars, MACross(fast=5, slow=20),
                        cash=1_000_000, code="600519.SH")
result = engine.run()
print(result.metrics)  # total_return, sharpe, max_drawdown, ...
```

### 因子计算

```python
from src.tools.pipeline import make_synthetic_panel
from src.primitives.factors.alpha101 import compute_all

panel = make_synthetic_panel(n_days=252, n_stocks=10)
factors = compute_all(panel)  # MultiIndex(date, code) × 15 因子列
# 输出已 zscore + 去极值，可直接 IC/选股
```

### 沙箱执行用户代码

```python
from src.governance.sandbox import Sandbox, SandboxConfig

sb = Sandbox(SandboxConfig(timeout=10))
res = sb.run("import numpy as np; print(np.array([1,2,3]).sum())")
# os/subprocess/socket 被禁；open() 限工作目录；eval/exec 被移除
```

### 审计 + 人审 + 反向入库

```python
from src.governance.audit import AuditTrail
from src.memory.factor_strategy_stores import StrategyStore

audit = AuditTrail("data/audit_trail.jsonl")
store = StrategyStore("data/strategy_store.jsonl")

# 1. 提交审计（必须带证据）
audit.submit("strategy", "RSI超卖反弹", "buy rsi<30, sell rsi>70",
             evidence={"total_return": 0.15, "sharpe": 1.2})

# 2. 审核通过（人审 / Agent 辅助审）
audit.approve("RSI超卖反弹", "buy rsi<30, sell rsi>70", reviewer="human")

# 3. 注册到本地 repo
store.register("RSI超卖反弹", "buy rsi<30, sell rsi>70",
               desc="14 日 RSI 超卖反弹", version="v1")
```

---

## 集成到 Agent（MCP 协议方式）

本项目通过 [MCP 协议](https://modelcontextprotocol.io/)将量化工具暴露给外部 Agent（**Trae / Claude Code / Cursor 等**）。Agent 获得量化研究"工具箱"——跑回测、做因子、审策略、把好策略回写进本地 repo。

### 1. 启动 MCP Server

直接运行（stdio 模式，供 Trae 等客户端 stdin/stdout 通信）：

```bash
cd /path/to/make_a_deal
python mcp_server.py
```

Docker 方式：

```bash
docker build -t make_a_deal .
docker run -i -v $(pwd)/data:/app/data make_a_deal
```

### 2. Trae 客户端配置

在 Trae 的 MCP 配置中添加（**两种方式任选其一**）：

**方式 A：文件配置 `.trae/mcp.json`**

```json
{
  "mcpServers": {
    "make_a_deal": {
      "command": "python",
      "args": ["/absolute/path/to/make_a_deal/mcp_server.py"],
      "env": {
        "TUSHARE_TOKEN": "your_token_if_using_tushare"
      }
    }
  }
}
```

**方式 B：设置界面**

进入 Trae 设置 → MCP Servers → 新增：

| 字段 | 值 |
|------|----|
| Server 名称 | `make_a_deal` |
| command | `python` |
| args | `["/absolute/path/to/make_a_deal/mcp_server.py"]` |
| env | `{"TUSHARE_TOKEN": "xxx"}`（可选） |

保存并重启 Trae，会话里就可以让 Agent 调用 `make_a_deal.*` 9 个工具。

### 3. 可用工具列表（共 9 个）

MCP server 启动后向外部 Agent 暴露 **9 个工具**，覆盖 L1-L4 全链路及反向入库：

| # | 工具名 | 层级 | 功能 | 参数 | 返回 |
|---|--------|------|------|------|------|
| 1 | `run_quant_pipeline` | L1→L4 | 端到端量化 pipeline（数据→因子→回测→风控→偏差校正→审计） | 无 | 各步骤状态 + 回测指标 |
| 2 | `compute_alpha_factors` | L1 | 计算 Alpha101 因子（合成数据） | `code: str`, `n_days: int=250` | 因子数 + 均值/标准差摘要 |
| 3 | `backtest_ma_cross` | L2 | 均线交叉回测（合成数据） | `code: str`, `fast: int=5`, `slow: int=20`, `cash: float=1e5` | 回测指标（收益/夏普/回撤） |
| 4 | `sandbox_execute` | L4 | 沙箱安全执行 Python 代码（禁网/禁写/import 白名单） | `code: str`, `timeout: int=10` | stdout/stderr/exit_code |
| 5 | `check_duplicate` | L3 | 注册前查重（因子/策略是否已存在或相似） | `artifact_type: str`, `name: str`, `content: str` | `exact_dup: bool`, `similar: list` |
| 6 | `submit_for_audit` | L4 | 提交因子/策略到审计轨迹（须附回测证据） | `artifact_type: str`, `name: str`, `content: str`, `evidence: str` | `submitted: bool`, `msg: str` |
| 7 | `approve_audit` | L4 | 审核通过 pending 中的因子/策略 | `name: str`, `content: str`, `reviewer: str`, `version: str` | `approved: bool`, `msg: str` |
| 8 | `register_artifact` | L3 | 将审计通过的因子/策略注册到本地 repo | `artifact_type: str`, `name: str`, `content: str`, `reviewer: str`, `desc: str`, `version: str` | `registered: bool`, `msg: str` |
| 9 | `list_artifacts` | L3 | 列出本地 repo 已注册的因子/策略 | `artifact_type: str`（可选） | `count: int`, `items: list` |

> 所有工具输出经 `_to_jsonable` 递归序列化（numpy/pandas → list/dict），保证 JSON 可安全传输。不可序列化类型直接降级为字符串，防传输层崩溃。

---

### 4. 反向入库：Agent 把发现的好策略写回本地 repo

外部 Agent（Trae 等）一旦通过回测发现有效因子/策略，可以 **按顺序调用 5 个工具**，把它登记到本地仓库（JSONL 持久化），形成「Agent 研究 → 验证 → 入库」的闭环：

```
Agent 研究（生成假设 → 跑回测 → 算指标）
    │
    ▼  tool 1: check_duplicate(type, name, content)
    │  exact_dup=True 则重复，直接放弃；
    │  有 similar 列表，Agent 复核是否真不同
    │
    ▼  tool 2: submit_for_audit(type, name, content, evidence=<回测 JSON>)
    │  必须带 evidence（回测指标），无证据直接拒绝（防拍脑袋）
    │
    ▼  tool 3: approve_audit(name, content, reviewer="human" 或 "agent")
    │  仅对 pending 中的记录批准；已 approved / 已 revoked 不重复过审
    │
    ▼  tool 4: register_artifact(type, name, content, reviewer, desc, version)
    │  审计闸门：未通过 is_approved() → 拒绝；
    │  指纹去重：同名同内容 → 已存在 = registered=False
    │
    ✅ 写入 data/factor_store.jsonl / data/strategy_store.jsonl
```

**Trae 会话调用示例**（伪 Agent 工作流）：

```text
> Trae Agent 发现：均线交叉策略 (MA3/MA15) 在 600036 上 sharpe=1.35

[Trae → MCP] check_duplicate(artifact_type="strategy",
                              name="MA3xMA15交叉",
                              content="buy on MA(3) cross MA(15) up, sell down")
  ← { exact_dup:false, similar_count:0 }   ✅ 库中无重复

[Trae → MCP] submit_for_audit(artifact_type="strategy",
                              name="MA3xMA15交叉",
                              content="buy on MA(3) cross MA(15) up, sell down",
                              evidence='{"total_return":0.15,"sharpe":1.35,
                                         "max_drawdown":0.07,"n_trades":32}')
  ← { submitted:true, msg:"已提交，待审核" }

[Trae 弹窗让人审 or 自动审] → approve_audit(name="MA3xMA15交叉",
                                          content="buy on MA(3)...",
                                          reviewer="human-xiao-ming")
  ← { approved:true, msg:"已通过，可注册" }

[Trae → MCP] register_artifact(artifact_type="strategy",
                               name="MA3xMA15交叉",
                               content="buy on MA(3)...",
                               reviewer="human-xiao-ming",
                               desc="短周期均线交叉，适合震荡市",
                               version="v1")
  ← { registered:true, msg:"注册成功" }

[Trae → MCP] list_artifacts()
  ← { count: 1, items: [{name:"MA3xMA15交叉", rules:"...", ...}] }
```

三重安全保障：
1. **证据强制**：无回测 evidence 的策略，`submit_for_audit` 抛 `ValueError` 拒绝；
2. **审计闸门**：`register_artifact` 注册前强制校验 `is_approved()`，未通过审计无法入库；
3. **指纹去重**：`MemoryStore` 基于 `name + content` SHA256 哈希，重复注册静默返回 false，不污染仓库。

---

## 测试

```bash
python -m pytest tests -q
```

核心测试覆盖：
- MemoryStore 原子写/指纹去重/相似检索/Purge 护栏
- FactorStore/StrategyStore 注册前查重
- AuditTrail submit/approve/reject/revoke + 无证据拦截
- Sandbox：非法 import / 绝对路径写 / eval / 超时四类攻击拦截
- BacktestEngine：T+1 / 涨跌停 / 手续费 / 滑点规则
- BiasCorrector：四类偏差检出
- 反向入库端到端：查重 → 提交 → 审核 → 注册 → 列取（附冒烟脚本）

对抗开发流程详见 [blueprint.md](./blueprint.md)。

## License

MIT
