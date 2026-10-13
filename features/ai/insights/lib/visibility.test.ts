import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";

import { INSIGHT_KIND_PERMISSION, canSeeInsight } from "./visibility";

const FINANCE_KINDS = [
  "cashflow",
  "receivables_risk",
  "dup_invoice",
  "unusual_amount",
];
const FLEET_KINDS = ["fleet_doc_expiry", "trip_margin"];

describe("canSeeInsight", () => {
  it("hides treasury / AR / AP cards from operations", () => {
    for (const kind of FINANCE_KINDS) {
      expect(canSeeInsight(["operations"], kind)).toBe(false);
    }
  });

  it("shows fleet cards to operations, not to finance", () => {
    for (const kind of FLEET_KINDS) {
      expect(canSeeInsight(["operations"], kind)).toBe(true);
      expect(canSeeInsight(["finance"], kind)).toBe(false);
    }
  });

  it("shows finance cards to finance", () => {
    for (const kind of FINANCE_KINDS) {
      expect(canSeeInsight(["finance"], kind)).toBe(true);
    }
  });

  it("shows everything to owner/admin, including unmapped kinds", () => {
    for (const role of ["owner", "admin"] satisfies Role[]) {
      for (const kind of [...FINANCE_KINDS, ...FLEET_KINDS, "future_kind"]) {
        expect(canSeeInsight([role], kind)).toBe(true);
      }
    }
  });

  it("fails closed for unmapped kinds and for roles without ai:read", () => {
    expect(canSeeInsight(["finance"], "future_kind")).toBe(false);
    expect(canSeeInsight(["operations"], "future_kind")).toBe(false);
    expect(canSeeInsight(["warehouse"], "fleet_doc_expiry")).toBe(false);
    expect(canSeeInsight(["driver"], "trip_margin")).toBe(false);
    expect(canSeeInsight([], "cashflow")).toBe(false);
  });
});

describe("ai_insights RLS policy stays in sync with the visibility map", () => {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      "../../../../supabase/migrations/20260705110000_ai_hardening.sql",
    ),
    "utf8",
  );
  const policy = sql.slice(
    sql.indexOf('create policy "ai_insights select"'),
    sql.lastIndexOf("-- 2. ai_usage.kind"),
  );

  it("grants each non-admin role exactly the kinds its permissions allow", () => {
    // Each `kind in (...) and (select public.user_has_role(array['<role>']))`.
    const clause =
      /kind in \(([^)]*)\)\s*and \(select public\.user_has_role\(array\['(\w+)'\]\)\)/g;
    const granted = new Map<string, string[]>();
    for (const m of policy.matchAll(clause)) {
      const kinds = (m[1] ?? "").match(/'(\w+)'/g)?.map((k) => k.slice(1, -1));
      granted.set(m[2] ?? "", kinds ?? []);
    }
    for (const role of ["finance", "operations"] satisfies Role[]) {
      const expected = Object.entries(INSIGHT_KIND_PERMISSION)
        .filter(
          ([, perm]) =>
            ROLE_PERMISSIONS[role].includes(perm) &&
            ROLE_PERMISSIONS[role].includes("ai:read"),
        )
        .map(([kind]) => kind)
        .sort();
      expect((granted.get(role) ?? []).slice().sort()).toEqual(expected);
    }
  });

  it("does not grant operations a blanket read anymore", () => {
    expect(policy).toContain('create policy "ai_insights select"');
    expect(policy).not.toContain(
      "array['owner', 'admin', 'finance', 'operations']",
    );
  });
});
