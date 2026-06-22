import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// N.4 — Annual cron for vacation balances.
//
// October 1st 00:00 ART. Calls the RPC grant_vacation_balances(year, true)
// for each active employee:
//   - Computes entitled_days based on tenure as of Dec 31 of the year
//   - Applies Art. 153 prorating if tenure is under 6 months
//   - Carries over remaining_days from the previous year if the policy is active
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
