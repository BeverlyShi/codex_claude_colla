# Claude–Codex Debate Skill

在 Claude Code 工作流中嵌入双模型并行对比与自动辩论。

- `/parallel` — 同时获得 Claude 和 Codex 对同一问题的独立回答，并排对比
- `/debate` — 自动运行多轮交叉批评，Codex 扮演对手审查者，Claude 最终综合裁定

## 前置条件

| 依赖 | 要求 | 验证 |
|------|------|------|
| Node.js | 18.18+ | `node --version` |
| Claude Code | 最新版 | `claude --version` |
| Codex CLI | 最新版，已登录 | `codex --version` |

Codex 登录：
```bash
codex login   # 使用 ChatGPT 账号，复用现有订阅，无需额外 API 费用
```

## 安装（一次性）

```bash
git clone https://github.com/your-username/claude-codex-debate
cd claude-codex-debate
npm install
npm run setup
```

`setup` 会将脚本和 Skill 文件安装到 `~/.claude/`，之后任意项目都可使用。

## 使用方式

在**任意项目目录**下，打开一个**新的** Claude Code 会话：

```bash
cd ~/your-project
claude
```

### /parallel — 并行对比

```
/parallel 这段缓存逻辑应该放在 service 层还是 repository 层？
```

输出：Claude 回答 / Codex 回答 / 主要差异分析，三块并排呈现。

### /debate — 多轮辩论

```
/debate 我们应该用微服务还是单体架构？ --rounds 2
```

```
/debate AI 编程助手的普及会让程序员能力变强还是变弱？
```

- 默认 2 轮，最多 5 轮（`--rounds N`）
- 每轮：Claude 提出论点 → Codex 以对手审查者身份找漏洞和反例
- 最终：Claude 综合裁定，给出建议行动
- 辩论结束后，完整记录保存在当前项目的 `.council/` 目录下

## 文件说明

```
your-project/
└── .council/
    ├── sessions/          ← 会话状态（临时文件）
    └── debate_<ts>.md     ← 完整辩论记录，可直接打开阅读
```

`.council/` 已加入 `.gitignore`，不会提交到版本库。

## 完整工作流（推荐）

安装 OpenAI 官方插件 [codex-plugin-cc](https://github.com/openai/codex-plugin-cc)，解锁 Codex 代码执行能力：

```
# 在 Claude Code 中执行一次
/plugin marketplace add openai/codex-plugin-cc
```

安装后，典型工作流：

```
/debate 我们应该用 Redis 还是内存缓存？ --rounds 2
  → Claude 与 Codex 多轮辩论，得出最优方案

/codex:rescue 根据辩论结论，用 Redis 实现缓存层，修改 src/cache.ts
  → Codex 作为 agent 直接写代码、修改文件
```

也可以随时独立使用 `/codex:rescue` 将任何任务委托给 Codex 执行。

## 更新

```bash
cd claude-codex-debate
git pull
npm run setup   # 重新安装，覆盖旧版本
```
