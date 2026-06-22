import { describe, expect, it } from "vitest";

import { AssignSchema, InviteSchema, RoleEnum, SetRolesSchema } from "./schema";

describe("RoleEnum", () => {
  it("acepta un rol válido", () => {
    expect(RoleEnum.safeParse("owner").success).toBe(true);
  });

  it("rechaza un rol inexistente", () => {
    expect(RoleEnum.safeParse("superadmin").success).toBe(false);
    expect(RoleEnum.safeParse("").success).toBe(false);
  });
});

describe("InviteSchema", () => {
  it("acepta email válido con al menos un rol", () => {
    expect(
      InviteSchema.safeParse({
        email: "user@example.com",
        roles: ["finance"],
      }).success,
    ).toBe(true);
  });

  it("rechaza email inválido", () => {
    expect(
      InviteSchema.safeParse({ email: "no-email", roles: ["finance"] }).success,
    ).toBe(false);
  });

  it("rechaza lista de roles vacía", () => {
    expect(
      InviteSchema.safeParse({ email: "user@example.com", roles: [] }).success,
    ).toBe(false);
  });

  it("rechaza un rol no válido en la lista", () => {
    expect(
      InviteSchema.safeParse({
        email: "user@example.com",
        roles: ["finance", "hacker"],
      }).success,
    ).toBe(false);
  });
});

describe("AssignSchema", () => {
  it("acepta userId UUID + roleId válido", () => {
    expect(
      AssignSchema.safeParse({
        userId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        roleId: "admin",
      }).success,
    ).toBe(true);
  });

  it("rechaza userId no UUID", () => {
    expect(
      AssignSchema.safeParse({ userId: "123", roleId: "admin" }).success,
    ).toBe(false);
  });

  it("rechaza roleId inválido", () => {
    expect(
      AssignSchema.safeParse({
        userId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        roleId: "ceo",
      }).success,
    ).toBe(false);
  });
});

describe("SetRolesSchema", () => {
  it("acepta lista vacía (revocar todo)", () => {
    expect(
      SetRolesSchema.safeParse({
        userId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        roles: [],
      }).success,
    ).toBe(true);
  });

  it("rechaza un rol inválido en la lista", () => {
    expect(
      SetRolesSchema.safeParse({
        userId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        roles: ["owner", "nope"],
      }).success,
    ).toBe(false);
  });
});
