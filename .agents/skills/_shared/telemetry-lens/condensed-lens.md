# Condensed telemetry lens (paste verbatim per subagent)

This is the block review/planning/build skills paste into EVERY subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). There is no separate fat telemetry skill
in JouveERP — this file IS the lens; the orchestrator reads it once and pastes the block below.

```
=== TELEMETRY LENS (attack every signal the change emits: logs, errors, Sentry events, audit rows, config) ===
On its own `telemetry-lens loaded:`-prefixed line in the load-proof header block (header order:
catalog, ports-lens, dry-lens, perf-lens, comment-lens, telemetry-lens; the tripwire keys on the
PREFIX, not on line position), or this wave is NON-CLEAN and re-run:
  telemetry-lens loaded: every emission routed/named/bounded/clean | telemetry surface: <log/capture/audit/env list | "none — no signal emitted or configured in diff">
("none" is a CLEAN pass ONLY when stated AND the diff adds no new failure surface — a behavioral
diff that adds a route handler/server action/retry/fallback/outbound call (AFIP, AI provider, email,
BCRA)/Inngest function or step and emits NOTHING is a law-7 DEFECT, not "none". A missing/garbled
telemetry-lens line = NON-CLEAN. A wrongful "none" on a diff that DOES add a `logger.*` call, a
`captureException`/`captureMessage`, a `logAudit()`, an `ai_usage` write, a Sentry config change, or a
SENTRY_*/LOG_LEVEL var is a first-class DEFECT.)

THE ONE LAW: every signal flows through the HOUSE pipeline, uses a stable greppable name, carries
the ids needed to find the unit of work, and NEVER carries a secret, PII, or a financial value. A
signal that doesn't DETECT, LOCALIZE, or EXPLAIN is not emitted. Audit is not telemetry.

HOUSE PIPELINE (the only sanctioned emitters — three channels, never mixed):
- LOGS: `logger` from `lib/logger.ts` — single-line JSON, level-filtered (`LOG_LEVEL`), with key-based
  redaction of password/secret/token/authorization/cookie/api_key/private_key/cert/sign. Server code
  never uses `console.*` (only `lib/logger.ts` itself and `scripts/`).
- ERRORS: `captureException(error, context)` / `captureMessage(message, level, context)` from
  `lib/observability.ts` — logs AND forwards to Sentry when `SENTRY_DSN` is set (lazy import, no-op
  without a DSN). Sentry is initialised ONLY in `sentry.{server,edge,client}.config.ts` via
  `instrumentation.ts`; `beforeSend` strips authorization/cookie headers. Besides those, only
  `lib/observability.ts` imports `@sentry/nextjs` (lazily) — it is the sanctioned forwarder.
- AUDIT: `logAudit(eventType, actorId, payload, targetResourceId?)` from `lib/actions/audit.ts` →
  the `audit_events` table (service role, insert-only; failures are logged, never thrown). AI cost
  goes to `ai_usage` (tokens + cost per turn), not to logs.
There is no metrics backend and no product analytics. Adding either (or a tracing exporter, or a
second error tracker) is a platform decision, not a drive-by.

FIVE QUESTIONS PER SIGNAL (ask for every log call, capture, audit write, `ai_usage` write or alert
the diff adds or moves — they feed the laws below):
 Q1 ONE EMISSION PER ACTION — name the one user/system action that produces it; grep every path that
    emits it (features/, lib/, app/, SQL triggers/RPCs writing `audit_events`) and check whether the
    callee already logs/audits. Double-emitters: client + server emission, an RPC that audits plus the
    action that audits, a re-run on every keystroke/page, a fan-out loop, a pre-check call, an
    Inngest retry re-emitting a non-idempotent signal.
 Q2 THE REAL VALUE — each field holds what actually happened (the served model after fallback, the
    final AFIP code, the real outcome), not the intended one; check every branch: fallback, retry,
    deleted and variant paths.
 Q3 REACHES THE COLLECTOR — through the house pipeline; on Vercel serverless it is emitted before the
    response returns (no fire-and-forget after it); the emission point runs AFTER the guards that can
    reject, so auth/validation/rate-limit rejections are recorded too.
 Q4 THE ALERT CAN FIRE — for any Sentry alert rule or filter keyed on a signal, name the failure state
    it must catch and check it fires there; it keys on a stable code/slug, never message prose (a
    changed message string is grepped in docs/ and alert config).
 Q5 NOT REDUNDANT — a field derivable from another in the same record, or a log duplicating a
    capture/audit row with the same fields, is dropped.
DENY-PATH AUDIT: an audited operation records its denials too where the deny is a security fact (an
access change refused, an export refused): written after the gate decides, with the real outcome,
under an extend-only event type (law 2).

THE EIGHT CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. HOUSE-PIPELINE — no parallel logger, no `console.*` in server code, no direct `@sentry/nextjs`
   import outside the config files / `instrumentation.ts` / `lib/observability.ts` (lazy), no second error tracker or analytics SDK,
   no `Sentry.init` elsewhere. Client-side errors surface through error boundaries (Sentry client
   config), not ad-hoc `console.error`.
2. STABLE-NAMES — log messages and audit event types are static, greppable, dot-namespaced slugs
   (`invoice.issue.cae_rejected`, `ai.document.discarded`), never built from data or interpolated
   (`\`failed for ${id}\`` = defect; the id goes in the context object). Audit `eventType` values are
   EXTEND-ONLY: never rename or repurpose an existing one (reports and filters key on them).
