"use client";

import { ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useChatUnreadCountLite } from "@/features/chat/hooks/use-chat";
import type { Access } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

import {
  ASSISTANT_ITEM,
  canSee,
  navItemForPath,
  visibleSections,
  type NavItem,
} from "./nav-items";
import { NavTheme } from "./nav-theme";
import { NavUser, type ProfileSummary } from "./nav-user";

const PRIMARY_BUTTON =
  "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary/90 data-[active=true]:text-primary-foreground";

const ACTIVE_ITEM =
  "data-[active=true]:bg-primary/10 data-[active=true]:text-primary dark:data-[active=true]:bg-primary/25 dark:data-[active=true]:text-sidebar-foreground";

function NavLink({
  item,
  activeHref,
  badge = 0,
  primary = false,
}: {
  item: NavItem;
  activeHref: string | undefined;
  badge?: number;
  primary?: boolean;
}) {
  const { setOpenMobile } = useSidebar();
  const isActive = item.href === activeHref;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        size="sm"
        isActive={isActive}
        className={cn("text-xs", primary ? PRIMARY_BUTTON : ACTIVE_ITEM)}
      >
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          onClick={() => setOpenMobile(false)}
        >
          <item.icon />
          <span className={cn("truncate", isActive && "font-semibold")}>
            {item.label}
          </span>
          {badge > 0 && (
            <span
              className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium leading-none text-background"
              aria-label={`${badge} sin leer`}
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({
  userEmail,
  userAccess,
  profile,
}: {
  userEmail: string;
  userAccess: Access;
  profile: ProfileSummary;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const chatUnread = useChatUnreadCountLite();
  const activeHref = navItemForPath(pathname)?.href;
  const sections = visibleSections(userAccess);

  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader>
        <Link
          href="/dashboard"
          className="flex h-8 items-center gap-2 px-2"
          onClick={() => setOpenMobile(false)}
        >
          <Image
            src="/jouve-logo.jpeg"
            alt=""
            width={24}
            height={24}
            priority
            className="size-6 rounded-md"
          />
          <span className="text-base font-semibold tracking-tight">Jouve</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Principal">
          {canSee(userAccess, ASSISTANT_ITEM) && (
            <SidebarGroup>
              <SidebarMenu>
                <NavLink
                  item={ASSISTANT_ITEM}
                  activeHref={activeHref}
                  primary
                />
              </SidebarMenu>
            </SidebarGroup>
          )}
          {sections.map((section, index) => (
            <Collapsible
              key={section.label}
              defaultOpen
              className="group/collapsible"
            >
              <SidebarGroup className={cn(index > 0 && "pt-0")}>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="flex w-full items-center justify-between hover:text-sidebar-foreground">
                    {section.label}
                    <ChevronRight className="size-3 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {section.items.map((item) => (
                        <NavLink
                          key={item.href}
                          item={item}
                          activeHref={activeHref}
                          badge={item.href === "/chat" ? chatUnread : 0}
                        />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <NavTheme className="p-0" />
        <NavUser userEmail={userEmail} profile={profile} />
      </SidebarFooter>
    </Sidebar>
  );
}
