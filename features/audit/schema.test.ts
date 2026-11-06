import { describe, expect, it } from "vitest";

import { auditActorLabel } from "./lib/actor";
import { isSensitiveKey, MASK, maskSensitive } from "./lib/mask";
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

  it("takes a «Qué» group and a search, and refuses an unknown group", () => {
    expect(
      AuditFiltersSchema.safeParse({ group: "receipts", q: "Transportes Sur" })
        .success,
    ).toBe(true);
    expect(AuditFiltersSchema.safeParse({ group: "nope" }).success).toBe(false);
    expect(AuditFiltersSchema.safeParse({ q: "x".repeat(81) }).success).toBe(
      false,
    );
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

  it("keeps a flag under a secret key: it says a secret changed, not which", () => {
    expect(maskSensitive({ passwordChanged: true, password: "x" })).toEqual({
      passwordChanged: true,
      password: MASK,
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
