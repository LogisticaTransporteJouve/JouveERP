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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        then: <T>(resolve: (v: { data: unknown; error: null }) => T) =>
          Promise.resolve(
            resolve({
              data: table === "file_attachments" ? links : null,
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
