import type { Role } from "@/lib/auth/permissions";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  finance: "Finanzas",
  operations: "Operaciones",
  warehouse: "Depósito",
  driver: "Chofer",
  fiscal_reader: "Contador externo",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Acceso total. Puede asignar cualquier rol y los accesos por usuario.",
  admin: "Acceso total excepto el rol owner y los accesos por usuario.",
  finance: "Clientes, caja, comprobantes y cobranzas.",
  operations: "Flota, viajes, combustible, mantenimientos.",
  warehouse: "Pallets, productos, movimientos de stock.",
  driver: "Acceso de chofer (próximamente).",
  fiscal_reader:
    "Solo lectura de lo fiscal: comprobantes, compras, libros IVA y contabilidad.",
};
