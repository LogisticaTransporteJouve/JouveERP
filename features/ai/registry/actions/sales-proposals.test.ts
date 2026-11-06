import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const searchClientsAction = vi.fn();
const findClientByCuitAction = vi.fn();
const getClientByIdAction = vi.fn();
const listInvoicingChannelsAction = vi.fn();
const listEnabledPosAction = vi.fn();
const getInvoiceDetailAction = vi.fn();
const getInvoiceEmailDefaultsAction = vi.fn();
const issueComprobante = vi.fn();
const createClientRecord = vi.fn();
const updateClientRecord = vi.fn();
const sendInvoiceEmail = vi.fn();

vi.mock("@/features/clients/actions/clients-actions", () => ({
  searchClientsAction,
  findClientByCuitAction,
  getClientByIdAction,
}));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  listInvoicingChannelsAction,
  listEnabledPosAction,
  getInvoiceDetailAction,
}));
vi.mock("@/features/invoices/actions/send-invoice-email", () => ({
  getInvoiceEmailDefaultsAction,
}));
vi.mock("@/lib/commands/issue-comprobante", () => ({ issueComprobante }));
vi.mock("@/lib/commands/save-client", () => ({
  CLIENT_NOT_FOUND: "No se encontró el cliente. Actualizá la página.",
  createClientRecord,
  updateClientRecord,
}));
vi.mock("@/lib/commands/send-invoice-email", () => ({ sendInvoiceEmail }));

const {
  proposeClient,
  proposeClientUpdate,
  proposeCreditDebitNote,
  proposeInvoice,
  proposeInvoiceEmail,
} = await import("./sales-proposals");

const ctx = { userId: "u1", access: resolveAccess(["owner"]) };
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";
const CUIT = "30714637432";

const acme = {
  id: CLIENT_ID,
  cuit: CUIT,
  legal_name: "Acme SA",
  display_name: null,
  iva_condition: "responsable_inscripto",
  is_fiscal: true,
  email: "pagos@acme.com",
  phone: null,
  address: "Calle 1",
  real_address: null,
  notes: null,
  is_active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  searchClientsAction.mockResolvedValue({
    ok: true,
    data: { clients: [acme], nextOffset: null },
  });
  getClientByIdAction.mockResolvedValue({ ok: true, data: acme });
  findClientByCuitAction.mockResolvedValue({ ok: true, data: null });
  listInvoicingChannelsAction.mockResolvedValue({
    ok: true,
    data: [
      { id: "jouve_fiscal", name: "Jouve fiscal", is_fiscal: true },
      { id: "jouve_internal", name: "Jouve interno", is_fiscal: false },
    ],
  });
  listEnabledPosAction.mockResolvedValue({
    ok: true,
    data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
  });
});

describe("proposeClient", () => {
  it("a CUIT means a Ventas client; without the IVA condition it asks", async () => {
    const prepared = await proposeClient.proposal?.prepareDraft(ctx, {
      legal_name: "Nuevo SA",
      cuit: CUIT,
    });
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.issues[0]?.field).toBe("iva_condition");
    expect(prepared.candidates?.[0]?.options.length).toBe(5);
  });

  it("refuses a CUIT another client already has", async () => {
    findClientByCuitAction.mockResolvedValue({ ok: true, data: acme });
    const prepared = await proposeClient.proposal?.prepareDraft(ctx, {
      legal_name: "Nuevo SA",
      cuit: CUIT,
      iva_condition: "monotributo",
    });
    expect(prepared).toEqual({
      kind: "error",
      error: "Ya existe un cliente con ese CUIT: Acme SA.",
    });
  });

  it("asks the side when there is no CUIT, and drafts an Otras ventas client", async () => {
    const asked = await proposeClient.proposal?.prepareDraft(ctx, {
      legal_name: "Juan Pérez",
    });
    expect(asked?.kind).toBe("issues");
    const prepared = await proposeClient.proposal?.prepareDraft(ctx, {
      legal_name: "Juan Pérez",
      side: "otras_ventas",
      phone: "11 5555-5555",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      is_fiscal: false,
      legal_name: "Juan Pérez",
      phone: "11 5555-5555",
    });
    expect(prepared.draft).not.toHaveProperty("cuit");
  });
});

