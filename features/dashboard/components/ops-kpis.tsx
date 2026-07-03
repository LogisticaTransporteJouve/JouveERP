import { Package, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";

import type { OpsKpis } from "../schema";

export function OpsKpisRow({ ops }: { ops: OpsKpis }) {
  const tiles = [
    ops.trips_in_progress != null && {
      href: "/trips",
      label: "Viajes en curso",
      value: ops.trips_in_progress,
      icon: Truck,
    },
    ops.shipments_pending != null && {
      href: "/cargas",
      label: "Cargas pendientes",
      value: ops.shipments_pending,
      icon: PackageCheck,
    },
    ops.pallets_stored != null && {
      href: "/pallets",
      label: "Pallets en depósito",
      value: ops.pallets_stored,
      icon: Package,
    },
  ].filter((t) => t !== false);

  if (tiles.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map((tile) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-accent/50"
        >
          <tile.icon className="size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="font-mono text-2xl font-semibold">{tile.value}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
