// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../../actions/proposal-actions", () => ({
  acceptAiProposalAction: async () => ({
    ok: true,
    data: { resultId: "nd-1", note: null },
  }),
  dismissAiProposalAction: vi.fn(),
  prepareInsightProposalAction: vi.fn(),
}));

const { useAcceptAiProposal } = await import("./use-insight-proposal");

describe("useAcceptAiProposal", () => {
  it("refreshes every cached query and the dashboard, not only the insights", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAcceptAiProposal(), { wrapper });
    result.current.mutate("p1");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith();
  });
});
