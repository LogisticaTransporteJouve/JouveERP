import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, resolveAccess } from "@/lib/auth/permissions";

const FILE_ID = "44444444-4444-4444-8444-444444444444";
const ctx: { userId: string; access: Access } = {
  userId: "u1",
  access: resolveAccess(["operations"]),
};
let isHrFile = false;
let isFleetFile = false;
let links: Record<string, string | null>[] = [];
/** Whether an extraction reads the file (service role), null on error. */
let isScan: boolean | null = false;
/** The extractions of the file the caller's RLS returns. */
let visibleExtractions: { id: string }[] = [];
const rpc = vi.fn(async (name: string) => ({
  data: name === "is_fleet_document_file" ? isFleetFile : isHrFile,
  error: null,
}));
const createSignedUrl = vi.fn(async () => ({
  data: { signedUrl: "https://storage/signed" },
  error: null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ requireUserContext: async () => ctx }));
vi.mock("@/lib/files/references", () => ({
  isDocumentScanFile: async () => isScan,
  isFileStillReferenced: async () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        then: <T>(resolve: (v: { data: unknown; error: null }) => T) =>
          Promise.resolve(
            resolve({
              data:
                table === "file_attachments"
                  ? links
                  : table === "ai_document_extractions"
                    ? visibleExtractions
                    : null,
              error: null,
            }),
          ),
        maybeSingle: async () => ({
          data: {
            bucket: "files",
            bucket_path: `${FILE_ID}.pdf`,
            original_filename: "dni.pdf",
            mime_type: "application/pdf",
          },
          error: null,
        }),
      };
      return builder;
    },
    rpc,
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

const { getSignedFileUrlAction } = await import("./files-actions");

beforeEach(() => {
  vi.clearAllMocks();
  isHrFile = false;
  isFleetFile = false;
  links = [];
  isScan = false;
  visibleExtractions = [];
  ctx.access = resolveAccess(["operations"]);
});

describe("getSignedFileUrlAction — employee documents", () => {
  it("refuses an HR document's file without hr:read", async () => {
    isHrFile = true;
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual({
      ok: false,
      error: "Archivo no encontrado.",
    });
    expect(rpc).toHaveBeenCalledWith("is_employee_document_file", {
      p_file_id: FILE_ID,
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs other files for files:read roles", async () => {
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
  });

  it("hr:read roles skip the check", async () => {
    ctx.access = resolveAccess(["finance"]);
    isHrFile = true;
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
    expect(rpc).not.toHaveBeenCalledWith("is_employee_document_file", {
      p_file_id: FILE_ID,
    });
  });
});

describe("getSignedFileUrlAction — fleet documents", () => {
  it("refuses a fleet document's file without fleet_documents:read", async () => {
    ctx.access = resolveAccess(["finance"]);
    isFleetFile = true;
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual({
      ok: false,
      error: "Archivo no encontrado.",
    });
    expect(rpc).toHaveBeenCalledWith("is_fleet_document_file", {
      p_file_id: FILE_ID,
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses it when fleet_documents:read is denied to the user", async () => {
    ctx.access = resolveAccess(["operations"], ["fleet_documents:read"]);
    isFleetFile = true;
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(false);
  });

  it("fleet roles skip the check", async () => {
    isFleetFile = true;
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
    expect(rpc).not.toHaveBeenCalledWith("is_fleet_document_file", {
      p_file_id: FILE_ID,
    });
  });
});

describe("getSignedFileUrlAction — entity read denies", () => {
  it("hides a file attached only to an entity whose module is denied", async () => {
    ctx.access = resolveAccess(["finance"], ["purchase_invoices:read"]);
    links = [{ purchase_invoice_id: "pi1" }];
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual({
      ok: false,
      error: "Archivo no encontrado.",
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs it when another link is readable", async () => {
    ctx.access = resolveAccess(["finance"], ["purchase_invoices:read"]);
    links = [{ purchase_invoice_id: "pi1" }, { supplier_id: "s1" }];
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
  });
});

describe("getSignedFileUrlAction — AI chat attachments", () => {
  it("refuses a chat-only file when ai:chat is denied to the user", async () => {
    ctx.access = resolveAccess(["admin"], ["ai:chat"]);
    links = [{ ai_chat_message_id: "m1" }];
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual({
      ok: false,
      error: "Archivo no encontrado.",
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs it with ai:chat", async () => {
    ctx.access = resolveAccess(["admin"]);
    links = [{ ai_chat_message_id: "m1" }];
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
  });
});

describe("getSignedFileUrlAction — tax document attachments", () => {
  it("lets the accountant (taxes:read, no files:read) open a tax document's file", async () => {
    ctx.access = resolveAccess(["fiscal_reader"]);
    links = [{ tax_document_id: "td1" }];
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
  });

  it("refuses the accountant any other file", async () => {
    ctx.access = resolveAccess(["fiscal_reader"]);
    links = [{ invoice_id: "i1" }];
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual({
      ok: false,
      error: "Archivo no encontrado.",
    });
    links = [];
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses it when taxes:read is denied to the user", async () => {
    ctx.access = resolveAccess(["fiscal_reader"], ["taxes:read"]);
    links = [{ tax_document_id: "td1" }];
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual({
      ok: false,
      error: "No tenés permiso para ver archivos.",
    });
  });
});

describe("getSignedFileUrlAction — Document Intelligence scans", () => {
  const notFound = { ok: false, error: "Archivo no encontrado." };

  it("refuses another user's scan to operations (no extraction it can read)", async () => {
    isScan = true;
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual(notFound);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs the scan for the user who scanned it", async () => {
    isScan = true;
    visibleExtractions = [{ id: "e1" }];
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
  });

  it("refuses an own scan when ai:read is denied", async () => {
    ctx.access = resolveAccess(["finance"], ["ai:read"]);
    isScan = true;
    visibleExtractions = [{ id: "e1" }];
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual(notFound);
  });

  it("refuses warehouse (files:read without ai:read)", async () => {
    ctx.access = resolveAccess(["warehouse"]);
    isScan = true;
    visibleExtractions = [{ id: "e1" }];
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual(notFound);
  });

  it("refuses when it cannot tell whether the file is a scan", async () => {
    isScan = null;
    expect(await getSignedFileUrlAction(FILE_ID)).toEqual(notFound);
  });

  it("signs a scan through a record the user reads, without the extraction", async () => {
    ctx.access = resolveAccess(["finance"]);
    isScan = true;
    links = [{ purchase_invoice_id: "pi1" }];
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
  });

  it("signs an own scan whose only record's module is denied", async () => {
    ctx.access = resolveAccess(["finance"], ["purchase_invoices:read"]);
    isScan = true;
    visibleExtractions = [{ id: "e1" }];
    links = [{ purchase_invoice_id: "pi1" }];
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
  });
});
