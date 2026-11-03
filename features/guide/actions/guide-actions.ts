"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCanAll } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import { SETUP_ITEMS, type SetupItemKey } from "../lib/setup-checklist";
import { itemState, type GuideState } from "../schema";

type Service = ReturnType<typeof getServiceClient>;
type Probe = PromiseLike<{
  data: readonly unknown[] | null;
  error: { message: string } | null;
}>;

// One cheap read per item: "is there at least one". The service client reads
// past RLS, so each probe runs only for an item the viewer's access shows.
const PROBES: Record<SetupItemKey, (db: Service) => Probe[]> = {
  accounts: (db) => [
    db
      .from("accounts")
      .select("id")
      .eq("is_active", true)
      .in("type", ["bank", "cash", "wallet"])
      .limit(1),
  ],
  afip_points_of_sale: (db) => [
    db
      .from("sales_points")
      .select("numero")
      .eq("is_enabled", true)
      .not("last_synced_at", "is", null)
      .limit(1),
  ],
  imports: (db) => [
    db.from("import_runs").select("id").eq("status", "committed").limit(1),
  ],
  client_tariffs: (db) => [db.from("client_tariffs").select("id").limit(1)],
  opening_balances: (db) => [
    db.from("account_opening_balances").select("account_id").limit(1),
    db.from("client_opening_balances").select("client_id").limit(1),
    db.from("supplier_opening_balances").select("supplier_id").limit(1),
  ],
  initial_adjustment: (db) => [
    db
      .from("journal_entries")
      .select("id")
      .is("source_table", null)
      .eq("is_reversal", false)
      .limit(1),
  ],
  // More than one user with a role: someone besides the first owner.
  users: (db) => [db.from("user_roles").select("user_id").limit(200)],
  taxes: (db) => [db.from("tax_documents").select("id").limit(1)],
};

function probeDone(key: SetupItemKey, rows: readonly unknown[][]): boolean {
  if (key === "users") {
    const ids = new Set(
      (rows[0] ?? []).map((r) =>
        typeof r === "object" && r !== null && "user_id" in r
          ? String(r.user_id)
          : "",
      ),
    );
    return ids.size > 1;
  }
  return rows.some((r) => r.length > 0);
}

/**
 * The sidebar guide's state for the viewer: whether the panel is collapsed
 * and the go-live checklist items their access shows, each marked done from
 * the data or by the user. A probe that fails leaves its item pending.
 */
export async function getGuideAction(): Promise<ActionResult<GuideState>> {
  const ctx = await requireUserContext();

  const supabase = await createClient();
  const { data: state, error: stateError } = await supabase
    .from("user_guide_states")
    .select("collapsed, dismissed_items")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (stateError) {
    logger.error("guide.state.read_failed", {
      userId: ctx.userId,
      error: stateError,
    });
    return { ok: false, error: "No se pudo leer la guía." };
  }
  const dismissed = state?.dismissed_items ?? [];

  const visible = SETUP_ITEMS.filter((item) =>
    userCanAll(ctx.access, item.permission),
  );
  const db = getServiceClient();
  const items = await Promise.all(
    visible.map(async (item) => {
      const results = await Promise.all(PROBES[item.key](db));
      const failed = results.find((r) => r.error);
      if (failed) {
        logger.warn("guide.probe.failed", {
          userId: ctx.userId,
          key: item.key,
          error: failed.error?.message,
        });
      }
      const done =
        !failed &&
        probeDone(
          item.key,
          results.map((r) => [...(r.data ?? [])]),
        );
      return { key: item.key, state: itemState(done, dismissed, item.key) };
    }),
  );

  return { ok: true, data: { collapsed: state?.collapsed ?? false, items } };
}
