import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_KIND_BY_TARGET,
  ATTACHMENT_TARGET_TYPES,
  AttachmentTargetSchema,
} from "./schema";

describe("AttachmentTargetSchema", () => {
  it("acepta target válido", () => {
    expect(
      AttachmentTargetSchema.safeParse({
        targetType: "invoice",
        targetId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }).success,
    ).toBe(true);
  });

  it("rechaza targetType desconocido", () => {
    expect(
      AttachmentTargetSchema.safeParse({
        targetType: "foo",
        targetId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }).success,
    ).toBe(false);
  });

  it("rechaza targetId no-UUID", () => {
    expect(
      AttachmentTargetSchema.safeParse({
        targetType: "invoice",
        targetId: "not-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("ATTACHMENT_KIND_BY_TARGET", () => {
  it("cubre todos los target types", () => {
    for (const t of ATTACHMENT_TARGET_TYPES) {
      expect(ATTACHMENT_KIND_BY_TARGET[t]).toBeDefined();
      expect(ATTACHMENT_KIND_BY_TARGET[t].length).toBeGreaterThan(0);
    }
  });
});
