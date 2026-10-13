import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ROLES,
  ROLE_PERMISSIONS,
  type Permission,
} from "@/lib/auth/permissions";

// Static check over supabase/migrations: the LATEST definition of each money
// RPC exposed to `authenticated` must reject callers whose roles lack the
// matching write permission. Without it a direct POST /rest/v1/rpc/<fn> skips
// the server action's userCan() gate.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));

const ALL_SQL = MIGRATIONS.join("\n");

function latestDefinition(fn: string): string {
  const header = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(`,
    "gi",
  );
  let lastStart = -1;
  for (const match of ALL_SQL.matchAll(header)) {
    lastStart = match.index ?? -1;
  }
  if (lastStart < 0) throw new Error(`No definition found for ${fn}`);
  const open = ALL_SQL.indexOf("$$", lastStart);
  const close = ALL_SQL.indexOf("$$", open + 2);
  return ALL_SQL.slice(lastStart, close + 2);
}

function lastStatement(pattern: RegExp): string | null {
  let last: string | null = null;
  for (const match of ALL_SQL.matchAll(pattern)) last = match[0];
  return last;
}

function holders(permission: Permission): string[] {
  return ROLES.filter((role) =>
    ROLE_PERMISSIONS[role].includes(permission),
  ).sort();
}

function guardedRoles(definition: string): string[] | null {
  const guard =
    /if\s+coalesce\(auth\.jwt\(\)\s*->>\s*'role',\s*''\)\s*<>\s*'service_role'\s+and\s+not\s+public\.user_has_role\(array\[([^\]]*)\]\)\s+then\s+raise\s+exception\s+'[^']*'\s+using\s+errcode\s*=\s*'42501';/i.exec(
      definition,
    );
  if (!guard?.[1]) return null;
  return guard[1]
    .split(",")
    .map((r) => r.trim().replace(/'/g, ""))
    .sort();
}

const MONEY_RPCS: Array<{ fn: string; permission: Permission }> = [
  { fn: "create_receipt", permission: "receipts:write" },
  { fn: "update_receipt", permission: "receipts:write" },
  { fn: "create_payment_order", permission: "payment_orders:write" },
  { fn: "update_payment_order", permission: "payment_orders:write" },
  { fn: "deposit_check", permission: "cheques:write" },
  { fn: "credit_check", permission: "cheques:write" },
  { fn: "reject_check", permission: "cheques:write" },
  { fn: "create_transfer", permission: "transactions:write" },
  {
    fn: "replace_purchase_invoice_items",
    permission: "purchase_invoices:write",
  },
];

describe("money RPC role guards", () => {
  it.each(MONEY_RPCS)(
    "$fn rejects roles without $permission (42501) and lets service_role through",
    ({ fn, permission }) => {
      const definition = latestDefinition(fn);
      expect(guardedRoles(definition)).toEqual(holders(permission));
      expect(definition).toMatch(/set\s+search_path\s*=/i);
    },
  );

  it.each(MONEY_RPCS)("$fn is not executable by anon", ({ fn }) => {
    const revoke = lastStatement(
      new RegExp(`revoke all on function public\\.${fn}\\([^;]*;`, "gi"),
    );
    expect(revoke).toMatch(/from public, anon, authenticated;$/);
  });
});

describe("bootstrap_first_owner", () => {
  const definition = latestDefinition("bootstrap_first_owner");

  it("is serialized with an advisory lock before checking for owners", () => {
    const lock = definition.indexOf("pg_advisory_xact_lock");
    const check = definition.indexOf("role_id = 'owner'");
    expect(lock).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(lock);
  });

  it("is executable only by service_role", () => {
    expect(definition).toMatch(/<>\s*'service_role'\s+then\s+raise/i);
    expect(ALL_SQL).toMatch(
      /revoke all on function public\.bootstrap_first_owner\(uuid\) from public, anon, authenticated;\s*grant execute on function public\.bootstrap_first_owner\(uuid\) to service_role;/,
    );
  });
});