describe("proposeClientUpdate", () => {
  it("keeps the whole ficha and shows only what changes", async () => {
    const prepared = await proposeClientUpdate.proposal?.prepareDraft(ctx, {
      client: "acme",
      email: "cobranzas@acme.com",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      id: CLIENT_ID,
      legal_name: "Acme SA",
      cuit: CUIT,
      email: "cobranzas@acme.com",
    });
    expect(
      prepared.summary.filter((r) => r.value.includes("→")).map((r) => r.value),
    ).toEqual(["pagos@acme.com → cobranzas@acme.com"]);
  });

  it("does not save over a change someone made after the card", async () => {
    const prepared = await proposeClientUpdate.proposal?.prepareDraft(ctx, {
      client: "acme",
      email: "cobranzas@acme.com",
    });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    getClientByIdAction.mockResolvedValue({
      ok: true,
      data: { ...acme, phone: "4444-4444" },
    });
    const res = await proposeClientUpdate.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res?.ok).toBe(false);
    expect(updateClientRecord).not.toHaveBeenCalled();
  });

  it("an Otras ventas client gets no fiscal fields", async () => {
    const prepared = await proposeClientUpdate.proposal?.prepareDraft(ctx, {
      client: "acme",
      cuit: CUIT,
    });
    expect(prepared?.kind).toBe("draft");
    const internal = {
      ...acme,
      is_fiscal: false,
      cuit: null,
      iva_condition: null,
      address: null,
    };
    searchClientsAction.mockResolvedValue({
      ok: true,
      data: { clients: [internal], nextOffset: null },
    });
    const refused = await proposeClientUpdate.proposal?.prepareDraft(ctx, {
      client: "acme",
      cuit: CUIT,
    });
    expect(refused?.kind).toBe("error");
  });
});

describe("proposeInvoice", () => {
  it("drafts a factura A on the only fiscal POS with the server's totals", async () => {
    const prepared = await proposeInvoice.proposal?.prepareDraft(ctx, {
      client: "Acme SA",
      items: [{ description: "Flete Rosario", unit_price: 100_000 }],
      fecha: "2026-11-06",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(listEnabledPosAction).toHaveBeenCalledWith("jouve_fiscal");
    expect(prepared.draft).toMatchObject({
      channel_id: "jouve_fiscal",
      kind: "factura",
      letter: "A",
      punto_venta: 3,
      doc_tipo: 80,
      doc_nro: CUIT,
      fch_serv_desde: "2026-11-06",
      items: [{ quantity: 1, unit_price: 100_000, iva_rate_id: 5 }],
    });
    const row = (label: string) =>
      prepared.summary.find((r) => r.label === label)?.value;
    expect(row("IVA")).toContain("21.000,00");
    expect(row("Total")).toContain("121.000,00");
  });

  it("asks the POS when the channel has several", async () => {
    listEnabledPosAction.mockResolvedValue({
      ok: true,
      data: [
        { numero: 3, channel_id: "jouve_fiscal", nickname: null },
        { numero: 4, channel_id: "jouve_fiscal", nickname: "Depósito" },
      ],
    });
    const prepared = await proposeInvoice.proposal?.prepareDraft(ctx, {
      client: "Acme SA",
      items: [{ description: "Flete", unit_price: 1 }],
    });
    expect(prepared?.kind).toBe("issues");
    if (prepared?.kind !== "issues") return;
    expect(prepared.candidates?.[0]?.options.map((o) => o.value)).toEqual([
      "3",
      "4",
    ]);
  });

  it("issues on accept with the identity the card showed", async () => {
    const prepared = await proposeInvoice.proposal?.prepareDraft(ctx, {
      client: "Acme SA",
      items: [{ description: "Flete", unit_price: 1000 }],
    });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    issueComprobante.mockResolvedValue({
      ok: true,
      data: { id: INVOICE_ID, idempotency_key: "k", status: "draft" },
    });
    const res = await proposeInvoice.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: INVOICE_ID } });
    expect(issueComprobante).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        kind: "factura",
        idempotency_key: expect.any(String),
      }),
      { letter: "A", doc_tipo: 80, doc_nro: CUIT, iva_condition_receptor: 1 },
    );
  });

  it("will not issue a note through the factura proposal", async () => {
    const prepared = await proposeInvoice.proposal?.prepareDraft(ctx, {
      client: "Acme SA",
      items: [{ description: "Flete", unit_price: 1000 }],
    });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    const draft = {
      ...(prepared.draft as object),
      kind: "nc",
      invoice_origin_id: INVOICE_ID,
    };
    const res = await proposeInvoice.proposal?.executeDraft(ctx, draft);
    expect(res?.ok).toBe(false);
    expect(issueComprobante).not.toHaveBeenCalled();
  });
});

