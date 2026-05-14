import { notFound } from "next/navigation";

import { getChannelHeaderAction } from "@/features/chat/actions/channels";
import { listChannelsAction } from "@/features/chat/actions/list-channels";
import {
  listMessagesAction,
  listReactionsAction,
} from "@/features/chat/actions/messages";
import { ChatShell } from "@/features/chat/components/chat-shell";
import { CHAT_MESSAGES_PAGE_SIZE, chatKeys } from "@/features/chat/keys";
import { requireUserContext } from "@/lib/auth/context";
import { getDisplayName } from "@/lib/avatars";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const ctx = await requireUserContext();
  const { channelId } = await params;

  // Pre-check membership: si el RPC del header falla, devolvemos 404.
  // Esto evita gastar Suspense en algo que va a romper.
  const header = await getChannelHeaderAction(channelId);
  if (!header.ok) notFound();

  const dehydratedState = await prefetchQueries([
    {
      queryKey: chatKeys.channels(),
      queryFn: () => runAction(() => listChannelsAction()),
    },
    {
      queryKey: chatKeys.channel(channelId),
      queryFn: () => runAction(() => getChannelHeaderAction(channelId)),
    },
    {
      infinite: true,
      queryKey: chatKeys.messages(channelId),
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        runAction(() =>
          listMessagesAction({
            channelId,
            cursor: pageParam ?? null,
            limit: CHAT_MESSAGES_PAGE_SIZE,
          }),
        ),
      initialPageParam: null as string | null,
    },
    {
      queryKey: chatKeys.reactions(channelId),
      queryFn: () => runAction(() => listReactionsAction(channelId)),
    },
  ]);

  const displayName = getDisplayName(
    ctx.profile.firstName,
    ctx.profile.lastName,
    ctx.email,
  );

  return (
    <Hydrate state={dehydratedState}>
      <ChatShell
        activeChannelId={channelId}
        currentUserId={ctx.userId}
        currentUserDisplayName={displayName}
      />
    </Hydrate>
  );
}
