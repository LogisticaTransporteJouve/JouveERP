import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// M.2 — Daily cron for the BCRA USD exchange rate.
//
// Fetches the latest official USD→ARS rate from the BCRA public Estadísticas
// Cambiarias API and stores it with source='bcra'. Resilient: if the BCRA is
// down or changes the format, it logs and does nothing — the manual finance
// entry (source='manual') is the fallback. It does not overwrite a row already
// stored for that date (manual wins; the first of the day wins). `rate` = ARS per 1 USD.
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
    // Business days at 11:00 ART (the BCRA publishes around noon).
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
      // returns the row if it inserted, or null if one already existed (manual or
      // a prior bcra): that way the log reflects what actually happened.
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
