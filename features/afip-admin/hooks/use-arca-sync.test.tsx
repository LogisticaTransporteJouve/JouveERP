// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

type Progress = {
  running: { startedAt: string; imported: number } | null;
  last: { finishedAt: string; imported: number; error: string | null } | null;
};
let progress: Progress;
const getArcaSyncProgressAction = vi.fn(async () => ({
  ok: true as const,
  data: progress,
}));
vi.mock("../actions/afip-admin-actions", () => ({
  getArcaSyncProgressAction: () => getArcaSyncProgressAction(),
}));
vi.mock("./use-afip-admin", () => ({
  useRequestArcaSync: () => ({
    isPending: false,
    mutate: (_: unknown, opts: { onSuccess: () => void }) => opts.onSuccess(),
  }),
}));

const { useArcaSync } = await import("./use-arca-sync");
const { invoicesKeys } = await import("@/features/invoices/lib/invoices-keys");

const OLD = {
  finishedAt: "2026-11-05T10:00:00.000Z",
  imported: 3,
  error: null,
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useArcaSync(), { wrapper });
  return { qc, invalidate, ...hook };
}

describe("useArcaSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    progress = { running: null, last: OLD };
  });

  it("refreshes the invoices when a run starts and ends between two polls", async () => {
    const { qc, invalidate, result } = setup();
    await waitFor(() => expect(getArcaSyncProgressAction).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        qc.getQueryData(["afip-admin", "sync-progress"]) ?? true,
      ).toBeTruthy(),
    );

    act(() => result.current.start());
    expect(result.current.busy).toBe(true);

    progress = {
      running: null,
      last: { finishedAt: new Date().toISOString(), imported: 12, error: null },
    };
    await act(async () => {
      await qc.refetchQueries();
    });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Se importaron 12 comprobantes de ARCA.",
        { id: "arca-sync" },
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: invoicesKeys.all });
    expect(result.current.busy).toBe(false);
  });

  it("keeps waiting while the last finished run is the one from before the click", async () => {
    const { qc, result } = setup();
    await waitFor(() => expect(getArcaSyncProgressAction).toHaveBeenCalled());

    act(() => result.current.start());
    await act(async () => {
      await qc.refetchQueries();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);
  });
});
