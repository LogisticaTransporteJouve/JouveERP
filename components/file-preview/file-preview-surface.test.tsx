// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilePreviewSurface } from "./file-preview-surface";

afterEach(cleanup);

describe("FilePreviewSurface", () => {
  it("spins only while loading", () => {
    render(
      <FilePreviewSurface
        url={null}
        filename="a.pdf"
        mimeType={null}
        isLoading
      />,
    );
    expect(screen.getByText("Cargando archivo…")).toBeTruthy();
  });

  it("a failed signed URL shows the error with «Reintentar», not a spinner", () => {
    const onRetry = vi.fn();
    render(
      <FilePreviewSurface
        url={null}
        filename="a.pdf"
        mimeType="application/pdf"
        isLoading={false}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText("Cargando archivo…")).toBeNull();
    expect(screen.getByText("No se pudo cargar el archivo.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("without onRetry it still says the file could not be loaded", () => {
    render(<FilePreviewSurface url={null} filename="a.pdf" mimeType={null} />);
    expect(screen.getByRole("alert").textContent).toBe(
      "No se pudo cargar el archivo.",
    );
  });
});
