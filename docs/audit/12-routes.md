# AUDIT — Dashboard routes layer (agent audit-routes)

## SYSTEM MAP
All routes under app/(dashboard)/, server components dynamic="force-dynamic". Guard = requireUserContext()+userCan()→redirect("/dashboard"). Backstop: (dashboard)/layout.tsx:36-39 (getCurrentUserContext→/auth/login) + proxy.ts. Nav (app-sidebar.tsx:91-195, mobile-tab-bar) filters by same perms.
VERDICT hunt#1: page-level RBAC consistently enforced, matches nav filtering; NO shell/prefetch leak found via deep-link. Every data page guards before prefetch; prefetched actions re-guard (requireUserContext+RLS).
Features with no route (embedded, not dead): files, notifications, search. No orphan routes.

## FINDINGS
[high][authz/priv-esc] `app/(dashboard)/admin/users/page.tsx:24` — bootstrapOwnerIfNeeded() runs for ANY authed user BEFORE users:read check. users-actions.ts:72-84: if ownerCount()===0 caller inserted as owner via service client. If owners ever hits zero (bad migration/offboarding/seed reset) any low-priv user deep-linking /admin/users silently becomes owner. CONFIRMED. Fix: gate to setup flow/env flag, alert loudly. [CORROBORATES core-infra bootstrap finding]
[medium][authz-bug] admin/users/page.tsx:25 — requireUserContext() after bootstrap is no-op: getCurrentUserContext wrapped in React cache() (context.ts:27), refreshed.roles is memoized pre-bootstrap value → just-bootstrapped owner fails userCan and is redirected. CONFIRMED.
[medium][security/UX] `app/(dashboard)/ai/page.tsx:18-22` + ai-chat.tsx:70-75 — ?ask= searchParam → initialAsk → seedPrompt auto-executed on mount (void sendMessage). Crafted link /ai?ask=<attacker prompt> auto-runs arbitrary prompt against victim's 25-tool AI session on load — burns token cap, reflected prompt-injection foothold. CONFIRMED. Fix: prefill don't submit.
[medium][prefetch/waterfall] treasury/hooks/use-treasury.ts:12,20 — /treasury + /treasury/cash-flow use plain useQuery, no server prefetch. Same: /fleet-reports, /storage-billing, /hr/document-expirations, /documentos, /accounting/libro-iva-*, /accounting/balance. Spinner waterfall, violates house prefetch+Hydrate. CONFIRMED.
[medium][double-fetch] `app/(dashboard)/issued-checks/page.tsx:26-38` — listAccountsAction() run directly (l26) AND in prefetchQueries under accountsKeys.list() (l35-37). Two sequential identical calls. CONFIRMED.
[medium][params-validation] invoices/page.tsx:52 + transactions/page.tsx:56-57 — params.channel/account raw into .eq() uuid filters. Non-uuid → Postgres 22P02 → prefetch swallows → client retry fails → generic error boundary "blank". purchases?status= also raw. Contrast: hr/*/[year]/[month] validates. PLAUSIBLE. Fix: validate uuid params.
[medium][error-semantics] detail pages conflate failure/not-found: invoices/[id]:49 !res.ok→notFound() (transient DB error=404); clients/[id]:47-48, suppliers/[id]:44-45, trips/[id]:25-26 !ok→redirect (DB error→silent bounce). No not-found.tsx anywhere → notFound() renders bare Next default outside chrome. CONFIRMED. Fix: distinguish !ok(throw) from null(notFound); add dashboard not-found.tsx.
[low][error-boundary] (dashboard)/error.tsx:9-11 comment says per-route error.tsx override but zero exist. queryClient.clear() on retry nukes whole cache. Does NOT leak error.message (good). CONFIRMED stale comment.
[low][key-dup] hr/attendance/[year]/[month]/page.tsx:51,55 hardcodes ["attendance",...] because attendanceKeys is private to hook file (not in features/hr/lib/). Same profile/page.tsx:23 ["notifications","settings"]. Keys currently match but refactor desyncs. CONFIRMED.
[low][consistency] invoices/page.tsx:44 channels lookup uses getServiceClient() while accounts/checks/receipts/etc use RLS createClient(). Not exploitable. CONFIRMED.
[low][design-system Sheet] features/ai/document/components/review-sheet.tsx:9-14 — only Sheet import outside ui/sidebar. Mutates extraction state. PLAUSIBLE Dialog-rule violation.
[low][metadata] zero route-level metadata; every tab reads "Logística y Transporte Jouve". CONFIRMED.
[low][loading] 24 route dirs no loading.tsx (fall back to generic skeleton). Cosmetic.
[low][routing naming] mixed ES/EN slugs: /cargas→shipments, /documentos→ai/document, /employees→features/hr (siblings under /hr/*). Labels diverge (/transactions="Caja"). CONFIRMED.

## EXPECTATION GAPS
1. "100% monocromo" is fiction — ~40+ files use color: admin/backups/page.tsx:31,36 (emerald/amber), employees/[id]:85, invoices/[id]:294, payment-orders/[id]:99, purchases/[id]:110, receipts/[id]:86 (all bg-red-500/15 text-red-700 badges). Systemic drift.
2. Docs describe per-route error boundaries that don't exist.
3. Prefetch+Hydrate house pattern is ~75% real; report routes use different client-fetch arch, undocumented.
4. /dashboard + /chat intentionally no permission (widgets/actions individually gated, verified; search_global RPC role-filtered).

## OPEN QUESTIONS
1. Move bootstrapOwnerIfNeeded behind CLI/setup script now seeded? (highest-value fix)
2. Is ?ask= auto-send intentional (insights emails)? Who can mint links?
3. Unauthorized deep-links: silent redirect vs 403?
4. review-sheet.tsx exempt from Dialog rule?
