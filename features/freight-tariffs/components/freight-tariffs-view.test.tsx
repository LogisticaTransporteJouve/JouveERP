// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FreightTariffList } from "../schema";

const lists: FreightTariffList[] = [
  {
    id: "l1",
    name: "General",
    client: null,
    notes: "Más seguro (1% del valor declarado)",
    versions: [
      {
        id: "v2",
        label: "Noviembre/Diciembre 26",
        valid_from: "2026-11-01",
        increase_pct: 10,
        notes: null,
        lines: [
          {
            id: "a2",
            section: "Bultos",
            concept: "1",
            price: 35330,
            percent: null,
            note: null,
          },
          {
            id: "b2",
            section: "Retiros",
            concept: "Bultos",
            price: null,
            percent: null,
            note: "Tarifa + $ 62.600",
          },
        ],
      },
      {
        id: "v1",
        label: "Septiembre/Octubre 26",
        valid_from: "2026-09-01",
        increase_pct: null,
        notes: null,
        lines: [
          {
            id: "a1",
            section: "Bultos",
            concept: "1",
            price: 32118.18,
            percent: null,
            note: null,
          },
        ],
      },
    ],
  },
];

vi.mock("../hooks/use-freight-tariffs", () => {
  const idle = { mutate: vi.fn(), isPending: false };
  return {
    useFreightTariffs: () => ({ data: lists }),
    useDeleteFreightTariffList: () => idle,
    useDeleteFreightTariffVersion: () => idle,
    useCreateFreightTariffList: () => idle,
    useUpdateFreightTariffList: () => idle,
    useSaveFreightTariffVersion: () => idle,
    useApplyFreightTariffIncrease: () => idle,
  };
});
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => async () => true,
}));

const { FreightTariffsView } = await import("./freight-tariffs-view");

afterEach(cleanup);

describe("FreightTariffsView", () => {
  it("shows the latest prices against the previous period, by section", () => {
    render(<FreightTariffsView canWrite />);
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getAllByText("Bultos").length).toBe(2);
    expect(within(table).getByText("Anterior")).toBeTruthy();
    expect(within(table).getByText("+10%")).toBeTruthy();
    expect(within(table).getByText("Tarifa + $ 62.600")).toBeTruthy();
    // The history lists both periods with the increase.
    expect(screen.getByText("Historial")).toBeTruthy();
    expect(screen.getAllByText("+10%").length).toBeGreaterThan(1);
  });

  it("a reader sees the prices but no button to change them", () => {
    render(<FreightTariffsView canWrite={false} />);
    expect(
      screen.queryByRole("button", { name: /Aplicar aumento/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar precios/ })).toBeNull();
  });
});
