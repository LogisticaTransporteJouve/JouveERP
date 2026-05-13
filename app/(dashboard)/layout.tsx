import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { DateRangeProvider } from "@/components/providers/date-range-provider";
import { ScopeProvider } from "@/components/providers/scope-provider";
import { ScopeSelector } from "@/components/scope-selector";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getCurrentUserContext } from "@/lib/auth/context";
import { isDivision, type InvoicingChannelSummary } from "@/lib/scope";
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

  return (
    <ScopeProvider channels={channels}>
      <DateRangeProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar userEmail={ctx.email} userRoles={ctx.roles} />
          <SidebarInset>
            <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <SidebarTrigger className="-ml-1" />
              <div className="ml-auto">
                <ScopeSelector />
              </div>
            </header>
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </DateRangeProvider>
    </ScopeProvider>
  );
}
