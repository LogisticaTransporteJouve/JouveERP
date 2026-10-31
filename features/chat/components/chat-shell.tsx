"use client";

import { Suspense, useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ChannelHeader } from "./channel-header";
import { ChannelList } from "./channel-list";
import { MessageThread } from "./message-thread";

type Props = {
  activeChannelId: string | null;
  currentUserId: string;
  currentUserDisplayName: string;
};

export function ChatShell({
  activeChannelId,
  currentUserId,
  currentUserDisplayName,
}: Props) {
  // Below md the shell shows ONE pane at a time (list ↔ thread); there is no
  // list-only route (/chat redirects to the self channel), so this is local
  // view state: picking a channel switches to the thread, back returns here.
  const [mobileView, setMobileView] = useState<"list" | "thread">(
    activeChannelId ? "thread" : "list",
  );

  useEffect(() => {
    if (activeChannelId) setMobileView("thread");
  }, [activeChannelId]);

  return (
    <div className="grid h-[calc(100dvh-7.5rem)] grid-cols-1 overflow-hidden rounded-lg border bg-card max-md:h-[calc(100dvh-11rem)] md:grid-cols-[260px_1fr]">
      <aside
        className={cn(
          "md:border-r",
          mobileView === "thread" && "max-md:hidden",
        )}
      >
        <Suspense fallback={<ChannelListSkeleton />}>
          <ChannelList
            activeChannelId={activeChannelId}
            currentUserId={currentUserId}
          />
        </Suspense>
      </aside>
      <section
        className={cn(
          "flex h-full min-h-0 flex-col",
          mobileView === "list" && "max-md:hidden",
        )}
      >
        {activeChannelId ? (
          <>
            <Suspense fallback={<HeaderSkeleton />}>
              <ChannelHeader
                channelId={activeChannelId}
                currentUserId={currentUserId}
                onBack={() => setMobileView("list")}
              />
            </Suspense>
            <div className="flex min-h-0 flex-1 flex-col">
              <Suspense fallback={<ThreadSkeleton />}>
                <MessageThread
                  channelId={activeChannelId}
                  currentUserId={currentUserId}
                  currentUserDisplayName={currentUserDisplayName}
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
        Elegí un chat de la lista o tocá &ldquo;Nuevo&rdquo; para empezar uno.
      </p>
    </div>
  );
}
