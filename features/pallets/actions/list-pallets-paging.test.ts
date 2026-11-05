import { describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { FAKE_MAX_ROWS, pagedSupabase } from "@/tests/helpers/paged-supabase";

// «Pallets» lists every pallet, not only the newest page PostgREST serves:
// the pallets stored longest are the last rows of the list.

const pallets = Array.from({ length: FAKE_MAX_ROWS + 250 }, (_, i) => ({
  id: `p${i}`,
  status: "en_deposito",
  quantity: "1",
}));
const fake = pagedSupabase({ pallets });

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["warehouse"], []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { listPalletsAction } = await import("./pallets-actions");

describe("listPalletsAction", () => {
  it("reads past the PostgREST row cap", async () => {
    const res = await listPalletsAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(pallets.length);
    expect(res.data.at(-1)?.id).toBe(`p${pallets.length - 1}`);
  });
});
