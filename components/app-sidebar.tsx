"use client";

import { LayoutDashboard } from "lucide-react";
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

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

export function AppSidebar() {
  const pathname = usePathname();

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
              {navItems.map((item) => {
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
        <div className="flex items-center justify-between px-2 py-1 group-data-[collapsible=icon]:justify-center">
          <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            Tema
          </span>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
