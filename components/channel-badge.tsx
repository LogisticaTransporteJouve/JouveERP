"use client";

import { useAllChannels } from "@/components/providers/scope-provider";
import { Badge } from "@/components/ui/badge";
import { isMainChannel } from "@/lib/scope";
import { cn } from "@/lib/utils";

/** Marks a treasury row of a segregated channel (DZ Instalaciones) with its
 *  short label: treasury is shared, so its rows show there with the mark.
 *  Nothing for a main channel or no channel. */
export function ChannelBadge({
  channelId,
  className,
}: {
  channelId: string | null | undefined;
  className?: string;
}) {
  const channels = useAllChannels();
  const channel = channelId
    ? channels.find((c) => c.id === channelId)
    : undefined;
  if (!channel || isMainChannel(channel)) return null;
  return (
    <Badge
      variant="outline"
      className={cn("ml-1.5 align-middle font-normal", className)}
      title={channel.name}
    >
      {channel.short_label || channel.name}
    </Badge>
  );
}
