#!/usr/bin/env node
import { defaultSession, firstJson, opencli, parseFlags, printJson, required, validateSession } from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
const session = flags.session ? validateSession(flags.session) : defaultSession('backlink-discovery');
if (flags.url) {
  const url = new URL(flags.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are supported.');
  await opencli(['browser', session, 'open', url.toString()], {
    env: { OPENCLI_WINDOW: flags.window === 'foreground' ? 'foreground' : 'background' },
    timeoutMs: 60_000,
  });
  await opencli(['browser', session, 'wait', 'time', String(Math.max(0, Math.min(15, Number(flags.wait || 3))))]);
}

const evaluated = await opencli(['browser', session, 'eval', `(() => {
  const pageHost = location.hostname.replace(/^www\\./, '');
  const containers = [...document.querySelectorAll('#comments,.comments,.comment-list,.commentlist,[class*="comment-list" i],[id*="comment-list" i],[data-testid*="comment" i],article')];
  const roots = containers.length ? containers : [document.body];
  const links = [];
  for (const root of roots) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.href, location.href);
        const domain = url.hostname.replace(/^www\\./, '');
        if (!['http:', 'https:'].includes(url.protocol) || !domain || domain === pageHost) continue;
        if (/facebook|twitter|x\\.com|instagram|linkedin|youtube|gravatar|wordpress\\.org|google/i.test(domain)) continue;
        links.push({ domain, url: url.toString().split('#')[0], rel: anchor.rel || null });
      } catch {}
    }
  }
  const unique = [...new Map(links.map((entry) => [entry.domain + '|' + entry.url, entry])).values()];
  return {
    sourceUrl: location.href,
    sourceDomain: pageHost,
    discoveredAt: new Date().toISOString(),
    candidateDomains: [...new Set(unique.map((entry) => entry.domain))],
    links: unique
  };
})()`]);
const result = firstJson(evaluated.stdout);
if (typeof flags.out === 'string') {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(flags.out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
printJson({ session, ...result });
