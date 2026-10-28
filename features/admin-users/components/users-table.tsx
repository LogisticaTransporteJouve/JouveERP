"use client";

import { MoreHorizontal, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { highestRole, userCan, type Access } from "@/lib/auth/permissions";
import type { UserWithRoles } from "@/lib/auth/users";

import { useUsersList } from "../hooks/use-admin-users";
import { ROLE_LABELS } from "../lib/role-labels";
import { AccessDialog } from "./access-dialog";
import { InviteUserDialog } from "./invite-user-dialog";

import { formatArgentineDateTime } from "@/lib/format";

const formatDate = formatArgentineDateTime;

export function UsersTable({
  actorAccess,
  currentUserId,
}: {
  actorAccess: Access;
  currentUserId: string;
}) {
  const { data: users } = useUsersList();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<UserWithRoles | null>(null);
  const canEditAccess =
    userCan(actorAccess, "users:assign_role") ||
    userCan(actorAccess, "users:manage_access");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => user.email.toLowerCase().includes(query));
  }, [users, search]);

  const columns = useMemo<ColumnDef<UserWithRoles>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.email}</span>
            {row.original.id === currentUserId ? (
              <Badge
                variant="secondary"
                className="text-[10px] uppercase tracking-wide"
              >
                Vos
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "roles",
        header: "Roles",
        enableSorting: false,
        cell: ({ row }) => {
          const top = highestRole(row.original.roles);
          return (
            <div className="flex flex-wrap gap-1">
              {row.original.roles.length === 0 ? (
                <span className="text-xs text-muted-foreground">Sin roles</span>
              ) : (
                row.original.roles.map((role) => (
                  <Badge
                    key={role}
                    variant={role === top ? "default" : "secondary"}
                    className="gap-1"
                  >
                    {role === "owner" ? (
                      <ShieldCheck className="size-3" />
                    ) : null}
                    {ROLE_LABELS[role]}
                  </Badge>
                ))
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "lastSignInAt",
        header: "Último acceso",
        cell: ({ row }) => formatDate(row.original.lastSignInAt),
        meta: { cellClassName: "text-sm text-muted-foreground" },
      },
      {
        accessorKey: "createdAt",
        header: "Creado",
        cell: ({ row }) => formatDate(row.original.createdAt),
        meta: { cellClassName: "text-sm text-muted-foreground" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-10", align: "right" },
        cell: ({ row }) =>
          // Nobody edits their own access (set_user_access refuses it too).
          canEditAccess && row.original.id !== currentUserId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Acciones">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(row.original)}>
                  Accesos
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [currentUserId, canEditAccess],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        <div className="ml-auto">
          <InviteUserDialog actorAccess={actorAccess} />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(user) => user.id}
        emptyMessage="No hay usuarios que coincidan."
        wrapperClassName="mt-4"
      />

      {editing ? (
        <AccessDialog
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          user={{ id: editing.id, email: editing.email }}
          actorAccess={actorAccess}
        />
      ) : null}
    </>
  );
}
