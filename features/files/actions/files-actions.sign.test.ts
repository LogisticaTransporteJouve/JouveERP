import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/lib/auth/permissions";

const FILE_ID = "44444444-4444-4444-8444-444444444444";
const ctx: { userId: string; roles: Role[] } = {
  userId: "u1",
  roles: ["operations"],
};
let isHrFile = false;
const rpc = vi.fn(async () => ({ data: isHrFile, error: null }));
const createSignedUrl = vi.fn(async () => ({
  data: { signedUrl: "https://storage/signed" },
  error: null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ requireUserContext: async () => ctx }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
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
  ctx.roles = ["operations"];
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
    ctx.roles = ["finance"];
    isHrFile = true;
    expect((await getSignedFileUrlAction(FILE_ID)).ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
