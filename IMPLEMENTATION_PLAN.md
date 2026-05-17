# Claude–Codex Debate Skill 实施计划

**版本：** v1.3  
**日期：** 2026-05-16  
**基于：** PRD v1.0 + 技术规格附录 + 架构评审 Round 3  
**状态：** 待执行

---

## 目录

1. [架构全景](#1-架构全景)
2. [实施前置条件核查](#2-实施前置条件核查阻塞级)
3. [风险登记册](#3-风险登记册)
4. [Phase 0 — 环境验证](#phase-0--环境验证人工执行)
5. [Phase 1 — 依赖安装与 SDK 接口验证](#phase-1--依赖安装与-sdk-接口验证)
6. [Phase 2 — debate-bridge.mjs 验证](#phase-2--debate-bridgemjs-验证)
7. [Phase 3 — Parallel 模式 Skill](#phase-3--parallel-模式-skill)
8. [Phase 4 — Debate 模式（Orchestrator + Skill）](#phase-4--debate-模式orchestrator--skill)
9. [Phase 5 — 错误处理与打磨](#phase-5--错误处理与打磨)
10. [完整回归测试](#10-完整回归测试)
11. [工时与里程碑](#11-工时与里程碑)
12. [技术决策记录（ADR）](#12-技术决策记录adr)

---

## 1. 架构全景

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code（编排层）                       │
│                                                             │
│  /parallel 或 /debate 触发                                    │
│       │                                                     │
│       ▼                                                     │
│  .claude/skills/debate/SKILL.md                             │
│  （只负责触发 + 说明 + 调用脚本，不管理状态）                      │
│       │                                                     │
│       ├── Claude 生成回复（内部上下文）                          │
│       │                                                     │
│       └── bash: node scripts/debate-orchestrator.mjs        │
│                         │                                   │
└─────────────────────────┼───────────────────────────────────┘
                          │ start / turn / finish 子命令
                          ▼
         ┌────────────────────────────────────┐
         │     debate-orchestrator.mjs        │
         │  ── 管理轮次循环                     │
         │  ── 读写 .council/ 状态与文件        │
         │  ── 调用 debate-bridge.mjs          │
         │  ── Transcript 压缩（> 6000 字符）   │
         └──────────────┬─────────────────────┘
                        │ stdin / stdout
                        ▼
         ┌────────────────────────────────────┐
         │       debate-bridge.mjs            │
         │  (@openai/codex-sdk  ESM-only)     │
         │  Codex().startThread(opts)         │
         │  thread.run(prompt)                │
         │  → turn.finalResponse              │
         └──────────────┬─────────────────────┘
                        │ JSONL stdin/stdout
                        ▼
         ┌────────────────────────────────────┐
         │       Codex CLI 本地进程             │
         │   ChatGPT 订阅授权，已登录            │
         └────────────────────────────────────┘
```

**职责划分：**

| 层级 | 文件 | 职责 | 谁来写 |
|------|------|------|--------|
| 触发层 | `SKILL.md` | 触发器 + 调用脚本的说明，不管理状态 | 纯 Markdown |
| 编排层 | `debate-orchestrator.mjs` | 轮次、Transcript、文件 I/O、Codex 调用 | Node.js ~80 行 |
| 桥接层 | `debate-bridge.mjs` | 单次 Codex SDK 调用，I/O 处理 | Node.js ~55 行 |
| 运行时 | Codex CLI + SDK | 推理执行 | 第三方，仅安装 |

**关键设计原则：复杂确定性逻辑归脚本，Claude 只做生成。**

---

## 2. 实施前置条件核查（阻塞级）

> 任何一项失败，先解决后继续，不跳过。

### 2.1 codex-plugin-cc 存在性验证（已降级为可选）

`codex-plugin-cc` 在 npm 上的发布者是 `Kenmege`，非 OpenAI 官方。`/parallel` 和 `/debate` 的 MVP **不依赖插件**，可独立交付。

```bash
# 确认 npm 上的实际发布者
npm info codex-plugin-cc

# 确认 Claude Code 是否有 plugin 子命令（大概率无）
claude --help | grep -i plugin
```

**结论逻辑：**
- 插件存在且来源可信 → 按 Phase 0.3 安装，`/codex:review` 等命令作为可选增强
- 插件不存在或来源不明 → 跳过 Phase 0.3，`/parallel` 和 `/debate` 正常推进，**不影响 MVP**

### 2.2 依赖版本矩阵

| 依赖 | 最低要求 | 验证命令 |
|------|---------|---------|
| Node.js | **18.18+** | `node --version` |
| npm | 9+ | `npm --version` |
| Codex CLI | 最新版 | `codex --version` |
| Claude Code | 最新版 | `claude --version` |

### 2.3 Codex 登录状态

```bash
codex auth status 2>/dev/null || codex --version
# 若未登录：
codex login
```

---

## 3. 风险登记册

| ID | 风险描述 | 可能性 | 影响 | 应对方案 |
|----|---------|--------|------|---------|
| R1 | `codex-plugin-cc` 非官方，功能不稳 | **已降级** | 插件层可选，不影响 MVP | 插件归入可选增强 |
| R2 | SDK 实际 API 与预期不符 | 中 | Phase 2 阻塞 | Phase 1 立即探查实际 exports |
| R3 | `turn.finalResponse` 为 undefined | 中 | 输出空白 | 已加五级 fallback 链 |
| R4 | 多轮辩论 Transcript 超阈值 | 中 | Codex 收到截断上下文 | Orchestrator 内 6000 字符阈值触发结构化摘要 |
| R5 | Codex CLI token 失效 | 低 | bridge 报 auth 错误 | Orchestrator 检测 stderr 含 `auth` 时退出并提示 |
| R6 | Skill 误触发 | 低 | 无关调用 | 精确斜杠命令触发，不做模糊匹配 |
| R7 | 非 Git 目录崩溃 | **已解决** | — | `skipGitRepoCheck: true` 已写入 bridge |
| R8 | 并发或中断后 session 覆盖 | **已解决** | 状态丢失 | 每次 `start` 生成独立 `sessions/debate_<ts>.json` |
| R9 | turn 超出声明轮数 | **已解决** | 计划外轮次 | `turn` 前校验 `currentRound >= rounds` |

---

## Phase 0 — 环境验证（人工执行）

### 0.1 运行环境检查

```bash
node --version   # >= v18.18.0
npm --version    # >= 9
codex --version
claude --version
```

### 0.2 项目目录结构

当前状态（已存在的文件 ✓）：

```
claude_codex_colla/
├── package.json                        ✓ 已创建
├── scripts/
│   ├── debate-bridge.mjs               ✓ 已创建（ESM）
│   └── debate-orchestrator.mjs         ✓ 已创建
├── .claude/
│   └── skills/debate/
│       └── SKILL.md                    ← Phase 3/4 创建
├── .council/                           ← Phase 4 自动创建
├── .gitignore                          ← Phase 5 创建
└── AGENTS.md                           ← Phase 5 可选
```

```bash
# 创建尚缺的目录
mkdir -p .claude/skills/debate
```

### 0.3 codex-plugin-cc 安装（可选，MVP 不依赖）

仅在 2.1 确认插件来源可信后执行：

```bash
# 安装社区插件（非官方，谨慎评估）
npm install -g codex-plugin-cc
```

**✅ Phase 0 通过条件：** 依赖版本符合要求，Codex CLI 已登录。

---

## Phase 1 — 依赖安装与 SDK 接口验证

### 1.1 安装依赖

```bash
# 项目根目录执行
npm install

# 验证 package.json 中的 "type": "module" 已存在
grep '"type"' package.json
```

### 1.2 SDK 接口探查（必做，在写任何代码之前）

```bash
# 查看 SDK 暴露的顶层名称
npm run test:sdk

# 查看 Codex 类实例方法
node --input-type=module << 'EOF'
import { Codex } from '@openai/codex-sdk';
const c = new Codex();
console.log('Codex methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(c)));
EOF

# 查看 thread 对象方法
node --input-type=module << 'EOF'
import { Codex } from '@openai/codex-sdk';
const c = new Codex();
const t = c.startThread({ workingDirectory: process.cwd(), skipGitRepoCheck: true });
console.log('Thread methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(t)));
EOF
```

| 探查结果 | 行动 |
|---------|------|
| `startThread` + `run` 均存在 | 无需修改 bridge |
| 方法名不同（如 `createThread`） | 更新 `debate-bridge.mjs` 对应行 |
| `Codex` 不是默认导出 | 检查实际导出名 |

### 1.3 三级验证顺序与职责边界

> 每级验证的范围不同，不能互相替代。

| 脚本 | 验证内容 | 证明了什么 | 不能证明什么 |
|------|---------|-----------|------------|
| `test:env` | `node --version` + `codex --version` | CLI 已安装 | 是否已登录 |
| `test:codex-auth` | `codex auth status` 或 `codex whoami` | 登录状态（如 CLI 支持） | SDK 接口是否匹配 |
| `test:sdk` | import SDK + 检查 `Codex` 是否在 exports | SDK 可用且包含预期类 | 能否连接 Codex CLI |
| `test:bridge` | 真实调用 `debate-bridge.mjs` | SDK 与 Codex CLI 通信正常，**登录状态有效** | — |

**登录状态的唯一可靠验证是 `test:bridge`**。`test:codex-auth` 是补充项，若 CLI 不支持 `auth status` 子命令则静默跳过。

### 1.4 Smoke Test（最小可运行验证）

```bash
# 直接在 Node 中做最小调用，确认 turn.finalResponse 真实存在
node --input-type=module << 'EOF'
import { Codex } from '@openai/codex-sdk';
const c = new Codex();
const t = c.startThread({ workingDirectory: process.cwd(), skipGitRepoCheck: true });
const turn = await t.run('用一个字回复');
console.log('turn keys:', Object.keys(turn));
console.log('finalResponse:', turn.finalResponse);
EOF
```

目的：在 `debate-bridge.mjs` 任何封装之前，确认 `turn.finalResponse` 字段真实存在于当前 SDK 版本。

### 1.5 验收测试

```bash
# 按顺序执行，第一个失败即停止
npm run test:env       # CLI 已安装
npm run test:codex-auth # 登录状态（CLI 支持时）
npm run test:sdk        # SDK 接口存在
# test:bridge 留到 Phase 2 作为真实连通验证
```

---

## Phase 2 — debate-bridge.mjs 验证

> 文件已创建（ESM，`turn.finalResponse` fallback 链，stdin/argv 双模式）。本阶段为验证。

### 2.1 当前实现摘要

```
scripts/debate-bridge.mjs
├── 模块格式：ESM import（兼容 @openai/codex-sdk ESM-only）
├── 输入：argv[2] 单行 prompt / stdin 长文本（stdin 优先）
├── SDK 调用：Codex().startThread({ skipGitRepoCheck: true })
├── 返回值：turn.finalResponse ?? response ?? text ?? output ?? JSON.stringify(items)
├── 超时：120 秒
└── 截断：8000 字符 + [TRUNCATED] 标记
```

### 2.2 验收测试

```bash
# 测试 1：argv 模式
npm run test:bridge

# 测试 2：stdin 模式
npm run test:bridge:stdin

# 测试 3：空 prompt 错误处理
node scripts/debate-bridge.mjs "" 2>&1 | grep ERROR && echo "✓ 错误处理"

# 测试 4：exit code
node scripts/debate-bridge.mjs "hello" && echo "✓ EXIT:0" || echo "✗ EXIT:1"
```

**✅ Phase 2 通过条件：** 测试 1/2 有实质文字输出且 exit code 为 0；测试 3 输出 `[ERROR]`。

---

## Phase 3 — Parallel 模式 Skill

### 3.1 创建 SKILL.md（Parallel 部分）

写入 `.claude/skills/debate/SKILL.md`：

````markdown
---
name: debate
description: >
  /parallel：向 Claude 和 Codex 提同一问题，并排展示两份独立回复。
  /debate：调用 debate-orchestrator.mjs 运行 N 轮交叉批评，Skill 负责 Claude 发言，
  脚本负责轮次管理、Codex 调用和文件落地。
---

# Debate Skill

## /parallel 模式

### 触发条件
用户输入以 `/parallel` 开头。

### 执行步骤
1. 提取 `/parallel` 之后的内容作为 PROMPT
2. 生成 Claude 自己的完整回复，记为 CLAUDE_RESPONSE
3. 获取 Codex 回复：
   ```bash
   printf '%s' "PROMPT" | node scripts/debate-bridge.mjs
   ```
   若 exit code 非 0，输出错误信息并终止
4. 按格式输出结果

### 输出格式
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
{Claude 分析核心差异，3-5 条}
```
````

### 3.2 验收测试

在 Claude Code 会话中依次执行：

```
# 正常路径
/parallel 用 JavaScript 实现一个防抖函数，应该怎么写？
```
预期：`▶ CLAUDE`、`▶ CODEX`、`▶ 主要差异` 三个区块均有实质内容；差异分析是真实对比，非占位符。

```
# 边界 1：空 prompt
/parallel
```
预期：输出 `[错误]` 提示，不调用 Codex，不出现任何区块。

```
# 边界 2：Codex 调用失败（将 SKILL.md 中 bridge 路径临时改错触发，测后恢复）
```
预期：显示 `▶ CLAUDE` + `✗ CODEX 调用失败` + 错误原因，**不出现 `▶ 主要差异` 区块**。

**✅ Phase 3 通过条件：** 正常路径三区块齐全；空 prompt 被拦截不调用 Codex；Codex 失败时差异分析区块被完全跳过。

---

## Phase 4 — Debate 模式（Orchestrator + Skill）

> **架构要点：** Skill 只负责 Claude 的发言和脚本调用序列；所有确定性操作（轮次计数、Transcript 追加、Codex 调用、文件写入）由 `debate-orchestrator.mjs` 承担。

### 4.1 orchestrator 命令接口

| 命令 | 输入 | 输出 |
|------|------|------|
| `start --prompt "..." [--rounds N]` | argv | `READY sessionId=debate_<ts> rounds=N file=.council/debate_<ts>.md` |
| `turn --session <id>`（stdin: Claude 回复） | stdin | Codex 本轮回复（stdout） |
| `finish --session <id>`（stdin: Claude 综合） | stdin | `SAVED .council/debate_<ts>.md` |

Session 状态文件存储于 `.council/sessions/<sessionId>.json`，每次 `start` 创建独立文件，并发多场辩论互不干扰。

**Transcript 压缩策略（ADR-003）：**
- 累积长度 ≤ 6000 字符 → 完整传递给 Codex
- 累积长度 > 6000 字符 → 结构化摘要（每节标题 + 前 300 字符）+ 原始记录写入文件

### 4.2 在 SKILL.md 末尾追加 Debate 部分

````markdown
## /debate 模式

### 触发条件
用户输入以 `/debate` 开头。

### 参数解析
- 提取 `/debate` 之后、`--rounds` 之前的内容作为 PROMPT
- 若有 `--rounds N`，N 限定 [1, 5]；默认 2

### 执行步骤

**Step 1 — 初始化**
```bash
node scripts/debate-orchestrator.mjs start --prompt "PROMPT" --rounds N
```
从输出中解析 `sessionId=debate_<ts>`，保存为 SESSION_ID；告知用户即将开始 N 轮辩论。

**Step 2 — Round 循环（重复 N 次）**

2a. 生成 Claude 本轮回复（第 1 轮基于 PROMPT，后续轮基于上一轮 Codex 批评）
2b. 将 Claude 回复通过 stdin 传给 orchestrator：
```bash
printf '%s' "CLAUDE_RESPONSE" | node scripts/debate-orchestrator.mjs turn --session SESSION_ID
```
2c. 将 orchestrator 返回的 Codex 回复展示给用户，作为下一轮 Claude 的输入

**Step 3 — 最终综合**
Claude 基于整场辩论生成综合裁定（执行摘要 + 各方论点 + 建议行动），然后：
```bash
printf '%s' "SYNTHESIS" | node scripts/debate-orchestrator.mjs finish --session SESSION_ID
```
告知用户文件路径。

### 输出格式（终端）
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖ DEBATE  主题：{PROMPT 前 50 字}
共 {N} 轮 | 记录将保存至 .council/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[实时显示每轮 Claude + Codex 发言]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
记录已保存至 .council/debate_{ts}.md
```
````

### 4.3 .council/ 文件格式

```markdown
# Debate 记录

- **主题**：{PROMPT}
- **时间**：{ISO 时间戳}
- **轮数**：{N}

---

## Round 1 — Claude

{内容}

## Round 1 — Codex

{内容}

## Round 2 — Claude

{内容}

## Round 2 — Codex

{内容}

## 最终裁定

### 执行摘要
{1 段}

### 各方核心论点
- Claude：...
- Codex：...

### 建议行动
1. ...
```

### 4.4 验收测试

```bash
# 测试 1：mock 状态机（不需要真实 Codex，应最先执行）
npm run test:mock
# 预期：所有断言 ✓，0 失败

# 测试 2：orchestrator start 输出格式
node scripts/debate-orchestrator.mjs start --prompt "测试主题" --rounds 1
# 预期：READY sessionId=debate_<ts> rounds=1 file=.council/debate_<ts>.md

# 测试 3：空 prompt 被拒绝
node scripts/debate-orchestrator.mjs start --prompt "" 2>&1 | grep ERROR && echo "✓ prompt 校验"

# 测试 4：turn 轮次保护
SESSION=$(node scripts/debate-orchestrator.mjs start --prompt "轮次保护测试" --rounds 1 | grep -o 'sessionId=\S*' | cut -d= -f2)
printf '%s' "第一轮" | node scripts/debate-orchestrator.mjs turn --session "$SESSION" > /dev/null
printf '%s' "多余轮" | node scripts/debate-orchestrator.mjs turn --session "$SESSION" 2>&1 | grep ERROR && echo "✓ 轮次保护"

# 测试 5：在 Claude Code 中端到端测试（需真实 Codex）
# /debate 实现本地缓存，用 Map 还是 WeakMap？ --rounds 1
# 预期：1 轮辩论 + 最终裁定 + .council/ 文件落地

# 文件验证
ls .council/*.md 2>/dev/null && cat .council/debate_*.md | head -20
```

**✅ Phase 4 通过条件：** `npm run test:mock` 全部通过；测试 3/4 的校验均被拦截；端到端测试（测试 5）有完整内容 + 文件落地。

---

## Phase 5 — 错误处理与打磨

### 5.1 错误场景处理（Orchestrator 层已实现，Skill 层补充）

| 场景 | 检测 | 行为 |
|------|------|------|
| Codex 未登录 | stderr 含 `auth`/`login` | 退出并提示 `codex login` |
| Codex 超时 | stderr 含 `[TIMEOUT]` | 本轮填 `[Codex 无响应]`，继续 |
| 输出截断 | 含 `[TRUNCATED]` | 注明「Codex 回复已截断」 |
| 脚本不存在 | `MODULE_NOT_FOUND` | 提示完成 Phase 1-2 |
| `--rounds` 越界 | N < 1 或 N > 5 | 自动修正到边界值并告知 |
| Transcript 过长 | > 6000 字符 | Orchestrator 自动启用结构化摘要 |

### 5.2 .gitignore

```bash
# 初始化 Git（若尚未初始化）
git init

cat >> .gitignore << 'EOF'

# Claude-Codex Debate Skill
node_modules/
.council/
EOF
```

### 5.3 AGENTS.md（可选）

```bash
cat > AGENTS.md << 'EOF'
# Project Instructions

## Debate Skill
- /parallel：并行获取两个模型的独立观点
- /debate：多轮交叉批评，结果存入 .council/

## 技术约定
- Node.js 18+，ESM（.mjs 文件，package.json type: module）
- 脚本在 scripts/ 目录
- 辩论记录在 .council/（已加入 .gitignore）
EOF
```

---

## 10. 完整回归测试

```bash
# ── 第一层：状态机 mock 测试（无需 Codex，最快） ──────────────
echo "=== Mock 状态机 ==="
npm run test:mock
# 预期：所有 ✓，0 失败

# ── 第二层：CLI 安装验证（不验证登录） ────────────────────────
echo "=== 环境（CLI 安装） ==="
npm run test:env        # 只证明 CLI 已安装

# ── 第三层：登录状态 + SDK 接口 ──────────────────────────────
echo "=== 登录状态 ==="
npm run test:codex-auth # codex auth status（CLI 支持时）；否则提示用 bridge 验证
echo "=== SDK 接口 ==="
npm run test:sdk        # 证明 Codex 类存在于 SDK exports

# ── 第四层：Bridge 真实调用（唯一的完整登录验证） ────────────────
echo "=== Bridge（真实登录验证）==="
npm run test:bridge
npm run test:bridge:stdin

# ── 第四层：Orchestrator + session 流程 ──────────────────
echo "=== Orchestrator ==="
SESSION=$(node scripts/debate-orchestrator.mjs start --prompt "回归测试" --rounds 1 \
  | grep -o 'sessionId=\S*' | cut -d= -f2)
echo "sessionId: $SESSION"

printf '%s' "这是 Claude 的测试回复" \
  | node scripts/debate-orchestrator.mjs turn --session "$SESSION" \
  && echo "✓ turn"

printf '%s' "综合结论：测试通过" \
  | node scripts/debate-orchestrator.mjs finish --session "$SESSION" \
  && echo "✓ finish"

# ── 文件结构 ─────────────────────────────────────────────
echo "=== 文件结构 ==="
ls .claude/skills/debate/SKILL.md  && echo "✓ Skill"
ls scripts/debate-bridge.mjs       && echo "✓ Bridge"
ls scripts/debate-orchestrator.mjs && echo "✓ Orchestrator"
ls scripts/test-mock.mjs           && echo "✓ Mock Test"
ls package.json                    && echo "✓ package.json"
ls .council/sessions/*.json 2>/dev/null && echo "✓ Sessions" || echo "○ 尚无 session"
ls .council/*.md 2>/dev/null        && echo "✓ Council"  || echo "○ 尚无记录"

# ── 功能层（Claude Code 会话中手动执行）─────────────────────
# /parallel 什么是尾递归优化？
# /debate 数组还是链表，哪个更适合实现 LRU 缓存？ --rounds 1
```

---

## 11. 工时与里程碑

| Phase | 任务 | 乐观 | 保守 | 主要弹性来源 |
|-------|------|------|------|------------|
| Pre | 前置核查 | 20 min | 40 min | codex-plugin-cc 调研 |
| 0 | 环境验证 | 20 min | 30 min | — |
| 1 | SDK 安装 + Smoke Test | 30 min | 90 min | SDK API 实际接口 |
| 2 | Bridge 验证与调整 | 20 min | 60 min | turn 返回值结构 |
| 3 | Parallel Skill | 40 min | 60 min | — |
| 4 | Orchestrator + Debate Skill | 60 min | 120 min | Skill 与脚本协作调试 |
| 5 | 错误处理 + 打磨 | 30 min | 60 min | — |
| QA | 完整回归 | 20 min | 30 min | — |

**预估总工时：4–7.5 小时**

---

## 12. 技术决策记录（ADR）

### ADR-001：stdin 优先于 argv 传递 Prompt

**决策：** Bridge 和 Orchestrator 均优先从 stdin 读取，argv 仅作调试快捷方式。  
**Why：** 多轮 Transcript 可达数万字符，argv 中的换行和引号在 shell 展开后会破坏命令。  
**How to apply：** Skill 中调用脚本时用 `printf '%s' "$VAR" | node scripts/xxx.mjs`。

### ADR-002：`skipGitRepoCheck: true` 为默认配置

**决策：** `startThread()` 始终传入 `skipGitRepoCheck: true`。  
**Why：** 用户可能在非 Git 目录使用本工具，不应因此崩溃。  
**How to apply：** bridge 中硬编码，不作为可配置项。

### ADR-003：Transcript 分层传递策略

**决策：** 累积长度 ≤ 6000 字符时完整传递；超过阈值时传结构化摘要，原始记录仍完整写入 `.council/` 文件。  
**Why：** 完整传递保真但有被截断风险；纯截断会让 Codex 收到残缺上下文。分层策略两者兼顾。  
**How to apply：** 逻辑在 `debate-orchestrator.mjs` 的 `buildCodexInput()` 函数中，阈值为 6000 字符（约 1500 token）。

### ADR-004：Claude 担任辩论主席

**决策：** Claude 负责所有自身回复和最终裁定，Codex 担任对抗性评审者。  
**Why：** Claude Code 持有项目文件系统上下文，更适合将结论转化为代码操作。  
**How to apply：** Orchestrator 只负责调用 Codex；Claude 的发言始终在 Skill 上下文中原地生成。

### ADR-005：确定性流程下沉到脚本，Skill 只做触发

**决策：** 轮次循环、文件写入、Transcript 管理全部在 `debate-orchestrator.mjs` 中；SKILL.md 只描述触发条件和调用序列。  
**Why：** SKILL.md 是给模型的自然语言指令，不是确定性运行时。依赖 Skill 管理状态会导致 Phase 4 成为不稳定点。  
**How to apply：** SKILL.md 内只出现三类操作：`start`、`turn`、`finish`，状态完全由 orchestrator 的 `.session.json` 持有。

### ADR-007：每次 start 生成独立 session 文件

**决策：** Session 状态存储在 `.council/sessions/<sessionId>.json`，`sessionId = debate_<ts>`，`turn` 和 `finish` 必须携带 `--session <id>`。  
**Why：** 固定单一 `.session.json` 在两场并发辩论或中途中断重试时会覆盖状态。时间戳命名保证唯一性，同时也是可读的调试索引。  
**How to apply：** Skill 在 `start` 输出中解析 `sessionId=...`，后续所有 `turn`/`finish` 调用附带该 id。

### ADR-009：对抗性引导注入在 orchestrator 而非 SKILL.md

**决策：** `ADVERSARIAL_FRAME` 字符串在 `debate-orchestrator.mjs` 的 `buildCodexInput()` 中拼接到每次 Codex 调用的 prompt 最前面。SKILL.md 只做角色说明，不重复注入引导语。  
**Why：** SKILL.md 是给 Claude 读的指令，不影响 Codex 收到的内容。Codex 在没有明确角色指令时默认倾向共识和补充，而非对抗。对抗性引导必须在 orchestrator 层注入才能真正影响 Codex 的输出风格。验收中发现 Codex 以"同意"开头做增量补充，产品价值严重折损——debate 退化为 parallel 的延伸版。  
**How to apply：** `buildCodexInput` 始终以 `ADVERSARIAL_FRAME` 开头，无论是完整 transcript 路径还是压缩摘要路径。引导语要求 Codex 先找问题、指出失败场景和被忽略的代价，不以"同意"或"补充"开头。

### ADR-008：mock 模式置于 orchestrator 而非 bridge

**决策：** `CODEX_MOCK=1` 在 `orchestrator.mjs` 的 `callCodex()` 中短路，不经过 `spawnSync`。  
**Why：** Phase 4 的测试目标是状态机（session 文件、轮次、transcript 累积），不是桥接层。在 orchestrator 层 mock 避免了子进程开销，让 `npm run test:mock` 可以在离线环境下毫秒级完成。  
**How to apply：** `CODEX_MOCK=1` 时 `callCodex` 返回固定字符串；`test-mock.mjs` 通过 `env` 注入该变量。

### ADR-006：codex-plugin-cc 降级为可选增强

**决策：** MVP 不依赖 `codex-plugin-cc`；`/codex:review`、`/codex:status` 等命令归入可选插件功能。  
**Why：** npm 上的 `codex-plugin-cc` 发布者为社区用户（Kenmege），非 OpenAI 官方；将其作为前置依赖会让 MVP 被一个不确定的外部包阻塞。  
**How to apply：** Phase 0.3 标记为可选，完整通过核查后再决定是否安装。

---

*本文档随实施进展更新。每个 Phase 完成后在对应验收测试旁标注 ✅ 和实际完成时间。*
