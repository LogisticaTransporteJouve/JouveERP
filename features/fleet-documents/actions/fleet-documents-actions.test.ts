import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

const DOC_ID = "66666666-6666-4666-8666-666666666666";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const VEHICLE_ID = "77777777-7777-4777-8777-777777777777";
const OLD_FILE_ID = "33333333-3333-4333-8333-333333333333";
const stored = { fileId: FILE_ID, bucketPath: `${FILE_ID}/vtv.pdf` };

let roles: Role[] = ["operations"];
let denied: string[] = [];
let updatedRows: { id: string }[] = [{ id: DOC_ID }];
let fileError: string | null = null;
let attachedFile: string | null = OLD_FILE_ID;
let updateError: { message: string } | null = null;
let deletedRows: { attachment_file_id: string | null }[] | null = null;
const update = vi.fn((_patch: Record<string, unknown>) => {
  const result = { data: updatedRows, error: updateError };
  return {
    eq: () =>
      Object.assign(Promise.resolve(result), {
        select: async () => result,
      }),
  };
});
const remove = vi.fn(() => ({
  eq: () => ({
    select: async () => ({
      data: deletedRows ?? [{ attachment_file_id: attachedFile }],
      error: null,
    }),
  }),
}));
const select = vi.fn(() => ({
  eq: () => ({
    maybeSingle: async () => ({
      data: { attachment_file_id: attachedFile },
      error: null,
    }),
  }),
}));
let insertError: { message: string; code: string; hint: string } | null = null;
const insert = vi.fn(() => ({
  select: () => ({
    single: async () =>
      insertError
        ? { data: null, error: insertError }
        : { data: { id: DOC_ID }, error: null },
  }),
}));
const storeUploadedFile = vi.fn(async () => ({
  ok: true as const,
  data: stored,
}));
const discardStoredFile = vi.fn(async () => undefined);
const removeReplacedFile = vi.fn(async () => undefined);
const linkableFileError = vi.fn(
  async (_client: unknown, id: string | null | undefined) =>
    id ? fileError : null,
);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
const logAudit = vi.fn(async () => undefined);
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/lib/files/store", () => ({
  storeUploadedFile,
  discardStoredFile,
  linkableFileError,
}));
vi.mock("@/lib/files/remove-unlinked", () => ({ removeReplacedFile }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ update, insert, select, delete: remove }),
  }),
}));

const {
  createFleetDocumentAction,
  deleteFleetDocumentAction,
  updateFleetDocumentAction,
  uploadFleetDocumentFileAction,
} = await import("./fleet-documents-actions");

