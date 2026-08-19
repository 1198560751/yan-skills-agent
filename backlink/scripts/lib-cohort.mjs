/**
 * One definition of "which run does this target belong in", shared by the
 * prober, the merge, the validator and the query script.
 *
 * Deriving the cohort in four places is how four answers appear; a target that
 * reads `account` in the data file and `open` in the report is worse than no
 * label at all, because a batch gets planned around it.
 */

// Severity order decides the single `gate` when several were observed.
// It is ordered by what it costs a campaign, NOT by what appears first in the
// DOM: a CAPTCHA costs a human's attention for a minute, an account costs a
// decision about identity that outlives the campaign, and a demand for a real
// phone number or a reciprocal link on the owner's own site is a decision only
// the owner can make.
export const GATE_SEVERITY = [
  'personal-contact',
  'reciprocal',
  'account',
  'captcha-interactive',
  'email-verify',
  'manual-review',
  'captcha-passive',
  'open-form',
  'none-found',
  'unknown',
];

export const COHORTS = ['open', 'captcha', 'account', 'account-captcha', 'email-verify', 'reciprocal', 'personal-contact', 'manual-review', 'unknown'];

/** All gates observed → the one to show as `gate`. */
export function primaryGate(gates) {
  const set = new Set(gates || []);
  for (const g of GATE_SEVERITY) if (set.has(g)) return g;
  return 'unknown';
}

/**
 * All gates observed → which run this belongs in.
 *
 * `captcha-passive` deliberately does NOT create a captcha cohort: it clears
 * itself in an ordinary browser with no user action, so it costs the run
 * nothing. Treating it as a CAPTCHA would push open targets into the queue that
 * needs a human, which is the expensive mistake in both directions.
 */
export function cohortOf(gates) {
  const s = new Set(gates || []);
  if (s.has('personal-contact')) return 'personal-contact';
  if (s.has('reciprocal')) return 'reciprocal';
  const account = s.has('account');
  const captcha = s.has('captcha-interactive');
  if (account && captcha) return 'account-captcha';
  if (account) return 'account';
  if (captcha) return 'captcha';
  if (s.has('email-verify')) return 'email-verify';
  if (s.has('manual-review')) return 'manual-review';
  if (s.has('open-form') || s.has('captcha-passive')) return 'open';
  return 'unknown';
}

/** A cohort a campaign can run with nobody sitting in front of the browser. */
export const UNATTENDED = new Set(['open']);
