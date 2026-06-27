// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable, type ColumnDef } from "./data-table";

type Row = { id: string; name: string };

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Nombre", cell: ({ row }) => row.original.name },
  { id: "actions", header: "", enableSorting: false, cell: () => "•" },
];

afterEach(cleanup);

describe("DataTable", () => {
  it("renders a row per data item", () => {
    render(
      <DataTable
        columns={columns}
        data={[
          { id: "1", name: "Alpha" },
          { id: "2", name: "Beta" },
        ]}
        getRowId={(r) => r.id}
      />,
    );
    expect(screen.getByText("Alpha")).toBeDefined();
    expect(screen.getByText("Beta")).toBeDefined();
  });

  it("shows the empty message spanning all columns when there is no data", () => {
    render(
      <DataTable columns={columns} data={[]} emptyMessage="Sin registros." />,
    );
    const cell = screen.getByText("Sin registros.");
    expect(cell.getAttribute("colspan")).toBe(String(columns.length));
  });

  it("uses the default empty message when none is provided", () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText("No hay datos.")).toBeDefined();
  });

  it("renders skeleton rows while loading, not the empty message", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        data={[]}
        isLoading
        skeletonRows={3}
        emptyMessage="Sin registros."
      />,
    );
    expect(screen.queryByText("Sin registros.")).toBeNull();
    expect(container.querySelectorAll("tbody tr").length).toBe(3);
  });

  it("renders a sort toggle for sortable columns", () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: "1", name: "Alpha" }]}
        getRowId={(r) => r.id}
      />,
    );
    // The sortable "Nombre" header renders a clickable button; the actions
    // column (enableSorting: false) does not.
    expect(screen.getByRole("button", { name: /Nombre/ })).toBeDefined();
  });
});
