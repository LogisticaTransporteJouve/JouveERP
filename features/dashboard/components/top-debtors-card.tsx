import { Users } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatMoneyWithCode } from "@/lib/format";

import type { TopDebtor } from "../schema";

export function TopDebtorsCard({ debtors }: { debtors: TopDebtor[] }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b p-4">
        <Users className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Top deudores</h2>
        <Link
          href="/aging"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Ver aging completo
        </Link>
      </div>
      {debtors.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          Sin cuentas por cobrar abiertas.
        </p>
      ) : (
        <ul className="divide-y">
          {debtors.map((d) => (
            <li key={d.client_id}>
              <Link
                href={`/clients/${d.client_id}`}
                className="flex items-center gap-3 p-3 text-sm hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {d.cuit}
                  </span>
                </span>
                {d.oldest_days > 90 && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {d.oldest_days} días
                  </Badge>
                )}
                <span className="shrink-0 font-mono text-sm">
                  {formatMoneyWithCode(d.total_open, "ARS")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
