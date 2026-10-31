import { Truck } from "lucide-react";

import { Section } from "@/components/ui/section";
import { StatGrid, StatTile, StatValue } from "@/components/ui/stat-tile";

import type { OpsKpis } from "../schema";

export function OpsKpisRow({ ops }: { ops: OpsKpis }) {
  const tiles = [
    ops.trips_in_progress != null && {
      href: "/trips",
      label: "Viajes en curso",
      value: ops.trips_in_progress,
    },
    ops.shipments_pending != null && {
      href: "/cargas",
      label: "Cargas pendientes",
      value: ops.shipments_pending,
    },
    ops.pallets_stored != null && {
      href: "/pallets",
      label: "Pallets en depósito",
      value: ops.pallets_stored,
    },
  ].filter((t) => t !== false);

  if (tiles.length === 0) return null;

  return (
    <Section
      title="Operación"
      icon={Truck}
      description="Lo que está en movimiento hoy"
    >
      <StatGrid className="xl:grid-cols-3">
        {tiles.map((tile) => (
          <StatTile key={tile.href} href={tile.href} label={tile.label}>
            <StatValue>{tile.value}</StatValue>
          </StatTile>
        ))}
      </StatGrid>
    </Section>
  );
}
