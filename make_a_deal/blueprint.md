# make_a_deal 蓝图 · v1.0

> Defender / Attacker / Judge 三角色对抗开发；每次版本迭代走一轮对抗。

## 四层架构

| 层 | 模块 | 版本 | 交付 |
|----|------|------|------|
| **L1 数据层** | infra/data + universe + config | v0.2–v0.3 | 多源行情 + Parquet 缓存 + 增量 + universe + 因子库（Alpha101）+ 清洗 |
| **L2 回测层** | primitives/{factors,backtest,risk} | v0.4–v0.5 | 事件驱动回测 + A股规则 + WFO + Brinson 归因 + 风控闸门 + 止损链 |
| **L3 Agent 层** | agent + memory | v0.6–v0.8 | 四阶闭环 + 失控防护 + 偏差校正 + 记忆库（MemoryStore/查重/经验自学习） |
| **L4 治理层** | governance | v0.9 | 沙箱隔离 + 审计卡点 + 人审闸门 |
| **工具化** | tools + mcp_server.py | v1.0 | MCP 协议暴露 + 端到端 pipeline + Dockerfile + 反向入库 |

## 版本对抗记录

### v0.8.0 · L3 偏差校正 + 记忆库
- **Defender**: 实现 BiasCorrector 四类偏差检测；MemoryStore 原子写 + 指纹去重 + 相似检索；FactorStore/StrategyStore 注册前查重。
- **Attacker**: 尝试注册空证据策略（被 AuditTrail 拦截 ✓）；Purge 超过半数（被护栏拦截 ✓）；重复提交（被指纹去重拦截 ✓）。
- **Judge**: 197 项离线测试全绿；三攻击面均被防住；偏差校正 score 阈值护栏生效。

### v0.9.0 · L4 沙箱 + 审计 + 人审
- **Defender**: Sandbox 子进程隔离（禁网/禁写/import 白名单/移除 eval&exec）；AuditTrail append-only 不可篡改；HumanGate 自动/人审双模。
- **Attacker**: 注入 `import subprocess`（被白名单拦截 ✓）；`open('/etc/passwd')` 绝对路径（被拦截 ✓）；`eval("1+1")`（builtins 移除 ✓）；超时硬杀 ✓。
- **Judge**: 沙箱六类攻击全部拦截；审计闸门证据缺失即拒绝；人审 auto_approve 模式不卡流程。

### v1.0.0 · 工具化 + MCP 协议 + 反向入库
- **Defender**: FastMCP 暴露 9 工具（L1→L4 + 反向入库 5）；_to_jsonable 递归序列化防传输崩溃；反向入库四步链路：查重 → 提交审计 → 审核 → 注册；AuditTrail 闸门+指纹去重。
- **Attacker**: 未审计就注册（被闸门拦截 ✓）；无证据提交（被 ValueError 拒绝 ✓）；重复注册（被指纹去重拦截 ✓）；numpy.ndarray 返回值（被序列化转 list ✓）。
- **Judge**: 9 工具 schema + 参数校验；反向入库全链路端到端冒烟通过；pipeline 7 步骤全部 ok 且回测指标可复现。

## 安全设计总览

1. **注册前查重**：FactorStore/StrategyStore `check_before_register`，同名/同指纹/相似内容 → 提前拦截。
2. **证据强制**：`AuditTrail.submit` 无 evidence → `ValueError`，防拍脑袋通过。
3. **审计闸门**：`register_artifact` 前必须 `is_approved=True`，否则拒绝。
4. **指纹去重**：`MemoryStore` 基于 `dedup_keys` SHA256 哈希，重复 append 返回 False。
5. **Purge 半数护栏**：单次删除 > 现存半数记录 → `RuntimeError` 拦截。
6. **沙箱隔离**：builtins 白名单 + import 白名单 + open 限相对路径 + 超时 SIGKILL。
7. **工具白名单**：`ToolRegistry` 未注册工具调用直接拒绝；`input_schema` JSON Schema 校验。
8. **JSON 安全传输**：`_to_jsonable` 递归转 numpy/pandas/自定义对象 → 纯 list/dict/str/number。

## 反向入库（Agent → 本地 repo）流程

```
Agent 发现好策略/因子
    │
    ▼
[1] check_duplicate(type, name, content)   # 查重，避免重复注册污染
    │ exact_dup=True → 终止；有 similar → 人工/Agent 复核
    ▼
[2] submit_for_audit(type, name, content, evidence=<回测结果 JSON>)
    │ 无 evidence → 拒绝；重复 pending → False
    ▼
[3] approve_audit(name, content, reviewer=...)
    │ 无 pending / 已 approved/revoked → False
    ▼
[4] register_artifact(type, name, content, reviewer, desc, version)
    │ 未通过审计 → 拒绝；指纹重复 → False
    ▼
✅ 写入 data/factor_store.jsonl 或 data/strategy_store.jsonl
```
