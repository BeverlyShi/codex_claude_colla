// scripts/debate-orchestrator.mjs
// Owns all deterministic debate logic: session state, rounds, Codex calls,
// transcript accumulation, and file I/O.
//
// Commands:
//   node scripts/debate-orchestrator.mjs start --prompt "..." [--rounds N]
//     → prints: READY sessionId=debate_<ts> rounds=N file=.council/debate_<ts>.md
//
//   printf '%s' "$CLAUDE" | node scripts/debate-orchestrator.mjs turn --session <id>
//     → prints: Codex response for this round
//
//   printf '%s' "$SYNTHESIS" | node scripts/debate-orchestrator.mjs finish --session <id>
//     → prints: SAVED .council/debate_<ts>.md
//
// Mock mode (for state-machine testing without real Codex):
//   CODEX_MOCK=1 node scripts/debate-orchestrator.mjs ...

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNCIL_DIR   = '.council';
const SESSIONS_DIR  = join(COUNCIL_DIR, 'sessions');
const BRIDGE        = join(__dirname, 'debate-bridge.mjs');

// ADR-003: full transcript below this limit; structured summary above it
const TRANSCRIPT_COMPRESS_CHARS = 6000;

const command = process.argv[2];
const flags   = parseFlags(process.argv.slice(3));

// ── Helpers ───────────────────────────────────────────────────────────────

function parseFlags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (args[i].startsWith('--')) {
      result[args[i].slice(2)] = true;
    }
  }
  return result;
}

function getSessionFile(sessionId) {
  return join(SESSIONS_DIR, `${sessionId}.json`);
}

function loadSession(sessionId) {
  return JSON.parse(readFileSync(getSessionFile(sessionId), 'utf8'));
}

