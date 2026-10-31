"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  addChannelMembersAction,
  leaveChannelAction,
  removeChannelMemberAction,
  toggleChannelMuteAction,
  updateChannelAction,
} from "../actions/channel-admin";
import {
  createGroupAction,
  getChannelHeaderAction,
  markChannelReadAction,
  openOrCreateDmAction,
} from "../actions/channels";
import { listAssignableUsersAction } from "../actions/list-assignable-users";
import { listChannelsAction } from "../actions/list-channels";
import {
  deleteMessageAction,
  editMessageAction,
  listMessagesAction,
  listReactionsAction,
  sendMessageAction,
  toggleReactionAction,
} from "../actions/messages";
import { CHAT_MESSAGES_PAGE_SIZE, chatKeys } from "../keys";
import type { Message, MessagesPage } from "../types";

// Channels list ---------------------------------------------------------

export function useChannels() {
  return useSuspenseQuery({
    queryKey: chatKeys.channels(),
    queryFn: () => runAction(() => listChannelsAction()),
  });
}

// "Lite" variant for showing a global badge from outside /chat
// (e.g. sidebar). Does not suspend. Computes the total unread message count.
//
// 3-layer freshness strategy:
//   1. Realtime: invalidates on INSERT/UPDATE in chat_messages.
//   2. refetchInterval: 15s fallback in case the realtime WS drops or
//      the event never arrives (common when the browser sleeps the tab).
//   3. refetchOnWindowFocus (TanStack Query default): rechecks immediately
//      when returning to the tab.
export function useChatUnreadCountLite() {
  const q = useQuery({
    queryKey: chatKeys.channels(),
    queryFn: () => runAction(() => listChannelsAction()),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  useChannelsRealtime();
  return (q.data ?? []).reduce(
    (sum, c) => sum + (c.is_muted ? 0 : c.unread_count),
    0,
  );
}

export function useChannelsRealtime() {
  useRealtimeInvalidate([
    {
      table: "chat_channels",
      queryKeys: [chatKeys.channels()],
    },
    {
      table: "chat_messages",
      queryKeys: [chatKeys.channels()],
    },
    {
      // mute toggle + last_read_at sync across devices, and joining/leaving
      // groups refreshes the sidebar instantly.
      table: "chat_channel_members",
      queryKeys: [chatKeys.channels()],
    },
  ]);
}

// Channel header --------------------------------------------------------

export function useChannelHeader(channelId: string) {
  return useSuspenseQuery({
    queryKey: chatKeys.channel(channelId),
    queryFn: () => runAction(() => getChannelHeaderAction(channelId)),
  });
}

// Assignable users (for new chat dialog) --------------------------------

export function useAssignableUsers(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: chatKeys.assignableUsers(),
    queryFn: () => runAction(() => listAssignableUsersAction()),
    enabled: options.enabled,
  });
}

// Messages (infinite + realtime) ----------------------------------------

export function useChannelMessages(channelId: string) {
  const query = useSuspenseInfiniteQuery({
    queryKey: chatKeys.messages(channelId),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listMessagesAction({
          channelId,
          cursor: pageParam ?? null,
          limit: CHAT_MESSAGES_PAGE_SIZE,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: MessagesPage) => lastPage.nextCursor,
  });

  // Pages load older ones going backward; reverse so the top→bottom render
  // shows old at the top and new at the bottom. Dedupe by id in case a
  // dupe arrives from the realtime invalidation before the fetch finishes.
  const messages = useMemo<Message[]>(() => {
    const seen = new Set<string>();
    const out: Message[] = [];
    // Walk pages from oldest to newest: the API already returns each
    // page in ascending order, and pages arrive newest first — the
    // oldest is the last one.
    for (let i = query.data.pages.length - 1; i >= 0; i--) {
      for (const msg of query.data.pages[i]!.messages) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        out.push(msg);
      }
    }
    return out;
  }, [query.data]);

  return { ...query, messages };
}

export function useChannelMessagesRealtime(channelId: string) {
  useRealtimeInvalidate([
    {
      table: "chat_messages",
      filter: `channel_id=eq.${channelId}`,
      queryKeys: [chatKeys.messages(channelId), chatKeys.channels()],
    },
  ]);
}

// Reactions -------------------------------------------------------------

export function useChannelReactions(channelId: string) {
  return useSuspenseQuery({
    queryKey: chatKeys.reactions(channelId),
    queryFn: () => runAction(() => listReactionsAction(channelId)),
  });
}

export function useChannelReactionsRealtime(channelId: string) {
  useRealtimeInvalidate([
    {
      table: "chat_message_reactions",
      queryKeys: [chatKeys.reactions(channelId)],
    },
  ]);
}

// Mutations -------------------------------------------------------------

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      channelId: string;
      body: string;
      replyToId?: string | null;
      mentionUserIds?: string[];
    }) => runAction(() => sendMessageAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: chatKeys.messages(variables.channelId),
      });
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

export function useEditMessage(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; body: string }) =>
      runAction(() => editMessageAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.messages(channelId) });
    },
  });
}

export function useDeleteMessage(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      runAction(() => deleteMessageAction(messageId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.messages(channelId) });
    },
  });
}

export function useToggleReaction(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; emoji: string }) =>
      runAction(() => toggleReactionAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.reactions(channelId) });
    },
  });
}

export function useOpenOrCreateDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (otherUserId: string) =>
      runAction(() => openOrCreateDmAction(otherUserId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createGroupAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

export function useMarkChannelRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      runAction(() => markChannelReadAction(channelId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

export function useUpdateChannel(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null }) =>
      runAction(() => updateChannelAction({ channelId, ...input })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channel(channelId) });
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

export function useAddChannelMembers(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      runAction(() => addChannelMembersAction({ channelId, userIds })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channel(channelId) });
    },
  });
}

export function useRemoveChannelMember(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      runAction(() => removeChannelMemberAction({ channelId, userId })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channel(channelId) });
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

export function useLeaveChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      runAction(() => leaveChannelAction(channelId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}

export function useToggleChannelMute(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (muted: boolean) =>
      runAction(() => toggleChannelMuteAction({ channelId, muted })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatKeys.channels() });
    },
  });
}
