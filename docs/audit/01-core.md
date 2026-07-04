# AUDIT — Core infra lib/ (agent audit-core)

## SYSTEM MAP
Auth: `proxy.ts` (Next 16 root proxy) → `lib/supabase/proxy.ts#updateSession` refreshes JWT via auth.getUser(), redirects anon → /auth/login (redirect-only, NOT security boundary). Real boundary per-callsite: every server action calls `requireUserContext()` (lib/auth/context.ts) re-reading auth.getUser()+user_roles+user_profiles via RLS client, wrapped in React cache() (request-scoped → role revocation effective next request, no cross-request staleness). All 70 "use server" files call requireUserContext except app/auth/login/actions.ts (expected).
Permission dual: app-side userCan() (chat/search/profile/notifications intentionally skip, scope via RLS/ctx.userId) + DB RLS (620 user_has_role refs). Contrary to CLAUDE.md, 62 files use RLS client, only 16 use getServiceClient() — all service read paths traced are gated by userCan.
Rate limit: Postgres-backed bump_rate_limit_bucket RPC, fail-closed, only AI chat (30/h,300/d) + AFIP padron. Login has none.
Errors: ActionResult<T> Spanish msgs; runAction rethrows. logAudit awaited but never throws.

## FINDINGS
[high][authz DB-vs-app drift] `supabase/migrations/20260508201626_roles_and_audit.sql:125-133` — RLS lets any admin insert/delete user_roles incl. granting self owner; "admins can't grant owner" invariant only in app-side canAssignRole (permissions.ts:241). Admin can POST /rest/v1/user_roles {self, owner} via PostgREST → silent UNAUDITED self-promotion, then revoke real owners. CONFIRMED. Fix: make user_roles writes service-role-only.
[high][correctness/dates] `lib/format.ts:26-36` formatArgentineDate applies −3h shift to date-only strings → every Postgres `date` column renders one day early. Invoice fecha "2026-07-04" shows "3 jul 2026", disagrees with AFIP CbteFch + PDF. Affects receipt_date, transaction_date, due_date, entry_date, movement_date, CAEA dates, export labels. TEST ASSERTS THE BUG (format.test.ts:18-19). CONFIRMED (node repro). Fix: branch on /^\d{4}-\d{2}-\d{2}$/ → format verbatim; fix test.
[high][open redirect] `app/auth/login/actions.ts:45-49` — redirectTo accepted if startsWith("/"), admits protocol-relative //evil.com. Post-auth redirect off-site. Same in login/page.tsx:15. CONFIRMED. Fix: reject //  and /\.
[medium][false test coverage] `lib/auth/permissions.test.ts` — "100% matrix" is NOT cell-by-cell; only owner/admin exhaustive, finance/ops/warehouse/driver ~10 spot checks. Adding accounting:write to operations → tests still pass. CONFIRMED. Fix: snapshot full ROLE_PERMISSIONS or loop ROLES×PERMISSIONS.
[medium][audit gaps] (a) audit.ts:31 swallows insert failures; (b) mutations with NO logAudit: chart-of-accounts actions, files-actions (blob deletion), supplier-categories; (c) backups getBackupSignedUrlAction hands full-DB-dump URL with no audit. CONFIRMED.
[medium][duplication] `features/admin-users/actions/users-actions.ts:33-54` — local logAudit writing target_user_id vs canonical target_resource_id; two audit row shapes. CONFIRMED.
[medium][money parsing] `lib/validation/common.ts:39-75` — moneyAmountPreprocess("1234.56")→123456 (×100); moneyAmountWithStripPreprocess("1,234.56" US paste)→1.23456. Used where pastes happen (purchase-invoices, issued-checks). PLAUSIBLE corruption. Fix: reject ambiguous.
[medium][convention] select("*") violated in ≥13 files (receipts:203, checks:203, afip-admin:80/150/199, chart-of-accounts:36, cost-centers:26, inflation:29, employee-documents:45/77, payment-orders:165/172, lib/afip/caea.ts:29/64/87, several inngest, lib/pdf/generate-and-store:47). CONFIRMED.
[medium][layering inversion] lib/pdf/* imports from features (generate-and-store.ts:22-23, receipt-render.tsx:5-23 import clients/invoices/accounts/receipts schemas). lib depends DOWN on features. CONFIRMED. Fix: move shared label maps/types to lib/.
[medium][info leak] PDF/export routes return raw err.message (invoices/[id]/pdf:41, receipts:38, payment-orders, both libro-iva, export/[resource]:69) — leaks pg/schema text. CONFIRMED. Fix: generic message.
[low][bootstrap race] users-actions.ts:72-92 bootstrapOwnerIfNeeded TOCTOU, triggered by any authed user rendering /admin/users; first visitor wins owner. Exploitable pre-bootstrap only. CONFIRMED.
[low][silent success] lib/email/send-comprobante.tsx:128-159 — email_send_log insert fail → returns ok:true, log_id:"". notified_at bump unchecked. CONFIRMED.
[low][date math] lib/date-range.ts:68-75 monthsBackIso setMonth no clamp — Aug31 −6mo → Mar3 not Feb28. todayIsoLocal server-local(UTC) vs browser(AR) → double-fetch ~3h around midnight. CONFIRMED.
[low][rounding] lib/format.ts:158-160 round2 float (round2(1.005)===1); IVA aggregation chains round2 per item → per-rate totals drift a cent vs DB numeric. CONFIRMED behavior.
[low][header] export/[resource]/route.ts:59-63 unvalidated ?to= into Content-Disposition filename (CRLF rejected, no injection). CONFIRMED.
[low][brute force] app/auth/login/actions.ts no app rate limit on signInWithEmail; logs attempted email (PII). CONFIRMED.

## DESIGN TENSIONS
1. App-side RBAC vs DB RLS = two sources of truth, must agree by hand; admin→owner is this class. Nothing tests SQL role arrays match ROLE_PERMISSIONS.
2. CLAUDE.md action recipe (getServiceClient) vs reality (RLS client 62/70). Reality safer but doc trains contributors toward RLS-bypassing client + treats userCan as only gate.
3. Audit-by-best-effort: logAudit + email_send_log allowed to fail silently while business mutation commits. Not evidence-grade.

## OPEN QUESTIONS
1. Is date-only −3h shift conscious or enshrined bug?
2. Storage bucket RLS aligned with files:read? (verified action-level, not storage.objects policies for files/backups-daily buckets)
3. Is admin/owner separation load-bearing or ceremonial?
4. isDev: NODE_ENV!=="production" — any non-prod deployment internet-reachable? (skips inngest sig validation + session auth)
