import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

const issueLateInterestNd = vi.fn();
let roles: Role[] = ["owner"];

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/commands/issue-late-interest-nd", () => ({
  issueLateInterestNd,
}));

const { issueLateInterestNdsBulkAction } =
  await import("./late-interest-actions");

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  roles = ["owner"];
  issueLateInterestNd.mockReset();
});

describe("issueLateInterestNdsBulkAction", () => {
  it("issues one ND per comprobante and keeps going after a failure", async () => {
    issueLateInterestNd
      .mockResolvedValueOnce({ ok: false, error: "AFIP caído" })
      .mockResolvedValueOnce({ ok: true, data: { invoiceId: "nd2" } });
    const res = await issueLateInterestNdsBulkAction({
      as_of: "2026-10-31",
      items: [
        { invoice_id: A, monthly_rate: 3, punto_venta: 2 },
        { invoice_id: B, monthly_rate: 2.5, punto_venta: 4 },
      ],
    });
    expect(res).toEqual({
      ok: true,
      data: [
        { invoice_id: A, ok: false, error: "AFIP caído" },
        { invoice_id: B, ok: true, nd_invoice_id: "nd2" },
      ],
    });
    expect(issueLateInterestNd.mock.calls[1]?.[1]).toEqual({
      invoice_id: B,
      monthly_rate: 2.5,
      punto_venta: 4,
      as_of: "2026-10-31",
    });
  });

  it("refuses a repeated comprobante and needs both permissions", async () => {
    const twice = await issueLateInterestNdsBulkAction({
      as_of: "2026-10-31",
      items: [
        { invoice_id: A, monthly_rate: 3, punto_venta: 2 },
        { invoice_id: A, monthly_rate: 3, punto_venta: 2 },
      ],
    });
    expect(twice.ok).toBe(false);
    roles = ["operations"];
    const denied = await issueLateInterestNdsBulkAction({
      as_of: "2026-10-31",
      items: [{ invoice_id: A, monthly_rate: 3, punto_venta: 2 }],
    });
    expect(denied.ok).toBe(false);
    expect(issueLateInterestNd).not.toHaveBeenCalled();
  });
});
