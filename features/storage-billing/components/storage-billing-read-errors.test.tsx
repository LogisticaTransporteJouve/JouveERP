// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

type Read = {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const failed = (): Read => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: true,
  refetch: vi.fn(),
});

const loaded = (data: unknown): Read => ({
  data,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
});

const h = vi.hoisted(() => ({
  billing: undefined as unknown as Read,
  runs: undefined as unknown as Read,
  channels: [] as { id: string; name: string; is_fiscal: boolean }[],
  posChannel: "",
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-storage-billing", () => ({
  useStorageBilling: () => h.billing,
  useStorageBillingRuns: () => h.runs,
  useInvoicingChannels: () => ({ data: h.channels }),
  useEnabledPos: (channelId: string) => {
    h.posChannel = channelId;
    return { data: [] };
  },
  useInvoiceStorage: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { StorageBillingReport } = await import("./storage-billing-report");
const { StorageInvoiceDialog } = await import("./storage-invoice-dialog");

const report = {
  storage_total: 1000,
  handling_total: 0,
  total: 1000,
  pallets_without_tariff: 0,
  pallets_without_rate: 0,
  byClient: [
    { client_id: "c1", client_name: "Acme", pallets: 2, charge: 1000 },
  ],
  lines: [],
};

const finance = resolveAccess(["finance"]);

afterEach(cleanup);
beforeEach(() => {
  h.billing = loaded(report);
  h.runs = loaded([]);
  h.channels = [];
  h.posChannel = "";
});

describe("StorageBillingReport", () => {
  it("shows a failed report read with «Reintentar» instead of a skeleton", () => {
    h.billing = failed();
    render(<StorageBillingReport actorAccess={finance} />);
    expect(
      screen.getByText("No se pudo cargar la facturación de almacenaje."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.billing.refetch).toHaveBeenCalled();
  });

  it("says the earlier runs could not be read and keeps «Facturar» closed", () => {
    h.runs = failed();
    render(<StorageBillingReport actorAccess={finance} />);
    expect(
      screen.getByText("No se pudo leer hasta cuándo se facturó cada cliente."),
    ).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
    const facturar = screen.getByRole("button", { name: /Facturar/ });
    expect(facturar.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.runs.refetch).toHaveBeenCalled();
  });

  it.each([
    [
      "storage_billing:issue",
      resolveAccess(["finance"], ["storage_billing:issue"]),
    ],
    ["invoices:issue", resolveAccess(["finance"], ["invoices:issue"])],
  ])("hides «Facturar» from finance with %s denied", (_, access) => {
    render(<StorageBillingReport actorAccess={access} />);
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Facturar/ })).toBeNull();
  });

  it("offers «Facturar» once the runs are read", () => {
    render(<StorageBillingReport actorAccess={finance} />);
    const facturar = screen.getByRole("button", { name: /Facturar/ });
    expect(facturar.hasAttribute("disabled")).toBe(false);
  });
});

describe("StorageInvoiceDialog", () => {
  function openDialog(clientIsFiscal: boolean | null = true) {
    render(
      <StorageInvoiceDialog
        client={{
          client_id: "c1",
          client_name: "Acme",
          client_is_fiscal: clientIsFiscal,
        }}
        reportStart="2026-10-01"
        reportEnd="2026-10-31"
        runs={[]}
        onClose={() => {}}
      />,
    );
  }

  it("shows a failed preview as an error, not as $0", () => {
    h.billing = failed();
    openDialog();
    expect(screen.getByText(/No se pudo calcular el total/)).toBeTruthy();
    expect(screen.queryByText("Total")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Emitir factura" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.billing.refetch).toHaveBeenCalled();
  });

  it("shows the totals when the preview is read", () => {
    h.billing = loaded({
      ...report,
      lines: [
        {
          client_id: "c1",
          storage_charge: 1000,
          handling_in_charge: 0,
          handling_out_charge: 0,
        },
      ],
    });
    openDialog();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.queryByText(/No se pudo calcular el total/)).toBeNull();
  });

  const bothChannels = [
    { id: "jouve_fiscal", name: "Jouve", is_fiscal: true },
    { id: "jouve_internal", name: "Jouve interno", is_fiscal: false },
  ];

  it("preselects the only channel on the client's side", () => {
    h.channels = bothChannels;
    openDialog(false);
    expect(h.posChannel).toBe("jouve_internal");
    expect(
      document.getElementById("storage-pos")?.hasAttribute("disabled"),
    ).toBe(false);
  });

  it("leaves the channel to choose when the client's side is unknown", () => {
    h.channels = bothChannels;
    openDialog(null);
    expect(h.posChannel).toBe("");
    expect(
      document.getElementById("storage-pos")?.hasAttribute("disabled"),
    ).toBe(true);
  });
});
