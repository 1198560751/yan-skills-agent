#!/usr/bin/env node
// 找出并浓缩本项目的 Claude Code / Codex 会话记录,供 `rankup review` 提取信号。
//
//   node scripts/sessions.mjs --project-root <项目目录> [--days 14]          列出会话
//   node scripts/sessions.mjs --project-root <项目目录> --days 7 --dump      输出浓缩对话
//   node scripts/sessions.mjs --project-root <项目目录> --new-only --dump    只看上次 review 之后的新增
//   node scripts/sessions.mjs --project-root <项目目录> --mark               记下已消费位置
//
// 只读。会话里已经发生过的纠正、裁决与验证结论,往往还没进 .rankup/——
// 它们是经验沉淀的原始素材,也是判断某条旧记录是否已被推翻的依据。
//
// 浓缩规则:只保留人说的话与助手的自然语言结论,丢掉工具调用、工具输出、
// 推理块与系统提示。原始 jsonl 单个会话可达数 MB,直接读会淹没上下文。

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";

const claudeProjects = path.join(homedir(), ".claude", "projects");
const codexSessions = path.join(homedir(), ".codex", "sessions");
const DEFAULT_DUMP_BUDGET = 200_000;

// 会话 jsonl 只追加,所以"读到哪了"用字节偏移记录最准:同一个会话后续续聊时,
// 下次只读新增的那一段,既不重复消耗上下文,也不会漏掉后来补上的内容。
// 按 mtime 或整文件哈希都做不到这一点——续聊会让整个文件重新变成"新的"。
const REVIEW_STATE = "review-state.json";

