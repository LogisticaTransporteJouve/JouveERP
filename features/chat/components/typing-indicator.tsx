"use client";

import { useTypingListener } from "../hooks/use-typing";

type Props = {
  channelId: string;
  currentUserId: string;
};

export function TypingIndicator({ channelId, currentUserId }: Props) {
  const typing = useTypingListener(channelId, currentUserId);
  if (typing.length === 0) return null;

  const label = formatLabel(typing.map((t) => t.display_name));
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-0 text-xs text-muted-foreground">
      <div className="flex items-center gap-0.5">
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </div>
      <span>{label}</span>
    </div>
  );
}

function formatLabel(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} está escribiendo…`;
  if (names.length === 2) {
    return `${names[0]} y ${names[1]} están escribiendo…`;
  }
  return `${names.length} personas están escribiendo…`;
}
