import { Badge } from "@/components/ui/badge";

/** A sale or purchase that does not belong to Jouve's activity
 *  (`is_operational = false`): in the Libro IVA and balances, not in income
 *  or expense. */
export function NotJouveBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] font-normal ${className ?? ""}`}
      title="No corresponde a la actividad de Jouve: sigue en el Libro IVA y en los saldos, pero no cuenta como ingreso ni gasto."
    >
      No Jouve
    </Badge>
  );
}