function formData(): FormData {
  const fd = new FormData();
  fd.append("documentId", DOC_ID);
  fd.append("file", new File(["%PDF"], "vtv.pdf", { type: "application/pdf" }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  roles = ["operations"];
  denied = [];
  updatedRows = [{ id: DOC_ID }];
  fileError = null;
  attachedFile = OLD_FILE_ID;
  updateError = null;
  insertError = null;
  deletedRows = null;
});

describe("a fleet document that is gone (no row matched)", () => {
  const notFound = {
    ok: false,
    error: "No se encontró la documentación. Actualizá la página.",
  };

  it("an update says so and audits nothing", async () => {
    updatedRows = [];
    expect(
      await updateFleetDocumentAction({
        id: DOC_ID,
        vehicle_id: VEHICLE_ID,
        notes: "Renovada",
      }),
    ).toEqual(notFound);
    expect(logAudit).not.toHaveBeenCalled();
    expect(removeReplacedFile).not.toHaveBeenCalled();
  });

  it("a delete says so and audits nothing", async () => {
    deletedRows = [];
    expect(await deleteFleetDocumentAction({ id: DOC_ID })).toEqual(notFound);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("a delete refuses an id that is not a uuid", async () => {
    expect(await deleteFleetDocumentAction({ id: "nope" })).toEqual({
      ok: false,
      error: "Documento inválido.",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("a new expiry date clears the alert cooldown", async () => {
    await updateFleetDocumentAction({
      id: DOC_ID,
      vehicle_id: VEHICLE_ID,
      expires_at: "2030-01-01",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: "2030-01-01", notified_at: null }),
    );
  });
});

describe("uploadFleetDocumentFileAction", () => {
  it("stores the file and points the document at it", async () => {
    expect(await uploadFleetDocumentFileAction(formData())).toEqual({
      ok: true,
      data: { fileId: FILE_ID },
    });
    expect(update).toHaveBeenCalledWith({ attachment_file_id: FILE_ID });
    expect(discardStoredFile).not.toHaveBeenCalled();
  });

  it("removes the scan it replaces right away (audit w13-s4 F2)", async () => {
    expect((await uploadFleetDocumentFileAction(formData())).ok).toBe(true);
    expect(removeReplacedFile).toHaveBeenCalledWith({
      userId: "u1",
      auditEvent: "fleet_document.file_removed",
      documentId: DOC_ID,
      previousFileId: OLD_FILE_ID,
      nextFileId: FILE_ID,
    });
  });

  it("keeps the previous scan when the document is not updated", async () => {
    updatedRows = [];
    await uploadFleetDocumentFileAction(formData());
    expect(removeReplacedFile).not.toHaveBeenCalled();
  });

  it("discards the stored file when the document is not updated", async () => {
    updatedRows = [];
    expect((await uploadFleetDocumentFileAction(formData())).ok).toBe(false);
    expect(discardStoredFile).toHaveBeenCalledWith(expect.anything(), stored);
  });

  it("refuses a role without fleet_documents:write before uploading", async () => {
    roles = ["finance"];
    expect((await uploadFleetDocumentFileAction(formData())).ok).toBe(false);
    expect(storeUploadedFile).not.toHaveBeenCalled();
  });
});

describe("createFleetDocumentAction attachment", () => {
  const input = {
    vehicle_id: VEHICLE_ID,
    kind: "vtv",
    expires_at: "2030-01-01",
    attachment_file_id: FILE_ID,
  };

  it("links a file the caller can see", async () => {
    expect((await createFleetDocumentAction(input)).ok).toBe(true);
  });

  it("refuses a file the caller cannot link", async () => {
    fileError = "No encontramos el archivo adjunto.";
    expect(await createFleetDocumentAction(input)).toEqual({
      ok: false,
      error: "No encontramos el archivo adjunto.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("asks files:write to link a file (audit w16-s4 F2)", async () => {
    denied = ["files:write"];
    expect(await createFleetDocumentAction(input)).toEqual({
      ok: false,
      error: "No tenés permiso para adjuntar archivos.",
    });
    expect(linkableFileError).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(
      (await createFleetDocumentAction({ ...input, attachment_file_id: null }))
        .ok,
    ).toBe(true);
  });

  it("shows the database guard's message when the link loses a race", async () => {
    insertError = {
      message: "Ese archivo ya está vinculado a otro registro.",
      code: "55006",
      hint: "jouve_guard",
    };
    expect(await createFleetDocumentAction(input)).toEqual({
      ok: false,
      error: "Ese archivo ya está vinculado a otro registro.",
    });
  });
});

describe("updateFleetDocumentAction attachment", () => {
  const edit = { id: DOC_ID, vehicle_id: VEHICLE_ID };

  it("checks a new file and asks files:write for it (audit w16-s4 F1, F2)", async () => {
    fileError = "Ese archivo ya está vinculado a otro registro.";
    expect(
      await updateFleetDocumentAction({ ...edit, attachment_file_id: FILE_ID }),
    ).toEqual({
      ok: false,
      error: "Ese archivo ya está vinculado a otro registro.",
    });
    fileError = null;
    denied = ["files:write"];
    expect(
      await updateFleetDocumentAction({ ...edit, attachment_file_id: FILE_ID }),
    ).toEqual({ ok: false, error: "No tenés permiso para adjuntar archivos." });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the file the document already has without re-checking it", async () => {
    denied = ["files:write"];
    fileError = "Ese archivo ya está vinculado a otro registro.";
    expect(
      (
        await updateFleetDocumentAction({
          ...edit,
          attachment_file_id: OLD_FILE_ID,
        })
      ).ok,
    ).toBe(true);
    expect(linkableFileError).not.toHaveBeenCalled();
  });
});

describe("fleet document scan removal (audit w13-s4 F2)", () => {
  const edit = { id: DOC_ID, vehicle_id: VEHICLE_ID };

  it("removes the scan an edit clears", async () => {
    expect(
      (await updateFleetDocumentAction({ ...edit, attachment_file_id: null }))
        .ok,
    ).toBe(true);
    expect(removeReplacedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOC_ID,
        previousFileId: OLD_FILE_ID,
        nextFileId: null,
      }),
    );
  });

  it("leaves the scan alone when an edit does not touch it", async () => {
    await updateFleetDocumentAction({ ...edit, notes: "Renovada" });
    expect(select).not.toHaveBeenCalled();
    expect(removeReplacedFile).toHaveBeenCalledWith(
      expect.objectContaining({ previousFileId: null }),
    );
  });

  it("keeps the scan when the edit fails", async () => {
    updateError = { message: "boom" };
    expect(
      (await updateFleetDocumentAction({ ...edit, attachment_file_id: null }))
        .ok,
    ).toBe(false);
    expect(removeReplacedFile).not.toHaveBeenCalled();
  });

  it("removes the scan of a deleted document", async () => {
    expect((await deleteFleetDocumentAction({ id: DOC_ID })).ok).toBe(true);
    expect(removeReplacedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOC_ID,
        previousFileId: OLD_FILE_ID,
        nextFileId: null,
      }),
    );
  });

  it("refuses a role without fleet_documents:write before touching files", async () => {
    roles = ["finance"];
    expect((await deleteFleetDocumentAction({ id: DOC_ID })).ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(removeReplacedFile).not.toHaveBeenCalled();
  });
});
