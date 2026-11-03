// Example mock: the Liquidaciones list (features/freight-settlements/components/freight-settlements-page.tsx)
// with a new "Cobro" column and a pending-collection tile. Everything outside ui.isNew is today's UI.
// Clients and amounts are made up.
function money(n) {
  return "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

Mock.app({
  state: {
    q: "",
    menu: null,
    overlay: null,
    pos: null,
    posOpen: false,
    rows: [
      { id: "s1", numero: "R-00000012", client: "Frigorífico Del Sur S.A.", period: "01/10/2026 al 31/10/2026", status: "Confirmada", total: 1000000, paid: null },
      { id: "s2", numero: "R-00000011", client: "Lácteos La Pampeana S.R.L.", period: "01/10/2026 al 31/10/2026", status: "Facturada · factura emitida", total: 2450000, paid: "Cobrada" },
      { id: "s3", numero: "R-00000010", client: "Distribuidora Andina S.A.", period: "16/09/2026 al 30/09/2026", status: "Facturada · factura emitida", total: 830500, paid: "Pendiente" },
      { id: "s4", numero: "Borrador", client: "Frigorífico Del Sur S.A.", period: "01/11/2026 al 30/11/2026", status: "Borrador", total: 400000, paid: null },
    ],
  },

  page: function () {
    return { nav: "/liquidaciones" };
  },

  view: function (s) {
    var pending = s.rows.filter(function (r) { return r.paid === "Pendiente"; });
    var rows = s.rows
      .filter(function (r) { return r.client.toLowerCase().indexOf(s.q.toLowerCase()) >= 0; })
      .map(function (r) {
        var trigger = ui.button("", { variant: "ghost", size: "icon", icon: "more-horizontal", action: "menu", arg: r.id, attrs: { "aria-label": "Acciones" } });
        var items = [{ label: "Ver", icon: "eye", action: "unsupported" }];
        if (r.numero !== "Borrador") items.push({ label: "Ver R (PDF)", icon: "file-text", action: "unsupported" });
        if (r.status === "Confirmada") items.push("separator", { label: "Facturar", icon: "receipt", action: "invoice", arg: r.id });
        items.push("separator", { label: "Cancelar", icon: "x-circle", action: "unsupported", destructive: true });
        var paid = r.paid ? ui.badge(r.paid, { variant: r.paid === "Cobrada" ? "secondary" : "outline" }) : '<span class="text-sm text-muted-foreground">—</span>';
        return ui.tr([
          ui.td('<span class="font-mono text-sm">' + r.numero + "</span>"),
          ui.td('<span class="font-medium">' + ui.esc(r.client) + "</span>"),
          ui.td('<span class="text-sm">' + r.period + "</span>"),
          ui.td('<span class="text-sm">' + r.status + "</span>"),
          ui.td(ui.isNew(paid, { inline: true })),
          ui.td('<span class="text-sm tabular-nums">' + money(r.total) + "</span>", "text-right"),
          ui.td(ui.anchor(trigger, s.menu === r.id && ui.menu(items), { close: "closeMenu", align: "end" })),
        ]);
      });

    return (
      '<div class="space-y-6">' +
        '<div class="flex flex-wrap items-center justify-between gap-3"><div>' +
          '<h1 class="text-2xl font-semibold tracking-tight">Liquidaciones</h1>' +
          '<p class="text-sm text-muted-foreground">Cargas entregadas de un cliente en un período, en un documento R y una sola factura.</p>' +
        "</div>" + ui.button("Nueva liquidación", { icon: "plus", action: "unsupported" }) + "</div>" +
        ui.isNew(ui.stats([{ label: "Por cobrar", value: money(pending.reduce(function (n, r) { return n + r.total * 1.21; }, 0)), note: pending.length + (pending.length === 1 ? " liquidación facturada sin cobrar" : " liquidaciones facturadas sin cobrar") }]), { inset: true }) +
        ui.input({ id: "q", value: s.q, placeholder: "Buscar cliente…", input: "search", cls: "max-w-xs" }) +
        '<div class="rounded-lg border bg-card">' +
          ui.table([
            { html: "Número", cls: "w-36" }, "Cliente", "Período", "Estado",
            { html: "Cobro", cls: "w-28" }, { html: "Total", cls: "w-36 text-right" }, { html: "", cls: "w-12" },
          ], rows) +
        "</div>" +
      "</div>"
    );
  },

  overlay: function (s) {
    if (s.overlay !== "invoice") return "";
    return ui.dialog({
      title: "Facturar liquidación",
      description: "Una sola factura con una línea por carga, al 21%.",
      body: '<div class="grid gap-2">' + ui.label("Punto de venta", { for: "pos" }) +
        ui.anchor(ui.select(s.pos, { placeholder: "Elegí un punto de venta", action: "posOpen", open: s.posOpen, cls: "w-full" }),
          s.posOpen && ui.selectContent(["0003 · Web service"], s.pos, { action: "posPick" }), { close: "posOpen", block: true }) + "</div>",
      footer: ui.button("Cancelar", { variant: "outline", action: "close" }) +
        ui.button("Facturar", { action: "invoiceSave", disabled: !s.pos }),
    });
  },

  actions: {
    search: function (s, value) { s.q = value; },
    menu: function (s, id) { s.menu = s.menu === id ? null : id; },
    closeMenu: function (s) { s.menu = null; },
    invoice: function (s, id) { s.menu = null; s.overlay = "invoice"; s.target = id; s.pos = null; s.posOpen = false; },
    posOpen: function (s) { s.posOpen = !s.posOpen; },
    posPick: function (s, p) { s.pos = p; s.posOpen = false; },
    invoiceSave: function (s) {
      s.rows.forEach(function (r) { if (r.id === s.target) { r.status = "Facturada · factura en cola"; r.paid = "Pendiente"; } });
      s.overlay = null;
      Mock.toast("Factura en cola de emisión.");
    },
    nav: function (s, target) { if (target !== "/liquidaciones") Mock.toast("No es parte de esta maqueta"); },
    close: function (s) { s.overlay = null; s.menu = null; },
  },
});
