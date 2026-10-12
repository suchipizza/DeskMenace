/** Resolves `value` against `base` and returns it only if it is an http(s) URL. */
export function safeHttpUrl(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const u = new URL(value, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Base URL for resolving relative URLs in the page. */
export function pageBase(): string {
  return typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
}
