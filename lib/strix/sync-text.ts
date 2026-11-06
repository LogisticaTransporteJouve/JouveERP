import { syncPhase } from "@/lib/afip/arca-sync-run";
import { formatArgentineDate, formatArgentineDateTime } from "@/lib/format";

import type {
  StrixAccountState,
  StrixSyncRun,
  StrixSyncRunResult,
} from "./strix-account";

const ERROR_TEXT: Record<string, string> = {
  SIGN_IN_REJECTED: "Strix rechazó el usuario o la clave",
  SIGN_IN_FAILED: "Strix no dejó entrar",
  NO_VEHICLES:
    "Strix no tiene ningún informe «Kmts recorridos» del que tomar los vehículos (generá uno a mano en Strix)",
  REPORT_FAILED: "Strix no armó el informe",
  REPORT_TIMEOUT: "el informe de Strix tardó demasiado",
  NETWORK: "no se pudo conectar con Strix",
  RECORD_FAILED: "no se pudo registrar el ingreso",
  SAVE_FAILED: "no se pudieron guardar los km",
  NOT_READ: "no se leyó",
  UNEXPECTED: "error de JouveERP",
};

export function strixErrorText(code: string): string {
  return ERROR_TEXT[code] ?? code;
}

/** The result of a run in a line. */
export function strixResultText(result: StrixSyncRunResult): string {
  switch (result.outcome) {
    case "skipped":
      if (result.reason === "rejected") {
        return "No se entró a Strix: la clave guardada fue rechazada.";
      }
      if (result.reason === "read_failed") {
        return "No se pudo leer el usuario de Strix guardado.";
      }
      return "No se entró a Strix: falta el usuario.";
    case "failed":
    case "sign_in_failed":
      return `No se trajeron los km: ${strixErrorText(result.code)}.`;
    case "done": {
      const parts = [
        `Km del ${formatArgentineDate(result.from)} al ${formatArgentineDate(result.to)}: ${result.vehicles} vehículos.`,
      ];
      const failed = Object.entries(result.failedMonths);
      if (failed.length > 0) {
        parts.push(
          `Sin leer: ${failed.map(([m, c]) => `${m} (${strixErrorText(c)})`).join(", ")}.`,
        );
      }
      if (result.unmatched.length > 0) {
        parts.push(
          `Patentes de Strix sin vehículo cargado: ${result.unmatched.join(", ")}.`,
        );
      }
      return parts.join(" ");
    }
  }
}

/** The account and last run in a line, for the km screen. */
export function strixStatusText(
  s: {
    state: StrixAccountState;
    lastSuccessAt: string | null;
    lastErrorCode: string | null;
    sync: StrixSyncRun;
  },
  now: number,
): string {
  if (s.state === "missing") return "Strix sin configurar.";
  if (s.state === "rejected") {
    return s.lastErrorCode === "SIGN_IN_REJECTED"
      ? "Strix rechazó la clave: hay que volver a cargarla."
      : `Pausado tras dos ingresos fallidos (${strixErrorText(s.lastErrorCode ?? "SIGN_IN_FAILED")}): volvé a cargar la clave.`;
  }
  switch (syncPhase({ ...s.sync, result: null }, now)) {
    case "waiting":
      return "Esperando a Strix…";
    case "running":
      return "Trayendo km de Strix…";
    case "not_started":
      return "El último pedido a Strix no arrancó: probá de nuevo.";
    case "died":
      return "La última corrida de Strix se cortó sin terminar.";
    case "idle":
      break;
  }
  const last = s.sync.result;
  const when = s.sync.finishedAt
    ? `Última corrida ${formatArgentineDateTime(s.sync.finishedAt)}`
    : "Todavía no corrió";
  return last ? `${when} · ${strixResultText(last)}` : `${when}.`;
}
