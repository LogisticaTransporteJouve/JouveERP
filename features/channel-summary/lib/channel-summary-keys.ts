import type { ChannelSummaryInput } from "../schema";

export const channelSummaryKeys = {
  all: ["channel-summary"] as const,
  summary: (input: ChannelSummaryInput) =>
    [...channelSummaryKeys.all, "summary", input] as const,
};
