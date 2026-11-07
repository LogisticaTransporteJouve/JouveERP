import "server-only";

import type { Access } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { getServiceClient } from "@/lib/supabase/service";

import { cardPartDenied } from "./card-permissions";

/** cardPartDenied over a part (pesos or dollars) of a stored statement, for
 *  paying it and for undoing it: whether it has an advance and whether it
 *  has a tax line, each read as one row so no line is cut off. `taxRoles` are the system roles of the
 *  accounts that need Impuestos' write. */
export async function readCardPartDenied(
  service: ReturnType<typeof getServiceClient>,
  access: Access,
  part: { statement_id: string; currency: "ARS" | "USD" },
  taxRoles: readonly NonNullable<
    Database["public"]["Tables"]["chart_of_accounts"]["Row"]["system_role"]
  >[],
  userId: string,
): Promise<{ ok: true; denied: string | null } | { ok: false }> {
  const taxes = await service
    .from("chart_of_accounts")
    .select("id")
    .in("system_role", [...taxRoles]);
  const lines = (filter: "advance" | "tax") => {
    const q = service
      .from("card_statement_lines")
      .select("treatment, chart_account_id")
      .eq("statement_id", part.statement_id)
      .eq("currency", part.currency);
    return (
      filter === "advance"
        ? q.eq("treatment", "advance")
        : q.in(
            "chart_account_id",
            (taxes.data ?? []).map((t) => t.id),
          )
    ).limit(1);
  };
  const [advance, tax] = taxes.error
    ? [null, null]
    : await Promise.all([lines("advance"), lines("tax")]);
  const error = taxes.error ?? advance?.error ?? tax?.error;
  if (error || !advance || !tax) {
    logger.error("cards.part_access.read_failed", {
      userId,
      statementId: part.statement_id,
      error,
    });
    return { ok: false };
  }
  return {
    ok: true,
    denied: cardPartDenied(
      access,
      [...(advance.data ?? []), ...(tax.data ?? [])],
      new Set((taxes.data ?? []).map((t) => t.id)),
    ),
  };
}
