import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// M.2 — Cron diario de cotización USD del BCRA.
//
// Trae la última cotización oficial USD→ARS de la API pública de Estadísticas
// Cambiarias del BCRA y la guarda con source='bcra'. Resiliente: si el BCRA
// está caído o cambia el formato, loguea y no hace nada — la carga manual de
// finance (source='manual') es el fallback. No pisa una fila ya cargada para
// esa fecha (manual gana; la primera del día gana). `rate` = ARS por 1 USD.
const BCRA_URL =
  "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones";

type BcraCotizacion = {
  results?: {
    fecha?: string;
    detalle?: Array<{
      codigoMoneda?: string;
      tipoCotizacion?: number;
    }>;
  };
};

export const bcraExchangeRate = inngest.createFunction(
  {
    id: "bcra-exchange-rate",
    name: "M.2 — fetch BCRA USD exchange rate",
    retries: 2,
    // Días hábiles 11:00 ART (el BCRA publica al mediodía).
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 11 * * 1-5" }],
  },
  async ({ step }) => {
    const fetched = await step.run("fetch-bcra", async () => {
      try {
        const res = await fetch(BCRA_URL, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          logger.warn("exchange_rates.bcra.http_error", { status: res.status });
          return null;
        }
        const json = (await res.json()) as BcraCotizacion;
        const fecha = json.results?.fecha;
        const usd = json.results?.detalle?.find(
          (d) => d.codigoMoneda === "USD",
        );
        const rate = usd?.tipoCotizacion;
        if (!fecha || typeof rate !== "number" || rate <= 0) {
          logger.warn("exchange_rates.bcra.no_usd", { fecha, rate });
          return null;
        }
        return { rate_date: fecha.slice(0, 10), rate };
      } catch (err) {
        logger.warn("exchange_rates.bcra.fetch_failed", { err: String(err) });
        return null;
      }
    });

    if (!fetched) {
      return { upserted: false, reason: "no-rate" };
    }

    const inserted = await step.run("upsert-rate", async () => {
      const supabase = getServiceClient();
      // ignoreDuplicates → INSERT ... ON CONFLICT DO NOTHING. maybeSingle()
      // devuelve la fila si insertó, o null si ya había una (manual o bcra
      // anterior): así el log refleja lo que pasó de verdad.
      const { data, error } = await supabase
        .from("exchange_rates")
        .upsert(
          {
            currency: "USD",
            rate_date: fetched.rate_date,
            rate: fetched.rate,
            source: "bcra",
          },
          { onConflict: "currency,rate_date", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`upsert-rate: ${error.message}`);
      return data !== null;
    });

    logger.info("exchange_rates.bcra.fetched", {
      rate_date: fetched.rate_date,
      rate: fetched.rate,
      inserted,
    });
    return { upserted: inserted, ...fetched };
  },
);
