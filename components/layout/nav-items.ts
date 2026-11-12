import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  BookCheck,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  CalendarClock,
  CarFront,
  Container,
  CreditCard,
  WalletCards,
  DatabaseBackup,
  DollarSign,
  FileSearch,
  FileText,
  FileUp,
  FolderOpen,
  Fuel,
  Gauge,
  History,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListChecks,
  ListTodo,
  ListTree,
  MessageSquare,
  Package,
  Palmtree,
  Receipt,
  ReceiptText,
  Route,
  Scale,
  ScanLine,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tags,
  TrendingUp,
  Truck,
  UserRound,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";

import {
  CLIENT_AGING_PERMISSIONS,
  isFiscalOnly,
  SUPPLIER_AGING_PERMISSIONS,
  TREASURY_PERMISSIONS,
  userCanAll,
  type Access,
  type Permission,
} from "@/lib/auth/permissions";
import type { FiscalFilter } from "@/lib/scope";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission | readonly Permission[];
  /** Opening the item switches the side (fiscal / internal) to this one. */
  scope?: Exclude<FiscalFilter, "all">;
  /** Other paths that belong to this item (an account opens from Resumen). */
  also?: readonly string[];
  /** The item opens its page inside this segregated channel's section
   *  (`?channel=`); it never switches the side. */
  channelId?: string;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

// The same sales pages, once per scope: "Ventas" opens them fiscal and
// "Otras ventas" internal. Every other section is shared and reads all
// channels (lib/scope `isScopedPath`).
function salesItems(scope: Exclude<FiscalFilter, "all">): NavItem[] {
  return [
    {
      href: "/clients",
      label: "Clientes",
      icon: Users,
      permission: "clients:read",
      scope,
    },
    {
      href: "/invoices",
      label: scope === "internal" ? "Remitos internos" : "Comprobantes",
      icon: ReceiptText,
      permission: "invoices:read",
      scope,
    },
    {
      href: "/receipts",
      label: scope === "internal" ? "Recibos internos" : "Recibos",
      icon: ScrollText,
      permission: "receipts:read",
      scope,
    },
    {
      href: "/aging",
      label: "Aging clientes",
      icon: AlertTriangle,
      permission: CLIENT_AGING_PERMISSIONS,
      scope,
    },
  ];
}

