# AUDIT — docs vs code + DX (agent audit-docs)

## DOCS INVENTORY
| Doc | Verdict | Notes |
|---|---|---|
| README.md | drifted | Commands runnable; 3 factual claims wrong (PostHog, test count, env example) |
| CLAUDE.md (root) | drifted | Structure/commands accurate; 3 conventions contradicted; "roadmap desactualizado" warning itself stale |
| docs/pendientes.md | fresh (2026-07-04, matches HEAD) | 2 small inaccuracies (schema.test claim, /admin/afip route) |
| docs/roadmap.md | half-synced | §0–§3 fresh; §4.1 + §6 still say ~24 PRs pending that are all shipped |
| docs/mobile-patterns.md | fresh | Every claim verified; not linked from any index |
| docs/frontend-patterns.md | reference/partially drifted | Catalog from another repo; several "✅" never adopted; husky details mismatch |
| docs/manual/ | drifted (coverage) | 9 pages, links resolve, no broken assets; claims "todos los módulos" while ~6 shipped areas have no page |
| .github/workflows/ | fresh | CI = lint+typecheck+test+build + database (db-types drift + migration order) + deploy-migrations + forbidden words + preview + daily backup. Matches CLAUDE.md |
| .claude/skills/ | mostly fresh | All referenced files/templates exist; restate 2 conventions the code violates |

