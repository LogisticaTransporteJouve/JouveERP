import "server-only";

// CAEA lifecycle service: request/recover the fortnight code and persist it in
// caea_codes. Used by the caea-request cron, the afip-admin manual action and
// the issue-invoice contingency branch.

import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { afipDateToIso, type Quincena } from "./caea-periods";
import { AfipServiceError } from "./errors";
import { consultCAEA, requestCAEA, type CaeaResult } from "./wsfev1";

export type CaeaCodeRow = Database["public"]["Tables"]["caea_codes"]["Row"];

const ALREADY_GRANTED = 15008;

/**
 * Ensures the quincena's CAEA exists locally: returns the stored row, or asks
 * AFIP (FECAEASolicitar; 15008 "ya otorgado" recovers via FECAEAConsultar) and
 * persists it. Throws on AFIP rejections (e.g. 15006 outside the window,
 * 15003 no CAEA PV registered in ARCA's ABM).
 */
export async function ensureCaea(q: Quincena): Promise<CaeaCodeRow> {
  const supabase = getServiceClient();
  const { data: existing } = await supabase
    .from("caea_codes")
    .select("*")
    .eq("periodo", q.periodo)
    .eq("orden", q.orden)
    .maybeSingle();
  if (existing) return existing;

  let result: CaeaResult;
  try {
    result = await requestCAEA(q.periodo, q.orden);
  } catch (err) {
    const alreadyGranted =
      err instanceof AfipServiceError &&
      err.errors.some((e) => e.code === ALREADY_GRANTED);
    if (!alreadyGranted) throw err;
    result = await consultCAEA(q.periodo, q.orden);
  }

  const { data: inserted, error } = await supabase
    .from("caea_codes")
    .upsert(
      {
        periodo: q.periodo,
        orden: q.orden,
        caea: result.caea,
        fch_vig_desde: afipDateToIso(result.fchVigDesde),
        fch_vig_hasta: afipDateToIso(result.fchVigHasta),
        fch_tope_inf: afipDateToIso(result.fchTopeInf),
        fch_proceso: result.fchProceso,
        observaciones:
          result.observaciones.length > 0
            ? JSON.parse(JSON.stringify(result.observaciones))
            : null,
      },
      { onConflict: "periodo,orden" },
    )
    .select("*")
    .single();
  if (error || !inserted) {
    logger.error("caea.persist.failed", { periodo: q.periodo, orden: q.orden, error });
    throw new Error("El CAEA se obtuvo pero no se pudo guardar.");
  }

  logger.info("caea.granted", {
    periodo: q.periodo,
    orden: q.orden,
    caea: result.caea,
    tope: inserted.fch_tope_inf,
  });
  return inserted;
}

/** CAEA whose vigencia covers the given date, or null. */
export async function getActiveCaeaForDate(
  dateIso: string,
): Promise<CaeaCodeRow | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("caea_codes")
    .select("*")
    .lte("fch_vig_desde", dateIso)
    .gte("fch_vig_hasta", dateIso)
    .maybeSingle();
  return data ?? null;
}
