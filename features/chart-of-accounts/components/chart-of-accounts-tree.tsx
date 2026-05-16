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

  const [expanded, setExpanded] = useState<Set<string>>(
    // Por default expandimos los capítulos (level 1) para que se vea el plan.
    () => new Set(accounts.filter((a) => a.level === 1).map((a) => a.id)),
  );
  const [dialogState, setDialogState] = useState<DialogState>(null);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(accounts.map((a) => a.id)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

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
          <Button variant="outline" size="sm" onClick={expandAll}>
            Expandir todo
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Colapsar todo
          </Button>
          <Button onClick={() => setDialogState({ mode: "create" })}>
            <Plus />
            Nueva cuenta
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {tree.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            Sin cuentas. Creá la primera para empezar.
          </div>
        ) : (
          <ul className="divide-y">
            {tree.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                onCreateChild={(parent) =>
                  setDialogState({ mode: "create", parentSuggestion: parent })
                }
                onEdit={(account) => setDialogState({ mode: "edit", account })}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>

      {dialogState && (
        <ChartAccountDialog
          mode={dialogState.mode}
          account={dialogState.mode === "edit" ? dialogState.account : undefined}
          parentSuggestion={
            dialogState.mode === "create" ? dialogState.parentSuggestion : undefined
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

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onCreateChild,
  onEdit,
  onDelete,
}: {
  node: ChartAccountWithChildren;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onCreateChild: (parent: ChartAccount) => void;
  onEdit: (account: ChartAccount) => void;
  onDelete: (account: ChartAccount) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isLeaf = !hasChildren;
  const canAddChild = node.level < 8;

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 hover:bg-muted/40",
          !node.is_active && "opacity-50",
        )}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
            hasChildren ? "hover:bg-muted" : "invisible",
          )}
          aria-label={isOpen ? "Colapsar" : "Expandir"}
        >
          {isOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>

        {isLeaf ? (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="size-4 shrink-0 text-muted-foreground" />
        )}

        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
          {node.code}
        </span>

        <span className="flex-1 truncate text-sm font-medium">{node.name}</span>

        <Badge variant="outline" className="hidden text-xs font-normal md:inline-flex">
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
            <DropdownMenuItem onClick={() => onEdit(node)}>
              <Pencil className="size-4" />
              Editar
            </DropdownMenuItem>
            {canAddChild && (
              <DropdownMenuItem onClick={() => onCreateChild(node)}>
                <Plus className="size-4" />
                Agregar hija
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(node)}
            >
              <Trash2 className="size-4" />
              Borrar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isOpen && hasChildren && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onCreateChild={onCreateChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
