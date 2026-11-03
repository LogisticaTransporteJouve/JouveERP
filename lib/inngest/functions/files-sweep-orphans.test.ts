import { beforeEach, describe, expect, it, vi } from "vitest";

type Orphan = { id: string; bucket: string; bucket_path: string };

const h = vi.hoisted(() => ({
  handler: null as ((ctx: unknown) => Promise<unknown>) | null,
  found: [] as Orphan[],
  /** What delete_orphan_files returns: the files still orphan at delete. */
  stillOrphan: [] as Orphan[],
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  removed: [] as Array<{ bucket: string; paths: string[] }>,
  order: [] as string[],
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: (
      _config: unknown,
      handler: (ctx: unknown) => Promise<unknown>,
    ) => {
      h.handler = handler;
      return {};
    },
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      h.rpcCalls.push({ fn, args });
      h.order.push(fn);
      return {
        data: fn === "find_orphan_files" ? h.found : h.stillOrphan,
        error: null,
      };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          h.order.push("remove");
          h.removed.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

await import("./files-sweep-orphans");

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
};

const fileA = { id: "a", bucket: "files", bucket_path: "a.pdf" };
const fileB = { id: "b", bucket: "files", bucket_path: "b.pdf" };

beforeEach(() => {
  h.found = [];
  h.stillOrphan = [];
  h.rpcCalls.length = 0;
  h.removed.length = 0;
  h.order.length = 0;
});

describe("files-sweep-orphans", () => {
  it("removes only the bytes of files still orphan when their rows are deleted", async () => {
    h.found = [fileA, fileB];
    // b was attached between the find and the delete.
    h.stillOrphan = [fileA];
    await expect(h.handler?.({ step })).resolves.toEqual({ swept: 1 });
    expect(h.rpcCalls[1]).toEqual({
      fn: "delete_orphan_files",
      args: { p_ids: ["a", "b"], p_max_age: "1 hour" },
    });
    expect(h.removed).toEqual([{ bucket: "files", paths: ["a.pdf"] }]);
    expect(h.order).toEqual([
      "find_orphan_files",
      "delete_orphan_files",
      "remove",
    ]);
  });

  it("does nothing when there are no orphans", async () => {
    await expect(h.handler?.({ step })).resolves.toEqual({ swept: 0 });
    expect(h.order).toEqual(["find_orphan_files"]);
  });
});
