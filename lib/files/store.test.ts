import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The bytes are always removed with the service role (the caller's storage
// delete needs the files row).
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return { error: null };
        },
      }),
    },
  }),
}));

const { discardStoredFile, writeFileBlobAndRow } = await import("./store");

const FILE_ID = "77777777-7777-4777-8777-777777777777";

let insertError: { message: string } | null = null;
let deleteResult: { data: { id: string }[] | null; error: unknown } = {
  data: [],
  error: null,
};
const uploads: string[] = [];
const removed: string[] = [];
const inserted: unknown[] = [];

const client = {
  storage: {
    from: () => ({
      upload: async (path: string) => {
        uploads.push(path);
        return { error: null };
      },
      remove: async () => {
        throw new Error("the caller's client cannot remove a rowless blob");
      },
    }),
  },
  from: () => ({
    insert: async (row: unknown) => {
      inserted.push(row);
      return { error: insertError };
    },
    delete: () => ({
      eq: () => ({ select: async () => deleteResult }),
    }),
  }),
} as never;

const writeInput = {
  fileId: FILE_ID,
  bucketPath: `p/${FILE_ID}.pdf`,
  body: new Uint8Array([1]),
  userId: "u1",
  filename: "a.pdf",
  mimeType: "application/pdf",
  size: 1,
  source: "document_scan",
  logPrefix: "test.upload",
};

beforeEach(() => {
  insertError = null;
  deleteResult = { data: [], error: null };
  uploads.length = 0;
  removed.length = 0;
  inserted.length = 0;
});

describe("writeFileBlobAndRow", () => {
  it("writes the bytes, then the row", async () => {
    expect(await writeFileBlobAndRow(client, writeInput)).toBe("ok");
    expect(uploads).toEqual([writeInput.bucketPath]);
    expect(inserted).toEqual([
      expect.objectContaining({ id: FILE_ID, source: "document_scan" }),
    ]);
    expect(removed).toEqual([]);
  });

  it("removes the bytes when the row fails", async () => {
    insertError = { message: "rls" };
    expect(await writeFileBlobAndRow(client, writeInput)).toBe(
      "registry_failed",
    );
    expect(removed).toEqual([writeInput.bucketPath]);
  });
});

describe("discardStoredFile", () => {
  const stored = { fileId: FILE_ID, bucketPath: `p/${FILE_ID}.pdf` };

  it("removes the bytes once the row is gone", async () => {
    deleteResult = { data: [{ id: FILE_ID }], error: null };
    await discardStoredFile(client, stored);
    expect(removed).toEqual([stored.bucketPath]);
  });

  it("keeps the bytes when the row was not deleted, so no row points at nothing", async () => {
    deleteResult = { data: null, error: { message: "timeout" } };
    await discardStoredFile(client, stored);
    expect(removed).toEqual([]);

    deleteResult = { data: [], error: null };
    await discardStoredFile(client, stored);
    expect(removed).toEqual([]);
  });
});
