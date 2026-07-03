import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { DateRangeProvider } from "@/components/providers/date-range-provider";
import { ScopeProvider } from "@/components/providers/scope-provider";
import { ScopeSelector } from "@/components/scope-selector";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { BrowserNotifier } from "@/features/notifications/components/browser-notifier";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { GlobalSearchTrigger } from "@/features/search/components/global-search-trigger";
import { getCurrentUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import {
  isDivision,
  isFiscalFilter,
  type InvoicingChannelSummary,
  type Scope,
} from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense in depth: the proxy already redirects unauthenticated requests,
  // but a server-side check here protects against any proxy misconfiguration.
  const ctx = await getCurrentUserContext();
  if (!ctx) {
    redirect("/auth/login");
  }

  const supabase = await createClient();
  const { data: channelsData } = await supabase
    .from("invoicing_channels")
    .select("id, name, division, is_fiscal, is_active")
    .order("division")
    .order("is_fiscal", { ascending: false });

  const channels: InvoicingChannelSummary[] = (channelsData ?? [])
    .filter((row) => isDivision(row.division))
    .map((row) => ({
      id: row.id,
      name: row.name,
      division: row.division as "dz" | "jouve",
      is_fiscal: row.is_fiscal,
      is_active: row.is_active,
    }));

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value;
  const defaultOpen = sidebarCookie === "true";

  // Read scope from the cookie to avoid the "all channels" flash
  // during the client's first render.
  const scopeCookie = cookieStore.get("jouve_scope")?.value;
  let initialScope: Scope | undefined;
  if (scopeCookie) {
    try {
      const parsed = JSON.parse(decodeURIComponent(scopeCookie)) as Partial<Scope>;
      initialScope = {
        division: isDivision(parsed.division) ? parsed.division : null,
        fiscalFilter: isFiscalFilter(parsed.fiscalFilter)
          ? parsed.fiscalFilter
          : "all",
      };
    } catch {
      initialScope = undefined;
    }
  }

  return (
    <ScopeProvider channels={channels} initialScope={initialScope}>
      <DateRangeProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar
            userEmail={ctx.email}
            userRoles={ctx.roles}
            profile={{
              firstName: ctx.profile.firstName,
              lastName: ctx.profile.lastName,
              avatarUrl: resolveAvatarUrl(supabase, ctx.profile.avatarPath),
              avatarColor: ctx.profile.avatarColor,
            }}
          />
          <SidebarInset className="min-w-0">
            <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <SidebarTrigger className="-ml-1" />
              <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
                <GlobalSearchTrigger />
                <ScopeSelector />
                <NotificationBell currentUserId={ctx.userId} />
              </div>
            </header>
            <main className="min-w-0 flex-1 px-4 py-6 max-md:pb-24 sm:px-6 lg:px-8">
              {children}
            </main>
            <MobileTabBar userRoles={ctx.roles} />
            <BrowserNotifier currentUserId={ctx.userId} />
          </SidebarInset>
        </SidebarProvider>
      </DateRangeProvider>
    </ScopeProvider>
  );
}
