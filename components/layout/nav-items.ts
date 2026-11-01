import {
  AlertTriangle,
  ArrowLeftRight,
  BookCheck,
  BookOpen,
  Boxes,
  CalendarDays,
  CalendarClock,
  CarFront,
  Container,
  CreditCard,
  DatabaseBackup,
  DollarSign,
  FileText,
  FolderOpen,
  Fuel,
  History,
  IdCard,
  LayoutDashboard,
  LineChart,
  ListChecks,
  ListTree,
  MessageSquare,
  Package,
  Receipt,
  ReceiptText,
  Repeat,
  Route,
  Scale,
  ScanLine,
  ScrollText,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tags,
  Target,
  TrendingUp,
  Truck,
  UserRound,
  Users,
  Wallet,
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
  /** Opening the item switches the header scope to this one. */
  scope?: Exclude<FiscalFilter, "all">;
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
      label: "Comprobantes",
      icon: ReceiptText,
      permission: "invoices:read",
      scope,
    },
    {
      href: "/receipts",
      label: "Recibos",
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
      label: "Compras",
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
      },
      {
        href: "/treasury/cash-flow",
        label: "Flujo de caja",
        icon: TrendingUp,
        permission: TREASURY_PERMISSIONS,
      },
      {
        href: "/accounts",
        label: "Cuentas",
        icon: Wallet,
        permission: "accounts:read",
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
        href: "/recurring-payments",
        label: "Pagos recurrentes",
        icon: Repeat,
        permission: "recurring_payments:read",
      },
      {
        href: "/loans",
        label: "Préstamos",
        icon: CreditCard,
        permission: TREASURY_PERMISSIONS,
      },
    ],
  },
  {
    label: "Contabilidad",
    items: [
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
        href: "/accounting/cost-centers",
        label: "Centros de costo",
        icon: Target,
        permission: "accounting:read",
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
        href: "/fuel",
        label: "Combustible",
        icon: Fuel,
        permission: "fuel:read",
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
      {
        href: "/fleet-reports",
        label: "Rentabilidad",
        icon: TrendingUp,
        permission: "trips:read",
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
      {
        href: "/storage-tariffs",
        label: "Tarifas",
        icon: Tags,
        permission: "storage_billing:read",
      },
      {
        href: "/storage-billing",
        label: "Facturación",
        icon: LineChart,
        permission: "storage_billing:read",
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
        href: "/admin/afip/preview-pdf",
        label: "Preview PDF",
        icon: FileText,
        permission: "afip:admin",
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

export function visibleSections(access: Access): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(access, item)),
  })).filter((section) => section.items.length > 0);
}

// The deepest item whose href is the path or one of its ancestors, so
// /suppliers/categories picks "Categorías" and not "Proveedores". A sales page
// listed under both scopes resolves to the current scope's entry ("Ventas"
// under "all").
export function navItemForPath(
  pathname: string,
  scope: FiscalFilter = "all",
): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_ITEMS) {
    const matches =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) continue;
    if (
      !best ||
      item.href.length > best.href.length ||
      (item.href === best.href && item.scope === scope)
    ) {
      best = item;
    }
  }
  return best;
}

export function navSectionForItem(item: NavItem): NavSection | undefined {
  return NAV_SECTIONS.find((section) => section.items.includes(item));
}