async function readReviewState(projectRoot) {
  try {
    const text = await readFile(path.join(projectRoot, ".rankup", REVIEW_STATE), "utf8");
    const state = JSON.parse(text);
    return state && typeof state.sessions === "object" ? state : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

async function writeReviewState(projectRoot, sessions, now) {
  const dir = path.join(projectRoot, ".rankup");
  await mkdir(dir, { recursive: true });
  const previous = await readReviewState(projectRoot);
  const merged = { ...previous.sessions };
  for (const session of sessions) merged[session.file] = { bytes: session.size };
  const state = {
    schemaVersion: 1,
    lastReviewAt: new Date(now).toISOString(),
    sessions: merged,
  };
  await writeFile(path.join(dir, REVIEW_STATE), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return Object.keys(merged).length;
}

function parseArgs(argv) {
  const options = {
    projectRoot: process.cwd(),
    days: 14,
    dump: false,
    budget: DEFAULT_DUMP_BUDGET,
    newOnly: false,
    mark: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project-root") options.projectRoot = argv[++index] ?? options.projectRoot;
    else if (arg === "--days") options.days = Number(argv[++index]);
    else if (arg === "--budget") options.budget = Number(argv[++index]);
    else if (arg === "--dump") options.dump = true;
    else if (arg === "--new-only") options.newOnly = true;
    else if (arg === "--mark") options.mark = true;
    else throw new TypeError(`未知参数: ${arg}`);
  }
  if (!Number.isFinite(options.days) || options.days <= 0) throw new TypeError("--days 必须是正数");
  if (!Number.isFinite(options.budget) || options.budget <= 0) throw new TypeError("--budget 必须是正数");
  options.projectRoot = path.resolve(options.projectRoot);
  return options;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// 会话属于本项目的判据是记录里的 cwd,不是目录名——目录名是路径改写后的结果,
// 分隔符与空格都被替换过,反推不可靠;worktree 还会生成额外目录。
function belongsToProject(cwd, projectRoot) {
  if (typeof cwd !== "string" || cwd.length === 0) return false;
  const resolved = path.resolve(cwd);
  return resolved === projectRoot || resolved.startsWith(projectRoot + path.sep);
}

async function readFirstLines(file, count) {
  const lines = [];
  const stream = createReadStream(file, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (line.trim()) lines.push(line);
      if (lines.length >= count) break;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return lines;
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Claude Code:~/.claude/projects/<改写后的路径>/<sessionId>.jsonl
async function findClaudeSessions(projectRoot, cutoff) {
  if (!(await exists(claudeProjects))) return [];
  const found = [];
  for (const dir of await readdir(claudeProjects, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(claudeProjects, dir.name);
    for (const entry of await readdir(dirPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(dirPath, entry.name);
      const info = await stat(file);
      if (info.mtimeMs < cutoff) continue;
      const cwd = readFirstLines(file, 40).then((lines) => {
        for (const line of lines) {
          const record = safeParse(line);
          if (record?.cwd) return record.cwd;
        }
        return null;
      });
      found.push({ source: "claude", file, size: info.size, mtime: info.mtimeMs, cwd: await cwd });
    }
  }
  return found.filter((item) => belongsToProject(item.cwd, projectRoot));
}

// Codex:~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl,首条 session_meta 带 cwd
async function findCodexSessions(projectRoot, cutoff) {
  if (!(await exists(codexSessions))) return [];
  const found = [];
  // 目录是 sessions/YYYY/MM/DD/rollout-*.jsonl:要下探三层目录才够得着文件,
  // 因此上限是 4 而不是 3——差一层的话一个 Codex 会话都扫不到,且毫无报错。
  const MAX_CODEX_DEPTH = 4;
  const walk = async (directory, depth) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_CODEX_DEPTH) await walk(candidate, depth + 1);
        continue;
      }
      if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue;
      const info = await stat(candidate);
      if (info.mtimeMs < cutoff) continue;
      const lines = await readFirstLines(candidate, 3);
      const meta = lines.map(safeParse).find((record) => record?.type === "session_meta");
      found.push({
        source: "codex",
        file: candidate,
        size: info.size,
        mtime: info.mtimeMs,
        cwd: meta?.payload?.cwd ?? null,
      });
    }
  };
  await walk(codexSessions, 1);
  return found.filter((item) => belongsToProject(item.cwd, projectRoot));
}

function claudeText(record) {
  const message = record?.message;
  if (!message) return null;
  const role = message.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = message.content;
  if (typeof content === "string") return { role, text: content };
  if (!Array.isArray(content)) return null;
  // 只取自然语言块;tool_use / tool_result 是过程噪音,不是结论。
  const text = content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text ? { role, text } : null;
}

function codexText(record) {
  if (record?.type !== "response_item") return null;
  const payload = record.payload;
  if (payload?.type !== "message") return null;
  const role = payload.role;
  if (role !== "user" && role !== "assistant") return null;
  const text = (payload.content ?? [])
    .filter((block) => typeof block?.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text ? { role, text } : null;
}

// 系统注入的内容不是人的意图,计入预算只会挤掉真正的信号。
// 尤其是 slash-command:它会把整个 Skill 正文当作一条用户消息注入,
// 动辄几万字,不滤掉就会把预算一次吃光,而它一个字都不是本轮的新信息。
function isNoise(text) {
  return (
    text.startsWith("<system-reminder>") ||
    text.startsWith("<permissions instructions>") ||
    text.startsWith("Caveat:") ||
    text.startsWith("<command-") ||
    text.startsWith("Base directory for this skill:")
  );
}

async function dumpSession(session, budget) {
  const chunks = [];
  let used = 0;
  // 从上次消费的偏移接着读。若该偏移落在某行中间,那半行 JSON.parse 会失败并被跳过,
  // 只损失一条记录,不会错位——这正是选择行式 jsonl 时可以接受的代价。
  const stream = createReadStream(session.file, { encoding: "utf8", start: session.consumed ?? 0 });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const record = safeParse(line);
      if (!record) continue;
      const turn = session.source === "claude" ? claudeText(record) : codexText(record);
      if (!turn || isNoise(turn.text)) continue;
      const label = turn.role === "user" ? "用户" : "助手";
      const body = turn.text.length > 4000 ? `${turn.text.slice(0, 4000)}\n…（已截断）` : turn.text;
      const block = `### ${label}\n\n${body}\n`;
      if (used + block.length > budget) {
        chunks.push("\n…（已达输出预算，其余略）\n");
        break;
      }
      chunks.push(block);
      used += block.length;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return chunks.join("\n");
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const cutoff = Date.now() - options.days * 86_400_000;
const all = [
  ...(await findClaudeSessions(options.projectRoot, cutoff)),
  ...(await findCodexSessions(options.projectRoot, cutoff)),
].sort((a, b) => a.mtime - b.mtime);

const reviewState = await readReviewState(options.projectRoot);
for (const session of all) {
  const consumed = reviewState.sessions?.[session.file]?.bytes ?? 0;
  // 记录的字节数可能大于当前文件(会话被清理重建),此时从头读更安全。
  session.consumed = consumed <= session.size ? consumed : 0;
  session.fresh = session.size - session.consumed;
}

// --new-only 只保留有新增内容的会话:上次 review 已经消费过的部分不再重读。
const sessions = options.newOnly ? all.filter((session) => session.fresh > 0) : all;

if (sessions.length === 0) {
  const scope = options.newOnly ? "自上次 review 以来没有新增会话" : `最近 ${options.days} 天内没有属于 ${options.projectRoot} 的会话记录`;
  console.log(`${scope}。`);
  if (options.mark) {
    await writeReviewState(options.projectRoot, all, Date.now());
    console.log("水位线已更新。");
  }
  process.exit(0);
}

if (!options.dump) {
  const scope = options.newOnly ? "自上次 review 以来新增的会话" : `最近 ${options.days} 天的会话`;
  console.log(`# ${scope} — ${options.projectRoot}\n`);
  console.log("| 来源 | 最近活动 | 待读 | 总大小 | 文件 |");
  console.log("|---|---|---|---|---|");
  for (const session of sessions) {
    const when = new Date(session.mtime).toISOString().slice(0, 16).replace("T", " ");
    console.log(
      `| ${session.source} | ${when} | ${Math.round(session.fresh / 1024)} KB | ${Math.round(session.size / 1024)} KB | \`${session.file}\` |`,
    );
  }
  const freshTotal = sessions.reduce((sum, session) => sum + session.fresh, 0);
  console.log(`\n共 ${sessions.length} 个会话，待读 ${Math.round(freshTotal / 1024)} KB。加 --dump 输出浓缩对话供提取信号。`);
} else {
  const perSession = Math.max(10_000, Math.floor(options.budget / sessions.length));
  for (const session of sessions) {
    const when = new Date(session.mtime).toISOString().slice(0, 16).replace("T", " ");
    const resumed = session.consumed > 0 ? "（接上次续读）" : "";
    console.log(`\n## ${session.source} — ${when} ${resumed}\n`);
    console.log(await dumpSession(session, perSession));
  }
}

// 水位线只在 review 真正消费完之后才落,所以 --mark 是独立一步:
// 中途失败或输出被截断时不留下"已读完"的假象,下次仍会重读那一段。
if (options.mark) {
  const count = await writeReviewState(options.projectRoot, all, Date.now());
  console.error(`\n水位线已更新：${count} 个会话记录在案。`);
}
