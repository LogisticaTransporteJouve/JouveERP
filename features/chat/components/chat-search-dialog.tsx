"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "@/components/user-avatar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getDisplayName } from "@/lib/avatars";

import { useChatSearch } from "../hooks/use-search";
import { formatRelativeShort } from "../lib/format-time";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChatSearchDialog({ open, onOpenChange }: Props) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 250);
  const router = useRouter();
  const { data: results = [], isFetching } = useChatSearch(debounced, null, {
    enabled: open && debounced.trim().length > 0,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Buscar en chat</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscá una palabra, frase o nombre…"
            className="pl-9"
          />
        </div>
        <ScrollArea className="max-h-96">
          {debounced.trim().length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Empezá a escribir para buscar.
            </p>
          ) : isFetching && results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Buscando…
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No se encontraron mensajes con &ldquo;{debounced}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      onOpenChange(false);
                      router.push(`/chat/${r.channel_id}`);
                    }}
                  >
                    <UserAvatar
                      firstName={r.sender_first_name}
                      lastName={r.sender_last_name}
                      email={r.sender_email}
                      avatarUrl={r.sender_avatar_url}
                      color={r.sender_avatar_color}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="truncate text-sm font-medium">
                          {getDisplayName(
                            r.sender_first_name,
                            r.sender_last_name,
                            r.sender_email,
                          )}
                        </p>
                        <span className="text-[10px] text-muted-foreground">
                          en {r.channel_display_name}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {formatRelativeShort(r.created_at)}
                        </span>
                      </div>
                      <p className="line-clamp-2 break-words text-sm text-muted-foreground">
                        {highlight(r.body, debounced)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent font-medium text-accent-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