3. STRUCTURED-CONTEXT — context is a flat object of ids, counts, codes and durations: `{ invoiceId,
   channelId, afipCode, attempt, rows: 12, ms }`. Pass the RAW error (`{ error: err }` /
   `captureException(err, ...)`), never a pre-stringified one. Severity matches the outcome: `error`
   only for a genuine final failure, a handled/retried success is not an error, an expected
   user-facing rejection (AFIP SERVICE validation, a Zod failure) is `warn`/`info` with its code, no
   debug noise on hot paths.
4. CORRELATION — a unit of work is findable: actions log the acting `userId` (opaque uuid from the
   session, never from the client) and the entity id; Inngest functions log the event's entity id
   and `attempt`; AFIP calls log the voucher type/point of sale/number and the AFIP error `code`;
   AI calls log the session/document id, model id (from `features/ai/model.ts`) and token counts.
   Identity comes from `requireUserContext()` or the triggering event, never a request field.
5. NO-SENSITIVE-DATA — never in ANY field of ANY channel (log, Sentry extra/breadcrumb/message,
   error message returned to the client, audit payload): credentials/tokens/cookies/auth headers/
   AFIP certificate or key/WSAA token+sign/request bodies; emails, names, CUIT/CUIL/DNI/CBU/CVU;
   amounts, balances, prices, salaries, account numbers; uploaded document content, OCR text or the
   extracted JSON; prompts and completions. No object spreads (`{...input}`, `{...invoice}`) into a
   signal. Log ids and COUNTS, never VALUES. The logger's key-based redaction is a NET for secrets —
   it does not catch a CUIT under key `doc` or an amount under `total`; reaching it with sensitive
   data is already the defect. Judge re-identification over the field SET, not per field.
6. SIGNAL-DENSITY — every new signal names its purpose (detect/localize/explain); one log per unit
   of work at its outcome beats many thin ones; no per-row logs inside loops (log the count); never
   emit a field derivable from another in the same record. A change to an emitted name/audit type
   states before/after in the PR body.
7. INSTRUMENTATION-COMPLETENESS — under-emission is a DEFECT. For every behavioral diff: "how will I
   know if this is working?" A new failure surface (route handler, server action error path, retry,
   fallback, outbound AFIP/AI/email/BCRA call, Inngest function or step) ships its `logger`/
   `captureException` in the same diff. Domain outcomes count, not just transport: "CAE rejected
   with code X", "extraction low-confidence", "period closed" land as an outcome log with a code.
   Unexpected errors in an action are `captureException`'d before returning
   `{ ok: false, error }`; the user sees a safe Spanish message, never the raw error.
8. AUDIT-DISTINCT — audit facts (invoice issued/cancelled, payment/receipt created or voided, role
   assigned, period closed/reopened, data exported or deleted, AI document confirmed/discarded,
   AFIP config changed) go through `logAudit()`: written AFTER the operation with its real outcome,
   `actorId` = `ctx.userId`, entity id in `targetResourceId`, payload = ids and codes only — never
   amounts, document content or PII. `audit_events` is append-only: any UPDATE/DELETE path (policy,
   grant, or code) is a DEFECT. Logs and Sentry are never relied on as the audit trail.

SEVERITY: secret/PII/financial value in any field / parallel logger or tracker / `Sentry.init` or
`@sentry/nextjs` outside its files (config files, `instrumentation.ts`, `lib/observability.ts`) / object spread into a signal / interpolated or data-built event
name / renamed audit event type / mutable `audit_events` / raw error or document content returned to
the client / new failure surface with no emission = HARD blockers (any one = does not merge).
`console.*` in server code / missing correlation id / wrong severity / per-row logging = raise-and-
downgradable (defer only if pre-existing AND outside the blast radius; state it, don't default).

ONLY sanctioned exceptions: (a) script/CLI stdout in `scripts/` = developer output; (b) a noisy
diagnostic behind `LOG_LEVEL=debug`, one line naming purpose + death condition.

PER-LAW VERDICT: if the change emits, alters, or configures ANY signal — or ADDS a failure surface
(law 7 applies even when nothing is emitted) — emit PASS|DEFECT + one line for each of the eight
laws. If it touches NO telemetry surface AND adds no failure surface, emit exactly:
  telemetry: N/A — no signal emitted or configured, no new failure surface (no logger/capture/logAudit/ai_usage write, Sentry config, or new route/action/retry/outbound call/Inngest step in diff).
=== END TELEMETRY LENS ===
```
