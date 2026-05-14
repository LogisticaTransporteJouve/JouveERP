"use client";

import { LogOut, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { getDisplayName } from "@/lib/avatars";
import { cn } from "@/lib/utils";

import {
  useAddChannelMembers,
  useAssignableUsers,
  useChannelHeader,
  useLeaveChannel,
  useRemoveChannelMember,
  useUpdateChannel,
} from "../hooks/use-chat";
import type { AssignableUser, ChannelMember } from "../types";

type Props = {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
};

export function ChannelSettingsDialog({
  channelId,
  open,
  onOpenChange,
  currentUserId,
}: Props) {
  const { data: header } = useChannelHeader(channelId);
  const update = useUpdateChannel(channelId);
  const addMembers = useAddChannelMembers(channelId);
  const removeMember = useRemoveChannelMember(channelId);
  const leave = useLeaveChannel();
  const router = useRouter();

  const [name, setName] = useState(header.name ?? "");
  const [description, setDescription] = useState(header.description ?? "");

  useEffect(() => {
    if (open) {
      setName(header.name ?? "");
      setDescription(header.description ?? "");
    }
  }, [open, header.name, header.description]);

  const myMembership = header.members.find((m) => m.user_id === currentUserId);
  const iAmAdmin = myMembership?.role === "admin";

  const handleSave = async () => {
    try {
      await update.mutateAsync({ name, description });
      toast.success("Grupo actualizado.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar.");
    }
  };

  const handleRemove = async (userId: string) => {
    const member = header.members.find((m) => m.user_id === userId);
    if (!member) return;
    if (
      !confirm(
        `¿Quitar a ${getDisplayName(member.first_name, member.last_name, member.email)} del grupo?`,
      )
    ) {
      return;
    }
    try {
      await removeMember.mutateAsync(userId);
      toast.success("Miembro removido.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al remover.");
    }
  };

  const handleLeave = async () => {
    if (!confirm("¿Salir del grupo? No vas a poder ver mensajes nuevos.")) return;
    try {
      await leave.mutateAsync(channelId);
      toast.success("Saliste del grupo.");
      onOpenChange(false);
      router.push("/chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al salir.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurar grupo</DialogTitle>
          <DialogDescription>
            {iAmAdmin
              ? "Renombrá, sumá miembros o sacá a quien ya no participa."
              : "Solo los administradores pueden editar el grupo."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Nombre</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              disabled={!iAmAdmin}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-description">Descripción</Label>
            <Textarea
              id="channel-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={280}
              disabled={!iAmAdmin}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Miembros ({header.members.length})</Label>
            </div>
            <ScrollArea className="max-h-48 rounded-md border">
              <ul className="divide-y">
                {header.members.map((member) => (
                  <li
                    key={member.user_id}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <UserAvatar
                      firstName={member.first_name}
                      lastName={member.last_name}
                      email={member.email}
                      avatarUrl={member.avatar_url}
                      color={member.avatar_color}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {getDisplayName(
                          member.first_name,
                          member.last_name,
                          member.email,
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.role === "admin" ? "Admin" : "Miembro"}
                      </p>
                    </div>
                    {iAmAdmin && member.user_id !== currentUserId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleRemove(member.user_id)}
                        disabled={removeMember.isPending}
                        aria-label="Quitar"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>

          {iAmAdmin ? (
            <AddMembersSection
              channelId={channelId}
              existingMemberIds={new Set(header.members.map((m) => m.user_id))}
            />
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleLeave}
            disabled={leave.isPending}
            className="text-foreground"
          >
            <LogOut className="size-4" />
            Salir del grupo
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
            {iAmAdmin ? (
              <Button
                type="button"
                onClick={handleSave}
                disabled={update.isPending || !name.trim()}
              >
                {update.isPending ? "Guardando…" : "Guardar"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMembersSection({
  channelId,
  existingMemberIds,
}: {
  channelId: string;
  existingMemberIds: Set<string>;
}) {
  const { data: users, isLoading } = useAssignableUsers({ enabled: true });
  const addMembers = useAddChannelMembers(channelId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const available = useMemo(
    () => (users ?? []).filter((u) => !existingMemberIds.has(u.user_id)),
    [users, existingMemberIds],
  );

  const filtered = useMemo(
    () => filterUsers(available, query),
    [available, query],
  );

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    try {
      await addMembers.mutateAsync(Array.from(selected));
      toast.success("Miembros agregados.");
      setSelected(new Set());
      setQuery("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error.");
    }
  };

  if (available.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label>Agregar miembros</Label>
      <div className="relative">
        <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar…"
          className="pl-8"
        />
      </div>
      <ScrollArea className="max-h-40 rounded-md border">
        <ul className="divide-y">
          {isLoading ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              Cargando…
            </li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              Sin resultados.
            </li>
          ) : (
            filtered.map((user) => {
              const checked = selected.has(user.user_id);
              return (
                <li key={user.user_id}>
                  <button
                    type="button"
                    onClick={() => toggle(user.user_id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 hover:bg-accent",
                      checked && "bg-accent/50",
                    )}
                  >
                    <UserAvatar
                      firstName={user.first_name}
                      lastName={user.last_name}
                      email={user.email}
                      avatarUrl={user.avatar_url}
                      color={user.avatar_color}
                      size="sm"
                    />
                    <span className="flex-1 truncate text-left text-sm">
                      {getDisplayName(user.first_name, user.last_name, user.email)}
                    </span>
                    {checked ? (
                      <Plus className="size-3.5 rotate-45 text-foreground" />
                    ) : (
                      <Plus className="size-3.5 text-muted-foreground" />
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </ScrollArea>
      {selected.size > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={addMembers.isPending}
          >
            Agregar {selected.size}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function filterUsers(users: AssignableUser[], query: string): AssignableUser[] {
  const q = query.trim().toLowerCase();
  if (!q) return users;
  return users.filter((u) => {
    const display = getDisplayName(u.first_name, u.last_name, u.email).toLowerCase();
    return display.includes(q) || u.email.toLowerCase().includes(q);
  });
}

// Re-export for callers that need the member shape locally.
export type { ChannelMember };
