import { z } from "zod";

import { listAuditEventsAction } from "@/features/audit/actions/audit-actions";
import { EMPTY_AUDIT_FILTERS } from "@/features/audit/schema";
import { IsoDateSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, okResult } from "../result";

// Read tool over Admin › Auditoría: wraps listAuditEventsAction, so it
// inherits its `audit:read` gate and its masking of CBU, CUIL, keys and
// tokens. One page (the latest events matching the filters).

export async function runAuditEvents(input: {
  from?: string | null;
  to?: string | null;
  module?: string | null;
  eventType?: string | null;
  search?: string | null;
}): Promise<AiRunResult> {
  const res = await listAuditEventsAction({
    filters: {
      ...EMPTY_AUDIT_FILTERS,
      from: input.from ?? null,
      to: input.to ?? null,
      module: input.module ?? null,
      eventType: input.eventType ?? null,
      q: input.search ?? null,
    },
    cursor: null,
  });
  if (!res.ok) return errResult(res.error);
  const { rows, nextCursor } = res.data;
  const more = nextCursor !== null;
  return okResult(
    `${rows.length} audit events` +
      (more ? "; only the latest page is listed." : "."),
    {
      rows: rows.map((r) => ({
        ts: r.ts,
        actor_id: r.actor_id,
        actor_type: r.actor_type,
        event_type: r.event_type,
        what: r.sentence,
        about: r.subject?.label ?? null,
        target_resource_id: r.target_resource_id,
      })),
    },
    { partial: more },
  );
}

export const getAuditEvents = defineAiAction({
  name: "getAuditEvents",
  domain: "general",
  permission: "audit:read",
  sideEffect: "read",
  sources: ["audit_events"],
  description:
    "Audit log (Admin › Auditoría): who did what and when, newest first — " +
    "event type (module.action), actor (user, ai-agent acting for a user, " +
    "system), what was done as a Spanish sentence ('what') and the record it " +
    "is about by name ('about'). For 'who issued the invoice to X', 'who " +
    "changed X', 'what was done yesterday' or a record's history.",
  input: z.object({
    from: IsoDateSchema.nullish().describe("First day (YYYY-MM-DD)."),
    to: IsoDateSchema.nullish().describe("Last day (YYYY-MM-DD)."),
    module: z
      .string()
      .regex(/^[a-z0-9_]{1,40}$/)
      .nullish()
      .describe(
        "Event-type prefix, e.g. 'invoice', 'journal_entry', 'transaction'.",
      ),
    eventType: z
      .string()
      .regex(/^[a-z0-9_.:-]{1,80}$/)
      .nullish()
      .describe("Exact event type, e.g. 'invoice.cancelled'."),
    search: z
      .string()
      .max(80)
      .nullish()
      .describe(
        "Text the record names: client or supplier name, document number, patente.",
      ),
  }),
  run: (_ctx, input) => runAuditEvents(input),
});
