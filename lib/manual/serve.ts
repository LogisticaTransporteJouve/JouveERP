import path from "node:path";

import { isFiscalOnly, type Access } from "@/lib/auth/permissions";

// The user manual (docs/manual/, static HTML) as the app serves it at
// /manual: which files a URL may name and how a page is adjusted to the
// app's Content-Security-Policy (lib/security/csp.ts). The route handler is
// app/manual/[[...path]]/route.ts.

export const MANUAL_DIR = path.join(process.cwd(), "docs", "manual");

const CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
} as const;

export type ManualFile = {
  /** Path inside docs/manual/, e.g. "assets/styles.css". */
  relative: string;
  contentType: string;
  isPage: boolean;
};

const PAGE = /^[a-z0-9][a-z0-9-]*\.html$/;
const ASSET = /^[a-z0-9][a-z0-9-]*\.(css|js)$/;

/**
 * The manual file a URL names: a page at the top (`sales.html`) or a
 * stylesheet or script under `assets/`. Anything else (another folder, a
 * dot, the README) is null, so no path outside the manual is ever read.
 */
export function manualFile(segments: readonly string[]): ManualFile | null {
  const [first, second, ...rest] = segments;
  if (first === undefined || rest.length > 0) return null;
  if (second === undefined) {
    return PAGE.test(first)
      ? { relative: first, contentType: CONTENT_TYPES.html, isPage: true }
      : null;
  }
  const match = first === "assets" ? ASSET.exec(second) : null;
  const ext = match?.[1];
  if (ext !== "css" && ext !== "js") return null;
  return {
    relative: `assets/${second}`,
    contentType: CONTENT_TYPES[ext],
    isPage: false,
  };
}

/**
 * A manual page under the app's strict CSP: every script carries the
 * request's nonce (the policy has 'strict-dynamic', so 'self' alone does not
 * run them), and the Google Fonts links go (style-src and font-src allow
 * only 'self'; the page falls back to the system font).
 */
export function adaptManualPage(html: string, nonce: string | null): string {
  const withoutFonts = html.replace(
    /^[ \t]*<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\r?\n?/gm,
    "",
  );
  if (!nonce || !/^[A-Za-z0-9+/=_-]+$/.test(nonce)) return withoutFonts;
  return withoutFonts.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
}

/**
 * Who may read the guide. It documents the internal channel (remitos
 * internos, Otras ventas/compras) that a fiscal-only user (the external
 * accountant) must not learn about, so they are refused; a user with no role
 * sees no module at all, so for them the guide does not exist.
 */
export function manualAccess(access: Access): "allowed" | "forbidden" | "none" {
  if (access.roles.length === 0) return "none";
  return isFiscalOnly(access) ? "forbidden" : "allowed";
}
