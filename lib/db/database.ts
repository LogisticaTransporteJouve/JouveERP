// Merge of the generated schema (`database.types.ts`) with the manual
// extensions (`database.types.extensions.ts`). Supabase clients
// import `Database` from here; features can still import row types
// directly from `database.types` for tables that already exist, or
// from here if they depend on the extensions.
//
// Once the types are regenerated with `pnpm db:types:generate` and the
// new tables live in `database.types.ts`, this file plus the extensions
// one can be deleted and the imports reverted to the original.

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
