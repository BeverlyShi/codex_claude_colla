---
name: debate
description: >
  /parallel：向 Claude 和 Codex 提同一问题，并排展示两份独立回复及差异分析。
  /debate：调用 debate-orchestrator.mjs 运行 N 轮交叉批评，默认 2 轮，支持 --rounds N。
---

# Debate Skill

## /parallel 模式

### 触发条件
用户输入以 `/parallel` 开头。

### 执行步骤

**Step 1 — 提取 prompt**
提取 `/parallel` 之后的全部内容，去除首尾空白，记为 PROMPT。

若 PROMPT 为空：
```
输出：[错误] /parallel 需要一个问题或任务，例如：/parallel 这段代码应该怎么重构？
终止，不调用 Codex，不生成任何分析。
```

**Step 2 — 生成 Claude 回复**
基于 PROMPT 生成 Claude 自己的完整回复，记为 CLAUDE_RESPONSE。

**Step 3 — 获取 Codex 回复**
执行以下命令（使用 stdin 传递 prompt，避免引号和换行破坏命令）：
```bash
printf '%s' "PROMPT" | node scripts/debate-bridge.mjs 2>&1
```
- 记录 exit code 和输出内容
- 若 exit code 为 0：将输出记为 CODEX_RESPONSE
- 若 exit code 非 0：执行以下操作后**立即终止**，不生成"主要差异"区块：
  ```
  输出：
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ▶ CLAUDE
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {CLAUDE_RESPONSE}

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✗ CODEX 调用失败
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {命令输出内容，即错误原因}

  ⚠ Codex 调用失败，已跳过差异分析。请检查 codex login 状态或 scripts/debate-bridge.mjs。
  ```

**Step 4 — 输出对比结果**
仅在 Step 3 成功（exit code 为 0）时执行：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ CLAUDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{CLAUDE_RESPONSE}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ CODEX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{CODEX_RESPONSE}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ 主要差异
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{基于 CLAUDE_RESPONSE 和 CODEX_RESPONSE 分析核心差异，3-5 条，每条说明各自的权衡取舍}
```

---

## /debate 模式

### 触发条件
用户输入以 `/debate` 开头。

### 参数解析
- 提取 `/debate` 之后、`--rounds` 之前的内容，去除首尾空白，记为 PROMPT
- 若 PROMPT 为空：输出错误提示并终止，不启动辩论
- 若有 `--rounds N`，解析 N 为整数；否则 N=2
- N 限定在 [1, 5]，超出范围自动修正到边界值并告知用户

### 执行步骤

**Step 1 — 初始化 session**
```bash
node scripts/debate-orchestrator.mjs start --prompt "PROMPT" --rounds N
```
从输出解析 `sessionId=<id>`，记为 SESSION_ID。
告知用户：`⚖ 开始 N 轮辩论，sessionId: SESSION_ID`

**Step 2 — Round 循环（重复 N 次）**

2a. 生成 Claude 本轮回复：
  - 第 1 轮：基于 PROMPT
  - 后续轮：基于上一轮 Codex 的批评内容

2b. 将 Claude 回复传给 orchestrator：
```bash
printf '%s' "CLAUDE_RESPONSE" | node scripts/debate-orchestrator.mjs turn --session SESSION_ID 2>&1
```
- 若 exit code 非 0：显示错误，本轮 Codex 标注 `[Codex 无响应]`，继续下一轮
- 若成功：将输出作为 Codex 本轮批评展示给用户

**Step 3 — 最终综合**
基于完整辩论内容生成综合裁定（执行摘要 + 各方核心论点 + 建议行动），然后：
```bash
printf '%s' "SYNTHESIS" | node scripts/debate-orchestrator.mjs finish --session SESSION_ID 2>&1
```
告知用户辩论记录文件路径。

### 输出格式
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖ DEBATE  主题：{PROMPT 前 50 字}
共 {N} 轮 | 记录将保存至 .council/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[每轮实时显示 Claude 发言 + Codex 批评]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
记录已保存至 .council/{sessionId}.md
```
