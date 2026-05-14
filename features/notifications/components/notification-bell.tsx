"use client";

import { Bell, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "@/components/user-avatar";
import { getDisplayName } from "@/lib/avatars";
import { cn } from "@/lib/utils";

import {
  useMarkAllRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationsRealtime,
  useUnreadCount,
} from "../hooks/use-notifications";
import {
  formatNotificationTime,
  getNotificationHref,
  getNotificationPreview,
  getNotificationTitle,
} from "../lib/format";
import type { Notification } from "../types";

type Props = {
  currentUserId: string;
};

export function NotificationBell({ currentUserId }: Props) {
  const [open, setOpen] = useState(false);
  const { data: unreadCount = 0 } = useUnreadCount();
  const { data: items = [], isLoading } = useNotifications("all", {
    enabled: open,
  });
  useNotificationsRealtime(currentUserId);

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();
  const router = useRouter();

  const handleClick = async (notif: Notification) => {
    const href = getNotificationHref(notif);
    if (notif.read_at === null) {
      markRead.mutate(notif.id);
    }
    if (href) {
      router.push(href);
      setOpen(false);
    }
  };

  // La primera vez que el user abre el bell, pedimos permiso para
  // browser notifications (Notification API). Hace nada si ya fue
  // accept/deny — el SO recuerda la elección.
  const requestBrowserPermission = () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {
        // El user puede cerrar el prompt; nada que hacer.
      });
    }
  };

  const handleMarkAll = async () => {
    try {
      await markAll.mutateAsync();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error.");
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) requestBrowserPermission();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-9"
          aria-label={
            unreadCount > 0
              ? `Notificaciones (${unreadCount} sin leer)`
              : "Notificaciones"
          }
        >
          <Bell className="size-4" />
          {unreadCount > 0 ? (
            <Badge className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px]">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-sm font-semibold">Notificaciones</h3>
          {unreadCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleMarkAll}
              disabled={markAll.isPending}
            >
              <Check className="size-3.5" />
              Marcar todas
            </Button>
          ) : null}
        </div>
        <ScrollArea className="max-h-[28rem]">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Cargando…
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No tenés notificaciones todavía.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((notif) => (
                <li key={notif.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-accent",
                      notif.read_at === null && "bg-accent/40",
                    )}
                    onClick={() => handleClick(notif)}
                  >
                    <UserAvatar
                      firstName={notif.sender_first_name}
                      lastName={notif.sender_last_name}
                      email={notif.sender_email}
                      avatarUrl={notif.sender_avatar_url}
                      color={notif.sender_avatar_color}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="truncate text-sm">
                          <span className="font-medium">
                            {getDisplayName(
                              notif.sender_first_name,
                              notif.sender_last_name,
                              notif.sender_email,
                            )}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {getNotificationTitle(notif)}
                          </span>
                        </p>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {formatNotificationTime(notif.created_at)}
                        </span>
                      </div>
                      <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                        {getNotificationPreview(notif)}
                      </p>
                    </div>
                    {notif.read_at === null ? (
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/70"
                        aria-label="Sin leer"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
