"use client";

import {
  Boxes,
  Container,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Receipt,
  Route,
  Sparkles,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSidebar } from "@/components/ui/sidebar";
import {
  highestRole,
  userCan,
  type Permission,
  type Role,
  type Access,
} from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

type TabItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
};

const DASHBOARD: TabItem = {
  href: "/dashboard",
  label: "Inicio",
  icon: LayoutDashboard,
};
const CHAT: TabItem = { href: "/chat", label: "Chat", icon: MessageSquare };
const TRIPS: TabItem = {
  href: "/trips",
  label: "Viajes",
  icon: Route,
  permission: "trips:read",
};

// First-level destinations per highest role; everything else lives behind
// "Más" (the sidebar sheet). Items still filter through userCan so a role
// matrix change never shows a dead tab.
const TABS_BY_ROLE: Record<Role, TabItem[]> = {
  owner: [
    DASHBOARD,
    {
      href: "/transactions",
      label: "Caja",
      icon: Wallet,
      permission: "transactions:read",
    },
    {
      href: "/receipts",
      label: "Recibos",
      icon: Receipt,
      permission: "receipts:read",
    },
    { href: "/ai", label: "IA", icon: Sparkles, permission: "ai:chat" },
  ],
  admin: [
    DASHBOARD,
    {
      href: "/transactions",
      label: "Caja",
      icon: Wallet,
      permission: "transactions:read",
    },
    {
      href: "/receipts",
      label: "Recibos",
      icon: Receipt,
      permission: "receipts:read",
    },
    { href: "/ai", label: "IA", icon: Sparkles, permission: "ai:chat" },
  ],
  finance: [
    DASHBOARD,
    {
      href: "/transactions",
      label: "Caja",
      icon: Wallet,
      permission: "transactions:read",
    },
    {
      href: "/receipts",
      label: "Recibos",
      icon: Receipt,
      permission: "receipts:read",
    },
    { href: "/ai", label: "IA", icon: Sparkles, permission: "ai:chat" },
  ],
  operations: [
    DASHBOARD,
    TRIPS,
    {
      href: "/cargas",
      label: "Cargas",
      icon: Container,
      permission: "shipments:read",
    },
    CHAT,
  ],
  warehouse: [
    DASHBOARD,
    {
      href: "/pallets",
      label: "Pallets",
      icon: Boxes,
      permission: "pallets:read",
    },
    {
      href: "/warehouses",
      label: "Depósitos",
      icon: Warehouse,
      permission: "warehouses:read",
    },
    CHAT,
  ],
  driver: [DASHBOARD, TRIPS, CHAT],
};

export function MobileTabBar({ userAccess }: { userAccess: Access }) {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();

  const role = highestRole(userAccess.roles);
  const items = (role ? TABS_BY_ROLE[role] : [DASHBOARD, CHAT]).filter(
    (item) => !item.permission || userCan(userAccess, item.permission),
  );

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
    >
      <div
        className="grid h-16"
        style={{ gridTemplateColumns: `repeat(${items.length + 1}, 1fr)` }}
      >
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[11px]",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <item.icon className={cn("size-5", active && "stroke-[2.25]")} />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground"
        >
          <Menu className="size-5" />
          Más
        </button>
      </div>
    </nav>
  );
}
