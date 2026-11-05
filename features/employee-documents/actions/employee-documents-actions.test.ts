import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

const FILE_ID = "44444444-4444-4444-8444-444444444444";
const EMPLOYEE_ID = "55555555-5555-4555-8555-555555555555";
const DOC_ID = "66666666-6666-4666-8666-666666666666";
const OLD_FILE_ID = "33333333-3333-4333-8333-333333333333";
let visibleFile: { id: string; source: string } | null = null;
const insert = vi.fn(() => ({
  select: () => ({
    single: async () => ({ data: { id: "doc-1" }, error: null }),
  }),
}));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
const removeReplacedFile = vi.fn(async () => undefined);
const docRow = { attachment_file_id: OLD_FILE_ID };
const docs = {
  insert,
  select: () => ({
    eq: () => ({ maybeSingle: async () => ({ data: docRow, error: null }) }),
  }),
  update: () => ({ eq: async () => ({ error: null }) }),
  delete: () => ({
    eq: () => ({ select: async () => ({ data: [docRow], error: null }) }),
  }),
};

vi.mock("@/lib/actions/audit", () => ({ logAudit: async () => undefined }));
vi.mock("@/lib/files/remove-unlinked", () => ({ removeReplacedFile }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "files") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: visibleFile, error: null }),
        };
        return builder;
      }
      return docs;
    },
  }),
}));

const {
  createEmployeeDocumentAction,
  deleteEmployeeDocumentAction,
  updateEmployeeDocumentAction,
} = await import("./employee-documents-actions");

const input = {
  employee_id: EMPLOYEE_ID,
  kind: "otro",
  expires_at: "2030-01-01",
  attachment_file_id: FILE_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  visibleFile = { id: FILE_ID, source: "manual_upload" };
});

describe("createEmployeeDocumentAction attachment", () => {
  it("links a file the caller can see", async () => {
    expect(await createEmployeeDocumentAction(input)).toEqual({
      ok: true,
      data: { id: "doc-1" },
    });
  });

  it("refuses a file the caller cannot see or a chat attachment", async () => {
    visibleFile = null;
    expect((await createEmployeeDocumentAction(input)).ok).toBe(false);
    visibleFile = { id: FILE_ID, source: "chat_attachment" };
    expect((await createEmployeeDocumentAction(input)).ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("employee document scan removal (audit w13-s4 F2)", () => {
  it("removes the scan an edit clears", async () => {
    expect(
      (
        await updateEmployeeDocumentAction({
          id: DOC_ID,
          attachment_file_id: null,
        })
      ).ok,
    ).toBe(true);
    expect(removeReplacedFile).toHaveBeenCalledWith({
      userId: "u1",
      auditEvent: "employee_document.file_removed",
      documentId: DOC_ID,
      previousFileId: OLD_FILE_ID,
      nextFileId: null,
    });
  });

  it("removes the scan of a deleted document", async () => {
    expect((await deleteEmployeeDocumentAction(DOC_ID)).ok).toBe(true);
    expect(removeReplacedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        previousFileId: OLD_FILE_ID,
        nextFileId: null,
      }),
    );
  });
});
