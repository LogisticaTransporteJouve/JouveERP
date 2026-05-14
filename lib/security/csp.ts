/**
 * Strict, nonce-based Content Security Policy.
 *
 * Notes from the Sumary patterns doc (§18.2) carried over:
 *  - script-src uses 'strict-dynamic' so scripts loaded transitively by a
 *    nonce-tagged script are also trusted, without enumerating CDN hosts.
 *  - style-src falls back to 'unsafe-inline' because Tailwind / next/font
 *    emit <style> tags Next does not reliably nonce-tag, and mixing nonces
 *    with 'unsafe-inline' invalidates the latter in modern browsers.
 *  - In dev we relax script-src to allow Next's HMR client (eval).
 */

type CspOptions = {
  nonce: string;
  isDev: boolean;
  supabaseUrl: string | undefined;
};

function parseExtraSources(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => /^(https:\/\/|wss:\/\/)[^\s'";]+$/.test(s));
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy({
  nonce,
  isDev,
  supabaseUrl,
}: CspOptions): string {
  const supabaseOrigin = originOf(supabaseUrl);
  const supabaseWs = supabaseOrigin
    ? supabaseOrigin.replace(/^http(s)?:/, (_, s) => (s ? "wss:" : "ws:"))
    : null;

  const extraConnect = parseExtraSources(process.env.CSP_EXTRA_CONNECT_SRC);
  const extraImg = parseExtraSources(process.env.CSP_EXTRA_IMG_SRC);

  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": scriptSrc,
    // No nonce on style-src: Tailwind v4 and next/font emit <style> tags Next
    // does not reliably nonce-tag, and modern browsers ignore 'unsafe-inline'
    // when a nonce is present. Scripts remain strict — that is where XSS lives.
    "style-src": "'self' 'unsafe-inline'",
    "img-src": ["'self'", "data:", "blob:", supabaseOrigin, ...extraImg]
      .filter(Boolean)
      .join(" "),
    "font-src": "'self' data:",
    "connect-src": [
      "'self'",
      supabaseOrigin,
      supabaseWs,
      ...extraConnect,
    ]
      .filter(Boolean)
      .join(" "),
    // 'self' (not 'none') so the in-app PDF viewer can iframe
    // /api/invoices/<id>/pdf. Cross-origin framing remains blocked,
    // and X-Frame-Options: SAMEORIGIN in next.config.ts pins the same rule
    // for browsers that don't honor frame-ancestors.
    "frame-ancestors": "'self'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "object-src": "'none'",
    "upgrade-insecure-requests": "",
  };

  return Object.entries(directives)
    .map(([key, value]) => (value ? `${key} ${value}` : key))
    .join("; ");
}

export function generateNonce(): string {
  // btoa + crypto.randomUUID work in both Node and Edge runtimes; Buffer does not.
  return btoa(crypto.randomUUID());
}
