import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ChannelsReadError } from "@/components/channels-read-error";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import {
  ScopeProvider,
  SideKeyed,
} from "@/components/providers/scope-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BrowserNotifier } from "@/features/notifications/components/browser-notifier";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { getCurrentUserContext } from "@/lib/auth/context";
import { isFiscalOnly } from "@/lib/auth/permissions";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import { readInvoicingChannels } from "@/lib/channels";
import {
  SCOPE_COOKIE,
  type InvoicingChannelSummary,
  type ScopeSide,
} from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";
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
  // Shared (React cache) with pages that also list channels in this request.
  // Fiscal first, as the forms expect. A failed read is passed on as such:
  // the labels and side filters must not take it for "no channels".
  const channelsRead = await readInvoicingChannels();
  const channels: InvoicingChannelSummary[] = (
    channelsRead.ok ? [...channelsRead.channels] : []
  )
    .sort((a, b) => Number(b.is_fiscal) - Number(a.is_fiscal))
    .map((row) => ({
      id: row.id,
      name: row.name,
      is_fiscal: row.is_fiscal,
      is_active: row.is_active,
    }));

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value;
  const defaultOpen = sidebarCookie !== "false";

  // Read the side from the cookie to avoid a flash of the other side during
  // the client's first render. A fiscal-only user is pinned to fiscal.
  const scopeLocked = isFiscalOnly(ctx.access);
  const initialFiscalFilter: ScopeSide | undefined =
    scopeLocked || cookieStore.get(SCOPE_COOKIE)
      ? await readScopeCookie()
      : undefined;

  return (
    <ScopeProvider
      channels={channels}
      channelsFailed={!channelsRead.ok}
      initialFiscalFilter={initialFiscalFilter}
      locked={scopeLocked}
    >
      <SidebarProvider
        defaultOpen={defaultOpen}
        className="h-svh min-h-0 overflow-hidden"
      >
        <AppSidebar
          userEmail={ctx.email}
          userAccess={ctx.access}
          profile={{
            firstName: ctx.profile.firstName,
            lastName: ctx.profile.lastName,
            avatarUrl: resolveAvatarUrl(supabase, ctx.profile.avatarPath),
            avatarColor: ctx.profile.avatarColor,
          }}
        />
        {/* The canvas card scrolls on its own, under its sticky header. */}
        <SidebarInset className="min-h-0 min-w-0 overflow-y-auto md:shadow-none md:ring-1 md:ring-border">
          <AppHeader
            actions={<NotificationBell currentUserId={ctx.userId} />}
          />
          <div className="min-w-0 flex-1 px-4 py-6 max-md:pb-24 sm:px-6 lg:px-8">
            <ChannelsReadError className="mb-4" />
            <SideKeyed>{children}</SideKeyed>
          </div>
          <MobileTabBar userAccess={ctx.access} />
          <BrowserNotifier currentUserId={ctx.userId} />
        </SidebarInset>
      </SidebarProvider>
    </ScopeProvider>
  );
}
