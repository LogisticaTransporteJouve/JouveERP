"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  BookCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Receipt,
  ReceiptText,
  ScrollText,
  Search,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
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
} from "@/components/ui/sidebar";
import { UserAvatar } from "@/components/user-avatar";
import {
  userCan,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";
import { getDisplayName } from "@/lib/avatars";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  {
    href: "/clients",
    label: "Clientes",
    icon: Users,
    permission: "clients:read",
  },
  {
    href: "/invoices",
    label: "Comprobantes",
    icon: ReceiptText,
    permission: "invoices:read",
  },
  {
    href: "/receipts",
    label: "Recibos",
    icon: ScrollText,
    permission: "receipts:read",
  },
  {
    href: "/accounts",
    label: "Cuentas",
    icon: Wallet,
    permission: "accounts:read",
  },
  {
    href: "/transactions",
    label: "Caja",
    icon: ArrowLeftRight,
    permission: "transactions:read",
  },
  {
    href: "/checks",
    label: "Cheques",
    icon: BookCheck,
    permission: "cheques:read",
  },
  {
    href: "/aging",
    label: "Aging",
    icon: AlertTriangle,
    permission: "clients:read",
  },
  {
    href: "/admin/users",
    label: "Usuarios",
    icon: ShieldCheck,
    permission: "users:read",
  },
  {
    href: "/admin/padron",
    label: "Padrón AFIP",
    icon: Search,
    permission: "padron:lookup",
  },
  {
    href: "/admin/afip/puntos-de-venta",
    label: "Puntos de venta",
    icon: Receipt,
    permission: "afip:admin",
  },
  {
    href: "/admin/afip/preview-pdf",
    label: "Preview PDF",
    icon: FileText,
    permission: "afip:admin",
  },
];

type ProfileSummary = {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  avatarColor: string;
};

export function AppSidebar({
  userEmail,
  userRoles,
  profile,
}: {
  userEmail: string;
  userRoles: Role[];
  profile: ProfileSummary;
}) {
  const pathname = usePathname();

  const visibleItems = navItems.filter(
    (item) => !item.permission || userCan(userRoles, item.permission),
  );

  const displayName = getDisplayName(
    profile.firstName,
    profile.lastName,
    userEmail,
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-0">
        <div className="flex h-12 items-center">
          <div className="flex w-12 shrink-0 items-center justify-center">
            <Image
              src="/jouve-logo.jpeg"
              alt="JouveERP"
              width={28}
              height={28}
              priority
              className="size-7 rounded-md"
            />
          </div>
          <span className="text-sm font-semibold tracking-tight whitespace-nowrap opacity-100 transition-opacity duration-150 delay-150 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:delay-0">
            Logística y Transporte Jouve
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                    >
                      <Link href={item.href}>
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={
                pathname === "/profile" || pathname.startsWith("/profile/")
              }
              tooltip={displayName}
              className="h-auto py-2"
            >
              <Link href="/profile">
                <UserAvatar
                  firstName={profile.firstName}
                  lastName={profile.lastName}
                  email={userEmail}
                  avatarUrl={profile.avatarUrl}
                  color={profile.avatarColor}
                  size="sm"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {displayName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {userEmail}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-end px-2 py-1 group-data-[collapsible=icon]:justify-center">
          <ThemeToggle />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <form action="/auth/logout" method="post" className="w-full">
              <SidebarMenuButton
                type="submit"
                tooltip="Cerrar sesión"
                className="w-full"
              >
                <LogOut className="size-4" />
                <span>Cerrar sesión</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
