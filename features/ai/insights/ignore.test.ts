import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

import { insightFingerprint } from "./lib/fingerprint";
import { buildResolvePrompt } from "./lib/resolve-prompt";

let roles: Role[] = ["owner"];
let respond: (call: RecordedCall) => {
  data: unknown;
  error: unknown;
} = () => ({
  data: [{ id: "i1", kind: "dup_invoice" }],
  error: null,
});
const fake = recordingSupabase((call) => respond(call));
const logAudit = vi.fn(async () => undefined);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("./analyst", () => ({ regenerateInsights: vi.fn() }));

const { ignoreInsightAction, setInsightStatusAction } =
  await import("./actions");

const ID = "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10";

beforeEach(() => {
  roles = ["owner"];
  fake.calls.length = 0;
  logAudit.mockClear();
});

describe("insightFingerprint", () => {
  it("is stable over the order of the records and differs by kind", () => {
    const a = insightFingerprint("dup_invoice", ["b", "a"]);
    expect(a).toBe(insightFingerprint("dup_invoice", ["a", "b"]));
    expect(a).not.toBe(insightFingerprint("unusual_amount", ["a", "b"]));
    expect(a?.startsWith("dup_invoice:")).toBe(true);
  });

  it("is null for cards that point at no records", () => {
    expect(insightFingerprint("cashflow", [])).toBeNull();
    expect(insightFingerprint("cashflow", { not: "an array" })).toBeNull();
  });
});

describe("ignoreInsightAction", () => {
  it("stores the reason, who and when, and audits it", async () => {
    const res = await ignoreInsightAction({
      id: ID,
      reason: "Son dos entregas.",
    });
    expect(res.ok).toBe(true);
    const update = fake.calls[0];
    expect(update?.payload).toMatchObject({
      status: "dismissed",
      dismissed_reason: "Son dos entregas.",
      dismissed_by: "u1",
    });
    expect(update && filterValue(update, "eq", "id")).toBe(ID);
    expect(logAudit).toHaveBeenCalledWith(
      "ai.insight.ignored",
      "u1",
      { kind: "dup_invoice", reason: "Son dos entregas." },
      "i1",
    );
  });

  it("requires a reason", async () => {
    const res = await ignoreInsightAction({ id: ID, reason: " " });
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("is limited to ai:admin (owner, admin)", async () => {
    for (const role of ["finance", "operations", "warehouse"] as const) {
      roles = [role];
      expect((await ignoreInsightAction({ id: ID, reason: "motivo" })).ok).toBe(
        false,
      );
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("reports an id RLS did not let it update", async () => {
    respond = () => ({ data: [], error: null });
    expect(await ignoreInsightAction({ id: ID, reason: "motivo" })).toEqual({
      ok: false,
      error: "No se encontró el insight.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("no longer dismisses without a reason through the status action", async () => {
    const res = await setInsightStatusAction({
      id: ID,
      status: JSON.parse('"dismissed"'),
    });
    expect(res.ok).toBe(false);
  });
});

describe("buildResolvePrompt", () => {
  it("seeds the chat with the alert, its figures and records", () => {
    const prompt = buildResolvePrompt({
      kind: "dup_invoice",
      severity: "warning",
      title: "Posible duplicado",
      finding: "Dos facturas iguales de Acme.",
      metrics: { amount: 1000, supplier: "Acme", nested: { x: 1 } },
      source_refs: Array.from({ length: 12 }, (_, i) => `id-${i}`),
      generated_at: "2026-10-19T10:00:00Z",
    });
    expect(prompt).toContain("posible factura de proveedor duplicada");
    expect(prompt).toContain("amount=1000");
    expect(prompt).not.toContain("nested");
    expect(prompt).toContain("id-9 y 2 más");
    expect(prompt.length).toBeLessThanOrEqual(3_000);
  });
});
