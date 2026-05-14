"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";

import type { Reaction } from "../types";

type Props = {
  reactions: Reaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
  disabled?: boolean;
  align?: "start" | "end";
};

export function ReactionBar({
  reactions,
  currentUserId,
  onToggle,
  disabled,
  align = "start",
}: Props) {
  const grouped = useMemo(() => groupByEmoji(reactions), [reactions]);
  if (grouped.length === 0) return null;
  return (
    <div
      className={cn(
        "mt-1 flex flex-wrap gap-1",
        align === "end" && "justify-end",
      )}
    >
      {grouped.map(({ emoji, users, mine }) => (
        <button
          key={emoji}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(emoji)}
          title={users.join(", ")}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs leading-none transition-colors",
            mine
              ? "border-foreground/40 bg-accent text-foreground"
              : "border-border bg-background text-foreground hover:bg-accent",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span>{emoji}</span>
          <span className="text-[10px] tabular-nums">{users.length}</span>
        </button>
      ))}
    </div>
  );

  function groupByEmoji(
    rs: Reaction[],
  ): Array<{ emoji: string; users: string[]; mine: boolean }> {
    const map = new Map<string, { users: string[]; mine: boolean }>();
    for (const r of rs) {
      const bucket = map.get(r.emoji) ?? { users: [], mine: false };
      bucket.users.push(r.user_id);
      if (r.user_id === currentUserId) bucket.mine = true;
      map.set(r.emoji, bucket);
    }
    return Array.from(map, ([emoji, v]) => ({ emoji, ...v }));
  }
}
