import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";
import { pagedSupabase } from "@/tests/helpers/paged-supabase";

let roles: Role[] = ["finance"];
let denied: string[] = [];
let fake = pagedSupabase({});
const rpc = vi.fn();
const ventas = vi.fn();
const compras = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...fake.client, rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/libro-iva/actions/libro-iva-actions", () => ({
  listLibroIvaVentasAction: (...args: unknown[]) => ventas(...args),
  listLibroIvaComprasAction: (...args: unknown[]) => compras(...args),
}));

const {
  getIvaPositionEstimateAction,
  listTaxDocumentsAction,
  payTaxDocumentAction,
} = await import("./tax-documents-actions");

const doc = {
  id: "t1",
  kind: "iva",
  title: null,
  jurisdiction: null,
  period: "2026-10",
  due_date: "2026-11-18",
  amount: "1000.00",
  amount_is_estimate: true,
  status: "liquidado",
  account_id: "a1",
  payment_transaction_id: null,
  payment_origin: null,
  paid_date: null,
  paid_amount: null,
  credit_balance: null,
  notes: null,
  updated_at: "2026-11-01T10:00:00Z",
  account: { code: "2.1.2.1", name: "IVA Débito Fiscal" },
  payment: null,
};

const PAYMENT = {
  id: "00000000-0000-4000-8000-000000000001",
  paid_date: "2026-11-18",
  account_id: "00000000-0000-4000-8000-000000000002",
  amount: 1000,
};

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  fake = pagedSupabase({ tax_documents: [doc] });
  rpc.mockReset();
  ventas.mockReset();
  compras.mockReset();
});

describe("listTaxDocumentsAction", () => {
  it("the accountant reads tax documents, with numeric amounts", async () => {
    roles = ["fiscal_reader"];
    const res = await listTaxDocumentsAction({ year: 2026 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]).toMatchObject({
      amount: 1000,
      account_name: "2.1.2.1 IVA Débito Fiscal",
      paid_from: null,
    });
  });

  it("operations and a per-user deny do not", async () => {
    roles = ["operations"];
    expect((await listTaxDocumentsAction({ year: 2026 })).ok).toBe(false);
    roles = ["finance"];
    denied = ["taxes:read"];
    expect((await listTaxDocumentsAction({ year: 2026 })).ok).toBe(false);
  });

  it("a failed read is an error, not an empty list", async () => {
    fake = pagedSupabase({}, { failOn: "tax_documents" });
    expect((await listTaxDocumentsAction({ year: 2026 })).ok).toBe(false);
  });
});

describe("payTaxDocumentAction", () => {
  it("the accountant cannot pay", async () => {
    roles = ["fiscal_reader"];
    const res = await payTaxDocumentAction(PAYMENT);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pays through pay_tax_document", async () => {
    rpc.mockResolvedValue({ data: "tx1", error: null });
    const res = await payTaxDocumentAction(PAYMENT);
    expect(res).toEqual({ ok: true, data: { transactionId: "tx1" } });
    expect(rpc).toHaveBeenCalledWith("pay_tax_document", {
      p_tax_document_id: PAYMENT.id,
      p_paid_date: PAYMENT.paid_date,
      p_account_id: PAYMENT.account_id,
      p_amount: 1000,
    });
  });

  it("shows a guard's own message", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: "El período contable 2026-11 está cerrado",
        code: "55006",
        hint: "jouve_guard",
      },
    });
    const res = await payTaxDocumentAction(PAYMENT);
    expect(res).toEqual({
      ok: false,
      error: "El período contable 2026-11 está cerrado",
    });
  });
});

