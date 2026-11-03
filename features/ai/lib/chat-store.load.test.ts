import { describe, expect, it, vi } from "vitest";

const rows = [
  {
    content: {
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "¿Cuánto me debe Acme?" }],
    },
  },
  { content: { id: "m2", role: "not-a-role", parts: "broken" } },
  {
    content: {
      id: "m3",
      role: "assistant",
      parts: [{ type: "text", text: "Te debe $1.000." }],
    },
  },
];

vi.mock("@/lib/supabase/service", () => {
  const sessions = {
    select: () => sessions,
    eq: () => sessions,
    maybeSingle: async () => ({ data: { user_id: "u1" }, error: null }),
  };
  const messages = {
    select: () => messages,
    eq: () => messages,
    order: async () => ({ data: rows, error: null }),
  };
  return {
    getServiceClient: () => ({
      from: (table: string) =>
        table === "ai_chat_sessions" ? sessions : messages,
    }),
  };
});

const { loadAiSessionMessages } = await import("./chat-store");

describe("loadAiSessionMessages", () => {
  it("drops only the corrupt message instead of the whole history", async () => {
    const messages = await loadAiSessionMessages("u1", "s1");
    expect(messages.map((m) => m.id)).toEqual(["m1", "m3"]);
  });
});
