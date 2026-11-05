// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/select", () => ({
  Select: ({
    onValueChange,
  }: {
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <button type="button" onClick={() => onValueChange("acc-1")}>
      Elegir cuenta
    </button>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/chart-of-accounts/hooks/use-chart-of-accounts", () => ({
  useChartOfAccounts: () => ({
    data: [{ id: "acc-1", code: "1.1", name: "Caja" }],
  }),
}));
const ledgerData = {
  truncated: false,
  opening: 0,
  rows: [
    {
      line_id: "l1",
      entry_date: "2026-09-01",
      accrual_period: "2026-09",
      description: "Cobro",
      line_desc: null,
      source_table: null,
      source_id: null,
      is_reversal: false,
      debit: 100,
      credit: 0,
      running: 100,
    },
  ],
};
type LedgerRead = {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  data: typeof ledgerData | undefined;
  refetch: () => void;
};
const loaded = (): LedgerRead => ({
  isLoading: false,
  isError: false,
  error: null,
  data: ledgerData,
  refetch: vi.fn(),
});
const h = vi.hoisted(() => ({ ledger: null as unknown }));

vi.mock("../hooks/use-libro-mayor", () => ({
  LEDGER_MAX_ROWS: 5000,
  useLedger: (accountId: string | null) =>
    accountId
      ? h.ledger
      : { isLoading: false, isError: false, data: undefined },
}));

const { LibroMayorPage } = await import("./libro-mayor-page");

afterEach(cleanup);
beforeEach(() => {
  h.ledger = loaded();
});

function chooseAccount(ledger: LedgerRead) {
  h.ledger = ledger;
  render(<LibroMayorPage />);
  fireEvent.click(screen.getByText("Elegir cuenta"));
}

describe("LibroMayorPage", () => {
  it("keeps only the date column sticky in the totals row, so a phone can read the totals", () => {
    render(<LibroMayorPage />);
    fireEvent.click(screen.getByText("Elegir cuenta"));
    const label = screen.getByText("Totales");
    expect(label.className).toContain("sticky");
    expect((label as HTMLTableCellElement).colSpan).toBe(1);
    expect(screen.getByText("1 movimientos")).toBeTruthy();
    for (const cell of document.querySelectorAll("td.sticky, th.sticky")) {
      expect((cell as HTMLTableCellElement).colSpan).toBe(1);
    }
  });

  it("shows no totals while the ledger loads", () => {
    chooseAccount({ ...loaded(), isLoading: true, data: undefined });
    expect(screen.getByText("Cargando…")).toBeTruthy();
    expect(screen.queryByText("Saldo final")).toBeNull();
  });

  it("shows a failed read with «Reintentar» and no totals", () => {
    const read: LedgerRead = {
      ...loaded(),
      isError: true,
      error: new Error("No se pudo leer el mayor."),
      data: undefined,
    };
    chooseAccount(read);
    expect(screen.getByText("No se pudo leer el mayor.")).toBeTruthy();
    expect(screen.queryByText("Saldo final")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(read.refetch).toHaveBeenCalled();
  });

  it("keeps the rows read when a background refetch fails", () => {
    chooseAccount({
      ...loaded(),
      isError: true,
      error: new Error("No se pudo leer el mayor."),
    });
    expect(screen.getByText("Cobro")).toBeTruthy();
    expect(screen.getByText("Saldo final")).toBeTruthy();
    expect(screen.queryByText("No se pudo leer el mayor.")).toBeNull();
  });
});
