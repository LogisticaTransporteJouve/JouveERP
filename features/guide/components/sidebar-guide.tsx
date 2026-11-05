"use client";

import {
  BookOpen,
  ChevronRight,
  Circle,
  CircleCheck,
  Compass,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  useSidebar,
} from "@/components/ui/sidebar";

import {
  useGuideState,
  useSetGuideCollapsed,
  useSetGuideItemDone,
} from "../hooks/use-guide";
import { guideForPath } from "../lib/route-guides";
import { SETUP_ITEMS } from "../lib/setup-checklist";
import type { GuideItemStatus } from "../schema";

// Only a first-paint hint: the saved state lives in user_guide_states.
const COLLAPSED_HINT_KEY = "jouve.guide.collapsed";

function readHint(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHint(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_HINT_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the server state still applies.
  }
}

/** The sidebar guide: help for the current screen and the go-live
 *  checklist, collapsible and remembered per user. */
export function SidebarGuide() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { data } = useGuideState();
  const setCollapsed = useSetGuideCollapsed();
  const [hint, setHint] = useState(false);

  useEffect(() => setHint(readHint()), []);
  useEffect(() => {
    if (data) writeHint(data.collapsed);
  }, [data]);

  const collapsed = data?.collapsed ?? hint;
  const routeGuide = guideForPath(pathname);
  const items = data?.items ?? [];
  const done = items.filter((i) => i.state !== "pending").length;

  if (!routeGuide && items.length === 0) return null;

  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => {
        setHint(!open);
        writeHint(!open);
        setCollapsed.mutate(!open, {
          onError: (err) => toast.error(err.message),
        });
      }}
      className="group/guide mt-auto"
    >
      <SidebarGroup className="pt-0">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 hover:text-sidebar-foreground">
            <Compass className="size-3.5" />
            <span>Guía</span>
            {items.length > 0 && done < items.length && (
              <span className="ml-1 tabular-nums" aria-label="Puesta en marcha">
                {done}/{items.length}
              </span>
            )}
            <ChevronRight className="ml-auto size-3 transition-transform duration-200 group-data-[state=open]/guide:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SidebarGroupContent className="space-y-3 px-2 pb-2 text-xs">
            {routeGuide && (
              <section aria-label="Esta pantalla" className="space-y-1">
                <p className="font-medium text-sidebar-foreground">
                  {routeGuide.title}
                </p>
                <p className="text-muted-foreground">{routeGuide.summary}</p>
                {routeGuide.steps && (
                  <ol className="text-muted-foreground list-decimal space-y-0.5 pl-4">
                    {routeGuide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                {/* The guide is static HTML the app serves, not a Next
                    page: a plain link, in its own tab. */}
                <a
                  href={`/manual/para?ruta=${encodeURIComponent(pathname)}`}
                  target="_blank"
                  rel="noopener"
                  className="text-muted-foreground hover:text-sidebar-foreground flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  <BookOpen className="size-3 shrink-0" />
                  Ver los pasos en la guía
                </a>
              </section>
            )}
            {items.length > 0 && (
              <SetupChecklist
                items={items}
                done={done}
                onNavigate={() => setOpenMobile(false)}
              />
            )}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function SetupChecklist({
  items,
  done,
  onNavigate,
}: {
  items: GuideItemStatus[];
  done: number;
  onNavigate: () => void;
}) {
  const setDone = useSetGuideItemDone();
  const [showAll, setShowAll] = useState(false);

  if (done === items.length && !showAll) {
    return (
      <p className="text-muted-foreground flex items-center gap-1">
        <CircleCheck className="size-3.5 shrink-0" />
        Puesta en marcha completa.
        <button
          type="button"
          className="ml-auto underline-offset-2 hover:underline"
          onClick={() => setShowAll(true)}
        >
          Ver
        </button>
      </p>
    );
  }

  // The next step gets its explanation; the rest show on hover.
  const next = items.find((i) => i.state === "pending")?.key;

  return (
    <section aria-label="Puesta en marcha" className="space-y-1">
      <p className="font-medium text-sidebar-foreground">
        Puesta en marcha ({done} de {items.length})
      </p>
      <ul className="space-y-1">
        {items.map((status) => {
          const item = SETUP_ITEMS.find((i) => i.key === status.key);
          if (!item) return null;
          const isDone = status.state !== "pending";
          return (
            <li key={item.key} className="flex items-start gap-1.5">
              {isDone ? (
                <CircleCheck
                  className="mt-px size-3.5 shrink-0"
                  aria-label="Hecho"
                />
              ) : (
                <Circle
                  className="text-muted-foreground mt-px size-3.5 shrink-0"
                  aria-label="Pendiente"
                />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  title={item.description}
                  onClick={onNavigate}
                  className={
                    isDone
                      ? "text-muted-foreground hover:underline"
                      : "text-sidebar-foreground hover:underline"
                  }
                >
                  {item.label}
                </Link>
                {item.key === next && (
                  <p className="text-muted-foreground">{item.description}</p>
                )}
              </div>
              {status.state !== "done_data" && (
                <button
                  type="button"
                  className="text-muted-foreground shrink-0 underline-offset-2 hover:text-sidebar-foreground hover:underline disabled:opacity-50"
                  disabled={setDone.isPending}
                  onClick={() =>
                    setDone.mutate(
                      { key: item.key, done: status.state === "pending" },
                      { onError: (err) => toast.error(err.message) },
                    )
                  }
                >
                  {status.state === "pending" ? "Ya está" : "Deshacer"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
