import { beforeEach, describe, expect, it, vi } from "vitest";

const FILE_ID = "44444444-4444-4444-8444-444444444444";
const EMPLOYEE_ID = "55555555-5555-4555-8555-555555555555";
let visibleFile: { id: string; source: string } | null = null;
const insert = vi.fn(() => ({
  select: () => ({
    single: async () => ({ data: { id: "doc-1" }, error: null }),
  }),
}));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", roles: ["finance"] }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: async () => undefined }));
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
      return { insert };
    },
  }),
}));

const { createEmployeeDocumentAction } =
  await import("./employee-documents-actions");

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
