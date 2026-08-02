#!/usr/bin/env node
import { firstJson, opencli, parseFlags, printJson, required, validateSession } from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
const session = validateSession(required(flags, 'session'));
const evaluated = await opencli(['browser', session, 'eval', `(() => {
  const guard = globalThis.__backlinkOpenCliSubmitGuard;
  if (!guard) return { released: false, reason: 'no_guard' };
  document.removeEventListener('submit', guard.blockSubmit, true);
  document.removeEventListener('click', guard.blockClick, true);
  delete globalThis.__backlinkOpenCliSubmitGuard;
  return { released: true };
})()`]);
printJson(firstJson(evaluated.stdout));
