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

export function makeSubmitGuard(handoffOnly = false) {
  const blockSubmit = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const blockClick = (event) => {
    if (event.target?.closest?.('button[type="submit"],input[type="submit"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  return { blockSubmit, blockClick, handoffOnly: Boolean(handoffOnly) };
}

export function releaseSubmitGuard(target, documentTarget, humanHandoff = false) {
  const guard = target.__backlinkOpenCliSubmitGuard;
  if (!guard) return { released: false, reason: 'no_guard' };
  if (guard.handoffOnly && !humanHandoff) return { released: false, reason: 'captcha_handoff_only', handoffOnly: true };
  documentTarget.removeEventListener('submit', guard.blockSubmit, true);
  documentTarget.removeEventListener('click', guard.blockClick, true);
  delete target.__backlinkOpenCliSubmitGuard;
  return { released: true, handoffOnly: Boolean(guard.handoffOnly), submitAttempted: false };
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
    `p${process.ppid}`
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
  // `sessions` / `cleanup` 不是会话名，是子命令本身。给它们注入 --window 会让
  // CLI 把子命令当成会话名解析，命令整个失败——而调用方通常 allowFailure，
  // 于是失败被吞掉，snapshotSessions() 静默返回空数组，差集回收变成空操作。
  const BARE = new Set(['sessions', 'cleanup']);
  if (resolved[0] === 'browser' && resolved[1] && !BARE.has(resolved[1]) && !resolved.includes('--window')) {
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

/* ------------------------------------------------------------------ *
 * 配额站：并发受限的站点
 * ------------------------------------------------------------------ */

/**
 * 配额站清单。
 *
 * 这些站不是「开太多标签页不礼貌」，是**同时加载会触发上限**。
 * 实测（用户反馈 2026-08-28）：Semrush 大约 3 个标签页同时 load 就出问题，
 * 一个个加载、中间隔几秒则没事。所以受限的资源是**导航事件**，不是标签页存在。
 *
 * 受限的既然是导航，解法就不是信号量，是串行 + 间隔——而串行 daemon 已经
 * 免费提供了：同名会话的写会在本机排队。于是「一个站一个固定会话名」
 * 就同时拿到了串行、标签页数量上限、以及不会读到别人的页面。
 */
export const QUOTA_SITES = [
  { match: /(^|\.)sem\.3ue\.co$/i,      key: 'semrush',    gapMs: 4000 },
  { match: /(^|\.)semrush\.com$/i,      key: 'semrush',    gapMs: 4000 },
  { match: /(^|\.)sim\.3ue\.co$/i,      key: 'similarweb', gapMs: 4000 },
  { match: /(^|\.)similarweb\.com$/i,   key: 'similarweb', gapMs: 4000 },
];

export function quotaSiteOf(url) {
  let host;
  try { host = new URL(String(url)).hostname; } catch { return null; }
  return QUOTA_SITES.find((site) => site.match.test(host)) || null;
}

/**
 * 配额站的会话名是**固定的**，不带任何 per-agent 后缀——这正是重点。
 * 十个 agent 拿到同一个名字，daemon 就把它们排成一队，Semrush 那边
 * 永远只看到一个标签页在一页页地翻。
 *
 * 这是四条会话法律里第 1 条（一个会话一个标签页、N 个页面 N 个会话名）
 * 的**唯一例外**，因为那条法律防的是「读到别人的页面」，而配额站靠
 * openAndExtract 的原子 batch 已经防住了同一件事。
 */
export function quotaSession(url) {
  const site = quotaSiteOf(url);
  return site ? `${site.key}-nav` : null;
}

/** 配额站用固定名，其余走 defaultSession 的 per-conversation 后缀。 */
export function sessionForUrl(url, base) {
  return quotaSession(url) || defaultSession(base);
}

/**
 * 会话名长得像 `$$` 展开的结果就拒绝。
 *
 * Claude Code 的 Bash tool 每次调用都是新进程，`$$` 每次都变，于是
 * `probe-$$` 会变成一串各不相同的会话名，每个都开一个新标签页，
 * 上一个打开的页面被遗弃——agent 看到的永远是空白页。
 * 实测 2026-08-28：`opencli-wait-probe-<PID>` 一天出现 14 个不同后缀。
 *
 * 这个失败不报错，只表现为「页面怎么老是空的」，所以必须让它当场红。
 * defaultSession 的 pid 兜底会写成 `p12345`，不会被这条误伤。
 */
export function guardSessionName(value) {
  validateSession(value);
  if (/-\d{3,6}$/.test(value)) {
    throw new Error(
      `会话名 "${value}" 以 3~6 位数字结尾，这是 $$ / PID 的形状。\n` +
      'Bash tool 里 $$ 每次调用都变，会把同一件事拆成一串标签页。\n' +
      '改用描述性常量（backlink-probe-cn），或 scripts/session.sh 的 oc_session。',
    );
  }
  return value;
}

/**
 * 打开一个页面并就地取数——配额站上唯一允许的访问形态。
 *
 * 整个 open → wait → extract 打包成**一个 batch**。SKILL.md 记着
 * 「含任一写操作的混合 batch 整体按写处理」，所以这一整包是被会话锁
 * 保护的原子单元，别人插不进来。反过来说：**不允许** open 一次然后
 * 隔几轮对话再回来读——那样会话一直占着，后面所有人都在排队。
 *
 * 重试的关键在于**不重开**。导航超时（扩展硬编码 15s，改不了）不等于
 * 页面没开——标签页已经建好了，只是没加载完。所以第二次尝试先光跑一次
 * extract 探活，确认真的没内容才在**同一个会话**里重新导航。
 * 每开一个新会话去重试，就是今天日志里那些重复标签页的来源。
 */
/**
 * openAndExtract 的命令构造，抽成纯函数是为了能直接断言形状——
 * 「探活那一次不许带 open」这条规则如果只活在循环里，就只能靠跑真页面去验，
 * 而同 URL 的 open 在 Chrome 里可能根本不触发重新加载，测不出来。
 */
export function buildExtractCommands({ navigate, url, evalStep, selector, settleSeconds, gapMs, timeout }) {
  // 节流放在 batch 末尾：它把会话锁多握 gapMs，间隔就出现在两次导航之间，
  // 不用另造一个限流器。串行循环里其实用不到（循环自己 sleep），
  // 这是留给「真有并行 agent 在排队」的那种情况的。
  const throttle = gapMs > 0 ? [sleepStep(gapMs / 1000)] : [];
  if (!navigate) return [evalStep, ...throttle];
  const waitStep = selector ? [{ cmd: 'wait', args: { selector, timeout } }] : [];
  const settle = settleSeconds > 0 ? [sleepStep(settleSeconds)] : [];
  return [{ cmd: 'open', args: { url } }, ...waitStep, ...settle, evalStep, ...throttle];
}

export async function openAndExtract(session, url, expression, options = {}) {
  guardSessionName(session);
  const site = quotaSiteOf(url);
  const selector = options.selector || null;
  const settleSeconds = options.settleSeconds ?? (selector ? 0 : 3);
  const gapMs = options.gapMs ?? (site ? site.gapMs : 0);
  const retries = options.retries ?? 2;

  const evalStep = { cmd: 'eval', args: { js: expression } };
  const build = (navigate) => buildExtractCommands({
    navigate, url, evalStep, selector, settleSeconds, gapMs,
    timeout: options.timeout ?? 25_000,
  });

  // 第 0 次导航；第 1 次**只**跑 extract 探活——导航超时（扩展硬编码 15s）
  // 不等于页面没开，标签页已经建好了，很可能只是 load 事件没等到。
  // 确认真的没内容，第 2 次才在同一个会话里重新导航。
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const navigate = attempt !== 1;
    const commands = build(navigate);
    let results;
    try {
      results = await batchBrowser(session, commands, options);
    } catch (error) {
      if (attempt === retries) throw error;
      continue;
    }
    const extracted = results.find((r) => r.cmd === 'eval' && r.index === commands.indexOf(evalStep));
    if (extracted?.ok && extracted.result != null) return extracted.result;
  }
  throw new Error(`openAndExtract 在 ${retries + 1} 次尝试后仍未取到内容：${url}`);
}

/**
 * 顺序爬取——配额站的默认形态，也是本模块想让人走的那条路。
 *
 * 不要扇出 N 个 agent 各自去抢同一个会话锁。daemon 的排队是**兜底，
 * 不是调度器**：它默认只等 10 分钟，20 个词顺序跑就快贴到上限了，
 * 而且每 2 秒轮询一次会在 daemon.log 里刷一条 WARN
 * （实测一天 1016 条）。采集本来就该是一个进程里的一个循环。
 */
export async function sequentialCrawl(items, handler, options = {}) {
  const gapMs = options.gapMs ?? 4000;
  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) await new Promise((r) => setTimeout(r, gapMs));
    try {
      results.push({ item: items[index], ok: true, value: await handler(items[index], index) });
    } catch (error) {
      if (options.stopOnError) throw error;
      results.push({ item: items[index], ok: false, error: String(error.message || error) });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * 会话回收
 * ------------------------------------------------------------------ */

export async function snapshotSessions() {
  const out = await opencli(['browser', 'sessions', '-f', 'json'], { allowFailure: true, timeoutMs: 20_000 });
  try { return firstJson(out.stdout); } catch { return []; }
}

/**
 * 差集回收：只关这一轮新出现的会话。
 *
 * **不要用 `opencli browser cleanup`**——它释放的是本机**全部**租约，
 * 并行扇出时会把兄弟 agent 正在读的页面一起关掉，而那些 agent 只会
 * 看到自己的页面莫名其妙不见了。
 *
 * 差集版能收掉崩溃的 sub agent 留下的标签页，一个兄弟的都不碰。也比
 * idle alarm 快——实测 2026-08-28 有 31 个标签页是靠 idle 自己掉的，
 * 在它掉之前用户的标签栏一直是脏的。
 */
export async function reconcileSessions(before, options = {}) {
  const seen = new Set((before || []).map((s) => s.session));
  const after = await snapshotSessions();
  let orphans = after.filter((s) => !seen.has(s.session));

  // 光靠「快照之后新出现的」还不够：兄弟 agent 在同一个时间窗里开的会话
  // 也是新出现的，无差别关掉就退化成了 cleanup——正是这个函数要替代的东西。
  // 实测 2026-08-28：一次 dry-run 里就混进了一个别人的 sweep2-* 会话。
  // 所以必须由调用方声明哪些是自己的；没声明就只报告、不动手。
  const owned = options.sessions ? new Set(options.sessions) : null;
  const prefix = options.prefix || null;
  if (owned) orphans = orphans.filter((s) => owned.has(s.session));
  else if (prefix) orphans = orphans.filter((s) => s.session.startsWith(prefix));

  if (options.dryRun || (!owned && !prefix)) return orphans;
  for (const orphan of orphans) await closeSession(orphan.session);
  return orphans;
}

/**
 * 配额站的会话名由**站点**决定，不由调用方决定。
 *
 * 这些脚本原本一律是 `flags.session ? ... : defaultSession(base)`，
 * 也就是每个 agent 一个名字——正是它让 19 个标签页同时压在一个 Semrush
 * 报表上。配额站上并发度就是会话名，所以名字得收归站点。
 *
 * `--session` 不再能悄悄恢复旧行为：传了会被忽略并打一行 stderr，
 * 真要并行得显式 `--allow-parallel-session`（几乎总是错的，留着是为了
 * 万一站点那边放宽了限制不用改代码）。
 */
export function resolveSession(flags, base, siteKey = null) {
  const explicit = flags.session ? guardSessionName(String(flags.session)) : null;
  if (!siteKey || flags['allow-parallel-session']) {
    return explicit || defaultSession(base);
  }
  const fixed = `${siteKey}-nav`;
  if (explicit && explicit !== fixed) {
    console.error(
      `[opencli] ${siteKey} 是配额站：忽略 --session ${explicit}，改用固定会话 ${fixed}。\n` +
      '          同时加载会触发上限；固定会话名让 daemon 把并发排成一队。\n' +
      '          真要并行加 --allow-parallel-session。',
    );
  }
  return fixed;
}

/** 用完必须还回去；崩溃时不会自动清理，所以 close 要在 finally 里。 */
export async function withSession(session, fn) {
  guardSessionName(session);
  try {
    return await fn(session);
  } finally {
    await closeSession(session);
  }
}
