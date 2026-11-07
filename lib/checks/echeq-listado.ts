// Banco Galicia's «Listado de cheques recibidos» (.xlsx): the eCheqs the
// company received, with who endorsed each one to it. Pure, no DB.

export type ListedEcheq = {
  check_number: string;
  /** Who gave it to the company (the endorser, or the drawer of one issued
   *  to the company): the client of the receipt. */
  client_name: string;
  client_cuit: string;
  drawer_name: string;
  drawer_cuit: string | null;
  bank_name: string;
  issue_date: string;
  due_date: string;
  /** When it was endorsed to the company (its receipt date). */
  received_date: string;
  amount: number;
  status: string;
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[º°]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isoDate = (s: string): string | null => {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ar = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return ar ? `${ar[3]}-${ar[2]}-${ar[1]}` : null;
};

const amountOf = (s: string): number | null => {
  const t = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^-?[\d.]+,\d{1,2}$/.test(t))
    return Number(t.replace(/\./g, "").replace(",", "."));
  return null;
};

/** The listed eCheqs, or why the table is not the listado. Rows are the
 *  sheet as read: a row of groups («Datos del cheque», «Datos del
 *  librador», «Historial de endosos») over the row of column titles. */
export function parseEcheqListado(
  rows: readonly (readonly string[])[],
  companyCuit: string,
): { ok: true; cheques: ListedEcheq[] } | { ok: false; error: string } {
  const h = rows.findIndex((r) => r.some((c) => norm(c) === "n de cheque"));
  if (h < 0 || !rows[h]!.some((c) => norm(c) === "recibido de")) {
    return {
      ok: false,
      error: "No es el listado de cheques recibidos de Galicia.",
    };
  }
  const header = rows[h]!.map(norm);
  const groups = (rows[h - 1] ?? []).map(norm);
  // A group's title sits on its first column; the group runs until the next.
  const groupOf = (i: number) => {
    for (let j = i; j >= 0; j--) if (groups[j]) return groups[j]!;
    return "";
  };
  const col = (name: string, group?: string) =>
    header.findIndex(
      (c, i) => c === name && (!group || groupOf(i).startsWith(group)),
    );

  const at = {
    number: col("n de cheque"),
    from: col("recibido de"),
    fromCuit: header.findIndex(
      (c, i) => c.startsWith("cuit") && i === col("recibido de") + 1,
    ),
    due: col("fecha de pago"),
    issue: col("fecha de emision"),
    amount: col("importe"),
    status: col("estado"),
    bank: col("banco emisor"),
    drawer: col("razon social", "datos del librador"),
    drawerCuit: header.findIndex(
      (c, i) =>
        c.startsWith("cuit") && groupOf(i).startsWith("datos del librador"),
    ),
  };
  if (Object.values(at).some((i) => i < 0)) {
    return {
      ok: false,
      error:
        "Al listado le faltan columnas (número, cliente, importe, fechas o estado).",
    };
  }
  // Each endorsement: its «Beneficiario», then that block's CUIT and «Fecha»
  // columns, found by title up to the next endorsement.
  const starts = header.flatMap((c, i) =>
    c === "beneficiario" && groupOf(i).startsWith("historial de endosos")
      ? [i]
      : [],
  );
  const endorsements = starts.map((b, k) => {
    const end = starts[k + 1] ?? header.length;
    const within = (pred: (c: string) => boolean) => {
      for (let j = b + 1; j < end; j++) if (pred(header[j]!)) return j;
      return -1;
    };
    return {
      cuit: within((c) => c.startsWith("cuit")),
      date: within((c) => c === "fecha"),
    };
  });
  const company = companyCuit.replace(/\D/g, "");

  const cheques: ListedEcheq[] = [];
  for (const r of rows.slice(h + 1)) {
    const number = (r[at.number] ?? "").trim();
    const amount = amountOf(r[at.amount] ?? "");
    const due = isoDate(r[at.due] ?? "");
    const issue = isoDate(r[at.issue] ?? "");
    if (!number || amount === null || !due || !issue) continue;
    // The endorsement to the company.
    let received: string | null = null;
    for (const e of endorsements) {
      if (e.cuit < 0 || e.date < 0) continue;
      const cuit = (r[e.cuit] ?? "").replace(/\D/g, "");
      const date = isoDate(r[e.date] ?? "");
      if (cuit === company && date) received = date;
    }
    // A cheque issued to the company itself («Recibido de» is the company)
    // comes from its drawer: the drawer is the client.
    const fromCuit = (r[at.fromCuit] ?? "").replace(/\D/g, "");
    const drawerCuit = (r[at.drawerCuit] ?? "").replace(/\D/g, "");
    const fromCompany = fromCuit === company;
    cheques.push({
      check_number: number,
      client_name: fromCompany
        ? (r[at.drawer] ?? "").trim()
        : (r[at.from] ?? "").trim(),
      client_cuit: fromCompany ? drawerCuit : fromCuit,
      drawer_name: (r[at.drawer] ?? "").trim() || (r[at.from] ?? "").trim(),
      drawer_cuit: (r[at.drawerCuit] ?? "").replace(/\D/g, "") || null,
      bank_name: (r[at.bank] ?? "").trim() || "Sin dato",
      issue_date: issue,
      due_date: due,
      received_date: received ?? issue,
      amount,
      status: (r[at.status] ?? "").trim(),
    });
  }
  if (cheques.length === 0)
    return { ok: false, error: "El listado no trae cheques." };
  return { ok: true, cheques };
}

/** The ones the company still has or deposited from `from` on: in custody,
 *  in deposit, endorsed to it, or paid (deposited) on or after `from`. */
export function echeqsToLoad(
  cheques: readonly ListedEcheq[],
  from: string,
): ListedEcheq[] {
  return cheques.filter((c) => {
    const s = norm(c.status);
    if (
      s === "en custodia" ||
      s === "deposito en proceso" ||
      s === "endoso recibido"
    )
      return true;
    return s === "pagado" && c.due_date >= from;
  });
}
