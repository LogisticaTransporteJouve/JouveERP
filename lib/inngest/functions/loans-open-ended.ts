import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily: every active open-ended loan keeps 3 upcoming interest cuotas
// (extend_open_ended_loan, idempotent: a second run inserts nothing). One
// step per loan, so a loan that fails is retried on its own and does not
// sink the others.
export const loansOpenEndedExtend = inngest.createFunction(
  {
    id: "loans-open-ended-extend",
    name: "Préstamos sin vencimiento — próximas cuotas de interés",
    retries: 2,
    // 05:23 Argentina: off the hour, before the working day.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 23 5 * * *" }],
  },
  async ({ step }) => {
    const loanIds = await step.run("list-loans", async () => {
      const { data, error } = await getServiceClient()
        .from("loans")
        .select("id")
        .eq("is_open_ended", true)
        .eq("status", "active")
        .order("id")
        .limit(1000);
      if (error) throw new Error(`list open-ended loans: ${error.message}`);
      return data.map((l) => l.id);
    });

    let inserted = 0;
    const failed: string[] = [];
    for (const loanId of loanIds) {
      try {
        inserted += await step.run(`extend-${loanId}`, async () => {
          const { data, error } = await getServiceClient().rpc(
            "extend_open_ended_loan",
            { p_loan_id: loanId },
          );
          if (error) {
            throw new Error(`extend_open_ended_loan: ${error.message}`);
          }
          return data;
        });
      } catch (error) {
        failed.push(loanId);
        logger.error("loans_open_ended.extend_failed", { loanId, error });
      }
    }
    logger.info("loans_open_ended.ok", {
      loans: loanIds.length,
      inserted,
      failed: failed.length,
    });
    return { loans: loanIds.length, inserted, failed };
  },
);
