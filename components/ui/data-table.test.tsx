// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn } from "./data-table";

type Row = { id: string; name: string };

const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Nombre", cell: (r) => r.name },
  { id: "actions", header: "", cell: () => "•", align: "right" },
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
        getRowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("Alpha")).toBeDefined();
    expect(screen.getByText("Beta")).toBeDefined();
  });

  it("shows the empty message (spanning all columns) when there is no data", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        getRowKey={(r) => r.id}
        emptyMessage="Sin registros."
      />,
    );
    const cell = screen.getByText("Sin registros.");
    expect(cell).toBeDefined();
    expect(cell.getAttribute("colspan")).toBe(String(columns.length));
  });

  it("uses the default empty message when none is provided", () => {
    render(<DataTable columns={columns} data={[]} getRowKey={(r) => r.id} />);
    expect(screen.getByText("No hay datos.")).toBeDefined();
  });

  it("renders skeleton rows while loading, not the empty message", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        data={[]}
        getRowKey={(r) => r.id}
        isLoading
        skeletonRows={3}
        emptyMessage="Sin registros."
      />,
    );
    expect(screen.queryByText("Sin registros.")).toBeNull();
    // 3 skeleton rows in the body (header row is in <thead>).
    expect(container.querySelectorAll("tbody tr").length).toBe(3);
  });
});
