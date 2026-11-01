// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemitoLinks } from "@/features/invoices/actions/bill-remito-actions";
import { type Access, resolveAccess } from "@/lib/auth/permissions";
import type { ActionResult } from "@/lib/query/run-action";

const h = vi.hoisted(() => ({
  access: null as Access | null,
  detail: null as Record<string, unknown> | null,
  links: null as ActionResult<RemitoLinks> | null,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  getInvoiceDetailAction: async () => ({ ok: true, data: h.detail }),
}));
vi.mock("@/features/invoices/actions/bill-remito-actions", () => ({
  getRemitoLinksAction: async () => h.links,
}));
vi.mock("@/features/invoices/components/bill-remito-dialog", () => ({
  BillRemitoDialog: () => <button type="button">stub-facturar</button>,
}));
vi.mock("@/features/invoices/components/retry-remito-credit-button", () => ({
  RetryRemitoCreditButton: ({ facturaId }: { facturaId: string }) => (
    <button type="button">stub-retry {facturaId}</button>
  ),
}));
vi.mock("@/features/invoices/components/invoice-job-status", () => ({
  InvoiceJobStatus: () => null,
}));
vi.mock("@/features/invoices/components/cancel-invoice-dialog", () => ({
  CancelInvoiceDialog: () => null,
}));
vi.mock("@/features/invoices/components/issue-nc-nd-dialog", () => ({
  IssueNcNdDialog: () => null,
}));
vi.mock("@/features/invoices/components/regenerate-pdf-button", () => ({
  RegeneratePdfButton: () => null,
}));
vi.mock("@/features/files/components/attachments-zone", () => ({
  AttachmentsZone: () => null,
}));

const { default: ComprobanteDetailPage } = await import("./page");

function base(isFiscal: boolean): Record<string, unknown> {
  return {
    id: isFiscal ? "fac-1" : "rem-1",
    kind: "factura",
    letter: isFiscal ? "A" : null,
    punto_venta: isFiscal ? 3 : 9001,
    numero: 7,
    expected_numero: null,
    status: "emitted",
    fecha: "2026-11-01",
    concepto: 2,
    moneda: "PES",
    cotizacion: 1,
    doc_tipo: 80,
    doc_nro: "30712345678",
    pdf_hash: "h",
    cae: isFiscal ? "123" : null,
    cae_vencimiento: null,
    emitted_at: null,
    afip_observaciones: null,
    fch_serv_desde: null,
    fch_serv_hasta: null,
    fch_vto_pago: null,
    imp_neto: 100,
    imp_tot_conc: 0,
    imp_op_ex: 0,
    imp_iva: isFiscal ? 21 : 0,
    imp_trib: 0,
    imp_total: isFiscal ? 121 : 100,
    channel: {
      id: isFiscal ? "jouve_fiscal" : "jouve_internal",
      name: isFiscal ? "Jouve" : "Interno",
      is_fiscal: isFiscal,
    },
    client: {
      id: "c1",
      legal_name: "ACME",
      iva_condition: isFiscal ? "responsable_inscripto" : null,
    },
    items: [
      {
        id: "it1",
        description: "Flete",
        quantity: 1,
        unit_price: 100,
        iva_rate_id: isFiscal ? 5 : null,
        line_total: isFiscal ? 121 : 100,
      },
    ],
  };
}

const okLinks = (over: Partial<RemitoLinks>): ActionResult<RemitoLinks> => ({
  ok: true,
  data: { billedAs: null, sourceRemito: null, creditState: "settled", ...over },
});

async function renderPage(id = "x") {
  render(await ComprobanteDetailPage({ params: Promise.resolve({ id }) }));
}

const RUNNING = "Acreditando el remito: en unos minutos queda saldado.";
const PENDING = /El remito todavía no se acreditó/;
const UNREADABLE = /No se pudo leer si el comprobante está vinculado/;

beforeEach(() => {
  h.access = resolveAccess(["finance"]);
});
afterEach(cleanup);

describe("invoice detail — remito links", () => {
  it("an unreadable link hides Facturar and the retry, says so, and does not throw", async () => {
    h.detail = base(false);
    h.links = { ok: false, error: "No se pudo leer el vínculo." };
    await renderPage();
    expect(screen.getByText(UNREADABLE)).toBeTruthy();
    expect(screen.queryByText("stub-facturar")).toBeNull();
    expect(screen.queryByText(/stub-retry/)).toBeNull();
  });

  it("an unbilled emitted remito offers Facturar", async () => {
    h.detail = base(false);
    h.links = okLinks({});
    await renderPage();
    expect(screen.getByText("stub-facturar")).toBeTruthy();
    expect(screen.queryByText(UNREADABLE)).toBeNull();
  });

  it("a billed remito links its factura and hides Facturar", async () => {
    h.detail = base(false);
    h.links = okLinks({ billedAs: { id: "fac-1", label: "A 0003-00000010" } });
    await renderPage();
    expect(screen.getByText("A 0003-00000010")).toBeTruthy();
    expect(screen.queryByText("stub-facturar")).toBeNull();
  });

  it("running: shows 'acreditando', no pending notice, no retry", async () => {
    h.detail = base(true);
    h.links = okLinks({
      sourceRemito: { id: "rem-1", label: "X9001-00000007" },
      creditState: "running",
    });
    await renderPage();
    expect(screen.getByText(RUNNING)).toBeTruthy();
    expect(screen.queryByText(PENDING)).toBeNull();
    expect(screen.queryByText(/stub-retry/)).toBeNull();
  });

  it("pending: shows the notice and the retry for this factura", async () => {
    h.detail = base(true);
    h.links = okLinks({
      sourceRemito: { id: "rem-1", label: "X9001-00000007" },
      creditState: "pending",
    });
    await renderPage();
    expect(screen.getByText(PENDING)).toBeTruthy();
    expect(screen.getByText("stub-retry fac-1")).toBeTruthy();
    expect(screen.queryByText(RUNNING)).toBeNull();
  });

  it("settled: neither notice nor retry", async () => {
    h.detail = base(true);
    h.links = okLinks({
      sourceRemito: { id: "rem-1", label: "X9001-00000007" },
      creditState: "settled",
    });
    await renderPage();
    expect(screen.queryByText(PENDING)).toBeNull();
    expect(screen.queryByText(RUNNING)).toBeNull();
    expect(screen.queryByText(/stub-retry/)).toBeNull();
  });

  it.each([
    ["a role without invoices:issue", () => resolveAccess(["fiscal_reader"])],
    [
      "finance with invoices:issue denied",
      () => resolveAccess(["finance"], ["invoices:issue"]),
    ],
  ])("%s gets the notice but neither retry nor Facturar", async (_, access) => {
    h.access = access();
    h.detail = base(true);
    h.links = okLinks({ creditState: "pending" });
    await renderPage();
    expect(screen.getByText(PENDING)).toBeTruthy();
    expect(screen.queryByText(/stub-retry/)).toBeNull();

    cleanup();
    h.detail = base(false);
    h.links = okLinks({});
    await renderPage();
    expect(screen.queryByText("stub-facturar")).toBeNull();
  });
});
