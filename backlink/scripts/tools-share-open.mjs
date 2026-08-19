#!/usr/bin/env node
/**
 * 打开共享账号面板，把其中一个 SEO 工具启动进一条已登录的后台 Chrome 会话。
 *
 * 启动流程本身在 lib-tools-share.mjs 里（会话焊死、卡片是 logo 图、nb-select 水合晚、
 * 节点会挂——四个坑都在那里注释着）。本文件只是它的命令行外壳，外加 --goto 深链。
 *
 * 用法：
 *   node tools-share-open.mjs --tool similarweb [--node 5] [--goto /#/...] [--session <名>]
 */
import { defaultSession, parseFlags, printJson, validateSession } from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool, scrub } from './lib-tools-share.mjs';

const flags = parseFlags(process.argv.slice(2));
const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-panel');

const { tool, state, landed, evalPage } = await launchTool({
  session,
  tool: flags.tool,
  node: flags.node,
  window: flags.window,
  wait: Number(flags.wait || 7),
  timeout: Number(flags.timeout || 40),
});

// 深链只有在启动器跑完之后才有效——建立会话的是那次点击，所以这里是个 flag 而非独立命令。
const final = typeof flags.goto === 'string'
  ? await gotoInTool(evalPage, flags.goto, Number(flags.settle || 15))
  : landed;

printJson({
  session,
  tool: tool.name,
  origin: tool.origin,
  url: scrub(final.url),
  title: final.title,
  subscription: { expiry: state.expiry, daysLeft: state.daysLeft, quotas: state.quotas },
  warning: expiryWarning(state),
});
