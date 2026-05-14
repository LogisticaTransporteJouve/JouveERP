"use client";

import { Pin, Users } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";

import { useChannelHeader } from "../hooks/use-chat";

type Props = {
  channelId: string;
  currentUserId: string;
};

export function ChannelHeader({ channelId, currentUserId }: Props) {
  const { data } = useChannelHeader(channelId);

  let leading: React.ReactNode;
  let subtitle: string;
  if (data.kind === "self") {
    leading = (
      <div className="flex size-8 items-center justify-center rounded-full bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        <Pin className="size-4" />
      </div>
    );
    subtitle = "Solo vos podés ver esto. Útil para notas y links.";
  } else if (data.kind === "group") {
    leading = (
      <div className="flex size-8 items-center justify-center rounded-full bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        <Users className="size-4" />
      </div>
    );
    subtitle = `${data.members.length} miembros${data.description ? " · " + data.description : ""}`;
  } else {
    const other = data.members.find((m) => m.user_id !== currentUserId);
    leading = (
      <UserAvatar
        firstName={other?.first_name}
        lastName={other?.last_name}
        email={other?.email}
        avatarUrl={other?.avatar_url}
        color={other?.avatar_color}
        size="md"
      />
    );
    subtitle = other?.email ?? "";
  }

  return (
    <div className="flex items-center gap-3 border-b px-4 py-3">
      {leading}
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{data.display_name}</h2>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
