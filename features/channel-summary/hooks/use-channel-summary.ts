"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getChannelSummaryAction } from "../actions/channel-summary-actions";
import { channelSummaryKeys } from "../lib/channel-summary-keys";
import type { ChannelSummaryInput } from "../schema";

export function useChannelSummary(input: ChannelSummaryInput) {
  return useSuspenseQuery({
    queryKey: channelSummaryKeys.summary(input),
    queryFn: () => runAction(() => getChannelSummaryAction(input)),
  });
}
