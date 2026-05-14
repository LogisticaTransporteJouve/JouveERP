// Merge del schema generado (`database.types.ts`) con las extensiones
// manuales (`database.types.extensions.ts`). Los clientes de Supabase
// importan `Database` desde acá; las features pueden seguir importando
// row types directo de `database.types` para tablas que ya existen, o
// de acá si dependen de las extensiones.
//
// Cuando se regeneren los tipos con `pnpm db:types:generate` y las
// nuevas tablas vivan en `database.types.ts`, este archivo + el de
// extensions se pueden borrar y revertir los imports al original.

import type { Database as Generated } from "./database.types";
import type { DatabaseExtensions } from "./database.types.extensions";

export type Database = Omit<Generated, "public"> & {
  public: {
    Tables: Generated["public"]["Tables"] & DatabaseExtensions["public"]["Tables"];
    Views: Generated["public"]["Views"] & DatabaseExtensions["public"]["Views"];
    Functions: Generated["public"]["Functions"] &
      DatabaseExtensions["public"]["Functions"];
    Enums: Generated["public"]["Enums"] & DatabaseExtensions["public"]["Enums"];
    CompositeTypes: Generated["public"]["CompositeTypes"] &
      DatabaseExtensions["public"]["CompositeTypes"];
  };
};

export type { Json } from "./database.types";
