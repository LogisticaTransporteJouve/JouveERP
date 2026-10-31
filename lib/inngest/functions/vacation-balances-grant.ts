import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// N.4 — Annual cron for vacation balances.
//
// October 1st 00:00 ART. Calls the RPC grant_vacation_balances(year,
// carryover) for each active employee, with carryover read from
// hr_settings.vacation_carryover (the RPC also checks it):
//   - Computes entitled_days based on tenure as of Dec 31 of the year
//   - Below half the year's working days (art. 151), one day per 20 days of
//     effective work (art. 153); only unjustified absences are not work
//   - Carries over up to a third of the previous period (LCT art. 164) when it
//     is extended or not yet expired, and closes that period
//   - Marks balances with expires_at < today as expired
//
// Idempotent: if the (employee, year) balance already exists, it's skipped.
// Manual trigger available via grantVacationBalancesAction (admin only).

export const vacationBalancesGrant = inngest.createFunction(
  {
    id: "vacation-balances-grant",
    name: "HR — grant annual vacation balances",
    retries: 2,
    // Annual: October 1st 00:00 Buenos Aires.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 0 1 10 *" }],
  },
  async ({ step }) => {
    const targetYear = new Date().getFullYear();

    const result = await step.run("grant-balances", async () => {
      const supabase = getServiceClient();
      const setting = await supabase
        .from("hr_settings")
        .select("value")
        .eq("key", "vacation_carryover")
        .maybeSingle();
      if (setting.error)
        throw new Error(`grant-balances: ${setting.error.message}`);
      const { data, error } = await supabase.rpc("grant_vacation_balances", {
        p_target_year: targetYear,
        p_carryover: setting.data?.value === true,
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
