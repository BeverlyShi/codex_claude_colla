---
name: debate
description: >
  自动运行 N 轮交叉批评辩论，Claude 与 Codex 交替发言，最终由 Claude 综合裁定。
  用法：/debate <问题或任务> [--rounds N]（默认 2 轮，最多 5 轮）
---

# Debate Skill

### 角色说明
- **Claude**：提案方，负责给出方案并在每轮中回应批评
- **Codex**：对手审查者（adversarial reviewer），被指令优先寻找漏洞和反例，而非补充正确部分
- **Codex 的对抗性引导已在 debate-orchestrator.mjs 中注入**，Claude 无需在 prompt 里重复，但在解读 Codex 回复和生成最终裁定时应以此角色设定为参照

### 触发条件
用户输入以 `/debate` 开头。

### 参数解析
- 提取 `/debate` 之后、`--rounds` 之前的内容，去除首尾空白，记为 PROMPT
- 若 PROMPT 为空：输出 `[错误] /debate 需要一个问题或任务` 并终止，不启动辩论
- 若有 `--rounds N`，解析 N 为整数；否则 N=2
- N 限定在 [1, 5]，超出范围自动修正到边界值并告知用户

### 执行步骤

> **注意：** 以下所有命令中，尖括号内容均为变量占位符，执行时必须替换为对应的真实内容，不要字面传入占位符字符串。

**Step 1 — 初始化 session**
```bash
node scripts/debate-orchestrator.mjs start --prompt "<用户真实输入>" --rounds <轮数>
```
从输出解析 `sessionId=<id>`，记为 SESSION_ID。
告知用户：`⚖ 开始 <N> 轮辩论，sessionId: <SESSION_ID>`

**Step 2 — Round 循环（重复 N 次）**

2a. 生成 Claude 本轮回复：
  - 第 1 轮：基于 PROMPT
  - 后续轮：基于上一轮 Codex 的批评内容
  - **长度约束：每轮控制在 200 字以内，聚焦核心论点或反驳，留详细展开给最终综合**

2b. 将 Claude 回复传给 orchestrator：
```bash
printf '%s' "<Claude 本轮回复内容>" | node scripts/debate-orchestrator.mjs turn --session <SESSION_ID> 2>&1
```
- 若 exit code 非 0：显示错误原因，本轮 Codex 区块标注 `[Codex 无响应]`，继续下一轮
- 若成功：将输出作为 Codex 本轮批评展示给用户

**Step 3 — 最终综合**
基于完整辩论内容生成综合裁定（执行摘要 + 各方核心论点 + 建议行动），然后：
```bash
printf '%s' "<综合裁定内容>" | node scripts/debate-orchestrator.mjs finish --session <SESSION_ID> 2>&1
```
告知用户辩论记录文件路径。

### 输出格式
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖ DEBATE  主题：<PROMPT 前 50 字>
共 <N> 轮 | 记录将保存至 .council/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[每轮实时显示 Claude 发言 + Codex 批评]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
记录已保存至 .council/<sessionId>.md
```
