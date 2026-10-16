import { describe, expect, it } from "vitest";

import { ROLES } from "@/lib/auth/permissions";

import {
  HUB_ENTITY_TYPES,
  buildHubOrFilter,
  containsPattern,
  hubEntityHref,
  hubScope,
  nextIsoDay,
} from "./hub";

describe("hubScope", () => {
  it("owner and admin see every origin, including others' AI files", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(hubScope([role])).toEqual({
        entityTypes: [...HUB_ENTITY_TYPES],
        ownOnly: false,
      });
    }
  });

  it("finance sees money documents, HR documents and only its own AI files", () => {
    const scope = hubScope(["finance"]);
    expect(scope.entityTypes).toEqual([
      "purchase_invoice",
      "invoice",
      "receipt",
      "payment_order",
      "check",
      "issued_check",
      "client",
      "supplier",
      "transaction",
      "ai_document",
      "ai_chat_message",
      "employee_document",
    ]);
    expect(scope.ownOnly).toBe(true);
  });

  it("operations never sees HR documents nor finance attachments", () => {
    const scope = hubScope(["operations"]);
    expect(scope.entityTypes).toEqual([
      "client",
      "supplier",
      "ai_document",
      "ai_chat_message",
    ]);
    expect(scope.entityTypes).not.toContain("employee_document");
    expect(scope.entityTypes).not.toContain("purchase_invoice");
    expect(scope.ownOnly).toBe(true);
  });

  it("warehouse and driver list nothing", () => {
    expect(hubScope(["warehouse"])).toEqual({
      entityTypes: [],
      ownOnly: false,
    });
    expect(hubScope(["driver"])).toEqual({ entityTypes: [], ownOnly: false });
    expect(hubScope([])).toEqual({ entityTypes: [], ownOnly: false });
  });

  it("a type is never listed without its owning entity's read permission", () => {
    for (const role of ROLES) {
      const { entityTypes } = hubScope([role]);
      if (entityTypes.includes("employee_document")) {
        expect(["owner", "admin", "finance"]).toContain(role);
      }
    }
  });
});

describe("buildHubOrFilter", () => {
  const cursor = {
    uploadedAt: "2026-10-16T12:00:00.123456+00:00",
    linkId: "11111111-1111-4111-8111-111111111111",
  };

  it("restricts owned rows to the caller", () => {
    expect(buildHubOrFilter({ ownerId: "u1", cursor: null })).toBe(
      "owner_id.is.null,owner_id.eq.u1",
    );
  });

  it("pages by (uploaded_at, link_id) descending", () => {
    expect(buildHubOrFilter({ ownerId: null, cursor })).toBe(
      'uploaded_at.lt."2026-10-16T12:00:00.123456+00:00",and(uploaded_at.eq."2026-10-16T12:00:00.123456+00:00",link_id.lt.11111111-1111-4111-8111-111111111111)',
    );
  });

  it("combines both in one logic tree", () => {
    const both = buildHubOrFilter({ ownerId: "u1", cursor });
    expect(
      both?.startsWith("and(or(owner_id.is.null,owner_id.eq.u1),or("),
    ).toBe(true);
    expect(buildHubOrFilter({ ownerId: null, cursor: null })).toBeNull();
  });
});

describe("helpers", () => {
  it("escapes LIKE wildcards in a search", () => {
    expect(containsPattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
    expect(containsPattern("a*b")).toBe("%a_b%");
  });

  it("computes the exclusive day bound across months", () => {
    expect(nextIsoDay("2026-02-28")).toBe("2026-03-01");
    expect(nextIsoDay("2026-12-31")).toBe("2027-01-01");
  });

  it("links each origin to its page", () => {
    const id = "e1";
    expect(
      hubEntityHref({
        entityType: "purchase_invoice",
        entityId: id,
        parentId: null,
      }),
    ).toBe("/purchases/e1");
    expect(
      hubEntityHref({
        entityType: "ai_chat_message",
        entityId: id,
        parentId: "s1",
      }),
    ).toBe("/ai?session=s1");
    expect(
      hubEntityHref({
        entityType: "employee_document",
        entityId: id,
        parentId: "emp",
      }),
    ).toBe("/employees/emp");
  });
});
