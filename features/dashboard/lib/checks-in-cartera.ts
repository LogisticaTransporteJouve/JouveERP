import { formatMoneyWithCode } from "@/lib/format";

import type { DashboardTreasuryKpis } from "../schema";

/** The ARS and USD check carteras, each in its own currency (never summed). */
export function checksInCartera(
  treasury: Pick<DashboardTreasuryKpis, "checks_now" | "checks_usd_now">,
): string {
  return [
    treasury.checks_now > 0 && formatMoneyWithCode(treasury.checks_now, "ARS"),
    treasury.checks_usd_now > 0 &&
      formatMoneyWithCode(treasury.checks_usd_now, "USD"),
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" · ");
}
