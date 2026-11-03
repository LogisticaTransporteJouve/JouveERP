import type { Permission } from "@/lib/auth/permissions";

// Go-live checklist of the sidebar guide (roadmap 6.5): what has to be loaded
// before the ERP replaces the spreadsheets, in the order it is usually done.
// Each item is shown only to whoever holds `permission` (every one of them),
// so a per-user deny hides it with its module. `derived` items are marked
// done from real data by getGuideAction; any undone item can also be marked
// done by hand (user_guide_states.dismissed_items).

export const SETUP_ITEM_KEYS = [
  "accounts",
  "afip_points_of_sale",
  "imports",
  "client_tariffs",
  "opening_balances",
  "initial_adjustment",
  "users",
  "taxes",
] as const;
export type SetupItemKey = (typeof SETUP_ITEM_KEYS)[number];

export type SetupItem = {
  key: SetupItemKey;
  label: string;
  description: string;
  href: string;
  permission: Permission | readonly Permission[];
};

export const SETUP_ITEMS: readonly SetupItem[] = [
  {
    key: "accounts",
    label: "Cuentas de caja y banco",
    description:
      "Alta de cada cuenta bancaria, caja y billetera con su moneda. Las de cheques se usan para la cartera.",
    href: "/accounts",
    permission: "accounts:write",
  },
  {
    key: "afip_points_of_sale",
    label: "Puntos de venta AFIP",
    description:
      "Sincronizá los puntos de venta habilitados en ARCA y asignales el canal fiscal.",
    href: "/admin/afip/puntos-de-venta",
    permission: "afip:admin",
  },
  {
    key: "imports",
    label: "Importar maestros",
    description:
      "Clientes, proveedores, empleados, vehículos, préstamos y cheques en cartera desde planillas, con el importador.",
    href: "/admin/imports",
    permission: "imports:write",
  },
  {
    key: "client_tariffs",
    label: "Tarifas por cliente",
    description:
      "El tarifario de cada cliente con su vigencia, en la ficha del cliente (también se importa).",
    href: "/clients",
    permission: ["clients:read", "storage_billing:issue"],
  },
  {
    key: "opening_balances",
    label: "Saldos iniciales",
    description:
      "Saldo de arranque de cada cuenta (en Cuentas) y de cada cliente y proveedor (en su ficha, pestaña Cuenta corriente) a la fecha de corte.",
    href: "/accounts",
    permission: "opening_balances:write",
  },
  {
    key: "initial_adjustment",
    label: "Ajuste inicial",
    description:
      "El asiento manual de apertura que deja el balance igual al del contador a la fecha de corte.",
    href: "/accounting/journal",
    permission: "accounting:write",
  },
  {
    key: "users",
    label: "Usuarios y permisos",
    description:
      "Invitá al equipo y asigná un rol a cada uno. El owner puede además ocultarle módulos puntuales a un usuario.",
    href: "/admin/users",
    permission: "users:invite",
  },
  {
    key: "taxes",
    label: "Vencimientos de impuestos",
    description:
      "Cargá los impuestos del mes (IVA, IIBB, F931…) para que aparezcan en el calendario y en Tareas.",
    href: "/taxes",
    permission: "taxes:write",
  },
];

export function isSetupItemKey(value: string): value is SetupItemKey {
  return (SETUP_ITEM_KEYS as readonly string[]).includes(value);
}
