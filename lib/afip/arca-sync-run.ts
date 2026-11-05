import type {
  ArcaSyncRun,
  ArcaSyncRunResult,
} from "@/lib/afip/arca-web-account";
import { arcaErrorText, skipReasonText } from "@/lib/afip/arca-error-text";

/** A requested run that has not started after this long never will (the
 *  event was lost, or the job is not deployed). Room for a whole run ahead
 *  of it (one at a time, up to 300 s) and the queue. */
export const SYNC_START_TIMEOUT_MS = 8 * 60_000;
/** A started run with no end after this long died (the function timed out). */
export const SYNC_RUN_TIMEOUT_MS = 15 * 60_000;

export type SyncPhase =
  | "idle"
  | "waiting"
  | "running"
  | "not_started"
  /** Started and never stamped its end: killed by the function timeout. */
  | "died";

const ms = (iso: string | null) => (iso ? Date.parse(iso) : 0);

/** Where the last run is: waiting to start, running, never started, died
 *  without an end, or done (idle). Times compare by value, so a cron run
 *  also counts. */
export function syncPhase(sync: ArcaSyncRun, now: number): SyncPhase {
  const requested = ms(sync.requestedAt);
  const started = ms(sync.startedAt);
  const finished = ms(sync.finishedAt);
  // Ours has not started until a run starts after the request: one that
  // started before it (the daily run, another tab) and ends meanwhile is not
  // its result.
  if (requested > started) {
    return now - requested < SYNC_START_TIMEOUT_MS ? "waiting" : "not_started";
  }
  if (started > finished) {
    return now - started < SYNC_RUN_TIMEOUT_MS ? "running" : "died";
  }
  return "idle";
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The result of a run in a line, for the card and the toast. */
export function syncResultText(result: ArcaSyncRunResult): string {
  switch (result.outcome) {
    case "skipped":
      if (result.reason === "rejected") {
        return "No se entró a ARCA: la clave guardada fue rechazada.";
      }
      if (result.reason === "read_failed") {
        return "No se pudo leer el usuario de ARCA guardado: probá de nuevo en un rato.";
      }
      return "No se entró a ARCA: falta el usuario.";
    case "failed":
      return "La corrida se cortó por un error de JouveERP: probá de nuevo en un rato.";
    case "sign_in_failed":
      return `No se pudo entrar a ARCA: ${arcaErrorText(result.code)}.`;
    case "done": {
      const c = result.counts;
      const parts = [
        plural(c.inserted, "comprobante nuevo", "comprobantes nuevos"),
        `${c.alreadyInTray} ya estaban`,
      ];
      if (c.linked > 0) parts.push(`${c.linked} ya cargados como compra`);
      if (result.skippedRows > 0) {
        parts.push(`${result.skippedRows} no se pudieron leer`);
      }
      return [
        `${parts.join(" · ")}.`,
        failedMonthsText(result.failedMonths),
        arcaSaidText(result.failedDetail ?? {}),
        skippedText(result.skipped ?? [], result.skippedRows),
      ]
        .filter(Boolean)
        .join(" ");
    }
  }
}

/** The months a run could not read, as ranges of consecutive months with
 *  the same reason: «Faltó 2014-12 a 2015-10 (…).» */
function failedMonthsText(failed: Record<string, string>): string {
  const months = Object.keys(failed).sort();
  if (months.length === 0) return "";
  const next = (m: string) => {
    const [y, mo] = m.split("-").map(Number) as [number, number];
    return mo === 12
      ? `${y + 1}-01`
      : `${y}-${String(mo + 1).padStart(2, "0")}`;
  };
  const runs: { from: string; to: string; code: string }[] = [];
  for (const m of months) {
    const last = runs.at(-1);
    if (last && last.code === failed[m] && next(last.to) === m) last.to = m;
    else runs.push({ from: m, to: m, code: failed[m]! });
  }
  return `Faltó ${runs
    .map(
      (r) =>
        `${r.from === r.to ? r.from : `${r.from} a ${r.to}`} (${arcaErrorText(r.code)})`,
    )
    .join(", ")}.`;
}

const SKIPPED_SHOWN = 3;

/** The first rows that could not be read, named: «No se leyeron: tipo 1 ·
 *  00003-00026630 · CUIT … (los importes no suman el total)…» */
function skippedText(
  skipped: { reason: string; ref: string }[],
  total: number,
): string {
  if (skipped.length === 0) return "";
  const shown = skipped
    .slice(0, SKIPPED_SHOWN)
    .map((s) => `${s.ref} (${skipReasonText(s.reason)})`)
    .join("; ");
  const more = total - Math.min(skipped.length, SKIPPED_SHOWN);
  return `No se leyeron: ${shown}${more > 0 ? ` y ${more} más` : ""}.`;
}

/** What ARCA said when it refused, once per distinct message, so a person
 *  knows why without opening Inngest. */
function arcaSaidText(detail: Record<string, string>): string {
  const said = [...new Set(Object.values(detail))].slice(0, 2);
  return said.length > 0 ? `Detalle: ${said.join(" / ")}.` : "";
}
