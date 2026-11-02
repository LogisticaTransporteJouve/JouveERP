import { notFound } from "next/navigation";

import { getChannelHeaderAction } from "@/features/chat/actions/channels";
import { listChannelsAction } from "@/features/chat/actions/list-channels";
import { ChatShell } from "@/features/chat/components/chat-shell";
import { chatKeys } from "@/features/chat/keys";
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

  // Membership check and the chat list in parallel. The messages are not
  // awaited here: the thread loads them when it mounts, so the list and the
  // header show at once instead of waiting for the whole history.
  const [header, dehydratedState] = await Promise.all([
    getChannelHeaderAction(channelId),
    prefetchQueries([
      {
        queryKey: chatKeys.channels(),
        queryFn: () => runAction(() => listChannelsAction()),
      },
      {
        queryKey: chatKeys.channel(channelId),
        queryFn: () => runAction(() => getChannelHeaderAction(channelId)),
      },
    ]),
  ]);
  if (!header.ok) notFound();

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
