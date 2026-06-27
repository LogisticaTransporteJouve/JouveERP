"use client";

import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type ColumnDef,
  type ExpandedState,
} from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  useChartOfAccounts,
  useDeleteChartAccount,
} from "../hooks/use-chart-of-accounts";
import {
  buildAccountTree,
  COA_ACCOUNT_TYPE_LABEL,
  COA_SYSTEM_ROLE_LABEL,
  type ChartAccount,
  type ChartAccountWithChildren,
} from "../schema";

import { ChartAccountDialog } from "./chart-account-dialog";

type DialogState =
  | { mode: "create"; parentSuggestion?: ChartAccount }
  | { mode: "edit"; account: ChartAccount }
  | null;

export function ChartOfAccountsTree() {
  const { data: accounts } = useChartOfAccounts();
  const deleteMut = useDeleteChartAccount();
  const confirm = useConfirm();

  const tree = useMemo(() => buildAccountTree(accounts), [accounts]);

  // Expand the chapters (level 1) by default so the chart is visible.
  const [expanded, setExpanded] = useState<ExpandedState>(() => {
    const initial: Record<string, boolean> = {};
    for (const a of accounts) if (a.level === 1) initial[a.id] = true;
    return initial;
  });
  const [dialogState, setDialogState] = useState<DialogState>(null);

  const columns = useMemo<ColumnDef<ChartAccountWithChildren>[]>(() => {
    async function handleDelete(account: ChartAccount) {
      const ok = await confirm({
        title: `Borrar cuenta ${account.code}`,
        description: `${account.name}. Esta acción no se puede deshacer.`,
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(account.id, {
        onSuccess: () => toast.success("Cuenta borrada."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        id: "account",
        header: "Cuenta",
        enableSorting: false,
        cell: ({ row }) => {
          const node = row.original;
          const canExpand = row.getCanExpand();
          return (
            <div
              className={cn(
                "flex items-center gap-2",
                !node.is_active && "opacity-50",
              )}
              style={{ paddingLeft: `${row.depth * 20}px` }}
            >
              <button
                type="button"
                onClick={
                  canExpand ? row.getToggleExpandedHandler() : undefined
                }
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
                  canExpand ? "hover:bg-muted" : "invisible",
                )}
                aria-label={row.getIsExpanded() ? "Colapsar" : "Expandir"}
              >
                {row.getIsExpanded() ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </button>

              {canExpand ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}

              <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                {node.code}
              </span>
              <span className="flex-1 truncate text-sm font-medium">
                {node.name}
              </span>

              <Badge
                variant="outline"
                className="hidden text-xs font-normal md:inline-flex"
              >
                {COA_ACCOUNT_TYPE_LABEL[node.account_type]}
              </Badge>
              {node.system_role && (
                <Badge variant="secondary" className="text-xs">
                  {COA_SYSTEM_ROLE_LABEL[node.system_role]}
                </Badge>
              )}
              {!node.is_active && (
                <Badge variant="outline" className="text-xs">
                  Inactiva
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => {
          const node = row.original;
          const canAddChild = node.level < 8;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Acciones"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setDialogState({ mode: "edit", account: node })}
                >
                  <Pencil className="size-4" />
                  Editar
                </DropdownMenuItem>
                {canAddChild && (
                  <DropdownMenuItem
                    onClick={() =>
                      setDialogState({
                        mode: "create",
                        parentSuggestion: node,
                      })
                    }
                  >
                    <Plus className="size-4" />
                    Agregar hija
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleDelete(node)}
                >
                  <Trash2 className="size-4" />
                  Borrar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
  }, [confirm, deleteMut]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Plan de cuentas
          </h1>
          <p className="text-sm text-muted-foreground">
            Jerarquía contable. Las cuentas con rol del sistema son destinos
            de asientos automáticos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
            Expandir todo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExpanded({})}>
            Colapsar todo
          </Button>
          <Button onClick={() => setDialogState({ mode: "create" })}>
            <Plus />
            Nueva cuenta
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={tree}
        getRowId={(a) => a.id}
        getSubRows={(a) => (a.children.length > 0 ? a.children : undefined)}
        expanded={expanded}
        onExpandedChange={setExpanded}
        emptyMessage="Sin cuentas. Creá la primera para empezar."
      />

      {dialogState && (
        <ChartAccountDialog
          mode={dialogState.mode}
          account={dialogState.mode === "edit" ? dialogState.account : undefined}
          parentSuggestion={
            dialogState.mode === "create"
              ? dialogState.parentSuggestion
              : undefined
          }
          allAccounts={accounts}
          open={dialogState !== null}
          onOpenChange={(open) => {
            if (!open) setDialogState(null);
          }}
        />
      )}
    </>
  );
}
