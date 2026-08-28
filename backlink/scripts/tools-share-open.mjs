#!/usr/bin/env node
/**
 * 打开共享账号面板，把其中一个 SEO 工具启动进一条已登录的后台 Chrome 会话。
 *
 * 启动流程本身在 lib-tools-share.mjs 里（会话焊死、卡片是 logo 图、nb-select 水合晚、
 * 节点会挂——四个坑都在那里注释着）。本文件只是它的命令行外壳，外加 --goto 深链。
 *
 * 用法：
 *   node tools-share-open.mjs --tool similarweb [--node 5] [--goto /#/...] [--session <名>]
 *
 * --goto 默认校验落地路由 == 请求路由，不一致就抛错。探路时加 --allow-redirect
 * 可以放行并回报实际落到了哪里。
 */
import { defaultSession, parseFlags, printJson, validateSession, showHelpIfRequested} from './opencli-core.mjs';
import { expiryWarning, gotoInTool, launchTool, scrub } from './lib-tools-share.mjs';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-panel');

const launched = await launchTool({
  session,
  tool: flags.tool,
  node: flags.node,
  window: flags.window,
  wait: Number(flags.wait || 7),
  timeout: Number(flags.timeout || 40),
});
try {
const { tool, state, landed, evalPage } = launched;

// 深链只有在启动器跑完之后才有效——建立会话的是那次点击，所以这里是个 flag 而非独立命令。
//
// 默认严格：落地的路由跟请求的不一致就抛错（Similarweb 对未知路由是静默重定向，
// 不是 404）。`--allow-redirect` 是给**探路**用的——想知道某条路由到底会落到哪里时
// 才加，此时你要的就是那个落地 URL 本身。本脚本不解析任何指标，只回报 url/title，
// 所以这个出口不会把别人的数字记到你的报表名下。
const final = typeof flags.goto === 'string'
  ? await gotoInTool(evalPage, flags.goto, Number(flags.settle || 15), { allowRedirect: Boolean(flags['allow-redirect']) })
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
} finally {
  await launched.releaseBrowserLocks();
}
