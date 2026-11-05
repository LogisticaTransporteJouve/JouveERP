"use client";

import { CircleHelp } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useScope } from "@/components/providers/scope-provider";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { IconButton } from "@/components/ui/icon-button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { APP_WINDOW, MANUAL_WINDOW } from "@/lib/manual/windows";

import { navItemForPath, navSectionForItem } from "./nav-items";

// Sticky over the scrolling canvas, on the canvas's own surface and hairline
// so it reads as part of the card.
export function AppHeader({ actions }: { actions: React.ReactNode }) {
  const { fiscalFilter, locked } = useScope();
  const pathname = usePathname();
  const item = navItemForPath(pathname, fiscalFilter);
  const section = item ? navSectionForItem(item) : undefined;

  // Names this tab so the guide's links back to the app land here instead
  // of replacing the guide.
  useEffect(() => {
    if (!window.name) window.name = APP_WINDOW;
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:rounded-t-xl">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />
      {item && (
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap text-xs">
            {section && (
              <>
                {/* Only the page's own crumb shows on a phone. */}
                <BreadcrumbItem className="hidden md:inline-flex">
                  {section.label}
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
              </>
            )}
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        {/* The guide section of this screen (app/manual resolves the route);
            static HTML, so a plain link, in the guide's own reused tab. */}
        {/* The guide refuses a fiscal-only user (lib/manual/serve.ts). */}
        {!locked && (
          <IconButton label="Ayuda de esta pantalla" variant="ghost" asChild>
            <a
              href={`/manual/para?ruta=${encodeURIComponent(pathname)}`}
              target={MANUAL_WINDOW}
            >
              <CircleHelp />
            </a>
          </IconButton>
        )}
        {actions}
      </div>
    </header>
  );
}