## FINDINGS
[high][doc-drift] README.md:15, roadmap.md:69 — "Sentry + PostHog (vía reverse proxy /ingest/*)". No posthog dependency, proxy.ts does only CSP+Supabase session, zero grep hits. CONFIRMED — feature never built. Fix: delete claim.
[high][doc-drift] CLAUDE.md + new-feature/SKILL.md — "Importar de otra feature → prohibido". 151 cross-feature imports (receipts→invoices, loans→transactions actions; top targets accounts 30, suppliers 17, clients 17, invoices 16). CONFIRMED — dead letter. Fix: rewrite as "shared types/pickers may cross; logic must not" + ESLint boundary rule.
[high][doc-drift] CLAUDE.md docs section — "roadmap.md ⚠️ Hoy desactualizado". Roadmap synced in PR #201 (HEAD, same day); §3 "Estado al 2026-07-04… Nada en vuelo". CONFIRMED — the warning is the stale part. Fix: update CLAUDE.md.
[medium][doc-drift] roadmap.md:368,846-871 — §4.1 "Fase K próximo" though §3.2 says K completa; §6 lists L.6/L.7, Fase R, AI.0-AI.8, G, H under "PENDIENTE ~24 PRs" — all shipped (#178-#200). CONFIRMED. Fix: collapse §4-§6 into annex.
[medium][doc-drift] CLAUDE.md "ESLint: no-explicit-any error; sin as" — eslint has no-explicit-any:error ✓ but NO rule vs assertions; ~276 files use `as X`, incl 46 `as unknown as`. CONFIRMED — "sin as" unenforced+untrue. (Repeated mobile-patterns.md:91.)
[medium][doc-drift] CLAUDE.md/skills "Sin select *" — 16 select("*") in non-test server code (checks:203, chart-of-accounts:36, afip-admin:80/150/199, receipts:203, inflation:29, cost-centers:26, employee-documents:45/77, caea.ts:29/64/87, caea-inform:54/134, document-expiry-alerts:49). CONFIRMED.
[medium][doc-drift] README.md:94 ".env.local.example lista completa" — file has only 4 vars (SUPABASE_DB_URL unread). Missing but read by code: AFIP_CERT/KEY/CUIT/ENV, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, AI_FALLBACK_*, RESEND_API_KEY, EMAIL_FROM/REPLY_TO, FINANCE_EMAIL, VAPID_*, SENTRY_DSN, LOG_LEVEL, CSP_EXTRA_* (+ANTHROPIC_API_KEY implicit). .env.production.example lacks FINANCE_EMAIL (aging cron), OPENAI/GOOGLE, AI_FALLBACK_*. CONFIRMED. Fix: regenerate both from grep inventory.
[medium][doc-drift] docs/manual/README.md "de todos los módulos" — no page for Flota (drivers/vehicles/trips/cargas/fuel/maintenance/fleet-reports), Pallets/Depósito, IA (/ai,/documentos), Préstamos, Pagos recurrentes — all shipped. CONFIRMED. (What exists is accurate.)
[medium][doc-drift] docs/pendientes.md:74-75 "47/47 dominios con schema.test.ts" — 5/47 have none (ai, fleet-reports, loans, notifications, storage-billing; each has other tests). CONFIRMED literally false, spirit true (47/47 have ≥1 test).
[medium][dx/security] docs/mobile-patterns.md:66-70 known-but-unfixed — /fleet-reports gated by trips:read lets driver open profitability report; "fix trivial PR aparte". Code today: fleet-reports/page.tsx:11 + profitability-actions.ts:30 still check trips:read; drivers hold trips:read. CONFIRMED — flagged 2026-07-03, never fixed.
[low][doc-drift] README.md:112 "220+ tests, <2s" — actual 743 passed + 9 skipped, 88 files, 3.5s. CONFIRMED (undersells 3×).
[low][doc-drift] counts — roadmap:296 "~45 permisos"→72 declared; "25 tools"→31 tool({. CONFIRMED stale.
[low][doc-drift] pendientes.md:27 "panel de /admin/afip" — no such page; CAEA panel in /admin/afip/puntos-de-venta. CONFIRMED.
[low][doc-drift] "100% cobertura" permissions matrix (CLAUDE.md, roadmap:296, pendientes:75) — permissions.test.ts asserts structural invariants + ~10 spot-checks, NOT full 6×72 snapshot. Wrong grant to finance in most domains would pass. PLAUSIBLE overstatement. Fix: add matrix snapshot test.
[low][doc-drift] "sin Co-Authored-By" — every squash commit carries Co-authored-by: Tomas Dziurdzia (GitHub squash artifact of owner's 2nd email, not AI footer). Literal contradiction, spirit intact. Conventional-commit 30/30 comply ✓.
[low][doc-drift] frontend-patterns.md — §2.1 dotenv-cli ✅ but dev is plain next dev; §3.1 pre-commit=prettier-only but actual .husky/pre-commit is lint-staged eslint --fix no prettier; §3.2 pre-push types-regen ✅ but no .husky/pre-push (CI covers). CONFIRMED (low, reference catalog).
[low][doc-drift] README.md:116 integration suite "(triggers, RPCs, RLS)" — tests/integration/ has exactly one suite chat-flows.test.ts (9 tests). Money/accounting triggers, RPCs, RLS zero integration coverage. CONFIRMED overstatement.
[ci verified true] pnpm dlx supabase gen types matches scripts/db-types.sh; the CI `database` job diffs it (path-filtered); migration-order check matches skill; 14/14 Inngest fns registered; dev:up/seed:dev/bootstrapOwnerIfNeeded/logAudit/lib/email graceful skip all real.

## ONBOARDING GAPS (fresh clone + README only)
1. Incomplete .env.local.example (biggest): AI chat (no ANTHROPIC_API_KEY documented), fallback, email, push, Sentry silently/loudly broken. Dead SUPABASE_DB_URL.
2. AFIP setup undocumented: app boots fine without it (lib/afip/env.ts throws lazily on first call); nothing explains AFIP_CERT/KEY must be base64 single-line PEM (only a code comment says so), nor how to get homologación creds.
3. No instruction to copy .env.local.example → .env.local, nor where local anon/service keys come from (supabase status).
4. Supabase CLI install not covered.
5. VAPID key generation not explained (npx web-push generate-vapid-keys).
6. Undocumented scripts newcomer needs: db:types:generate, db:reset, seed:all, import:afip-purchases, format.
7. Node ≥20 / pnpm 10 only in package.json engines.
8. Integration tests read .env.local directly (needs service key); not mentioned in RUN_INTEGRATION=1 snippet.

## TEST POSTURE
- 743 unit tests / 88 files, 3.5s. All 47 slices have ≥1 test but ~38 have only Zod schema.test.ts — SERVER ACTIONS ESSENTIALLY UNTESTED (0 tests under any features/*/actions/); tested logic is pure lib/ (amortization, billing, pallet-days, AI mappers).
- Integration: single suite (chat flows, 9 tests), gated RUN_INTEGRATION=1 else auto-skips green. No integration coverage of journal triggers, cheque lifecycle RPCs, RLS on money tables — the riskiest code.
- E2E: Playwright configured + runnable (4 specs: login, invoices, invoices-emit gated RUN_AFIP_E2E, chat) but NEVER runs in CI (requires pre-running stack). Opt-in manual.
- CI gaps: no Playwright job, no format:check (prettier configured but unenforced; pre-commit only eslint), no coverage reporting.

## OPEN QUESTIONS
1. Is cross-feature-import ban meant to apply only to actions/logic (types+pickers tolerated)? Current wording bans all 151.
2. Is /fleet-reports visible to drivers intentional? One-line fix pending since 2026-07-03.
3. Archive roadmap §4-§6 into annex now §3 declares everything shipped?
4. Is manual meant to lag intentionally (finance-only audience) or add Flota/Pallets/IA/Préstamos/Recurrentes pages?
5. SUPABASE_DB_URL in .env.local.example: leftover or reserved?
