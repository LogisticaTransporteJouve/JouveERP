"use client";

import { Pin, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

import { useChannels, useChannelsRealtime } from "../hooks/use-chat";
import { formatRelativeShort } from "../lib/format-time";
import type { ChannelListItem } from "../types";

import { ChatSearchDialog } from "./chat-search-dialog";
import { NewChatDialog } from "./new-chat-dialog";

type Props = {
  activeChannelId: string | null;
  currentUserId: string;
};

export function ChannelList({ activeChannelId, currentUserId }: Props) {
  const { data: channels } = useChannels();
  useChannelsRealtime();
  const [newOpen, setNewOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K (Ctrl+K en Windows) abre la búsqueda. Solo cuando estamos en
  // /chat — el listener vive en el component, que se monta con el shell.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selfChannels = channels.filter((c) => c.kind === "self");
  const dms = channels.filter((c) => c.kind === "dm");
  const groups = channels.filter((c) => c.kind === "group");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-1.5 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Chat</h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Buscar (⌘K)"
            title="Buscar (⌘K)"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" />
            Nuevo
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-2 py-3">
          {selfChannels.length > 0 ? (
            <Section title="Mis notas">
              {selfChannels.map((c) => (
                <ChannelRow
                  key={c.id}
                  channel={c}
                  active={c.id === activeChannelId}
                  currentUserId={currentUserId}
                />
              ))}
            </Section>
          ) : null}

          <Section title={`Mensajes directos${dms.length ? ` · ${dms.length}` : ""}`}>
            {dms.length === 0 ? (
              <EmptyHint>No tenés DMs abiertos.</EmptyHint>
            ) : (
              dms.map((c) => (
                <ChannelRow
                  key={c.id}
                  channel={c}
                  active={c.id === activeChannelId}
                  currentUserId={currentUserId}
                />
              ))
            )}
          </Section>

          <Section title={`Grupos${groups.length ? ` · ${groups.length}` : ""}`}>
            {groups.length === 0 ? (
              <EmptyHint>No estás en ningún grupo.</EmptyHint>
            ) : (
              groups.map((c) => (
                <ChannelRow
                  key={c.id}
                  channel={c}
                  active={c.id === activeChannelId}
                  currentUserId={currentUserId}
                />
              ))
            )}
          </Section>
        </div>
      </ScrollArea>

      <NewChatDialog open={newOpen} onOpenChange={setNewOpen} />
      <ChatSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>
  );
}

function ChannelRow({
  channel,
  active,
  currentUserId,
}: {
  channel: ChannelListItem;
  active: boolean;
  currentUserId: string;
}) {
  const senderIsMe = channel.last_message_sender_id === currentUserId;
  const preview = channel.last_message_preview ?? "";
  return (
    <Link
      href={`/chat/${channel.id}`}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50",
      )}
    >
      <ChannelLeading channel={channel} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{channel.display_name}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {formatRelativeShort(channel.last_message_at)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {senderIsMe && preview ? "Vos: " : ""}
            {preview || (channel.last_message_at ? "" : "Sin mensajes")}
          </p>
          {channel.unread_count > 0 ? (
            <Badge variant="default" className="h-4 min-w-4 px-1.5 text-[10px]">
              {channel.unread_count > 99 ? "99+" : channel.unread_count}
            </Badge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function ChannelLeading({ channel }: { channel: ChannelListItem }) {
  if (channel.kind === "self") {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        <Pin className="size-3.5" />
      </div>
    );
  }
  if (channel.kind === "group") {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        <Users className="size-3.5" />
      </div>
    );
  }
  return (
    <UserAvatar
      firstName={null}
      lastName={null}
      email={channel.display_name}
      avatarUrl={channel.avatar_url}
      color={channel.avatar_color}
      size="sm"
    />
  );
}
