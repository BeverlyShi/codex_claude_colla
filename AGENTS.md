# Project Instructions for Codex

## 项目用途
本项目是 Claude Code 的双模型协作工具，为开发者提供 /parallel（并行对比）和 /debate（多轮辩论）功能。

## 目录约定
- `scripts/`：核心脚本，debate-bridge.mjs 负责单次 Codex 调用，debate-orchestrator.mjs 负责辩论状态管理
- `.claude/skills/`：Claude Code Skill 文件，定义 /parallel 和 /debate 触发器
- `.council/`：辩论记录输出目录，不纳入版本管理

## 技术约定
- 模块格式：ESM（.mjs），package.json 中 `"type": "module"`
- Node.js 18+
- 核心依赖：`@openai/codex-sdk`

## 当你被 /codex:rescue 调用时
- 优先阅读 `scripts/` 下的文件了解现有接口
- 新脚本放在 `scripts/` 目录
- 不要修改 `.council/` 下的任何文件（辩论记录）
- 遵循 ESM 模块格式，不引入 CommonJS require()
