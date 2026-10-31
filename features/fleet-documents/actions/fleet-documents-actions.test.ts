import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

const DOC_ID = "66666666-6666-4666-8666-666666666666";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const VEHICLE_ID = "77777777-7777-4777-8777-777777777777";
const stored = { fileId: FILE_ID, bucketPath: `${FILE_ID}/vtv.pdf` };

let roles: Role[] = ["operations"];
let updatedRows: { id: string }[] = [{ id: DOC_ID }];
let fileError: string | null = null;
const update = vi.fn((_patch: Record<string, unknown>) => ({
  eq: () => ({
    select: async () => ({ data: updatedRows, error: null }),
  }),
}));
const insert = vi.fn(() => ({
  select: () => ({
    single: async () => ({ data: { id: DOC_ID }, error: null }),
  }),
}));
const storeUploadedFile = vi.fn(async () => ({
  ok: true as const,
  data: stored,
}));
const discardStoredFile = vi.fn(async () => undefined);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: async () => undefined }));
vi.mock("@/lib/files/store", () => ({
  storeUploadedFile,
  discardStoredFile,
  linkableFileError: async (_client: unknown, id: string | null | undefined) =>
    id ? fileError : null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ update, insert }),
  }),
}));

const { createFleetDocumentAction, uploadFleetDocumentFileAction } =
  await import("./fleet-documents-actions");

function formData(): FormData {
  const fd = new FormData();
  fd.append("documentId", DOC_ID);
  fd.append("file", new File(["%PDF"], "vtv.pdf", { type: "application/pdf" }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  roles = ["operations"];
  updatedRows = [{ id: DOC_ID }];
  fileError = null;
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
});
