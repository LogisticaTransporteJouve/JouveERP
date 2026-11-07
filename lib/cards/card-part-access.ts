import "server-only";

import type { Access } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { getServiceClient } from "@/lib/supabase/service";

import { cardPartDenied } from "./card-permissions";

/** cardPartDenied over a part (pesos or dollars) of a stored statement, for
 *  paying it and for undoing it. `taxRoles` are the system roles of the
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
  const [lines, taxes] = await Promise.all([
    service
      .from("card_statement_lines")
      .select("treatment, chart_account_id")
      .eq("statement_id", part.statement_id)
      .eq("currency", part.currency),
    service
      .from("chart_of_accounts")
      .select("id")
      .in("system_role", [...taxRoles]),
  ]);
  if (lines.error || taxes.error) {
    logger.error("cards.part_access.read_failed", {
      userId,
      statementId: part.statement_id,
      error: lines.error ?? taxes.error,
    });
    return { ok: false };
  }
  return {
    ok: true,
    denied: cardPartDenied(
      access,
      lines.data,
      new Set(taxes.data.map((t) => t.id)),
    ),
  };
}
