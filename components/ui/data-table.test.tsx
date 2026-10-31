// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable, type ColumnDef } from "./data-table";

type Row = { id: string; name: string; children?: Row[] };

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
    cell: ({ row }) => row.original.name,
  },
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

  it("sorts by a column when its header is clicked", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        data={[
          { id: "1", name: "Beta" },
          { id: "2", name: "Alpha" },
          { id: "3", name: "Gamma" },
        ]}
        getRowId={(r) => r.id}
      />,
    );
    const names = () =>
      Array.from(container.querySelectorAll("tbody tr td:first-child")).map(
        (td) => td.textContent,
      );
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
    fireEvent.click(screen.getByRole("button", { name: /Nombre/ }));
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    fireEvent.click(screen.getByRole("button", { name: /Nombre/ }));
    expect(names()).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("paginates only when enabled", () => {
    const data = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      name: `Fila ${i}`,
    }));
    const { container, rerender } = render(
      <DataTable columns={columns} data={data} getRowId={(r) => r.id} />,
    );
    expect(container.querySelectorAll("tbody tr").length).toBe(5);

    rerender(
      <DataTable
        columns={columns}
        data={data}
        getRowId={(r) => r.id}
        enablePagination
        initialPageSize={2}
        key="paged"
      />,
    );
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
    expect(screen.getByText(/Página 1 de 3/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText(/Página 2 de 3/)).toBeDefined();
    expect(screen.getByText("Fila 2")).toBeDefined();
  });

  it("renders sub-rows when expanded", () => {
    const treeColumns: ColumnDef<Row>[] = [
      {
        id: "name",
        header: "Nombre",
        cell: ({ row }) =>
          `${"-".repeat(row.depth)}${row.original.name}${row.getCanExpand() ? "+" : ""}`,
      },
    ];
    render(
      <DataTable
        columns={treeColumns}
        data={[
          { id: "1", name: "Padre", children: [{ id: "2", name: "Hijo" }] },
        ]}
        getRowId={(r) => r.id}
        getSubRows={(r) => r.children}
        expanded={{ "1": true }}
      />,
    );
    expect(screen.getByText("Padre+")).toBeDefined();
    expect(screen.getByText("-Hijo")).toBeDefined();
  });

  it("renders one header row before each run of rows sharing a group key", () => {
    render(
      <DataTable
        columns={columns}
        data={[
          { id: "1", name: "a1" },
          { id: "2", name: "a2" },
          { id: "3", name: "b1" },
        ]}
        getRowId={(r) => r.id}
        groupBy={{
          key: (r) => r.name.slice(0, 1),
          header: (key) => `Grupo ${key}`,
        }}
      />,
    );
    expect(screen.getAllByText(/^Grupo /).map((el) => el.textContent)).toEqual([
      "Grupo a",
      "Grupo b",
    ]);
    const rows = screen.getAllByRole("row").map((r) => r.textContent);
    expect(rows.slice(1)).toEqual(["Grupo a", "a1•", "a2•", "Grupo b", "b1•"]);
  });
});
