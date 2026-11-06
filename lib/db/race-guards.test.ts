import { describe, expect, it } from "vitest";

import { lastStatement, latestDefinition } from "./testing/migration-sql";

// Static checks over supabase/migrations for writes the app checks first and
// the database must still refuse or serialize when something changes between
// the check and the write.

describe("a supplier category or supplier in use cannot be deleted", () => {
  it.each([
    ["suppliers", "suppliers_category_id_fkey"],
    ["file_attachments", "file_attachments_supplier_id_fkey"],
  ])("%s.%s is ON DELETE RESTRICT", (table, constraint) => {
    const statement = lastStatement(
      new RegExp(
        `alter table public\\.${table} add constraint ${constraint}[^;]*;`,
        "gi",
      ),
    );
    expect(statement).toMatch(/on delete restrict/i);
  });
});

describe("bulk pallet codes are numbered one load per prefix at a time", () => {
  it("create_pallets_bulk locks the prefix before reading the highest code", () => {
    const definition = latestDefinition("create_pallets_bulk");
    const lock = definition.search(/pg_advisory_xact_lock\(/);
    const read = definition.search(/from public\.pallets/);
    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
  });
});

describe("the importer writes loans through the loan writer", () => {
  const importer = latestDefinition("commit_import_run");

  it("commit_import_run calls create_loan_core and inserts no loan itself", () => {
    expect(importer).toMatch(/public\.create_loan_core\(/);
    expect(importer).not.toMatch(/insert into public\.loans\b/);
    expect(importer).not.toMatch(/insert into public\.loan_installments\b/);
  });

  it("create_loan goes through create_loan_core too", () => {
    expect(latestDefinition("create_loan")).toMatch(
      /public\.create_loan_core\(/,
    );
  });

  it("the driver position comes from the action, not a literal", () => {
    expect(importer).toMatch(/i\.position = p_driver_position/);
    expect(importer).not.toMatch(/Chofer \/ Acompañante/);
  });
});
