"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { searchChatMessagesAction } from "../actions/search";
import { chatKeys } from "../keys";

export function useChatSearch(
  query: string,
  channelId: string | null = null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...chatKeys.all, "search", query, channelId ?? "all"],
    queryFn: () =>
      runAction(() =>
        searchChatMessagesAction({ query, channelId, limit: 30 }),
      ),
    enabled: options.enabled && query.trim().length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
