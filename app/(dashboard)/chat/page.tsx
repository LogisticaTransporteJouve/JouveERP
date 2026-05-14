import { redirect } from "next/navigation";

import { getOrCreateSelfChannelAction } from "@/features/chat/actions/channels";

export const dynamic = "force-dynamic";

export default async function ChatRootPage() {
  const res = await getOrCreateSelfChannelAction();
  if (!res.ok) {
    throw new Error(res.error);
  }
  redirect(`/chat/${res.data.channelId}`);
}
