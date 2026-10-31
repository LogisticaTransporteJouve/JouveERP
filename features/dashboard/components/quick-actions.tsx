import {
  Banknote,
  FilePlus2,
  Package,
  Receipt,
  ScanLine,
  Sparkles,
  Truck,
} from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { userCan, type Permission, type Access } from "@/lib/auth/permissions";

const ACTIONS: {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
}[] = [
  {
    label: "Facturar",
    href: "/invoices",
    icon: FilePlus2,
    permission: "invoices:issue",
  },
  {
    label: "Cobrar",
    href: "/receipts",
    icon: Receipt,
    permission: "receipts:write",
  },
  {
    label: "Pagar",
    href: "/payment-orders",
    icon: Banknote,
    permission: "payment_orders:write",
  },
  {
    label: "Escanear documento",
    href: "/documentos",
    icon: ScanLine,
    permission: "ai:read",
  },
  { label: "Viajes", href: "/trips", icon: Truck, permission: "trips:read" },
  {
    label: "Pallets",
    href: "/pallets",
    icon: Package,
    permission: "pallets:read",
  },
  { label: "Asistente IA", href: "/ai", icon: Sparkles, permission: "ai:chat" },
];

export function QuickActions({ access }: { access: Access }) {
  const allowed = ACTIONS.filter((a) => userCan(access, a.permission));
  if (allowed.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {allowed.map((action) => (
        <Button
          key={action.href}
          variant="outline"
          size="sm"
          className="text-xs"
          asChild
        >
          <Link href={action.href}>
            <action.icon className="size-4" />
            {action.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}
