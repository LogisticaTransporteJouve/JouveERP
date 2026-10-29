import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

// Rows visible to the caller (RLS client) and to the service role.
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
let attachments: { id: string; file_id: string }[] = [];
let extractionRefs = 0;
let employeeDocRefs = 0;
const removedBlobs: string[] = [];
const deletedFiles: string[] = [];

function rlsFrom(table: string) {
  const eqs: Record<string, unknown> = {};
  let op: "select" | "delete" = "select";
  let head = false;
  const builder = {
    select: (_cols: string, opts?: { head?: boolean }) => {
      head = opts?.head ?? false;
      return builder;
    },
    delete: () => {
      op = "delete";
      return builder;
    },
    eq: (col: string, v: unknown) => {
      eqs[col] = v;
      return builder;
    },
    maybeSingle: async () => {
      if (table === "file_attachments") {
        return {
          data: attachments.find((a) => a.id === eqs.id) ?? null,
          error: null,
        };
      }
      return {
        data: { bucket: "files", bucket_path: `p/${FILE_ID}` },
        error: null,
      };
    },
    then: (resolve: (v: unknown) => unknown) => {
      if (op === "delete" && table === "file_attachments") {
        attachments = attachments.filter((a) => a.id !== eqs.id);
      } else if (op === "delete" && table === "files") {
        deletedFiles.push(String(eqs.id));
      }
      const count = head
        ? attachments.filter((a) => a.file_id === eqs.file_id).length
        : null;
      return Promise.resolve(resolve({ data: null, count, error: null }));
    },
  };
  return builder;
}

function serviceFrom(table: string) {
  const builder = {
    select: () => builder,
    eq: async () => ({
      count:
        table === "ai_document_extractions" ? extractionRefs : employeeDocRefs,
      error: null,
    }),
  };
  return builder;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: rlsFrom,
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removedBlobs.push(...paths);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: serviceFrom }),
}));

const { detachFileAction } = await import("./files-actions");

beforeEach(() => {
  attachments = [{ id: ATTACHMENT_ID, file_id: FILE_ID }];
  extractionRefs = 0;
  employeeDocRefs = 0;
  removedBlobs.length = 0;
  deletedFiles.length = 0;
});

describe("detachFileAction", () => {
  it("deletes the blob and file once nothing references it", async () => {
    const res = await detachFileAction(ATTACHMENT_ID);
    expect(res).toEqual({ ok: true, data: { deletedBlob: true } });
    expect(deletedFiles).toEqual([FILE_ID]);
  });

  it("keeps a scanned file its extraction still references", async () => {
    extractionRefs = 1;
    const res = await detachFileAction(ATTACHMENT_ID);
    expect(res).toEqual({ ok: true, data: { deletedBlob: false } });
    expect(attachments).toHaveLength(0);
    expect(deletedFiles).toEqual([]);
    expect(removedBlobs).toEqual([]);
  });

  it("keeps a file an employee document references", async () => {
    employeeDocRefs = 1;
    const res = await detachFileAction(ATTACHMENT_ID);
    expect(res).toEqual({ ok: true, data: { deletedBlob: false } });
    expect(deletedFiles).toEqual([]);
  });

  it("keeps the file while it has other attachments", async () => {
    attachments.push({ id: "other", file_id: FILE_ID });
    const res = await detachFileAction(ATTACHMENT_ID);
    expect(res).toEqual({ ok: true, data: { deletedBlob: false } });
    expect(deletedFiles).toEqual([]);
  });
});
