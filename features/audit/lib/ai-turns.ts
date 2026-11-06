// The assistant writes one ai.tool_call event per query it runs; a single
// question can run five. The log shows a turn's consecutive queries as one
// row: «consultó IVA Ventas, IVA Compras e Impuestos (09/2026)».

import type { JsonValue } from "@/lib/actions/audit";
import { toolLabel } from "@/features/ai/lib/tool-labels";
import { activityFilters } from "@/features/ai/lib/activity-filters";

import type { AuditEventRow } from "../schema";

import { joinAnd } from "./words";

export const AI_TOOL_CALL = "ai.tool_call";

/** Queries further apart than this are separate turns, even in one chat. */
const TURN_GAP_MS = 10 * 60_000;

/** Labels a turn's row names before «y N consultas más». */
const MAX_LABELS = 6;

export type AuditAiTurn = {
  kind: "ai_turn";
  /** The newest call's id: stable while more pages load below it. */
  id: string;
  /** The newest call's time. */
  ts: string;
  actor_id: string | null;
  actor_type: AuditEventRow["actor_type"];
  sentence: string;
  calls: AuditEventRow[];
};

export type AuditListItem = ({ kind: "event" } & AuditEventRow) | AuditAiTurn;

function asObject(v: JsonValue): { [k: string]: JsonValue | undefined } {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}

/** The chat (or automatic task run) a call belongs to. */
function turnKey(row: AuditEventRow): string {
  const p = asObject(row.payload);
  const session = p.session_id ?? p.workflow_run_id ?? row.target_resource_id;
  return `${row.actor_id ?? ""}|${typeof session === "string" ? session : ""}`;
}

/** «consultó IVA Ventas, IVA Compras e Impuestos (09/2026)»: shared filters
 *  said once, different ones next to each query. */
export function aiTurnSentence(calls: readonly AuditEventRow[]): string {
  const parts = calls
    .slice()
    .reverse()
    .map((c) => {
      const p = asObject(c.payload);
      const tool = typeof p.tool === "string" ? p.tool : "";
      return {
        label: toolLabel(tool),
        filters: activityFilters(p.input).join(" · "),
      };
    });
  const sharedFilters = parts.every((x) => x.filters === parts[0]?.filters)
    ? (parts[0]?.filters ?? "")
    : null;
  const labels = [
    ...new Set(
      parts.map((x) =>
        sharedFilters === null && x.filters
          ? `${x.label} (${x.filters})`
          : x.label,
      ),
    ),
  ];
  const shown = labels.slice(0, MAX_LABELS);
  const rest = labels.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(", ")} y ${rest} ${rest === 1 ? "consulta más" : "consultas más"}`
      : joinAnd(shown);
  return `consultó ${list}${sharedFilters ? ` (${sharedFilters})` : ""}`;
}

/**
 * The rows as the list shows them: consecutive assistant queries of the same
 * chat, close in time, folded into one turn; everything else as is. `rows`
 * come newest first, and so do the items.
 */
export function groupAiTurns(rows: readonly AuditEventRow[]): AuditListItem[] {
  const out: AuditListItem[] = [];
  let run: AuditEventRow[] = [];

  const flush = () => {
    const first = run[0];
    if (!first) return;
    if (run.length === 1) {
      out.push({ kind: "event", ...first });
    } else {
      out.push({
        kind: "ai_turn",
        id: first.id,
        ts: first.ts,
        actor_id: first.actor_id,
        actor_type: first.actor_type,
        sentence: aiTurnSentence(run),
        calls: run,
      });
    }
    run = [];
  };

  for (const row of rows) {
    if (row.event_type !== AI_TOOL_CALL) {
      flush();
      out.push({ kind: "event", ...row });
      continue;
    }
    const last = run.at(-1);
    const sameTurn =
      last !== undefined &&
      turnKey(last) === turnKey(row) &&
      Date.parse(last.ts) - Date.parse(row.ts) <= TURN_GAP_MS;
    if (!sameTurn) flush();
    run.push(row);
  }
  flush();
  return out;
}
