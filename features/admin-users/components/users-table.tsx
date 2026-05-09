"use client";

import { MoreHorizontal, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { highestRole, type Role } from "@/lib/auth/permissions";
import type { UserWithRoles } from "@/lib/auth/users";

import { AssignRolesDialog } from "./assign-roles-dialog";
import { InviteUserDialog } from "./invite-user-dialog";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  finance: "Finanzas",
  operations: "Operaciones",
  warehouse: "Depósito",
  driver: "Chofer",
};

import { formatArgentineDateTime } from "@/lib/format";

const formatDate = formatArgentineDateTime;

export function UsersTable({
  users,
  actorRoles,
  currentUserId,
}: {
  users: UserWithRoles[];
  actorRoles: Role[];
  currentUserId: string;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<UserWithRoles | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => user.email.toLowerCase().includes(query));
  }, [users, search]);

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
          <InviteUserDialog actorRoles={actorRoles} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Último acceso</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay usuarios que coincidan.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => {
                const top = highestRole(user.roles);
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{user.email}</span>
                        {user.id === currentUserId ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] uppercase tracking-wide"
                          >
                            Vos
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Sin roles
                          </span>
                        ) : (
                          user.roles.map((role) => (
                            <Badge
                              key={role}
                              variant={role === top ? "default" : "secondary"}
                              className="gap-1"
                            >
                              {role === "owner" ? (
                                <ShieldCheck className="size-3" />
                              ) : null}
                              {ROLE_LABEL[role]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.lastSignInAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Acciones"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(user)}>
                            Editar roles
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <AssignRolesDialog
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          user={{
            id: editing.id,
            email: editing.email,
            roles: editing.roles,
          }}
          actorRoles={actorRoles}
        />
      ) : null}
    </>
  );
}
