import { redirect } from "next/navigation";

import { getOrCreateSelfChannelAction } from "@/features/chat/actions/channels";
import { listChannelsAction } from "@/features/chat/actions/list-channels";
import { ChatShell } from "@/features/chat/components/chat-shell";
import { chatKeys } from "@/features/chat/keys";
import type { ChannelListItem } from "@/features/chat/types";
import { requireUserContext } from "@/lib/auth/context";
import { getDisplayName } from "@/lib/avatars";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

// The chat list only: a channel's messages load when it is opened. With a
// single channel (just "Mis notas") there is nothing to choose, so it opens.
export default async function ChatRootPage() {
  const ctx = await requireUserContext();
  const self = await getOrCreateSelfChannelAction();
  if (!self.ok) {
    throw new Error(self.error);
  }

  const list = await listChannelsAction();
  const channels: ChannelListItem[] = list.ok ? list.data : [];
  if (list.ok && channels.length <= 1) {
    redirect(`/chat/${channels[0]?.id ?? self.data.channelId}`);
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: chatKeys.channels(),
      queryFn: () => runAction(async () => list),
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
        activeChannelId={null}
        currentUserId={ctx.userId}
        currentUserDisplayName={displayName}
      />
    </Hydrate>
  );
}
