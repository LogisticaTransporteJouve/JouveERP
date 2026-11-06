// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listInsightsAction = vi.fn();

vi.mock("../actions", () => ({
  listInsightsAction: () => listInsightsAction(),
  ignoreInsightAction: vi.fn(),
  runAnalystAction: vi.fn(),
  setInsightStatusAction: vi.fn(),
}));

const { InsightsPanel } = await import("./insights-panel");

function renderPanel(canManage: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InsightsPanel canManage={canManage} onAsk={() => undefined} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  listInsightsAction.mockReset();
});

describe("InsightsPanel", () => {
  it("shows a failed read as an error, not as 'no insights yet'", async () => {
    listInsightsAction.mockResolvedValue({
      ok: false,
      error: "No se pudieron cargar los insights.",
    });
    renderPanel(true);
    expect(
      await screen.findByText("No se pudieron cargar los insights."),
    ).toBeTruthy();
    expect(screen.queryByText(/No hay insights todavía/)).toBeNull();
  });

  it("keeps the error visible to users who cannot recalculate", async () => {
    listInsightsAction.mockResolvedValue({
      ok: false,
      error: "No se pudieron cargar los insights.",
    });
    renderPanel(false);
    expect(
      await screen.findByText("No se pudieron cargar los insights."),
    ).toBeTruthy();
  });

  it("says when only part of the cards is shown", async () => {
    listInsightsAction.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: "i1",
            kind: "cashflow",
            severity: "critical",
            title: "Caja negativa",
            finding: "",
            metrics: {},
            source_refs: [],
            period: null,
            status: "open",
            generated_at: "2026-11-03T00:00:00Z",
            proposal: null,
          },
        ],
        total: 3,
      },
    });
    renderPanel(true);
    expect(await screen.findByText("Caja negativa")).toBeTruthy();
    expect(screen.getByText(/Mostrando 1 de 3/)).toBeTruthy();
  });

  // On a phone the cards share one implicit `auto` track unless the grid
  // names it: a long unbreakable figure in a card then widens the whole page.
  it("keeps a card with a long unbreakable figure to the page width", async () => {
    const figure = "30123456789301234567893012345678930123456789";
    listInsightsAction.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: "i1",
            kind: "cashflow",
            severity: "critical",
            title: `Caja ${figure}`,
            finding: `Saldo ${figure}`,
            metrics: {},
            source_refs: [],
            period: null,
            status: "open",
            generated_at: "2026-11-03T00:00:00Z",
            proposal: null,
          },
        ],
        total: 1,
      },
    });
    renderPanel(true);
    const title = await screen.findByText(`Caja ${figure}`);
    const finding = screen.getByText(`Saldo ${figure}`);
    expect(title.className.split(" ")).toContain("break-words");
    expect(finding.className.split(" ")).toContain("break-words");
    const grid = title.closest("[data-slot=card]")?.parentElement;
    expect(grid?.className.split(" ")).toContain("grid-cols-1");
  });
});
