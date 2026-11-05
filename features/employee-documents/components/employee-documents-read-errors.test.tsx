// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: {
    data: undefined as unknown,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock("../hooks/use-employee-documents", () => ({
  useExpiringDocuments: () => h.read,
  useEmployeeDocuments: () => h.read,
  useDeleteEmployeeDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("./employee-document-dialog", () => ({
  EmployeeDocumentDialog: () => null,
}));

const { DocumentExpirationsPage } = await import("./document-expirations-page");
const { EmployeeDocumentsCard } = await import("./employee-documents-card");

afterEach(() => {
  cleanup();
  h.read.refetch.mockClear();
});

describe("employee documents: failed reads", () => {
  it("Vencimientos shows «Reintentar», not «Ningún documento por vencer»", () => {
    render(<DocumentExpirationsPage />);
    expect(
      screen.getByText("No se pudieron cargar los vencimientos de documentos."),
    ).toBeTruthy();
    expect(screen.queryByText(/Ningún documento por vencer/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.read.refetch).toHaveBeenCalled();
  });

  it("the employee card shows «Reintentar», not «Sin documentos cargados»", () => {
    render(<EmployeeDocumentsCard employeeId="e1" canWrite={false} />);
    expect(
      screen.getByText("No se pudieron cargar los documentos del empleado."),
    ).toBeTruthy();
    expect(screen.queryByText("Sin documentos cargados.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.read.refetch).toHaveBeenCalled();
  });
});

// v_documents_expiring lists only documents expiring from today on, and the
// cron alerts every hr:read user: the header must not promise more.
it("Vencimientos says what the list and the alert really cover", () => {
  render(<DocumentExpirationsPage />);
  expect(
    screen.getByText(
      /vencen entre hoy y los próximos 30 días\. Cada mañana se avisa dentro de la app a quienes tienen acceso a Personal\./,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/vencidos|owner\/admin/)).toBeNull();
});