function saveSession(session) {
  writeFileSync(getSessionFile(session.sessionId), JSON.stringify(session, null, 2));
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

// Adversarial framing prepended to every Codex call in debate mode.
// Without this, LLMs default to consensus-seeking and additive feedback.
// The goal is genuine friction: find failure modes, not refine correct parts.
const ADVERSARIAL_FRAME = `\
你的角色是对手审查者（adversarial reviewer）。
你的任务是寻找对方论点的漏洞、边界条件和反例，而不是补充对方已经正确的部分。
具体要求：
- 如果对方方案在某些场景下会失败，明确指出是哪些场景
- 如果对方忽略了重要的权衡取舍，明确指出被忽略的代价
- 如果你认为对方方案存在更优替代，提出并说明为何更优
- 不要以"同意"或"补充"开头——先找问题，再评价优点

---
`;

// ADR-003: full transcript under threshold; structured summary prepended above it
function buildCodexInput(prompt, transcript) {
  if (transcript.length <= TRANSCRIPT_COMPRESS_CHARS) {
    return `${ADVERSARIAL_FRAME}${prompt}\n\n${transcript}`;
  }
  const summary = transcript
    .split(/(?=^## )/m)
    .map(section => {
      const lines   = section.trimEnd().split('\n');
      const heading = lines[0];
      const body    = lines.slice(1).join('\n').trim().slice(0, 300);
      return `${heading}\n${body}${body.length === 300 ? '…' : ''}`;
    })
    .join('\n\n');
  return `${ADVERSARIAL_FRAME}${prompt}\n\n[以下为辩论摘要，完整记录已超过压缩阈值]\n\n${summary}`;
}

// Returns Codex response string; records reason on failure for transcript annotation.
// Set CODEX_MOCK=1 to skip real Codex and return a deterministic mock string.
function callCodex(prompt) {
  if (process.env.CODEX_MOCK === '1') {
    return `[MOCK] Codex 模拟批评：针对「${prompt.slice(0, 60).replace(/\n/g, ' ')}…」的对抗性审查意见。`;
  }

  const result = spawnSync('node', [BRIDGE], {
    input: prompt,
    encoding: 'utf8',
    timeout: 130_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? '';

    // Auth errors are fatal — exit immediately with guidance
    if (stderr.includes('auth') || stderr.includes('login')) {
      process.stderr.write('[AUTH] Codex 未登录，请先执行 codex login\n');
      process.exit(1);
    }

    // Distinguish error reason for transcript annotation
    if (result.signal === 'SIGTERM' || stderr.includes('[TIMEOUT]')) {
      return '[Codex 无响应: TIMEOUT]';
    }
    return `[Codex 无响应: EXIT_${result.status ?? 1}]`;
  }

  return result.stdout.trim();
}

// ── Main ──────────────────────────────────────────────────────────────────

async function run() {
  switch (command) {

    // ── start ──────────────────────────────────────────────────────────
    case 'start': {
      if (!flags.prompt?.trim()) {
        process.stderr.write('[ERROR] --prompt 不能为空\n');
        process.exit(1);
      }

      mkdirSync(SESSIONS_DIR, { recursive: true });
      mkdirSync(COUNCIL_DIR,  { recursive: true });

      const rounds    = Math.min(5, Math.max(1, parseInt(flags.rounds) || 2));
      const ts        = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
      const sessionId = `debate_${ts}`;

      const session = {
        sessionId,
        prompt:      flags.prompt.trim(),
        rounds,
        currentRound: 0,
        transcript:   '',
        ts,
        outputFile:  join(COUNCIL_DIR, `${sessionId}.md`),
      };

      saveSession(session);
      process.stdout.write(
        `READY sessionId=${sessionId} rounds=${rounds} file=${session.outputFile}\n`
      );
      break;
    }

    // ── turn ───────────────────────────────────────────────────────────
    case 'turn': {
      if (!flags.session) {
        process.stderr.write('[ERROR] --session <sessionId> 必须指定\n');
        process.exit(1);
      }

      const session = loadSession(flags.session);

      // Guard: prevent extra rounds beyond what was declared in start
      if (session.currentRound >= session.rounds) {
        process.stderr.write(
          `[ERROR] 已完成全部 ${session.rounds} 轮，请调用 finish\n`
        );
        process.exit(1);
      }

      const claudeResponse = await readStdin();
      if (!claudeResponse) {
        process.stderr.write('[ERROR] Claude 回复不能为空\n');
        process.exit(1);
      }

      session.currentRound++;
      session.transcript += `## Round ${session.currentRound} — Claude\n\n${claudeResponse}\n\n`;

      const codexInput    = buildCodexInput(session.prompt, session.transcript);
      const codexResponse = callCodex(codexInput);

      session.transcript += `## Round ${session.currentRound} — Codex\n\n${codexResponse}\n\n`;
      saveSession(session);

      // Print a terminal-friendly preview; full response is in the session file.
      // Long outputs collapse in Claude Code UI — keep stdout short for readability.
      const PREVIEW_CHARS = 400;
      const isLong = codexResponse.length > PREVIEW_CHARS;
      const preview = isLong
        ? codexResponse.slice(0, PREVIEW_CHARS) + `\n…（已截断，完整回复见 ${session.outputFile}）`
        : codexResponse;
      process.stdout.write(preview);
      break;
    }

    // ── finish ─────────────────────────────────────────────────────────
    case 'finish': {
      if (!flags.session) {
        process.stderr.write('[ERROR] --session <sessionId> 必须指定\n');
        process.exit(1);
      }

      const synthesis = await readStdin();
      if (!synthesis) {
        process.stderr.write('[ERROR] 综合裁定不能为空\n');
        process.exit(1);
      }

      const session = loadSession(flags.session);
      session.transcript += `## 最终裁定\n\n${synthesis}\n`;

      const header = [
        '# Debate 记录',
        '',
        `- **主题**：${session.prompt}`,
        `- **时间**：${session.ts}`,
        `- **轮数**：${session.currentRound}`,
        '',
        '---',
        '',
      ].join('\n');

      writeFileSync(session.outputFile, header + session.transcript);
      process.stdout.write(`SAVED ${session.outputFile}\n`);
      break;
    }

    default:
      process.stderr.write(
        `[ERROR] 未知命令: ${command ?? '(无)'}\n` +
        `用法: start --prompt "..." [--rounds N] | turn --session <id> | finish --session <id>\n`
      );
      process.exit(1);
  }
}

run().catch(err => {
  process.stderr.write('[ERROR] ' + err.message + '\n');
  process.exit(1);
});
