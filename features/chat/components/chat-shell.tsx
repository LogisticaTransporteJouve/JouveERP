"use client";

import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { ChannelHeader } from "./channel-header";
import { ChannelList } from "./channel-list";
import { MessageThread } from "./message-thread";

type Props = {
  activeChannelId: string | null;
  currentUserId: string;
};

export function ChatShell({ activeChannelId, currentUserId }: Props) {
  return (
    <div className="grid h-[calc(100vh-3.5rem-3rem)] grid-cols-[260px_1fr] overflow-hidden rounded-lg border bg-card">
      <aside className="border-r">
        <Suspense fallback={<ChannelListSkeleton />}>
          <ChannelList
            activeChannelId={activeChannelId}
            currentUserId={currentUserId}
          />
        </Suspense>
      </aside>
      <section className="flex h-full min-h-0 flex-col">
        {activeChannelId ? (
          <>
            <Suspense fallback={<HeaderSkeleton />}>
              <ChannelHeader
                channelId={activeChannelId}
                currentUserId={currentUserId}
              />
            </Suspense>
            <div className="flex min-h-0 flex-1 flex-col">
              <Suspense fallback={<ThreadSkeleton />}>
                <MessageThread
                  channelId={activeChannelId}
                  currentUserId={currentUserId}
                />
              </Suspense>
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

function ChannelListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3">
      <Skeleton className="size-8 rounded-full" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Cargando mensajes…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <p className="text-sm text-muted-foreground">
        Elegí un chat de la lista o tocá "Nuevo" para empezar uno.
      </p>
    </div>
  );
}
