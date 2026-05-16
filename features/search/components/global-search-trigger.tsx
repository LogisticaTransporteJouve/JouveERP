"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { GlobalSearchDialog } from "./global-search-dialog";

export function GlobalSearchTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K (Mac) / Ctrl+K (Windows/Linux) abre el dialog.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground"
      >
        <Search className="size-3" />
        <span className="hidden sm:inline">Buscar…</span>
        <kbd className="hidden rounded border px-1.5 text-[10px] sm:inline-block">
          ⌘K
        </kbd>
      </Button>
      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
