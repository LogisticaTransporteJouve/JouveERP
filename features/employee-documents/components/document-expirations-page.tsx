"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate } from "@/lib/format";

import { useExpiringDocuments } from "../hooks/use-employee-documents";
import {
  EMPLOYEE_DOCUMENT_KINDS,
  EMPLOYEE_DOCUMENT_KIND_LABEL,
  type EmployeeDocumentKind,
} from "../schema";

const ANY_KIND = "__any__";

export function DocumentExpirationsPage() {
  const query = useExpiringDocuments();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>(ANY_KIND);

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const term = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (kindFilter !== ANY_KIND && d.kind !== kindFilter) return false;
      if (term && !d.employee_name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [query.data, search, kindFilter]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Vencimientos de documentos
        </h1>
        <p className="text-sm text-muted-foreground">
          Papeles vencidos o por vencer en los próximos 30 días. La alerta
          in-app se dispara automáticamente cada mañana a los roles
          owner/admin/operations.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar empleado…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_KIND}>Todos los tipos</SelectItem>
            {EMPLOYEE_DOCUMENT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {EMPLOYEE_DOCUMENT_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {query.data && (
          <span className="ml-auto text-sm text-muted-foreground">
            {filtered.length} de {query.data.length}
          </span>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {(query.data?.length ?? 0) === 0
              ? "Ningún documento por vencer en los próximos 30 días. 🎉"
              : "Sin resultados para el filtro actual."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empleado</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Días restantes</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => {
                const isExpired = d.days_until_expiry < 0;
                const isCritical = !isExpired && d.days_until_expiry <= 7;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.employee_name}
                    </TableCell>
                    <TableCell>
                      {EMPLOYEE_DOCUMENT_KIND_LABEL[
                        d.kind as EmployeeDocumentKind
                      ] ?? d.kind}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {d.number ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatArgentineDate(d.expires_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="secondary"
                        className={
                          isExpired
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                            : isCritical
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                              : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        }
                      >
                        {isExpired
                          ? `Vencido hace ${-d.days_until_expiry}d`
                          : d.days_until_expiry === 0
                            ? "Vence hoy"
                            : `${d.days_until_expiry}d`}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        asChild
                      >
                        <Link
                          href={`/employees/${d.employee_id}`}
                          title="Ver empleado"
                        >
                          <ExternalLink className="size-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
