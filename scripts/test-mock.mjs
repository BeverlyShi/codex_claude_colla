// scripts/test-mock.mjs
// State-machine test for debate-orchestrator.mjs using CODEX_MOCK=1.
// Validates session lifecycle, round guards, and file output
// without requiring real Codex access.
//
// Run: npm run test:mock

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// .pathname keeps Chinese dir names URL-encoded; fileURLToPath decodes them
const __dirname = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR = join(__dirname, 'debate-orchestrator.mjs');
const env = { ...process.env, CODEX_MOCK: '1' };

let passed = 0;
let failed = 0;

function run(args, stdin = '') {
  return spawnSync('node', [ORCHESTRATOR, ...args], {
    input: stdin,
    encoding: 'utf8',
    env,
  });
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ── Test 1: full 1-round lifecycle ────────────────────────────────────────
console.log('\nTest 1: 完整 1 轮生命周期');
{
  const startResult = run(['start', '--prompt', '测试主题', '--rounds', '1']);
  assert('start 退出码 0', startResult.status === 0, startResult.stderr);

  const sessionIdMatch = startResult.stdout.match(/sessionId=(debate_[\w-]+)/);
  assert('start 输出 sessionId', !!sessionIdMatch, startResult.stdout);

  if (sessionIdMatch) {
    const sessionId = sessionIdMatch[1];

    const turnResult = run(['turn', '--session', sessionId], 'Claude 的第一轮观点');
    assert('turn 退出码 0', turnResult.status === 0, turnResult.stderr);
    assert('turn 输出 [MOCK]', turnResult.stdout.includes('[MOCK]'), turnResult.stdout);

    const finishResult = run(['finish', '--session', sessionId], '综合结论：方案 A 更优');
    assert('finish 退出码 0', finishResult.status === 0, finishResult.stderr);

    const savedMatch = finishResult.stdout.match(/SAVED (.+\.md)/);
    assert('finish 输出 SAVED 路径', !!savedMatch, finishResult.stdout);

    if (savedMatch) {
      const content = readFileSync(savedMatch[1].trim(), 'utf8');
      assert('文件包含主题',          content.includes('测试主题'));
      assert('文件包含 Round 1',      content.includes('## Round 1 — Claude'));
      assert('文件包含 Codex 回复',   content.includes('## Round 1 — Codex'));
      assert('文件包含最终裁定',       content.includes('## 最终裁定'));
    }
  }
}

// ── Test 2: rounds over-call guard ────────────────────────────────────────
console.log('\nTest 2: rounds 轮次上限保护');
{
  const start = run(['start', '--prompt', '轮次测试', '--rounds', '1']);
  const sessionId = start.stdout.match(/sessionId=(debate_[\w-]+)/)?.[1];

  if (sessionId) {
    run(['turn', '--session', sessionId], 'Round 1 内容');  // valid
    const over = run(['turn', '--session', sessionId], 'Round 2 额外调用');  // should fail
    assert('第 2 次 turn 退出码 1', over.status === 1, over.stderr);
    assert('第 2 次 turn 含 [ERROR]', over.stderr.includes('[ERROR]'), over.stderr);
  }
}

// ── Test 3: empty prompt guard ────────────────────────────────────────────
console.log('\nTest 3: 空 prompt 校验');
{
  const result = run(['start', '--prompt', '']);
  assert('空 prompt 退出码 1', result.status === 1, result.stderr);
  assert('空 prompt 含 [ERROR]', result.stderr.includes('[ERROR]'), result.stderr);
}

// ── Test 4: empty synthesis guard ────────────────────────────────────────
console.log('\nTest 4: 空综合裁定校验');
{
  const start = run(['start', '--prompt', '综合校验测试', '--rounds', '1']);
  const sessionId = start.stdout.match(/sessionId=(debate_[\w-]+)/)?.[1];

  if (sessionId) {
    run(['turn', '--session', sessionId], 'Claude 回复');
    const finish = run(['finish', '--session', sessionId], '');
    assert('空 synthesis 退出码 1', finish.status === 1, finish.stderr);
  }
}

// ── Test 5: concurrent sessions don't overwrite ───────────────────────────
console.log('\nTest 5: 并发 session 互不覆盖');
{
  const a = run(['start', '--prompt', 'Session A', '--rounds', '1']);
  const b = run(['start', '--prompt', 'Session B', '--rounds', '1']);
  const idA = a.stdout.match(/sessionId=(debate_[\w-]+)/)?.[1];
  const idB = b.stdout.match(/sessionId=(debate_[\w-]+)/)?.[1];

  assert('两个 sessionId 不同', idA !== idB, `A=${idA} B=${idB}`);

  if (idA && idB) {
    run(['turn', '--session', idA], 'A 的观点');
    run(['turn', '--session', idB], 'B 的观点');

    const finA = run(['finish', '--session', idA], 'A 综合');
    const finB = run(['finish', '--session', idB], 'B 综合');

    const fileA = finA.stdout.match(/SAVED (.+\.md)/)?.[1]?.trim();
    const fileB = finB.stdout.match(/SAVED (.+\.md)/)?.[1]?.trim();

    assert('两个输出文件不同', fileA !== fileB, `A=${fileA} B=${fileB}`);

    if (fileA && fileB) {
      const contentA = readFileSync(fileA, 'utf8');
      const contentB = readFileSync(fileB, 'utf8');
      assert('A 文件含 Session A 主题', contentA.includes('Session A'));
      assert('B 文件含 Session B 主题', contentB.includes('Session B'));
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`通过: ${passed}  失败: ${failed}`);
if (failed > 0) process.exit(1);
