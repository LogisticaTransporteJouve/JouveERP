// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import { EXTRACTIONS_LIST_LIMIT } from "../types";

// Documentos: a failed list read says so with «Reintentar» instead of an
// empty tab, and a list cut at the limit says so.

const h = vi.hoisted(() => ({
  list: {} as {
    data: unknown[] | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  },
  refetch: vi.fn(),
}));

vi.mock("../hooks/use-documents", () => ({
  useExtractions: () => h.list,
  useScanDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscardExtraction: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("@/components/file-upload/file-dropzone", () => ({
  FileDropzone: () => null,
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: (props: { data: unknown[]; emptyMessage: string }) => (
    <span>
      {props.data.length === 0
        ? props.emptyMessage
        : `rows=${props.data.length}`}
    </span>
  ),
}));
vi.mock("./review-sheet", () => ({ ReviewSheet: () => null }));
vi.mock("./columns", () => ({ buildDocumentColumns: () => [] }));

const { DocumentsTray } = await import("./documents-tray");

const renderTray = () =>
  render(<DocumentsTray access={resolveAccess(["finance"])} />);

beforeEach(() => {
  h.refetch.mockReset();
  h.list = { data: [], isLoading: false, isError: false, refetch: h.refetch };
});
afterEach(cleanup);

describe("DocumentsTray", () => {
  it("a failed read says so with «Reintentar», not an empty tab", () => {
    h.list = { ...h.list, data: undefined, isError: true };
    renderTray();
    expect(
      screen.getByText("No se pudieron cargar los documentos."),
    ).toBeTruthy();
    expect(screen.queryByText("No hay documentos en este estado.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.refetch).toHaveBeenCalledOnce();
  });

  it("an empty tab is empty", () => {
    renderTray();
    expect(screen.getByText("No hay documentos en este estado.")).toBeTruthy();
    expect(screen.queryByText(/más recientes/)).toBeNull();
  });

  it("a list cut at the limit says so", () => {
    h.list = {
      ...h.list,
      data: Array.from({ length: EXTRACTIONS_LIST_LIMIT }, (_, i) => ({
        id: `e${i}`,
      })),
    };
    renderTray();
    expect(
      screen.getByText(
        `Se muestran los ${EXTRACTIONS_LIST_LIMIT} más recientes.`,
      ),
    ).toBeTruthy();
  });
});
