import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/db/database.types";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { readMainFiscalChannelId } = await import("./channels");

function client(answer: { data: unknown; error: unknown }) {
  const fake = recordingSupabase(() => answer);
  return {
    fake,
    supabase: fake.client as unknown as SupabaseClient<Database>,
  };
}

describe("readMainFiscalChannelId", () => {
  it("asks for an active fiscal channel of the main app, never a segregated one", async () => {
    const { fake, supabase } = client({
      data: { id: "jouve_fiscal" },
      error: null,
    });
    expect(await readMainFiscalChannelId(supabase)).toEqual({
      ok: true,
      data: "jouve_fiscal",
    });
    expect(fake.calls[0]?.filters).toEqual([
      ["eq", "is_fiscal", true],
      ["eq", "is_active", true],
      ["eq", "is_segregated", false],
    ]);
  });

  it("says when there is none, and when the read fails", async () => {
    expect(
      await readMainFiscalChannelId(
        client({ data: null, error: null }).supabase,
      ),
    ).toEqual({ ok: true, data: null });
    expect(
      (
        await readMainFiscalChannelId(
          client({ data: null, error: { message: "down" } }).supabase,
        )
      ).ok,
    ).toBe(false);
  });
});
