import { ensureCaea } from "@/lib/afip/caea";
import { nextQuincena, quincenaOf } from "@/lib/afip/caea-periods";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";

import { inngest } from "../client";

// Requests the CAEA ahead of each fortnight so a code is always on hand when
// AFIP goes down. AFIP's window opens 5 calendar days before the quincena
// starts (validation 15006), so:
//   - day 11 → requests orden 2 of the current month (starts the 16th)
//   - day 26 → requests orden 1 of the next month (starts the 1st)
// It also backfills the CURRENT quincena (its window stays open until its
// last day) in case the previous run failed or the feature just shipped.
// Requires >= 1 CAEA "Contingencias" POS registered in ARCA's ABM (15003).

export const caeaRequest = inngest.createFunction(
  {
    id: "caea-request",
    name: "CAEA — solicitar código de la quincena",
    retries: 3,
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 9 11,26 * *" }],
  },
  async ({ step }) => {
    const today = todayInAR();
    const current = quincenaOf(today);
    const next = nextQuincena(current);

    const currentResult = await step.run("ensure-current", async () => {
      try {
        const row = await ensureCaea(current);
        return { ok: true as const, caea: row.caea };
      } catch (err) {
        // The current quincena may legitimately fail (e.g. it was never
        // requested and the window is odd) — the NEXT one is the real goal.
        logger.warn("caea.request.current_failed", {
          periodo: current.periodo,
          orden: current.orden,
          err: err instanceof Error ? err.message : String(err),
        });
        return { ok: false as const };
      }
    });

    const nextRow = await step.run("ensure-next", async () => {
      const row = await ensureCaea(next);
      return { caea: row.caea, tope: row.fch_tope_inf };
    });

    return { current: currentResult, next: nextRow };
  },
);
