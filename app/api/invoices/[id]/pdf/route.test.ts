import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, resolveAccess } from "@/lib/auth/permissions";

const h = vi.hoisted(() => ({
  access: null as Access | null,
  visible: null as { id: string } | null,
  generate: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: h.visible, error: null }),
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/pdf/generate-and-hash", () => ({
  generateInvoicePdfBuffer: h.generate,
}));

const { GET } = await import("./route");

const ID = "11111111-1111-4111-8111-111111111111";
const call = () =>
  GET(new Request("http://x"), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  h.generate.mockReset();
  h.generate.mockResolvedValue({
    pdfBuffer: Buffer.from("%PDF"),
    pdfHash: "h",
  });
  h.visible = null;
});

describe("GET /api/invoices/[id]/pdf", () => {
  it("a fiscal_reader gets 404 for an invoice RLS hides, without rendering", async () => {
    h.access = resolveAccess(["fiscal_reader"]);
    const res = await call();
    expect(res.status).toBe(404);
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("a fiscal_reader gets the PDF of an invoice RLS shows", async () => {
    h.access = resolveAccess(["fiscal_reader"]);
    h.visible = { id: ID };
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.generate).toHaveBeenCalledWith(ID);
  });

  it("finance skips the RLS probe", async () => {
    h.access = resolveAccess(["finance"]);
    const res = await call();
    expect(res.status).toBe(200);
  });
});
