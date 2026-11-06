"use server";

import { z } from "zod";

import { logAudit, type JsonValue } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { listUsersWithRoles } from "@/lib/auth/users";
import { toCsv } from "@/lib/export/csv";
import { formatArgentineDateTime, todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { containsPattern, escapeLike } from "@/lib/supabase/like-pattern";
import { getServiceClient } from "@/lib/supabase/service";

import { auditActorLabel } from "../lib/actor";
import { AI_TOOL_CALL, groupAiTurns } from "../lib/ai-turns";
import { describeAuditEvent } from "../lib/describe";
import { maskSensitive } from "../lib/mask";
import { auditEventTypesOf } from "../lib/registry";
import { resolveAuditEntities } from "../lib/resolve-entities";
import { normalizeAuditSearch } from "../lib/search";
import {
  AUDIT_EXPORT_LIMIT,
  AUDIT_PAGE_SIZE,
  AuditFiltersSchema,
  AuditListInputSchema,
  RECORD_HISTORY_LIMIT,
  isAuditActorType,
  type AuditCsvExport,
  type AuditEventRow,
  type AuditFilterOptions,
  type AuditFilters,
  type AuditPage,
  type AuditUserOption,
} from "../schema";

const DENIED = "No tenés permiso para ver la auditoría.";

const COLUMNS =
  "id, ts, actor_id, actor_type, event_type, target_resource_id, target_user_id, payload";

/** Argentina has no daylight saving time: its days start at -03:00. */
const AR_DAY_START = "T00:00:00-03:00";
const AR_DAY_END = "T23:59:59.999-03:00";

/** Events whose names one batch resolves (bounds each `in (...)` list). */
const RESOLVE_CHUNK = 200;

type AuditEventDbRow = {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_type: string;
  event_type: string;
  target_resource_id: string | null;
  target_user_id: string | null;
  payload: JsonValue;
};

/** The rows the screen and the export show: masked, named and linked. The
 *  records they mention are looked up in one query per kind of record. */
async function toRows(
  rows: readonly AuditEventDbRow[],
): Promise<AuditEventRow[]> {
  const out: AuditEventRow[] = [];
  for (let i = 0; i < rows.length; i += RESOLVE_CHUNK) {
    const chunk = rows
      .slice(i, i + RESOLVE_CHUNK)
      .map((row) => ({ ...row, payload: maskSensitive(row.payload) }));
    const lookup = await resolveAuditEntities(chunk);
    for (const row of chunk) {
      const described = describeAuditEvent(row, lookup);
      out.push({
        id: row.id,
        ts: row.ts,
        actor_id: row.actor_id,
        actor_type: isAuditActorType(row.actor_type) ? row.actor_type : "user",
        event_type: row.event_type,
        target_resource_id: row.target_resource_id,
        target_user_id: row.target_user_id,
        payload: row.payload,
        ...described,
      });
    }
  }
  return out;
}

function filteredQuery(filters: AuditFilters) {
  let query = getServiceClient().from("audit_events").select(COLUMNS);
  if (filters.from) query = query.gte("ts", `${filters.from}${AR_DAY_START}`);
  if (filters.to) query = query.lte("ts", `${filters.to}${AR_DAY_END}`);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.group) {
    query = query.in("event_type", auditEventTypesOf(filters.group));
  }
  if (filters.hideAiQueries) query = query.neq("event_type", AI_TOOL_CALL);
  const search = normalizeAuditSearch(filters.q);
  if (search) query = query.like("search_text", containsPattern(search));
  if (filters.eventType) query = query.eq("event_type", filters.eventType);
  if (filters.module) {
    // A module name is matched as typed, not as a pattern.
    query = query.like("event_type", `${escapeLike(filters.module)}.%`);
  }
  return query
    .order("ts", { ascending: false })
    .order("id", { ascending: false });
}

