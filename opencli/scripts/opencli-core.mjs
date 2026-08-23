/**
 * opencli-core.mjs —— OpenCLI 的最小 JS 封装。
 *
 * 这是本仓库的规范副本，配套文档见同 Skill 的 references/session-laws.md。
 * `backlink/scripts/opencli-core.mjs` 是同一份代码的 vendored 副本——
 * 那 17 个消费脚本必须在 opencli Skill 未安装时也能跑，所以两份并存；
 * 改动任何一份时同步另一份。
 *
 * 最重要的一个导出是 defaultSession(base)：它把会话名的后缀解析成
 * OPENCLI_SESSION_SUFFIX -> CLAUDE_CODE_SESSION_ID -> CLAUDE_CODE_HOST_SESSION_ID -> pid，
 * 绝不要直接用 HOST id（它被整个桌面应用共享，会把同一个标签页发给并行任务）。
 */

import { spawn } from 'node:child_process';

export function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

export function required(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${name} is required.`);
  return value;
}

export function validateSession(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(value)) {
    throw new Error('Session names may contain only letters, numbers, and hyphens.');
  }
  return value;
}

/**
 * A session name is a tab claim: two tasks that pick the same name share one tab
 * and read back each other's pages, which looks exactly like the CLI stealing
 * tabs. So no script may ship a literal session name as its default — every
 * default gets a per-process suffix, with `--session` still overriding.
 */
export function defaultSession(base) {
  // Order matters. CLAUDE_CODE_SESSION_ID is per conversation — the unit that
  // actually runs concurrently on one machine. CLAUDE_CODE_HOST_SESSION_ID is
  // per desktop-app host and is SHARED by every conversation inside it, so it
  // is a fallback, never the first choice: keying off it hands two parallel
  // tasks the same tab, which is the exact bug this helper exists to prevent.
  const suffix = (
    process.env.OPENCLI_SESSION_SUFFIX ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CLAUDE_CODE_HOST_SESSION_ID ||
    String(process.ppid)
  ).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'local';
  return validateSession(`${base}-${suffix}`);
}

/**
 * Subagents inherit the parent conversation's environment, so several agents
 * spawned inside ONE conversation still resolve to the same default. Any script
 * that fans browser work out across parallel agents must give each one an
 * explicit `--session` (or set OPENCLI_SESSION_SUFFIX per agent).
 */

export async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? 60_000}ms.`));
    }, options.timeoutMs ?? 60_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited ${code}.`));
    });
  });
}

export async function opencli(args, options = {}) {
  const resolved = [...args];
  if (resolved[0] === 'browser' && resolved[1] && !resolved.includes('--window')) {
    const requested = options.windowMode || options.env?.OPENCLI_WINDOW || 'background';
    const windowMode = requested === 'foreground' ? 'foreground' : 'background';
    resolved.splice(2, 0, '--window', windowMode);
  }
  // Default `state` snapshots to AX (accessibility-tree) format — compact,
  // fewer tokens than the full DOM tree.  Callers can still override with an
  // explicit `--source dom`.
  if (resolved[0] === 'browser' && !resolved.includes('--source')) {
    const sub = resolved.findIndex((a, i) => i >= 2 && a === 'state');
    if (sub >= 0) resolved.splice(sub + 1, 0, '--source', 'ax');
  }
  return await run('opencli', resolved, options);
}

export function firstJson(text) {
  const source = String(text);
  const start = [...source].findIndex((character) => character === '{' || character === '[');
  if (start < 0) throw new Error('OpenCLI returned no JSON payload.');
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      stack.pop();
      if (stack.length === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error('OpenCLI returned incomplete JSON.');
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Execute multiple browser operations in a single CLI call. Each command is
 * {cmd, args} matching the `opencli browser <session> batch` contract.
 * Returns the parsed results array; each element has {cmd, index, ok, result?, error?}.
 */
export async function batchBrowser(session, commands, options = {}) {
  const windowMode = options.windowMode || options.env?.OPENCLI_WINDOW || 'background';
  const result = await run('opencli', [
    'browser', session, '--window', windowMode === 'foreground' ? 'foreground' : 'background',
    'batch', '--commands', JSON.stringify(commands),
  ], options);
  return JSON.parse(result.stdout);
}

/**
 * Open a URL, optionally wait, then eval an expression — the most common
 * three-step browser sequence, collapsed into one CLI call.
 */
export async function openAndEval(session, url, expression, options = {}) {
  const wait = options.wait ?? 3;
  const commands = [
    { cmd: 'open', args: { url } },
    ...(wait > 0 ? [{ cmd: 'wait', args: { seconds: wait } }] : []),
    { cmd: 'eval', args: { js: expression } },
  ];
  const results = await batchBrowser(session, commands, options);
  const last = results[results.length - 1];
  if (!last.ok) throw new Error(last.error || 'eval failed in openAndEval');
  return last.result;
}

export async function closeSession(session) {
  await opencli(['browser', session, 'close'], { allowFailure: true, timeoutMs: 20_000 });
}
