"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  deleteAiSessionAction,
  getAiSessionMessagesAction,
  listAiSessionsAction,
} from "../actions/chat-actions";
import { aiKeys } from "../lib/ai-keys";

const THIRTY_SECONDS = 30_000;

export function useAiSessions() {
  return useQuery({
    queryKey: aiKeys.sessions(),
    queryFn: () => runAction(() => listAiSessionsAction()),
    staleTime: THIRTY_SECONDS,
  });
}

/**
 * Loads a session's messages. `enabled` is false for live (not-yet-persisted)
 * chats so we don't fetch an empty/own conversation that useChat already holds.
 */
export function useAiSessionMessages(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: aiKeys.sessionMessages(sessionId),
    queryFn: () => runAction(() => getAiSessionMessagesAction(sessionId)),
    enabled,
    staleTime: Infinity,
  });
}

export function useDeleteAiSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      runAction(() => deleteAiSessionAction(sessionId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiKeys.sessions() });
    },
  });
}
