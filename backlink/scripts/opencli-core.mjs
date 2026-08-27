import { readFileSync } from 'node:fs';
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

/**
 * `--help` 是成功，不是用法错误。
 *
 * 这五个面板脚本此前的行为是：`--help` 走到 `required()` 抛未捕获异常，
 * 打一屏堆栈、退出码 1。任何 `set -e` 的批处理扫过去都会把它们判成脚本坏了，
 * 而它们其实是好的——想看用法的人反而以为装挂了。
 *
 * 帮助文案直接取**本文件自身的头部注释**，不另写一份：两份文案必然漂移，
 * 而漂移后的帮助比没有帮助更误导人。
 */
export function showHelpIfRequested(flags, importMetaUrl) {
  if (!flags.help && !flags.h) return;
  let text = '';
  try {
    const path = new URL(importMetaUrl).pathname;
    const src = readFileSync(path, 'utf8');
    const m = src.match(/\/\*\*([\s\S]*?)\*\//);
    if (m) text = m[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim();
  } catch { /* 取不到就退回下面那句 */ }
  console.log(text || '这个脚本还没写头部说明；用 --domain / --out 之类的参数直接跑，或读源码。');
  process.exit(0);
}

/**
 * `helpGuard` 是 `showHelpIfRequested` 的无依赖版本：直接看 `process.argv`，
 * 不要求调用方先解析出 flags。
 *
 * 为什么需要两个：仓库里的脚本分两类——一类用 `parseFlags`（那类用上面那个函数），
 * 另一类自己数 `process.argv.length` 或读 `process.argv[2]`。后者往往在**任何**
 * 参数解析之前就先做必填校验或直接开工，`--help` 走到那里就抛异常了。
 * 所以这个守卫要放在文件最前面，早于一切。
 */
export function helpGuard(importMetaUrl) {
  const argv = process.argv.slice(2);
  if (!argv.includes('--help') && !argv.includes('-h')) return;
  showHelpIfRequested({ help: true }, importMetaUrl);
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
 * A settle step that actually sleeps.
 *
 * `wait time <seconds>` is broken in opencli 1.8.7: it reports the seconds back
 * but returns after well under a second, so every `wait time 12` in this repo
 * used to be a no-op and pages were read before they had rendered. Measured on
 * a fresh session with a live page: `wait time 1`, `5`, and `12` all returned in
 * ~0.97s, while an in-page timer of the same length was accurate to within a
 * second. `wait selector` and `wait text` are unaffected and stay preferred —
 * reach for this only when there is no condition to wait on.
 *
 * `tests/opencli-wait.test.mjs` pins this. If it starts failing because the
 * sleep got accurate, opencli fixed `wait time` and this can go back.
 */
export function sleepStep(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  return { cmd: 'eval', args: { js: `(async () => { await new Promise((resolve) => setTimeout(resolve, ${ms})); return true; })()` } };
}

/**
 * Open a URL, optionally wait, then eval an expression — the most common
 * three-step browser sequence, collapsed into one CLI call.
 */
export async function openAndEval(session, url, expression, options = {}) {
  const wait = options.wait ?? 3;
  const commands = [
    { cmd: 'open', args: { url } },
    ...(wait > 0 ? [sleepStep(wait)] : []),
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
