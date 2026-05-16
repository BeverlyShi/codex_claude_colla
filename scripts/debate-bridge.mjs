// scripts/debate-bridge.mjs  (ESM — required by @openai/codex-sdk)
// Usage:
//   Single-line:  node scripts/debate-bridge.mjs "<prompt>"
//   Long/piped:   printf '%s' "$PROMPT" | node scripts/debate-bridge.mjs

import { Codex } from '@openai/codex-sdk';

const MAX_CHARS = 8000;    // ~2000 tokens
const TIMEOUT_MS = 120000; // 120 s

async function main(prompt) {
  if (!prompt?.trim()) {
    process.stderr.write('[ERROR] prompt 不能为空\n');
    process.exit(1);
  }

  const timer = setTimeout(() => {
    process.stderr.write('[TIMEOUT] Codex 响应超时（120s）\n');
    process.exit(1);
  }, TIMEOUT_MS);

  try {
    const codex = new Codex();
    const thread = codex.startThread({
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true,
    });

    const turn = await thread.run(prompt);
    clearTimeout(timer);

    // Fallback chain: SDK version differences may expose the value differently
    let output =
      turn.finalResponse          ??
      turn.response               ??
      turn.text                   ??
      turn.output                 ??
      JSON.stringify(turn.items)  ??
      '[NO OUTPUT]';

    if (output.length > MAX_CHARS) {
      output = output.slice(0, MAX_CHARS) + '\n\n[TRUNCATED]';
    }

    process.stdout.write(output);
    process.exit(0);

  } catch (err) {
    clearTimeout(timer);
    process.stderr.write('[ERROR] ' + err.message + '\n');
    process.exit(1);
  }
}

// stdin takes priority over argv — safe for large multi-round transcripts
if (process.argv[2]) {
  main(process.argv[2]);
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => main(input.trim()));
}
