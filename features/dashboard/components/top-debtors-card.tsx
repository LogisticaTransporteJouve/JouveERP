import { Users } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/section";
import { formatMoneyWithCode } from "@/lib/format";

import type { TopDebtor } from "../schema";

export function TopDebtorsCard({ debtors }: { debtors: TopDebtor[] }) {
  return (
    <Section
      title="Top deudores"
      icon={Users}
      description="Clientes con más saldo por cobrar"
      actions={
        <Link
          href="/aging"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Ver aging completo
        </Link>
      }
    >
      <div className="rounded-lg border bg-card">
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
                  <span className="flex shrink-0 flex-col items-end font-mono text-sm">
                    {d.total.ars !== 0 && (
                      <span>{formatMoneyWithCode(d.total.ars, "ARS")}</span>
                    )}
                    {d.total.usd !== 0 && (
                      <span>{formatMoneyWithCode(d.total.usd, "USD")}</span>
                    )}
                    {d.total.usd !== 0 && d.total_ars_equivalent !== null && (
                      <span className="text-xs text-muted-foreground">
                        ≈ {formatMoneyWithCode(d.total_ars_equivalent, "ARS")}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
