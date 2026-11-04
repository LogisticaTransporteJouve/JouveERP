// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const h = vi.hoisted(() => ({
  detail: {
    data: undefined as unknown,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
  signedUrl: vi.fn(),
}));

vi.mock("../hooks/use-documents", () => ({
  useExtraction: () => h.detail,
}));
vi.mock("@/features/files/hooks/use-attachments", () => ({
  fetchSignedUrl: h.signedUrl,
}));
vi.mock("./detail/document-detail", () => ({ DocumentDetail: () => null }));
vi.mock("./review-actions", () => ({ ReviewActions: () => null }));

const { ReviewSheet } = await import("./review-sheet");

afterEach(() => {
  cleanup();
  h.detail.refetch.mockReset();
});

describe("ReviewSheet: the extraction read failed", () => {
  it("shows the error with «Reintentar» in the sidecar and the body, no spinner and no status", () => {
    render(
      <ReviewSheet
        extractionId="x1"
        access={resolveAccess(["finance"])}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByText("Cargando archivo…")).toBeNull();
    expect(screen.queryByText("Pendiente")).toBeNull();
    expect(screen.getByText("No se pudo cargar el archivo.")).toBeTruthy();
    expect(screen.getByText("No se pudo cargar la extracción.")).toBeTruthy();
    // Radix hides the sidecar (outside the sheet) from the a11y tree.
    const retries = screen.getAllByRole("button", {
      name: /Reintentar/,
      hidden: true,
    });
    expect(retries).toHaveLength(2);
    for (const retry of retries) fireEvent.click(retry);
    expect(h.detail.refetch).toHaveBeenCalledTimes(2);
    expect(h.signedUrl).not.toHaveBeenCalled();
  });
});
