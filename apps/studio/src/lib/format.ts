export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(iso);
}

export function fullName(r: { first_name?: string | null; last_name?: string | null }): string {
  return [r.first_name, r.last_name].filter(Boolean).join(' ');
}

export function publicUrl(base: string, slug: string, params: Record<string, string> = {}): string {
  const q = Object.entries(params)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v.trim())}`)
    .join('&');
  return `${base}/${slug}${q ? `?${q}` : ''}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}
