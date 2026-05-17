// scripts/setup.mjs
// Global installation: copies scripts and SKILL.md files to ~/.claude/
// Run once after cloning: npm run setup

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..');
const HOME       = homedir();

const DEBATE_HOME = join(HOME, '.claude', 'debate');
const SCRIPTS_DST = join(DEBATE_HOME, 'scripts');
const SKILLS_DST  = join(HOME, '.claude', 'skills');

const line = '━'.repeat(42);

function step(n, msg) { process.stdout.write(`\n${n}/4  ${msg}\n`); }
function ok(msg)       { process.stdout.write(`  ✓ ${msg}\n`); }

// ── 1. Directories ────────────────────────────────────────────────────────
step(1, '创建目录...');
mkdirSync(SCRIPTS_DST,                   { recursive: true });
mkdirSync(join(SKILLS_DST, 'parallel'), { recursive: true });
mkdirSync(join(SKILLS_DST, 'debate'),   { recursive: true });
ok(SCRIPTS_DST);
ok(`${SKILLS_DST}/{parallel,debate}`);

// ── 2. Scripts ────────────────────────────────────────────────────────────
step(2, '复制脚本...');
for (const file of ['debate-bridge.mjs', 'debate-orchestrator.mjs']) {
  copyFileSync(join(REPO_ROOT, 'scripts', file), join(SCRIPTS_DST, file));
  ok(file);
}

// ── 3. SDK ────────────────────────────────────────────────────────────────
step(3, '安装 SDK（@openai/codex-sdk）...');
writeFileSync(
  join(DEBATE_HOME, 'package.json'),
  JSON.stringify({
    name: 'claude-codex-debate-runtime',
    private: true,
    type: 'module',
    dependencies: { '@openai/codex-sdk': '^0.130.0' },
  }, null, 2)
);
execSync('npm install', { cwd: DEBATE_HOME, stdio: 'inherit' });
ok('@openai/codex-sdk');

// ── 4. SKILL.md (inject absolute script paths) ────────────────────────────
step(4, '安装 Skill 文件...');

function installSkill(name) {
  const src = join(REPO_ROOT, '.claude', 'skills', name, 'SKILL.md');
  const dst = join(SKILLS_DST, name, 'SKILL.md');
  // Replace relative path with absolute so Skill works from any project
  const content = readFileSync(src, 'utf8')
    .replaceAll('node scripts/', `node ${SCRIPTS_DST}/`);
  writeFileSync(dst, content);
  ok(`~/.claude/skills/${name}/SKILL.md`);
}

installSkill('parallel');
installSkill('debate');

// ── Done ──────────────────────────────────────────────────────────────────
process.stdout.write(`
${line}
✅ 安装完成

脚本：${SCRIPTS_DST}
Skill：${SKILLS_DST}/parallel  ${SKILLS_DST}/debate

打开任意项目，启动新的 Claude Code 会话即可使用：
  /parallel <问题>
  /debate <问题> [--rounds N]

辩论记录保存在当前项目的 .council/ 目录下。
${line}
`);
