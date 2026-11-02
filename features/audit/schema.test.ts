import { describe, expect, it } from "vitest";

import { auditActorLabel } from "./lib/actor";
import { isSensitiveKey, MASK, maskSensitive } from "./lib/mask";
import {
  auditModuleLabel,
  auditModuleOf,
  auditModulesOf,
  auditRecordHref,
} from "./lib/modules";
import { summarizeAuditPayload } from "./lib/summary";
import {
  AuditCursorSchema,
  AuditFiltersSchema,
  EMPTY_AUDIT_FILTERS,
} from "./schema";

describe("AuditFiltersSchema", () => {
  it("takes empty filters", () => {
    expect(AuditFiltersSchema.safeParse(EMPTY_AUDIT_FILTERS).success).toBe(
      true,
    );
  });

  it("rejects a range that ends before it starts", () => {
    const res = AuditFiltersSchema.safeParse({
      from: "2026-11-02",
      to: "2026-11-01",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a module or action outside the event-type alphabet", () => {
    expect(AuditFiltersSchema.safeParse({ module: "invoice%" }).success).toBe(
      false,
    );
    expect(
      AuditFiltersSchema.safeParse({ eventType: "a,b.or(x)" }).success,
    ).toBe(false);
  });
});

describe("AuditCursorSchema", () => {
  it("takes a Postgres timestamp and refuses filter syntax", () => {
    const id = "6f1c0c6e-3d0a-4a39-9d36-1b2a1d5c9e11";
    expect(
      AuditCursorSchema.safeParse({ ts: "2026-11-02T10:00:00.123+00:00", id })
        .success,
    ).toBe(true);
    expect(
      AuditCursorSchema.safeParse({ ts: '2026-11-02",id.gt.0', id }).success,
    ).toBe(false);
  });
});

describe("maskSensitive", () => {
  it("masks by key name at any depth and keeps the rest", () => {
    expect(
      maskSensitive({
        cbu: "0170099220000067797370",
        employee: { cuil: "20-12345678-3", legal_name: "Ana" },
        api_key: "sk-123",
        accessToken: "abc",
        tokens_used: 1200,
        items: [{ password: "x" }],
        amount: 10,
      }),
    ).toEqual({
      cbu: `${MASK}7370`,
      employee: { cuil: `${MASK}78-3`, legal_name: "Ana" },
      api_key: MASK,
      accessToken: MASK,
      tokens_used: 1200,
      items: [{ password: MASK }],
      amount: 10,
    });
  });

  it("masks a whole object under a secret key", () => {
    expect(maskSensitive({ credentials: { user: "a", pass: "b" } })).toEqual({
      credentials: MASK,
    });
  });

  it("tells sensitive keys apart by word, not substring", () => {
    expect(isSensitiveKey("idempotency_key")).toBe(true);
    expect(isSensitiveKey("signing-key")).toBe(true);
    expect(isSensitiveKey("monkey")).toBe(false);
    expect(isSensitiveKey("tokens_used")).toBe(false);
  });
});

describe("summarizeAuditPayload", () => {
  it("lists the fields a before/after pair changed", () => {
    expect(
      summarizeAuditPayload({
        before: { amount: 10, note: "a" },
        after: { amount: 12, note: "a" },
      }),
    ).toBe("amount: 10 → 12");
  });

  it("reads a from/to pair", () => {
    expect(summarizeAuditPayload({ from: 100, to: 150 })).toBe("100 → 150");
  });

  it("falls back to the first scalar fields and to null", () => {
    expect(summarizeAuditPayload({ period: "2026-10", nested: { a: 1 } })).toBe(
      "period: 2026-10",
    );
    expect(summarizeAuditPayload({})).toBeNull();
    expect(summarizeAuditPayload(null)).toBeNull();
  });
});

describe("audit modules", () => {
  it("takes the event type's first word", () => {
    expect(auditModuleOf("invoice.cancelled")).toBe("invoice");
    expect(auditModuleOf("account.opening_balance.applied")).toBe("account");
    expect(auditModuleLabel("invoice")).toBe("Comprobantes");
    expect(auditModuleLabel("unknown_thing")).toBe("unknown_thing");
  });

  it("links a record to its detail page or module list", () => {
    expect(auditRecordHref("invoice.cancelled", "i1")).toBe("/invoices/i1");
    expect(auditRecordHref("transaction.deleted", "t1")).toBe("/transactions");
    expect(auditRecordHref("ai.tool_call", "x")).toBeNull();
    expect(auditRecordHref("invoice.cancelled", null)).toBeNull();
  });

  it("lists distinct modules sorted by label", () => {
    expect(
      auditModulesOf(["trip.deleted", "client.created", "client.updated"]),
    ).toEqual([
      { id: "client", label: "Clientes" },
      { id: "trip", label: "Viajes" },
    ]);
  });
});

describe("auditActorLabel", () => {
  const names = new Map([["u1", "Ana Pérez"]]);

  it("names the user, the assistant with its user, or the system", () => {
    expect(auditActorLabel({ actor_id: "u1", actor_type: "user" }, names)).toBe(
      "Ana Pérez",
    );
    expect(
      auditActorLabel({ actor_id: "u1", actor_type: "ai-agent" }, names),
    ).toBe("Asistente IA (por Ana Pérez)");
    expect(
      auditActorLabel({ actor_id: null, actor_type: "system" }, names),
    ).toBe("Sistema");
    expect(
      auditActorLabel({ actor_id: "gone", actor_type: "user" }, names),
    ).toBe("Usuario eliminado");
  });
});
