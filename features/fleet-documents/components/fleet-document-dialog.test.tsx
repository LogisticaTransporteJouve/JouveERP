// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-fleet-documents", () => ({
  useCreateFleetDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateFleetDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadFleetDocumentFile: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { FleetDocumentDialog } = await import("./fleet-document-dialog");

afterEach(cleanup);

describe("FleetDocumentDialog: the file upload follows files:write", () => {
  it.each([
    [true, true],
    [false, false],
  ])("canAttach %s shows the dropzone: %s", (canAttach, visible) => {
    render(
      <FleetDocumentDialog
        mode="create"
        vehicleOptions={[]}
        driverOptions={[]}
        canAttach={canAttach}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText("Nuevo documento")).toBeTruthy();
    expect(
      screen.queryByText("Arrastrá el escaneo o elegí un archivo") !== null,
    ).toBe(visible);
  });
});