// The same purchase pages, once per scope, like sales.
function purchaseItems(scope: Exclude<FiscalFilter, "all">): NavItem[] {
  return [
    {
      href: "/suppliers",
      label: "Proveedores",
      icon: Truck,
      permission: "suppliers:read",
      scope,
    },
    {
      href: "/suppliers/categories",
      label: "Categorías",
      icon: Tags,
      permission: "suppliers:read",
      scope,
    },
    {
      href: "/purchases",
      label: scope === "internal" ? "Remitos de compra" : "Comprobantes",
      icon: ShoppingCart,
      permission: "purchase_invoices:read",
      scope,
    },
    {
      href: "/payment-orders",
      label: "Órdenes de pago",
      icon: CreditCard,
      permission: "payment_orders:read",
      scope,
    },
    {
      href: "/aging-suppliers",
      label: "Aging proveedores",
      icon: AlertTriangle,
      permission: SUPPLIER_AGING_PERMISSIONS,
      scope,
    },
  ];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Plataforma",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/chat", label: "Chat", icon: MessageSquare },
      {
        href: "/tasks",
        label: "Tareas",
        icon: ListTodo,
        permission: "tasks:read",
      },
      {
        href: "/files",
        label: "Archivos",
        icon: FolderOpen,
        permission: "files:read",
      },
    ],
  },
  {
    label: "Inteligencia",
    items: [
      {
        href: "/ai/tasks",
        label: "Tareas IA",
        icon: ListChecks,
        permission: "ai:chat",
      },
      {
        href: "/documentos",
        label: "Documentos",
        icon: ScanLine,
        permission: "ai:read",
      },
    ],
  },
  { label: "Ventas", items: salesItems("fiscal") },
  { label: "Otras ventas", items: salesItems("internal") },
  { label: "Compras", items: purchaseItems("fiscal") },
  { label: "Otras compras", items: purchaseItems("internal") },
  {
    label: "Tesorería",
    items: [
      {
        href: "/treasury",
        label: "Resumen",
        icon: LineChart,
        permission: TREASURY_PERMISSIONS,
        also: ["/accounts"],
      },
      {
        href: "/treasury/cash-flow",
        label: "Flujo de caja",
        icon: TrendingUp,
        permission: TREASURY_PERMISSIONS,
      },
      {
        href: "/transactions",
        label: "Caja",
        icon: ArrowLeftRight,
        permission: "transactions:read",
      },
      {
        href: "/checks",
        label: "Cheques recibidos",
        icon: BookCheck,
        permission: "cheques:read",
      },
      {
        href: "/issued-checks",
        label: "Cheques propios",
        icon: BookCheck,
        permission: "issued_checks:read",
      },
      {
        href: "/loans",
        label: "Préstamos",
        icon: CreditCard,
        permission: TREASURY_PERMISSIONS,
      },
      {
        href: "/card-statements",
        label: "Tarjetas",
        icon: WalletCards,
        permission: TREASURY_PERMISSIONS,
      },
    ],
  },
  {
    label: "Contabilidad",
    items: [
      {
        href: "/accounting/package",
        label: "Paquete del mes",
        icon: Archive,
        permission: "accounting:read",
      },
      {
        href: "/accounting/chart",
        label: "Plan de cuentas",
        icon: ListTree,
        permission: "accounting:read",
      },
      {
        href: "/accounting/journal",
        label: "Libro diario",
        icon: BookOpen,
        permission: "accounting:read",
      },
      {
        href: "/accounting/libro-mayor",
        label: "Libro mayor",
        icon: LineChart,
        permission: "accounting:read",
      },
      {
        href: "/accounting/libro-iva-ventas",
        label: "Libro IVA Ventas",
        icon: ReceiptText,
        permission: "accounting:read",
      },
      {
        href: "/accounting/libro-iva-compras",
        label: "Libro IVA Compras",
        icon: ShoppingCart,
        permission: "accounting:read",
      },
      {
        href: "/accounting/balance",
        label: "Balance / EERR",
        icon: Scale,
        permission: "accounting:read",
      },
      {
        href: "/management",
        label: "Resultado de gestión",
        icon: Gauge,
        permission: "management:read",
      },
      {
        href: "/taxes",
        label: "Impuestos",
        icon: Landmark,
        permission: "taxes:read",
      },
      {
        href: "/accounting/inflation",
        label: "Ajuste inflación",
        icon: TrendingUp,
        permission: "accounting:read",
      },
      {
        href: "/accounting/exchange-rates",
        label: "Cotización USD",
        icon: DollarSign,
        permission: "accounting:read",
      },
      {
        href: "/accounting/settings",
        label: "Configuración contable",
        icon: Settings,
        permission: "accounting:read",
      },
    ],
  },
  {
    label: "Flota",
    items: [
      {
        href: "/drivers",
        label: "Choferes",
        icon: CarFront,
        permission: "drivers:read",
      },
      {
        href: "/vehicles",
        label: "Vehículos",
        icon: Truck,
        permission: "vehicles:read",
      },
      {
        href: "/trips",
        label: "Viajes",
        icon: Route,
        permission: "trips:read",
      },
      {
        href: "/cargas",
        label: "Cargas",
        icon: Package,
        permission: "shipments:read",
      },
      {
        href: "/fleet-tariffs",
        label: "Tarifas",
        icon: Tags,
        permission: "freight_tariffs:read",
      },
      {
        href: "/fuel",
        label: "Combustible",
        icon: Fuel,
        permission: "fuel:read",
      },
      {
        href: "/vehicle-km",
        label: "Km recorridos",
        icon: Gauge,
        permission: "fleet_km:read",
      },
      {
        href: "/maintenance",
        label: "Mantenimiento",
        icon: Wrench,
        permission: "maintenance:read",
      },
      {
        href: "/fleet-documents",
        label: "Vencimientos",
        icon: CalendarClock,
        permission: "fleet_documents:read",
      },
    ],
  },
  {
    label: "Depósito",
    items: [
      {
        href: "/warehouses",
        label: "Depósitos",
        icon: Warehouse,
        permission: "warehouses:read",
      },
      {
        href: "/products",
        label: "Productos",
        icon: Boxes,
        permission: "products:read",
      },
      {
        href: "/pallets",
        label: "Pallets",
        icon: Container,
        permission: "pallets:read",
      },
      {
        href: "/pallets/trazabilidad",
        label: "Trazabilidad",
        icon: History,
        permission: "pallets:read",
      },
    ],
  },
  {
    label: "Personal",
    items: [
      {
        href: "/employees",
        label: "Empleados",
        icon: IdCard,
        permission: "hr:read",
      },
      {
        href: "/hr/payroll",
        label: "Sueldos",
        icon: Receipt,
        permission: "hr:read",
      },
      {
        href: "/hr/vacations",
        label: "Vacaciones",
        icon: Palmtree,
        permission: "hr:read",
      },
      {
        href: "/hr/attendance",
        label: "Asistencia",
        icon: CalendarDays,
        permission: "hr:read",
      },
      {
        href: "/hr/document-expirations",
        label: "Vencimientos",
        icon: CalendarClock,
        permission: "hr:read",
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/admin/users",
        label: "Usuarios",
        icon: ShieldCheck,
        permission: "users:read",
      },
      {
        href: "/admin/padron",
        label: "Padrón AFIP",
        icon: Search,
        permission: "padron:lookup",
      },
      {
        href: "/admin/afip/puntos-de-venta",
        label: "Puntos de venta",
        icon: Receipt,
        permission: "afip:admin",
      },
      {
        href: "/admin/accesos",
        label: "Accesos",
        icon: KeyRound,
        permission: "afip:admin",
      },
      {
        href: "/admin/afip/preview-pdf",
        label: "Preview PDF",
        icon: FileText,
        permission: "afip:admin",
      },
      {
        href: "/admin/imports",
        label: "Importador",
        icon: FileUp,
        permission: "imports:read",
      },
      {
        href: "/admin/audit",
        label: "Auditoría",
        icon: FileSearch,
        permission: "audit:read",
      },
      {
        href: "/admin/backups",
        label: "Backups",
        icon: DatabaseBackup,
        permission: "audit:read",
      },
    ],
  },
];

