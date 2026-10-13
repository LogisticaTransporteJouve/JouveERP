import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: async () => ({ error: null }) },
  }),
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