/** Every user's display name (profile name, else email). */
async function loadUserOptions(): Promise<AuditUserOption[]> {
  const users = await listUsersWithRoles();
  const { data: profiles, error } = await getServiceClient()
    .from("user_profiles")
    .select("user_id, first_name, last_name")
    .in(
      "user_id",
      users.map((u) => u.id),
    );
  if (error) throw error;
  const names = new Map(
    (profiles ?? []).map((p) => [
      p.user_id,
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    ]),
  );
  return users
    .map((u) => ({ id: u.id, label: names.get(u.id) || u.email }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export async function listAuditEventsAction(
  input: unknown,
): Promise<ActionResult<AuditPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "audit:read")) return { ok: false, error: DENIED };
  const parsed = AuditListInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Filtro inválido.",
    };
  }
  const { filters, cursor } = parsed.data;

  let query = filteredQuery(filters);
  if (cursor) {
    // Keyset on (ts, id) descending: the rows after the previous page's last.
    query = query.or(
      `ts.lt."${cursor.ts}",and(ts.eq."${cursor.ts}",id.lt.${cursor.id})`,
    );
  }
  try {
    const { data, error } = await query.limit(AUDIT_PAGE_SIZE + 1);
    if (error) throw error;
    const page = (data ?? []).slice(0, AUDIT_PAGE_SIZE);
    const last = page.at(-1);
    return {
      ok: true,
      data: {
        rows: await toRows(page),
        nextCursor:
          (data ?? []).length > AUDIT_PAGE_SIZE && last
            ? { ts: last.ts, id: last.id }
            : null,
      },
    };
  } catch (error) {
    logger.error("audit.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo leer la auditoría." };
  }
}

export async function listAuditFilterOptionsAction(): Promise<
  ActionResult<AuditFilterOptions>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "audit:read")) return { ok: false, error: DENIED };
  try {
    return { ok: true, data: { users: await loadUserOptions() } };
  } catch (error) {
    logger.error("audit.options.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los filtros." };
  }
}

const CSV_HEADER = ["Fecha", "Quién", "Qué hizo", "Sobre qué"];

/** The filtered events as CSV, newest first, up to AUDIT_EXPORT_LIMIT rows,
 *  in the same words as the screen (an assistant turn is one line). */
export async function exportAuditEventsCsvAction(
  input: unknown,
): Promise<ActionResult<AuditCsvExport>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "audit:read")) return { ok: false, error: DENIED };
  const parsed = AuditFiltersSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Filtro inválido.",
    };
  }

  const rows: AuditEventDbRow[] = [];
  let users: AuditUserOption[];
  let kept: AuditEventRow[];
  try {
    users = await loadUserOptions();
    // PostgREST stops at max_rows (1000) a response: page by range.
    const PAGE = 1000;
    for (let from = 0; rows.length <= AUDIT_EXPORT_LIMIT; from += PAGE) {
      const { data, error } = await filteredQuery(parsed.data).range(
        from,
        from + PAGE - 1,
      );
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
    kept = await toRows(rows.slice(0, AUDIT_EXPORT_LIMIT));
  } catch (error) {
    logger.error("audit.export.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo exportar la auditoría." };
  }

  const truncated = rows.length > AUDIT_EXPORT_LIMIT;
  const names = new Map(users.map((u) => [u.id, u.label]));
  const csv = toCsv(
    CSV_HEADER,
    groupAiTurns(kept).map((item) => [
      formatArgentineDateTime(item.ts),
      auditActorLabel(item, names),
      item.sentence,
      item.kind === "event" ? (item.subject?.label ?? "") : "",
    ]),
  );

  await logAudit("audit.exported", ctx.userId, {
    filters: { ...parsed.data },
    rows: kept.length,
    truncated,
  });
  return {
    ok: true,
    data: {
      fileName: `auditoria-${todayInAR()}.csv`,
      csv,
      rows: kept.length,
      truncated,
    },
  };
}

const ResourceIdSchema = z.string().trim().min(1).max(100);

/** A record's own history: the latest events about `resourceId`, newest
 *  first. */
export async function getRecordHistoryAction(
  resourceId: string,
): Promise<ActionResult<AuditEventRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "audit:read")) return { ok: false, error: DENIED };
  const parsed = ResourceIdSchema.safeParse(resourceId);
  if (!parsed.success) return { ok: false, error: "Registro inválido." };

  try {
    const { data, error } = await getServiceClient()
      .from("audit_events")
      .select(COLUMNS)
      .eq("target_resource_id", parsed.data)
      .order("ts", { ascending: false })
      .order("id", { ascending: false })
      .limit(RECORD_HISTORY_LIMIT);
    if (error) throw error;
    return { ok: true, data: await toRows(data ?? []) };
  } catch (error) {
    logger.error("audit.record_history.failed", {
      userId: ctx.userId,
      resourceId: parsed.data,
      error,
    });
    return { ok: false, error: "No se pudo leer el historial." };
  }
}
