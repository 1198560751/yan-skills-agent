#!/usr/bin/env node
import { firstJson, opencli, parseFlags, printJson, releaseSubmitGuard, required, validateSession, showHelpIfRequested} from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
showHelpIfRequested(flags, import.meta.url);
const session = validateSession(required(flags, 'session'));
const humanHandoff = flags['human-handoff'] === true;
const evaluated = await opencli(['browser', session, 'eval', `(() => {
  const releaseSubmitGuard = ${releaseSubmitGuard.toString()};
  return releaseSubmitGuard(globalThis, document, ${JSON.stringify(humanHandoff)});
})()`]);
printJson(firstJson(evaluated.stdout));
