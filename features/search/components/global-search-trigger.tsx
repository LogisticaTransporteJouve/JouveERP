"use client";

import { Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// The dialog (and its search hook / action reference) is only needed once the
// user opens search, so it's split out of the dashboard shell bundle and
// mounted on first open. It stays mounted afterwards so the close animation
// and the per-query cache survive.
const GlobalSearchDialog = dynamic(
  () => import("./global-search-dialog").then((m) => m.GlobalSearchDialog),
  { ssr: false },
);

export function GlobalSearchTrigger() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K (Mac) / Ctrl+K (Windows/Linux) opens the dialog.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMounted(true);
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
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        className="text-muted-foreground"
      >
        <Search className="size-3" />
        <span className="hidden sm:inline">Buscar…</span>
        <kbd className="hidden rounded border px-1.5 text-[10px] sm:inline-block">
          ⌘K
        </kbd>
      </Button>
      {mounted && <GlobalSearchDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
