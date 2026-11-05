// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const h = vi.hoisted(() => ({ canAttach: null as boolean | null }));

const doc = {
  id: "fd1",
  vehicle: { patente: "AB123CD" },
  driver: null,
  kind: "vtv",
  number: null,
  expires_at: "2027-01-01",
  attachment_file_id: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/providers/confirm-provider", () => ({
  useConfirm: () => vi.fn(),
}));
vi.mock("@/features/files/hooks/use-attachments", () => ({
  fetchSignedUrl: vi.fn(),
}));
vi.mock("../hooks/use-fleet-documents", () => ({
  useFleetDocuments: () => ({ data: [doc] }),
  useDeleteFleetDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./fleet-document-dialog", () => ({
  FleetDocumentDialog: ({ canAttach }: { canAttach: boolean }) => {
    h.canAttach = canAttach;
    return null;
  },
}));

const { FleetDocumentsTable } = await import("./fleet-documents-table");

afterEach(() => {
  cleanup();
  h.canAttach = null;
});

describe("FleetDocumentsTable: write controls follow the actions' permissions", () => {
  it.each([
    ["operations", resolveAccess(["operations"]), true, true],
    [
      "operations with files:write denied",
      resolveAccess(["operations"], ["files:write"]),
      true,
      false,
    ],
    [
      "operations with fleet_documents:write denied",
      resolveAccess(["operations"], ["fleet_documents:write"]),
      false,
      false,
    ],
  ])(
    "%s: write controls %s, file upload %s",
    (_, access, canWrite, canAttach) => {
      render(
        <FleetDocumentsTable
          actorAccess={access}
          vehicleOptions={[]}
          driverOptions={[]}
        />,
      );
      expect(screen.queryByRole("button", { name: "Acciones" }) !== null).toBe(
        canWrite,
      );
      const create = screen.queryByRole("button", { name: /Nuevo documento/ });
      expect(create !== null).toBe(canWrite);
      if (create) {
        fireEvent.click(create);
        expect(h.canAttach).toBe(canAttach);
      }
    },
  );
});
