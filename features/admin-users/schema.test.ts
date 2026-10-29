import { describe, expect, it } from "vitest";

import { InviteSchema, RoleEnum, SetAccessSchema } from "./schema";

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

const USER = "00000000-0000-4000-8000-000000000001";

describe("SetAccessSchema", () => {
  it("acepta roles y denegaciones con lo que se cargó", () => {
    expect(
      SetAccessSchema.safeParse({
        userId: USER,
        roles: ["finance"],
        denied: ["accounts:read"],
        expectedRoles: [],
        expectedDenied: [],
      }).success,
    ).toBe(true);
  });

  it("acepta null para dejar una parte sin cambios", () => {
    expect(
      SetAccessSchema.safeParse({
        userId: USER,
        roles: null,
        denied: null,
        expectedRoles: ["finance"],
        expectedDenied: [],
      }).success,
    ).toBe(true);
  });

  it("rechaza un permiso que no está en la matriz", () => {
    expect(
      SetAccessSchema.safeParse({
        userId: USER,
        roles: null,
        denied: ["accounts:delete_everything"],
        expectedRoles: [],
        expectedDenied: [],
      }).success,
    ).toBe(false);
  });

  it("rechaza un userId que no es UUID", () => {
    expect(
      SetAccessSchema.safeParse({
        userId: "abc",
        roles: [],
        denied: null,
        expectedRoles: [],
        expectedDenied: [],
      }).success,
    ).toBe(false);
  });
});
