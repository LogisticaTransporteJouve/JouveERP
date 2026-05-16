import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// N.4 — Cron anual de balances de vacaciones.
//
// 1° de octubre 00:00 ART. Llama al RPC grant_vacation_balances(year, true)
// para cada empleado activo:
//   - Calcula entitled_days según antigüedad al 31-dic del año
//   - Aplica prorating Art. 153 si tiene <6 meses
//   - Arrastra remaining_days del año anterior si la política está activa
//   - Marca expired las balances con expires_at < hoy
//
// Idempotente: si la balance del (employee, year) ya existe, se saltea.
// Manual trigger disponible via grantVacationBalancesAction (admin only).

export const vacationBalancesGrant = inngest.createFunction(
  {
    id: "vacation-balances-grant",
    name: "HR — grant annual vacation balances",
    retries: 2,
    // Anual: 1 de octubre 00:00 Buenos Aires.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 0 1 10 *" }],
  },
  async ({ step }) => {
    const targetYear = new Date().getFullYear();

    const result = await step.run("grant-balances", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("grant_vacation_balances", {
        p_target_year: targetYear,
        p_carryover: true,
      });
      if (error) throw new Error(`grant-balances: ${error.message}`);
      return data ?? [];
    });

    logger.info("hr.vacation_balances_granted", {
      target_year: targetYear,
      count: result.length,
    });

    return { target_year: targetYear, count: result.length };
  },
);
