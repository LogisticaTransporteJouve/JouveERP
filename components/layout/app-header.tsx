"use client";

import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

import { navItemForPath, navSectionForItem } from "./nav-items";

// Sticky over the scrolling canvas, on the canvas's own surface and hairline
// so it reads as part of the card.
export function AppHeader({ actions }: { actions: React.ReactNode }) {
  const item = navItemForPath(usePathname());
  const section = item ? navSectionForItem(item) : undefined;

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
        {actions}
      </div>
    </header>
  );
}
