import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denied: string[] = [];
let tables: Record<string, { data: unknown; error: unknown }> = {};
const rpc = vi.fn();
const audit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));

/** Every query on a table resolves to its canned result; filters are
 *  accepted and ignored, `.range` serves the whole list once. */
function query(table: string) {
  const result = tables[table] ?? { data: [], error: null };
  let ranged = false;
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "not", "gte", "lte", "order"]) {
    builder[m] = () => builder;
  }
  builder.limit = () => builder;
  builder.range = (from: number) => {
    ranged = from > 0;
    return builder;
  };
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(ranged ? { data: [], error: null } : result);
  return builder;
}

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: query, rpc }),
}));

const {
  linkTaxDocumentPaymentAction,
  listPayableTaxDocumentsAction,
  listTaxPaymentCandidatesAction,
} = await import("./tax-payment-link-actions");

const DOC_ID = "00000000-0000-4000-8000-000000000001";
const TX_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  rpc.mockReset();
  audit.mockReset();
  tables = {
    tax_documents: {
      data: {
        id: DOC_ID,
        status: "liquidado",
        amount: "1000.00",
        due_date: "2026-11-18",
      },
      error: null,
    },
    accounts: { data: [{ id: "acc1", name: "Banco Galicia" }], error: null },
    v_transactions_tagged: {
      data: [
        {
          id: "t-far",
          account_id: "acc1",
          transaction_date: "2026-11-18",
          amount: "1500.00",
          description: "Otro",
        },
        {
          id: "t-exact",
          account_id: "acc1",
          transaction_date: "2026-11-20",
          amount: "1000.00",
          description: "AFIP",
        },
        {
          id: "t-other",
          account_id: "inactive",
          transaction_date: "2026-11-18",
          amount: "1000.00",
          description: null,
        },
      ],
      error: null,
    },
  };
});

describe("listTaxPaymentCandidatesAction", () => {
  it("ranks the closest amount first and shows the difference", async () => {
    const res = await listTaxPaymentCandidatesAction({ id: DOC_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual(["t-exact", "t-far"]);
    expect(res.data.items[0]).toMatchObject({
      difference: 0,
      days_from_due: 2,
      account_name: "Banco Galicia",
    });
    expect(res.data.items[1]?.difference).toBe(500);
    expect(res.data.total).toBe(2);
  });

  it("needs taxes:write and transactions:read", async () => {
    roles = ["fiscal_reader"];
    expect((await listTaxPaymentCandidatesAction({ id: DOC_ID })).ok).toBe(
      false,
    );
    roles = ["finance"];
    denied = ["transactions:read"];
    expect((await listTaxPaymentCandidatesAction({ id: DOC_ID })).ok).toBe(
      false,
    );
  });

  it("a paid document has no candidates", async () => {
    tables.tax_documents = {
      data: {
        id: DOC_ID,
        status: "pagado",
        amount: "1000.00",
        due_date: "2026-11-18",
      },
      error: null,
    };
    const res = await listTaxPaymentCandidatesAction({ id: DOC_ID });
    expect(res).toEqual({
      ok: false,
      error: "El impuesto ya está pagado o anulado.",
    });
  });

  it("a failed read is an error, not an empty list", async () => {
    tables.v_transactions_tagged = { data: null, error: { message: "boom" } };
    expect((await listTaxPaymentCandidatesAction({ id: DOC_ID })).ok).toBe(
      false,
    );
  });
});

describe("linkTaxDocumentPaymentAction", () => {
  it("links through link_tax_document_payment and audits", async () => {
    rpc.mockResolvedValue({ data: TX_ID, error: null });
    const res = await linkTaxDocumentPaymentAction({
      id: DOC_ID,
      transaction_id: TX_ID,
    });
    expect(res).toEqual({ ok: true, data: { transactionId: TX_ID } });
    expect(rpc).toHaveBeenCalledWith("link_tax_document_payment", {
      p_tax_document_id: DOC_ID,
      p_transaction_id: TX_ID,
      p_user_id: "u1",
      p_allow_difference: false,
    });
    expect(audit).toHaveBeenCalledWith(
      "tax_document.payment_linked",
      "u1",
      { transaction_id: TX_ID, allow_difference: false },
      DOC_ID,
    );
  });

  it("needs transactions:write as well as taxes:write", async () => {
    denied = ["transactions:write"];
    const res = await linkTaxDocumentPaymentAction({
      id: DOC_ID,
      transaction_id: TX_ID,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a guard's own message and audits nothing", async () => {
    const message =
      "El movimiento es de $ 1.500,00 y el impuesto de $ 1.000,00";
    rpc.mockResolvedValue({
      data: null,
      error: { message, code: "23514", hint: "jouve_guard" },
    });
    const res = await linkTaxDocumentPaymentAction({
      id: DOC_ID,
      transaction_id: TX_ID,
    });
    expect(res).toEqual({ ok: false, error: message });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("listPayableTaxDocumentsAction", () => {
  it("labels the open documents", async () => {
    tables.tax_documents = {
      data: [
        {
          id: DOC_ID,
          kind: "iibb",
          title: null,
          jurisdiction: "Buenos Aires",
          period: "2026-10",
          due_date: "2026-11-15",
          amount: "300.00",
        },
        {
          id: "bad",
          kind: "unknown",
          title: null,
          jurisdiction: null,
          period: "2026-10",
          due_date: "2026-11-15",
          amount: null,
        },
      ],
      error: null,
    };
    const res = await listPayableTaxDocumentsAction();
    expect(res).toEqual({
      ok: true,
      data: [
        {
          id: DOC_ID,
          label: "IIBB (Buenos Aires)",
          period: "2026-10",
          due_date: "2026-11-15",
          amount: 300,
        },
      ],
    });
  });

  it("the accountant cannot pay, so gets no list", async () => {
    roles = ["fiscal_reader"];
    expect((await listPayableTaxDocumentsAction()).ok).toBe(false);
  });
});