const origin = {
  id: INVOICE_ID,
  channel: { id: "jouve_fiscal", name: "Jouve fiscal", is_fiscal: true },
  client: {
    id: CLIENT_ID,
    legal_name: "Acme SA",
    iva_condition: "responsable_inscripto",
  },
  kind: "factura",
  letter: "A",
  punto_venta: 3,
  numero: 12,
  fecha: "2026-10-01",
  concepto: 2,
  doc_tipo: 80,
  doc_nro: CUIT,
  iva_condition_receptor: 1,
  moneda: "PES",
  cotizacion: 1,
  status: "emitted",
  items: [
    {
      description: "Flete",
      quantity: 2,
      unit_price: 500,
      iva_rate_id: 5,
      revenue_kind: "service",
    },
  ],
};

describe("proposeCreditDebitNote", () => {
  it("an NC with no items credits the origin's items, same letter and POS", async () => {
    getInvoiceDetailAction.mockResolvedValue({ ok: true, data: origin });
    const prepared = await proposeCreditDebitNote.proposal?.prepareDraft(ctx, {
      invoice_id: INVOICE_ID,
      kind: "nc",
      motivo: "Anulación",
      fecha: "2026-11-06",
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toMatchObject({
      kind: "nc",
      letter: "A",
      punto_venta: 3,
      invoice_origin_id: INVOICE_ID,
      motivo_nc_nd: "Anulación",
      items: [{ description: "Flete", quantity: 2, unit_price: 500 }],
    });
    expect(prepared.summary.find((r) => r.label === "Sobre")?.value).toBe(
      "A0003-00000012 del 1 oct 2026",
    );
  });

  it("an ND needs its items, and nothing goes on a comprobante not emitted", async () => {
    getInvoiceDetailAction.mockResolvedValue({ ok: true, data: origin });
    const nd = await proposeCreditDebitNote.proposal?.prepareDraft(ctx, {
      invoice_id: INVOICE_ID,
      kind: "nd",
      motivo: "Diferencia de tarifa",
    });
    expect(nd?.kind).toBe("issues");
    getInvoiceDetailAction.mockResolvedValue({
      ok: true,
      data: { ...origin, status: "failed", numero: null },
    });
    const failed = await proposeCreditDebitNote.proposal?.prepareDraft(ctx, {
      invoice_id: INVOICE_ID,
      kind: "nc",
      motivo: "x",
    });
    expect(failed?.kind).toBe("error");
  });
});

describe("proposeInvoiceEmail", () => {
  it("sends to the client's email by default", async () => {
    getInvoiceDetailAction.mockResolvedValue({ ok: true, data: origin });
    getInvoiceEmailDefaultsAction.mockResolvedValue({
      ok: true,
      data: {
        recipient: "pagos@acme.com",
        subject: "Comprobante A0003-00000012",
        numero_label: "A0003-00000012",
        client_legal_name: "Acme SA",
        last_sent_at: null,
      },
    });
    const prepared = await proposeInvoiceEmail.proposal?.prepareDraft(ctx, {
      invoice_id: INVOICE_ID,
    });
    expect(prepared?.kind).toBe("draft");
    if (prepared?.kind !== "draft") return;
    expect(prepared.draft).toEqual({
      invoice_id: INVOICE_ID,
      recipient: "pagos@acme.com",
      subject: "Comprobante A0003-00000012",
      body: null,
    });
  });

  it("asks for the address when the client has none", async () => {
    getInvoiceDetailAction.mockResolvedValue({ ok: true, data: origin });
    getInvoiceEmailDefaultsAction.mockResolvedValue({
      ok: true,
      data: {
        recipient: null,
        subject: "Comprobante A0003-00000012",
        numero_label: "A0003-00000012",
        client_legal_name: "Acme SA",
        last_sent_at: null,
      },
    });
    const prepared = await proposeInvoiceEmail.proposal?.prepareDraft(ctx, {
      invoice_id: INVOICE_ID,
    });
    expect(prepared?.kind).toBe("issues");
  });
});
