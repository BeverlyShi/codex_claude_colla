---
name: parallel
description: >
  向 Claude 和 Codex 提同一问题，并排展示两份独立回复及差异分析。
  用法：/parallel <问题或任务>
---

# Parallel Skill

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
> **注意：** 执行时必须将尖括号内容替换为用户真实输入，不要字面传入占位符字符串。
```bash
printf '%s' "<用户真实输入>" | node scripts/debate-bridge.mjs 2>&1
```
- 记录 exit code 和输出内容
- 若 exit code 为 0：将输出记为 CODEX_RESPONSE
- 若 exit code 非 0：执行以下操作后**立即终止**，不生成"主要差异"区块：
  ```
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
