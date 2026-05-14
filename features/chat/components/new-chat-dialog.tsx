"use client";

import { Check, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { getDisplayName } from "@/lib/avatars";
import { cn } from "@/lib/utils";

import {
  useAssignableUsers,
  useCreateGroup,
  useOpenOrCreateDm,
} from "../hooks/use-chat";
import type { AssignableUser } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewChatDialog({ open, onOpenChange }: Props) {
  const [tab, setTab] = useState<"dm" | "group">("dm");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo chat</DialogTitle>
          <DialogDescription>
            Mensaje directo o grupo. Los grupos pueden tener varios miembros.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "dm" | "group")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="dm">Persona</TabsTrigger>
            <TabsTrigger value="group">Grupo</TabsTrigger>
          </TabsList>

          <TabsContent value="dm" className="pt-4">
            <DmForm
              open={open}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="group" className="pt-4">
            <GroupForm
              open={open}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DmForm({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { data: users, isLoading } = useAssignableUsers({ enabled: open });
  const openDm = useOpenOrCreateDm();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const list = useMemo(() => filterUsers(users ?? [], query), [users, query]);

  const handlePick = async (user: AssignableUser) => {
    try {
      const res = await openDm.mutateAsync(user.user_id);
      router.push(`/chat/${res.channelId}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al abrir DM.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o email…"
          className="pl-8"
        />
      </div>
      <ScrollArea className="h-64 rounded-md border">
        <ul className="divide-y">
          {isLoading ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              Cargando…
            </li>
          ) : list.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query ? "Sin resultados." : "No hay otros usuarios todavía."}
            </li>
          ) : (
            list.map((user) => (
              <li key={user.user_id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent"
                  onClick={() => handlePick(user)}
                  disabled={openDm.isPending}
                >
                  <UserAvatar
                    firstName={user.first_name}
                    lastName={user.last_name}
                    email={user.email}
                    avatarUrl={user.avatar_url}
                    color={user.avatar_color}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium">
                      {getDisplayName(user.first_name, user.last_name, user.email)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}

function GroupForm({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { data: users, isLoading } = useAssignableUsers({ enabled: open });
  const create = useCreateGroup();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const list = useMemo(() => filterUsers(users ?? [], query), [users, query]);

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleCreate = async () => {
    if (selected.size === 0) {
      toast.error("Agregá al menos un miembro.");
      return;
    }
    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        memberIds: Array.from(selected),
      });
      router.push(`/chat/${res.channelId}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear grupo.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del grupo *"
          maxLength={60}
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          rows={2}
          maxLength={280}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            Miembros {selected.size > 0 ? `(${selected.size})` : ""}
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…"
            className="pl-8"
          />
        </div>
        <ScrollArea className="h-48 rounded-md border">
          <ul className="divide-y">
            {isLoading ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Cargando…
              </li>
            ) : list.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Sin resultados.
              </li>
            ) : (
              list.map((user) => {
                const checked = selected.has(user.user_id);
                return (
                  <li key={user.user_id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 hover:bg-accent",
                        checked && "bg-accent/50",
                      )}
                      onClick={() => toggle(user.user_id)}
                    >
                      <UserAvatar
                        firstName={user.first_name}
                        lastName={user.last_name}
                        email={user.email}
                        avatarUrl={user.avatar_url}
                        color={user.avatar_color}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium">
                          {getDisplayName(user.first_name, user.last_name, user.email)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                      {checked ? (
                        <Check className="size-4 text-muted-foreground" />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </ScrollArea>
      </div>

      <DialogFooter>
        <Button onClick={onDone} variant="outline">
          Cancelar
        </Button>
        <Button onClick={handleCreate} disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Creando…" : "Crear grupo"}
        </Button>
      </DialogFooter>
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