export const ASSISTANT_ITEM: NavItem = {
  href: "/ai",
  label: "Asistente",
  icon: Sparkles,
  permission: "ai:chat",
};

const ALL_ITEMS = [
  ASSISTANT_ITEM,
  { href: "/profile", label: "Perfil", icon: UserRound },
  ...NAV_SECTIONS.flatMap((section) => section.items),
];

export function canSee(access: Access, item: NavItem): boolean {
  // A fiscal-only user is pinned to the fiscal scope.
  if (item.scope === "internal" && isFiscalOnly(access)) return false;
  return !item.permission || userCanAll(access, item.permission);
}

/** One section per segregated channel (DZ Instalaciones), labelled with its
 *  name: the only place its documents show. The pages are the main app's,
 *  opened inside the channel (`?channel=`). */
export function channelSections(
  channels: readonly { id: string; name: string }[],
): NavSection[] {
  return channels.map((channel) => ({
    label: channel.name,
    items: [
      {
        href: `/channel-summary/${channel.id}`,
        label: "Resumen",
        icon: Building2,
        permission: "management:read",
        channelId: channel.id,
      },
      {
        href: "/purchases",
        label: "Comprobantes de compra",
        icon: ShoppingCart,
        permission: "purchase_invoices:read",
        channelId: channel.id,
      },
      {
        href: "/payment-orders",
        label: "Órdenes de pago",
        icon: CreditCard,
        permission: "payment_orders:read",
        channelId: channel.id,
      },
      {
        href: "/invoices",
        label: "Ventas",
        icon: ReceiptText,
        permission: "invoices:read",
        channelId: channel.id,
      },
      {
        href: "/clients",
        label: "Clientes",
        icon: Users,
        permission: "clients:read",
        channelId: channel.id,
      },
      {
        href: "/suppliers",
        label: "Proveedores",
        icon: Truck,
        permission: "suppliers:read",
        channelId: channel.id,
      },
    ],
  }));
}

/** The menu a user sees: the main sections, then one per segregated channel
 *  (`channelSections`), last. */
export function visibleSections(
  access: Access,
  extra: readonly NavSection[] = [],
): NavSection[] {
  return [...NAV_SECTIONS, ...extra]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canSee(access, item)),
    }))
    .filter((section) => section.items.length > 0);
}

// The deepest item whose href is the path or one of its ancestors, so
// /suppliers/categories picks "Categorías" and not "Proveedores". A sales page
// listed under both scopes resolves to the current scope's entry ("Ventas"
// under "all").
export function navItemForPath(
  pathname: string,
  scope: FiscalFilter = "all",
  channelId: string | null = null,
  extra: readonly NavSection[] = [],
): NavItem | undefined {
  // Inside a segregated channel's section only its items match a shared path
  // (/purchases); its own pages (/channel-summary/<id>) match by path alone.
  const rank = (item: NavItem) =>
    ((item.channelId ?? null) === channelId ? 2 : 0) +
    (item.scope === scope ? 1 : 0);
  let best: { item: NavItem; length: number } | undefined;
  const under = (base: string) =>
    pathname === base || pathname.startsWith(`${base}/`);
  for (const item of [...ALL_ITEMS, ...extra.flatMap((s) => s.items)]) {
    if (channelId && item.channelId !== channelId) continue;
    const base = [item.href, ...(item.also ?? [])].find(under);
    if (!base) continue;
    if (
      !best ||
      base.length > best.length ||
      (base.length === best.length && rank(item) > rank(best.item))
    ) {
      best = { item, length: base.length };
    }
  }
  return best?.item;
}

export function navSectionForItem(
  item: NavItem,
  extra: readonly NavSection[] = [],
): NavSection | undefined {
  return [...NAV_SECTIONS, ...extra].find((section) =>
    section.items.includes(item),
  );
}
