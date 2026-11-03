// Mounts JouveERP's real dashboard shell in the browser, as app/(dashboard)/layout.tsx does:
// ScopeProvider → SidebarProvider → AppSidebar + SidebarInset (AppHeader, the canvas, MobileTabBar).
// The mock's app.js draws into `stage`; the active route comes through update(), and the sidebar
// and header read it through the next/navigation stub, so the nav item and breadcrumb follow it.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ScopeProvider } from "@/components/providers/scope-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { GlobalSearchTrigger } from "@/features/search/components/global-search-trigger";
import { isFiscalOnly, isRole, resolveAccess } from "@/lib/auth/permissions";
import type { InvoicingChannelSummary, ScopeSide } from "@/lib/scope";
import { cn } from "@/lib/utils";

// Virtual module built by build.mjs: the lucide-react icon nodes this mock names.
import { ICONS as icons } from "mock-icons";

import { setMockPath } from "./stubs/next-navigation";

type ShellConfig = {
  user?: { firstName: string; lastName: string; email: string; avatarColor?: string };
  roles?: string[];
  denied?: string[];
  scope?: ScopeSide;
  activePath?: string;
};
type View = { path?: string };

const CHANNELS: InvoicingChannelSummary[] = [
  { id: "jouve_fiscal", name: "Logística Jouve — Fiscal", is_fiscal: true, is_active: true },
  { id: "jouve_internal", name: "Logística Jouve — Interno", is_fiscal: false, is_active: true },
];

function Shell({ config, stage, onReady }: { config: ShellConfig; stage: HTMLElement; onReady: () => void }) {
  // Server actions are stubbed to { ok: false }: no retries, no polling noise.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } }));
  const u = config.user ?? { firstName: "Marta", lastName: "Giménez", email: "marta@jouve.test" };
  const roles = (config.roles ?? ["owner"]).filter(isRole);
  const access = resolveAccess(roles.length ? roles : ["owner"], config.denied ?? []);
  const scope: ScopeSide = config.scope ?? "fiscal";

  return (
    <QueryClientProvider client={client}>
      <ScopeProvider channels={CHANNELS} initialFiscalFilter={scope} locked={isFiscalOnly(access)}>
        <SidebarProvider defaultOpen className="h-svh min-h-0 overflow-hidden">
          <AppSidebar
            userEmail={u.email}
            userAccess={access}
            profile={{ firstName: u.firstName, lastName: u.lastName, avatarUrl: null, avatarColor: u.avatarColor ?? "blue" }}
          />
          <SidebarInset className="min-h-0 min-w-0 overflow-y-auto md:shadow-none md:ring-1 md:ring-border">
            <AppHeader
              actions={
                <>
                  <GlobalSearchTrigger />
                  <NotificationBell currentUserId="mock-user" />
                </>
              }
            />
            <div className="min-w-0 flex-1 px-4 py-6 max-md:pb-24 sm:px-6 lg:px-8">
              <div
                className="contents"
                ref={(el) => {
                  if (!el || stage.parentNode === el) return;
                  el.appendChild(stage);
                  onReady();
                }}
              />
            </div>
            <MobileTabBar userAccess={access} />
          </SidebarInset>
        </SidebarProvider>
      </ScopeProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export function mountShell(rootEl: HTMLElement, stage: HTMLElement, config: ShellConfig, onReady: () => void) {
  setMockPath(config.activePath ?? "/dashboard");
  createRoot(rootEl).render(<Shell config={config} stage={stage} onReady={onReady} />);
}

export function update(next: View) {
  if (next.path) setMockPath(next.path);
}

export { cn, icons, toast };
