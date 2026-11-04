import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signInError: null as { message: string } | null,
  warn: vi.fn(),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: async () => ({ error: h.signInError }) },
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: h.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { signInWithEmail } = await import("./actions");

async function landingFor(redirectTo: string | null): Promise<string> {
  const form = new FormData();
  form.set("email", "user@example.com");
  form.set("password", "secret");
  if (redirectTo !== null) form.set("redirectTo", redirectTo);
  await expect(signInWithEmail({ error: null }, form)).rejects.toThrow(
    "NEXT_REDIRECT",
  );
  const [target] = redirect.mock.calls[0] ?? [];
  return target ?? "";
}

beforeEach(() => {
  redirect.mockClear();
  h.warn.mockClear();
  h.signInError = null;
});

describe("signInWithEmail redirect target", () => {
  it("honours a same-origin path", async () => {
    expect(await landingFor("/invoices?tab=draft")).toBe("/invoices?tab=draft");
  });

  it("defaults to /dashboard when no target is given", async () => {
    expect(await landingFor(null)).toBe("/dashboard");
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "/\t/evil.com"])(
    "ignores the off-site target %j",
    async (target) => {
      expect(await landingFor(target)).toBe("/dashboard");
    },
  );
});

describe("signInWithEmail failure", () => {
  it("logs the email domain, not the typed address", async () => {
    h.signInError = { message: "Invalid login credentials" };
    const form = new FormData();
    form.set("email", "someone@example.com");
    form.set("password", "wrong");
    expect(await signInWithEmail({ error: null }, form)).toEqual({
      error: "Credenciales inválidas.",
    });
    expect(h.warn).toHaveBeenCalledWith("login.failure", {
      emailDomain: "example.com",
      reason: "Invalid login credentials",
    });
    expect(JSON.stringify(h.warn.mock.calls)).not.toContain("someone");
  });
});
