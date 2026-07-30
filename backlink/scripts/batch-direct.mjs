#!/usr/bin/env node
// batch-direct.mjs — Direct bb-browser submission without the buggy CLI
// Submits to simple form-based directory sites using eval-based form filling

import { execFileSync } from 'child_process';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';

const config = yamlLoad(readFileSync('config.yaml', 'utf8'));
const product = config.product;

function bb(...args) {
  try {
    return execFileSync('bb-browser', args, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (e) {
    throw new Error(e.stderr?.trim() || e.message);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync('batch-direct.log', line + '\n');
}

function escJs(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/'/g, "\\'");
}

// Fill a form field by CSS selector
function evalFill(selector, value) {
  bb('eval', `(() => {
    const el = document.querySelector("${escJs(selector)}");
    if (!el) return;
    el.focus();
    el.value = "${escJs(value)}";
    el.dispatchEvent(new Event("input", {bubbles:true}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
  })()`);
}

// Click a submit button by selector
function evalClick(selector) {
  bb('eval', `document.querySelector("${escJs(selector)}")?.click()`);
}

// Get page text
function pageText() {
  return bb('eval', 'document.body.innerText.substring(0, 1000)');
}

// Get snapshot
function snapshot() {
  return bb('snapshot', '-i');
}

// Parse snapshot for form fields (new format: 'textbox [ref=8] "url"')
function parseFields(snap) {
  const fields = { name: null, url: null, email: null, description: null, submit: null };
  for (const line of snap.split('\n')) {
    const m = line.match(/^\s*(\w+)\s+\[ref=(\d+)\]\s*"?([^"]*)"?\s*$/);
    if (!m) continue;
    const [, role, ref, label] = m;
    const lbl = label.toLowerCase();
    if (role === 'textbox' || role === 'combobox') {
      if (!fields.url && /url|website|link|homepage|site/.test(lbl)) fields.url = `@${ref}`;
      else if (!fields.name && /name|title|product|tool/.test(lbl)) fields.name = `@${ref}`;
      else if (!fields.email && /email|mail/.test(lbl)) fields.email = `@${ref}`;
      else if (!fields.description && /desc|about|summary|detail|intro/.test(lbl)) fields.description = `@${ref}`;
    }
    if ((role === 'button' || role === 'link') && /submit|send|add|post|create|save/.test(lbl)) {
      if (!fields.submit) fields.submit = `@${ref}`;
    }
  }
  return fields;
}

// Sites that use simple forms (tested patterns)
const SITES = [
  // PHP web directories with simple URL+email forms
  { name: 'Viesearch', url: 'https://viesearch.com/submit', type: 'snapshot' },
  { name: '9Sites.net', url: 'https://www.9sites.net/addurl.php', type: 'snapshot' },
  { name: 'Sonic Run', url: 'https://www.sonicrun.com/freelisting.html', type: 'snapshot' },
  { name: 'Highrankdirectory', url: 'https://www.highrankdirectory.com/submit.php', type: 'snapshot' },
  { name: 'Site Promotion Directory', url: 'https://www.sitepromotiondirectory.com/submit.php', type: 'snapshot' },
  { name: 'SitesWebdirectory', url: 'https://www.siteswebdirectory.com/submit.php', type: 'snapshot' },
  { name: 'Marketing Internet Directory', url: 'https://www.marketinginternetdirectory.com/submit.php', type: 'snapshot' },
  { name: 'Promote Business Directory', url: 'https://www.promotebusinessdirectory.com/submit.php', type: 'snapshot' },
  { name: 'ProLinkDirectory', url: 'https://www.prolinkdirectory.com/submit.php', type: 'snapshot' },
  { name: 'Free Directory', url: 'https://www.directory-free.com/submit/submit.php', type: 'snapshot' },
  { name: 'Free PR Web Directory', url: 'https://www.freeprwebdirectory.com/submit.php', type: 'snapshot' },
  { name: 'Free Internet Web Directory', url: 'https://www.freeinternetwebdirectory.com/submit.php', type: 'snapshot' },
  { name: 'TXTLinks', url: 'https://www.txtlinks.com/sug_url.php?cat_id=0', type: 'snapshot' },
  { name: 'Quality Internet Directory', url: 'https://www.qualityinternetdirectory.com/submit.php', type: 'snapshot' },
  { name: 'UK Internet Directory', url: 'https://www.ukinternetdirectory.net/submit.php', type: 'snapshot' },
  { name: 'USA Websites Directory', url: 'https://www.usawebsitesdirectory.com/submit.php', type: 'snapshot' },
  { name: 'World Web Directory', url: 'https://www.worldweb-directory.com/add.php', type: 'snapshot' },
  { name: 'Thales Directory', url: 'https://thalesdirectory.com/submit/', type: 'snapshot' },
  { name: 'GainWeb.org', url: 'https://gainweb.org/', type: 'snapshot' },
  { name: 'Submit.biz', url: 'https://www.submit.biz/', type: 'snapshot' },
  { name: 'OnToplist.com', url: 'https://www.ontoplist.com/join/', type: 'snapshot' },
  { name: 'Offpagesavvy', url: 'https://www.offpagesavvy.com/submit-your-site/', type: 'snapshot' },
  { name: '01webdirectory', url: 'https://www.01webdirectory.com/frmPreSubmit.aspx', type: 'snapshot' },
  { name: 'Dizila', url: 'https://www.dizila.com/submit', type: 'snapshot' },
  { name: '700.tools', url: 'https://700.tools/add', type: 'snapshot' },
  // AI directories
  { name: 'AI Tool For Business', url: 'https://aitoolforbusiness.com/submit-ai-tool/', type: 'snapshot' },
  { name: 'AI-Hunter.io', url: 'https://ai-hunter.io/submit-ai-tool/', type: 'snapshot' },
  { name: 'AIWikiTools', url: 'https://aiwikitools.com/submit-a-tool/', type: 'snapshot' },
  { name: 'AI Tools Up', url: 'https://aitoolsup.com/submit-tool/', type: 'snapshot' },
  { name: 'DropYourAI', url: 'https://www.dropyourai.com/submit-tool', type: 'snapshot' },
  { name: 'Free AI Tools Directory', url: 'https://free-ai-tools-directory.com/submit-request/', type: 'snapshot' },
  { name: 'findcool.tools', url: 'https://www.findcool.tools/submit-tool', type: 'snapshot' },
  { name: 'PoweredbyAI', url: 'https://poweredbyai.app/submit-tool', type: 'snapshot' },
  { name: 'SpotTheAI', url: 'https://www.spottheai.com/submit', type: 'snapshot' },
  { name: 'ToolHunter.ai', url: 'https://www.toolhunter.ai/submit-a-tool', type: 'snapshot' },
  { name: 'TrackBes', url: 'https://trackbes.com/submit-tool', type: 'snapshot' },
  { name: 'Interested In AI', url: 'https://www.interestedinai.com/submit-tool', type: 'snapshot' },
  { name: 'Free AI Tool', url: 'https://freeaitool.ai/submit', type: 'snapshot' },
  { name: 'insanelycooltools', url: 'https://www.insanelycooltools.com/submit', type: 'snapshot' },
  { name: 'Tap4 AI', url: 'https://tap4.ai/submit', type: 'snapshot' },
  // Chinese directories
  { name: '2AGI', url: 'https://2agi.net/zh/submit', type: 'snapshot' },
  { name: 'AI NAV', url: 'https://www.ainavpro.com/contribute', type: 'snapshot' },
  { name: 'Cooltools', url: 'https://backdata.net/submit-site.html', type: 'snapshot' },
  { name: 'AIGC工具导航', url: 'https://www.aigc.cn/submit', type: 'snapshot' },
];

async function submitSite(site) {
  log(`--- ${site.name} (${site.url}) ---`);

  try {
    // Pre-flight HTTP check
    const res = await fetch(site.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (res && (res.status === 404 || res.status >= 500)) {
      log(`  SKIP: HTTP ${res.status}`);
      return { site: site.name, status: 'skip', reason: `HTTP ${res.status}` };
    }

    // Open page
    bb('open', site.url);
    await sleep(4000);

    // Get snapshot
    const snap = snapshot();
    const fields = parseFields(snap);
    const detected = Object.entries(fields).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`);
    log(`  Fields: ${detected.join(', ') || 'none'}`);

    if (!fields.url && !fields.name && !fields.email) {
      // Try JS-based detection
      const inputCount = bb('eval', 'document.querySelectorAll("input[type=text], input:not([type]), textarea").length');
      if (parseInt(inputCount) > 0) {
        log(`  Found ${inputCount} input(s) via JS, trying eval-based fill...`);
        // Try common field names
        evalFill('input[name*="url" i], input[name*="site" i], input[name*="link" i], input[placeholder*="url" i], input[placeholder*="URL"]', product.url);
        evalFill('input[name*="email" i], input[type="email"], input[placeholder*="email" i]', product.email);
        evalFill('input[name*="name" i], input[name*="title" i], input[placeholder*="name" i], input[placeholder*="title" i]', product.name);
        evalFill('textarea, input[name*="desc" i], input[placeholder*="desc" i]', product.description);
        await sleep(500);
        evalClick('input[type="submit"], button[type="submit"]');
        await sleep(3000);
        const text = pageText();
        const success = /thank|success|confirm|added|received|submitted/i.test(text);
        log(`  JS fill result: ${success ? 'SUCCESS' : 'unknown'}`);
        return { site: site.name, status: success ? 'submitted' : 'filled', method: 'js-eval' };
      }
      log(`  SKIP: no form fields detected`);
      return { site: site.name, status: 'skip', reason: 'no fields' };
    }

    // Fill via snapshot refs
    if (fields.url) { bb('fill', fields.url, product.url); await sleep(300); }
    if (fields.name) { bb('fill', fields.name, product.name); await sleep(300); }
    if (fields.email) { bb('fill', fields.email, product.email); await sleep(300); }
    if (fields.description) {
      bb('fill', fields.description, product.long_description || product.description);
      await sleep(300);
    }

    // Submit
    if (fields.submit) {
      bb('click', fields.submit);
      await sleep(3000);
    }

    const text = pageText();
    const success = /thank|success|confirm|added|received|submitted/i.test(text);
    log(`  Result: ${success ? 'SUCCESS' : 'submitted (unconfirmed)'}`);
    return { site: site.name, status: success ? 'submitted' : 'filled' };

  } catch (e) {
    log(`  ERROR: ${e.message.substring(0, 100)}`);
    return { site: site.name, status: 'error', reason: e.message.substring(0, 100) };
  }
}

async function main() {
  log('=== SBTI Batch Direct Submission ===');
  log(`Product: ${product.name} — ${product.url}`);
  log(`Sites to process: ${SITES.length}\n`);

  const results = [];
  for (const site of SITES) {
    const result = await submitSite(site);
    results.push(result);
    // Pace: wait between submissions
    await sleep(5000);
  }

  // Summary
  log('\n=== SUMMARY ===');
  const submitted = results.filter(r => r.status === 'submitted');
  const filled = results.filter(r => r.status === 'filled');
  const skipped = results.filter(r => r.status === 'skip');
  const errors = results.filter(r => r.status === 'error');

  log(`Submitted: ${submitted.length}`);
  submitted.forEach(r => log(`  ✅ ${r.site}`));
  log(`Filled (unconfirmed): ${filled.length}`);
  filled.forEach(r => log(`  📝 ${r.site}`));
  log(`Skipped: ${skipped.length}`);
  skipped.forEach(r => log(`  ⏭️  ${r.site}: ${r.reason}`));
  log(`Errors: ${errors.length}`);
  errors.forEach(r => log(`  ❌ ${r.site}: ${r.reason}`));
}

main().catch(e => { console.error(e); process.exit(1); });
