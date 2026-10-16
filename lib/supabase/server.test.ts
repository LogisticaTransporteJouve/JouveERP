import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClient = vi.fn<(...args: unknown[]) => object>(() => ({}));
const cookies = vi.fn(async () => ({ getAll: () => [], set: () => {} }));

vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("next/headers", () => ({ cookies }));

const { createClient } = await import("./server");
const { runAsUser } = await import("@/lib/auth/acting-user");

beforeEach(() => {
  createServerClient.mockClear();
  cookies.mockClear();
});

describe("createClient", () => {
  it("uses the request cookies by default", async () => {
    await createClient();
    expect(cookies).toHaveBeenCalledOnce();
    const options = createServerClient.mock.calls[0]?.[2];
    expect(options).not.toHaveProperty("global");
  });

  it("sends the acting user's token and never reads cookies inside a background job", async () => {
    await runAsUser({ userId: "u1", email: "", accessToken: "tok" }, () =>
      createClient(),
    );
    expect(cookies).not.toHaveBeenCalled();
    expect(createServerClient.mock.calls[0]?.[2]).toMatchObject({
      global: { headers: { Authorization: "Bearer tok" } },
    });
  });
});
