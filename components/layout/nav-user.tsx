"use client";

import { ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { UserAvatar } from "@/components/user-avatar";
import { getDisplayName } from "@/lib/avatars";

export type ProfileSummary = {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  avatarColor: string;
};

function UserSummary({
  userEmail,
  profile,
}: {
  userEmail: string;
  profile: ProfileSummary;
}) {
  return (
    <>
      <UserAvatar
        firstName={profile.firstName}
        lastName={profile.lastName}
        email={userEmail}
        avatarUrl={profile.avatarUrl}
        color={profile.avatarColor}
        size="md"
        className="rounded-lg"
      />
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">
          {getDisplayName(profile.firstName, profile.lastName, userEmail)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {userEmail}
        </span>
      </span>
    </>
  );
}

export function NavUser({
  userEmail,
  profile,
}: {
  userEmail: string;
  profile: ProfileSummary;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  // Outside the menu: closing the menu unmounts its content, which would
  // drop a form rendered inside it before it submits.
  const logoutForm = useRef<HTMLFormElement>(null);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserSummary userEmail={userEmail} profile={profile} />
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="flex items-center gap-2 font-normal">
              <UserSummary userEmail={userEmail} profile={profile} />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" onClick={() => setOpenMobile(false)}>
                <UserRound />
                Perfil
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => logoutForm.current?.requestSubmit()}
            >
              <LogOut />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <form ref={logoutForm} action="/auth/logout" method="post" hidden />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
