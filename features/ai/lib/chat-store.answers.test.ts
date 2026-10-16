import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Response = { data: unknown; error: unknown };

const filters: [string, string, unknown][] = [];
const responses: Response[] = [];

function builder(): Record<string, unknown> {
  const respond = async () => responses.shift() ?? { data: null, error: null };
  const b: Record<string, unknown> = {
    select: () => b,
    update: () => b,
    order: () => b,
    limit: () => b,
    eq: (col: string, value: unknown) => {
      filters.push([col, "eq", value]);
      return b;
    },
    filter: (col: string, op: string, value: unknown) => {
      filters.push([col, op, value]);
      return b;
    },
    then: (resolve: (r: Response) => unknown) => respond().then(resolve),
  };
  return b;
}

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: () => builder() }),
}));

const { saveAnsweredQuestionCard } = await import("./chat-store");

const message: UIMessage = { id: "m2", role: "assistant", parts: [] };

beforeEach(() => {
  filters.length = 0;
  responses.length = 0;
});

describe("saveAnsweredQuestionCard (compare-and-set)", () => {
  it("updates only while the stored card still waits", async () => {
    responses.push(
      { data: [{ id: "row-2", content: { id: "m2" } }], error: null },
      { data: [{ id: "row-2" }], error: null },
    );
    expect(await saveAnsweredQuestionCard("s1", message, 1)).toBe(true);
    expect(filters).toContainEqual([
      "content->parts->1->>state",
      "eq",
      "input-available",
    ]);
  });

  it("returns false to the second submission: nothing was updated", async () => {
    responses.push(
      { data: [{ id: "row-2", content: { id: "m2" } }], error: null },
      { data: [], error: null },
    );
    expect(await saveAnsweredQuestionCard("s1", message, 1)).toBe(false);
  });

  it("returns false when the card's message is not persisted", async () => {
    responses.push({
      data: [{ id: "row-1", content: { id: "m1" } }],
      error: null,
    });
    expect(await saveAnsweredQuestionCard("s1", message, 1)).toBe(false);
  });
});
