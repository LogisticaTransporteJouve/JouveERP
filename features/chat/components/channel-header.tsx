"use client";

import {
  Bell,
  BellOff,
  ChevronLeft,
  LogOut,
  Pin,
  Settings,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";

import {
  useChannelHeader,
  useChannels,
  useLeaveChannel,
  useToggleChannelMute,
} from "../hooks/use-chat";

import { ChannelSettingsDialog } from "./channel-settings-dialog";

type Props = {
  channelId: string;
  currentUserId: string;
  /** Shown as a back chevron below md — returns to the channel list pane. */
  onBack?: () => void;
};

export function ChannelHeader({ channelId, currentUserId, onBack }: Props) {
  const { data } = useChannelHeader(channelId);
  const { data: channels } = useChannels();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleMute = useToggleChannelMute(channelId);
  const leave = useLeaveChannel();
  const router = useRouter();
  const confirm = useConfirm();

  // `is_muted` lives in chat_channel_members; we read it from the list
  // that's already cached (avoids an extra fetch).
  const isMuted = useMemo(
    () => channels.find((c) => c.id === channelId)?.is_muted ?? false,
    [channels, channelId],
  );

  const handleToggleMute = async () => {
    try {
      await toggleMute.mutateAsync(!isMuted);
      toast.success(!isMuted ? "Notificaciones silenciadas." : "Notificaciones activadas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error.");
    }
  };

  const handleLeaveDm = async () => {
    const ok = await confirm({
      title: "Cerrar este chat",
      description: "Vas a poder reabrirlo después escribiéndole de nuevo a esta persona.",
      confirmLabel: "Cerrar",
    });
    if (!ok) return;
    try {
      await leave.mutateAsync(channelId);
      router.push("/chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error.");
    }
  };

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
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 max-md:gap-2 max-md:px-3">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-1 size-8 shrink-0 md:hidden"
            aria-label="Volver a la lista"
            onClick={onBack}
          >
            <ChevronLeft className="size-5" />
          </Button>
        ) : null}
        {leading}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{data.display_name}</h2>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>

        {data.kind !== "self" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Opciones del chat"
              >
                <Settings className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleToggleMute}>
                {isMuted ? (
                  <>
                    <Bell className="size-3.5" />
                    Activar notificaciones
                  </>
                ) : (
                  <>
                    <BellOff className="size-3.5" />
                    Silenciar
                  </>
                )}
              </DropdownMenuItem>
              {data.kind === "group" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                    <Settings className="size-3.5" />
                    Configurar grupo
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLeaveDm}>
                    <LogOut className="size-3.5" />
                    Cerrar chat
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {data.kind === "group" ? (
        <ChannelSettingsDialog
          channelId={channelId}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          currentUserId={currentUserId}
        />
      ) : null}
    </>
  );
}
