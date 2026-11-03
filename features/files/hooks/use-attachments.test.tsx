// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const listAttachmentsAction = vi.fn(async () => ({
  ok: false as const,
  error: "No se pudieron leer los adjuntos.",
}));

vi.mock("@/hooks/use-realtime-invalidate", () => ({
  useRealtimeInvalidate: () => undefined,
}));
vi.mock("../actions/files-actions", () => ({
  detachFileAction: vi.fn(),
  getSignedFileUrlAction: vi.fn(),
  listAttachmentsAction: () => listAttachmentsAction(),
  uploadFileAction: vi.fn(),
}));

const { useAttachments } = await import("./use-attachments");

describe("useAttachments", () => {
  it("surfaces a failed read as an error, once, instead of an empty list", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useAttachments("purchase_invoice", "p1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe(
      "No se pudieron leer los adjuntos.",
    );
    // No self-invalidation: the failed read is not refetched in a loop.
    await new Promise((r) => setTimeout(r, 50));
    expect(listAttachmentsAction).toHaveBeenCalledTimes(1);
  });
});
