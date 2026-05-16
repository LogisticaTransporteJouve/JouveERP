"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  BookCheck,
  ChevronRight,
  CreditCard,
  FileText,
  IdCard,
  LayoutDashboard,
  ListTree,
  LogOut,
  MessageSquare,
  Receipt,
  ReceiptText,
  ScrollText,
  Search,
  ShieldCheck,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useChatUnreadCountLite } from "@/features/chat/hooks/use-chat";
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
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
};

type NavSection = {
  label: string | null;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/chat", label: "Chat", icon: MessageSquare },
    ],
  },
  {
    label: "Ventas",
    items: [
      { href: "/clients", label: "Clientes", icon: Users, permission: "clients:read" },
      { href: "/invoices", label: "Comprobantes", icon: ReceiptText, permission: "invoices:read" },
      { href: "/receipts", label: "Recibos", icon: ScrollText, permission: "receipts:read" },
      { href: "/aging", label: "Aging clientes", icon: AlertTriangle, permission: "clients:read" },
    ],
  },
  {
    label: "Compras",
    items: [
      { href: "/suppliers", label: "Proveedores", icon: Truck, permission: "suppliers:read" },
      { href: "/suppliers/categories", label: "Categorías", icon: Tags, permission: "suppliers:read" },
      { href: "/purchases", label: "Compras", icon: ShoppingCart, permission: "purchase_invoices:read" },
      { href: "/payment-orders", label: "Órdenes de pago", icon: CreditCard, permission: "payment_orders:read" },
      { href: "/aging-suppliers", label: "Aging proveedores", icon: AlertTriangle, permission: "suppliers:read" },
    ],
  },
  {
    label: "Tesorería",
    items: [
      { href: "/accounts", label: "Cuentas", icon: Wallet, permission: "accounts:read" },
      { href: "/transactions", label: "Caja", icon: ArrowLeftRight, permission: "transactions:read" },
      { href: "/checks", label: "Cheques recibidos", icon: BookCheck, permission: "cheques:read" },
      { href: "/issued-checks", label: "Cheques propios", icon: BookCheck, permission: "issued_checks:read" },
    ],
  },
  {
    label: "Contabilidad",
    items: [
      { href: "/accounting/chart", label: "Plan de cuentas", icon: ListTree, permission: "accounting:read" },
    ],
  },
  {
    label: "Personal",
    items: [
      { href: "/employees", label: "Empleados", icon: IdCard, permission: "hr:read" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/users", label: "Usuarios", icon: ShieldCheck, permission: "users:read" },
      { href: "/admin/padron", label: "Padrón AFIP", icon: Search, permission: "padron:lookup" },
      { href: "/admin/afip/puntos-de-venta", label: "Puntos de venta", icon: Receipt, permission: "afip:admin" },
      { href: "/admin/afip/preview-pdf", label: "Preview PDF", icon: FileText, permission: "afip:admin" },
    ],
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
  const chatUnread = useChatUnreadCountLite();

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || userCan(userRoles, item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0);

  const displayName = getDisplayName(
    profile.firstName,
    profile.lastName,
    userEmail,
  );

  return (
    <Sidebar collapsible="icon" className="overflow-x-hidden">
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
      <SidebarContent className="overflow-x-hidden">
        {visibleSections.map((section, idx) => {
          const menu = (
            <SidebarMenu>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const badge = item.href === "/chat" ? chatUnread : 0;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                    >
                      <Link href={item.href}>
                        <span className="relative inline-flex shrink-0">
                          <Icon className="size-4" />
                          {badge > 0 ? (
                            <span
                              className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white"
                              aria-label={`${badge} sin leer`}
                            >
                              {badge > 99 ? "99+" : badge}
                            </span>
                          ) : null}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          );

          if (!section.label) {
            return (
              <SidebarGroup key={`top-${idx}`}>
                <SidebarGroupContent>{menu}</SidebarGroupContent>
              </SidebarGroup>
            );
          }

          return (
            <Collapsible
              key={section.label}
              defaultOpen
              className="group/collapsible"
            >
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="flex w-full items-center justify-between hover:text-sidebar-foreground">
                    {section.label}
                    <ChevronRight className="size-3 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <SidebarGroupContent>{menu}</SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="overflow-hidden p-0">
        <Link
          href="/profile"
          title={displayName}
          className={cn(
            "flex h-12 items-center overflow-hidden text-sidebar-foreground hover:bg-sidebar-accent",
            (pathname === "/profile" || pathname.startsWith("/profile/")) &&
              "bg-sidebar-accent",
          )}
        >
          <div className="flex w-12 shrink-0 items-center justify-center">
            <UserAvatar
              firstName={profile.firstName}
              lastName={profile.lastName}
              email={userEmail}
              avatarUrl={profile.avatarUrl}
              color={profile.avatarColor}
              size="sm"
            />
          </div>
          <div className="flex min-w-0 flex-col whitespace-nowrap pr-2 opacity-100 transition-opacity duration-150 delay-150 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:delay-0">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {userEmail}
            </span>
          </div>
        </Link>
        <div className="flex h-10 items-center overflow-hidden">
          <div className="flex w-12 shrink-0 items-center justify-center">
            <ThemeToggle />
          </div>
        </div>
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            title="Cerrar sesión"
            className="flex h-10 w-full items-center overflow-hidden text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <div className="flex w-12 shrink-0 items-center justify-center">
              <LogOut className="size-4" />
            </div>
            <span className="whitespace-nowrap pr-2 text-sm opacity-100 transition-opacity duration-150 delay-150 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:delay-0">
              Cerrar sesión
            </span>
          </button>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
