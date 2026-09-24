import type { Attribution } from '@qq/engine';

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/**
 * Reads ?src= / ?source= / ?rep= / utm_* from the URL.
 * Also supports the legacy bare-key style (?ohio → source "ohio").
 */
export function readAttribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  const a: Attribution = {
    source: params.get('src') || params.get('source'),
    rep_code: params.get('rep'),
    referrer: document.referrer || null,
    user_agent: navigator.userAgent,
  };
  for (const k of UTM) a[k] = params.get(k);
  if (!a.source) {
    for (const [k, v] of params.entries()) {
      if (!v && !k.startsWith('utm_') && !['rep', 'src', 'source'].includes(k)) {
        a.source = k;
        break;
      }
    }
  }
  return a;
}

/** Stable per-tab session id per assessment (ties funnel events to the response). */
export function getSessionId(slug: string): string {
  const key = `qq-session:${slug}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Only fire an event once per session (e.g. 'view', or 'answer' per question). */
export function once(sessionId: string, key: string): boolean {
  const k = `qq-once:${sessionId}:${key}`;
  try {
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
  } catch {
    /* ignore */
  }
  return true;
}