describe("getIvaPositionEstimateAction", () => {
  it("débito of the sales book − crédito of the purchases − IVA retentions", async () => {
    ventas.mockResolvedValue({
      ok: true,
      data: [
        {
          invoice_id: "f1",
          kind: "factura",
          iva_rate_id: 5,
          neto: 10000,
          iva: 2100,
          imp_trib: 0,
          imp_op_ex: 0,
          imp_tot_conc: 0,
          imp_total: 12100,
          neto_orig: 10000,
          iva_orig: 2100,
          imp_trib_orig: 0,
          imp_op_ex_orig: 0,
          imp_tot_conc_orig: 0,
          imp_total_orig: 12100,
          cotizacion: 1,
        },
        {
          invoice_id: "nc1",
          kind: "nc",
          iva_rate_id: 5,
          neto: 1000,
          iva: 210,
          imp_trib: 0,
          imp_op_ex: 0,
          imp_tot_conc: 0,
          imp_total: 1210,
          neto_orig: 1000,
          iva_orig: 210,
          imp_trib_orig: 0,
          imp_op_ex_orig: 0,
          imp_tot_conc_orig: 0,
          imp_total_orig: 1210,
          cotizacion: 1,
        },
      ],
    });
    compras.mockResolvedValue({
      ok: true,
      data: [
        {
          purchase_invoice_id: "c1",
          kind: "factura",
          iva_rate_id: 5,
          neto: 5000,
          iva: 1050,
          imp_trib: 0,
          imp_total: 6050,
          neto_orig: 5000,
          iva_orig: 1050,
          imp_trib_orig: 0,
          imp_total_orig: 6050,
          cotizacion: 1,
          ...breakdownCols({}),
        },
      ],
    });
    fake = pagedSupabase({
      tax_documents: [doc],
      receipt_retentions: [{ id: "r1", amount: "40.00" }],
    });
    const res = await getIvaPositionEstimateAction({ period: "2026-10" });
    expect(res).toEqual({
      ok: true,
      data: {
        period: "2026-10",
        debito: 1890,
        credito: 1050,
        retenciones: 40,
        saldo_anterior: 0,
        saldo_anterior_known: true,
        percepciones_compras: 0,
        saldo: 800,
        tributos_compras: 0,
        ventas: 2,
        compras: 1,
      },
    });
  });

  it("subtracts last month's saldo a favor and the purchases' IVA perceptions, and reports the other tributos apart", async () => {
    ventas.mockResolvedValue({ ok: true, data: [] });
    compras.mockResolvedValue({
      ok: true,
      data: [
        {
          purchase_invoice_id: "c1",
          kind: "factura",
          iva_rate_id: 5,
          neto: 5000,
          iva: 1050,
          imp_trib: 75,
          imp_total: 6125,
          neto_orig: 5000,
          iva_orig: 1050,
          imp_trib_orig: 75,
          imp_total_orig: 6125,
          cotizacion: 1,
          ...breakdownCols({ perc_iva: 25, perc_iibb: 50 }),
        },
      ],
    });
    fake = pagedSupabase({
      tax_documents: [
        {
          ...doc,
          period: "2026-09",
          status: "anulado",
          credit_balance: "150.00",
        },
      ],
    });
    const res = await getIvaPositionEstimateAction({ period: "2026-10" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      credito: 1050,
      saldo_anterior: 150,
      saldo_anterior_known: true,
      percepciones_compras: 25,
      saldo: -1225,
      tributos_compras: 50,
    });
  });

  it("without last month's IVA document, the saldo a favor is unknown", async () => {
    ventas.mockResolvedValue({ ok: true, data: [] });
    compras.mockResolvedValue({ ok: true, data: [] });
    fake = pagedSupabase({ tax_documents: [] });
    const res = await getIvaPositionEstimateAction({ period: "2026-10" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      saldo_anterior: 0,
      saldo_anterior_known: false,
    });
  });

  it("a failed read of last month's IVA fails the estimate", async () => {
    ventas.mockResolvedValue({ ok: true, data: [] });
    compras.mockResolvedValue({ ok: true, data: [] });
    fake = pagedSupabase({}, { failOn: "tax_documents" });
    expect((await getIvaPositionEstimateAction({ period: "2026-10" })).ok).toBe(
      false,
    );
  });

  it("a book that cannot be read fails the estimate", async () => {
    ventas.mockResolvedValue({ ok: false, error: "No se pudo leer" });
    compras.mockResolvedValue({ ok: true, data: [] });
    const res = await getIvaPositionEstimateAction({ period: "2026-10" });
    expect(res.ok).toBe(false);
  });

  it("needs taxes:write and the libro IVA", async () => {
    roles = ["fiscal_reader"];
    expect((await getIvaPositionEstimateAction({ period: "2026-10" })).ok).toBe(
      false,
    );
    roles = ["finance"];
    denied = ["accounting:read"];
    expect((await getIvaPositionEstimateAction({ period: "2026-10" })).ok).toBe(
      false,
    );
    expect(ventas).not.toHaveBeenCalled();
  });
});

/** The libro IVA compras breakdown columns, in pesos and in the document's currency. */
function breakdownCols(parts: { perc_iva?: number; perc_iibb?: number }) {
  const b = {
    no_gravado: 0,
    exentas: 0,
    perc_iva: parts.perc_iva ?? 0,
    perc_iibb: parts.perc_iibb ?? 0,
    perc_municipales: 0,
    impuestos_internos: 0,
  };
  return {
    ...b,
    ...Object.fromEntries(Object.entries(b).map(([k, v]) => [`${k}_orig`, v])),
  };
}
