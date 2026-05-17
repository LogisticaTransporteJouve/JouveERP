// JouveERP manual — sidebar + mermaid bootstrap
// El sidebar se inyecta desde acá para que cada página HTML quede liviana
// y no tengamos que duplicar el árbol de navegación.

const NAV = [
  {
    label: null,
    items: [
      { href: "index.html", label: "Inicio", icon: "🏠" },
      { href: "getting-started.html", label: "Primeros pasos", icon: "🚀" },
    ],
  },
  {
    label: "Ventas",
    items: [
      { href: "sales.html#clientes", label: "Clientes", icon: "👥" },
      { href: "sales.html#comprobantes", label: "Comprobantes", icon: "🧾" },
      { href: "sales.html#recibos", label: "Recibos", icon: "📜" },
      { href: "sales.html#aging-clientes", label: "Aging clientes", icon: "⚠" },
    ],
  },
  {
    label: "Compras",
    items: [
      { href: "purchases.html#proveedores", label: "Proveedores", icon: "🚚" },
      { href: "purchases.html#categorias", label: "Categorías", icon: "🏷" },
      { href: "purchases.html#facturas-de-compra", label: "Facturas de compra", icon: "🛒" },
      { href: "purchases.html#ordenes-de-pago", label: "Órdenes de pago", icon: "💳" },
      { href: "purchases.html#aging-proveedores", label: "Aging proveedores", icon: "⚠" },
    ],
  },
  {
    label: "Tesorería",
    items: [
      { href: "treasury.html#cuentas", label: "Cuentas", icon: "👛" },
      { href: "treasury.html#caja", label: "Caja", icon: "↔" },
      { href: "treasury.html#cheques-recibidos", label: "Cheques recibidos", icon: "📥" },
      { href: "treasury.html#cheques-propios", label: "Cheques propios", icon: "📤" },
    ],
  },
  {
    label: "Contabilidad",
    items: [
      { href: "accounting.html#plan-de-cuentas", label: "Plan de cuentas", icon: "🌲" },
      { href: "accounting.html#libro-diario", label: "Libro diario", icon: "📖" },
      { href: "accounting.html#libro-mayor", label: "Libro mayor", icon: "📈" },
      { href: "accounting.html#libro-iva-ventas", label: "Libro IVA Ventas", icon: "🧾" },
      { href: "accounting.html#libro-iva-compras", label: "Libro IVA Compras", icon: "🛒" },
      { href: "accounting.html#balance-eerr", label: "Balance / EERR", icon: "⚖" },
      { href: "accounting.html#centros-de-costo", label: "Centros de costo", icon: "🎯" },
      { href: "accounting.html#ajuste-por-inflacion", label: "Ajuste inflación", icon: "📊" },
    ],
  },
  {
    label: "Personal",
    items: [
      { href: "hr.html#empleados", label: "Empleados", icon: "🪪" },
      { href: "hr.html#sueldos", label: "Sueldos", icon: "💰" },
      { href: "hr.html#asistencia", label: "Asistencia", icon: "📆" },
      { href: "hr.html#vacaciones", label: "Vacaciones", icon: "🌴" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "admin.html#usuarios", label: "Usuarios", icon: "🛡" },
      { href: "admin.html#padron-afip", label: "Padrón AFIP", icon: "🔎" },
      { href: "admin.html#puntos-de-venta", label: "Puntos de venta", icon: "🏪" },
      { href: "admin.html#preview-pdf", label: "Preview PDF", icon: "📄" },
      { href: "admin.html#backups", label: "Backups", icon: "💾" },
    ],
  },
  {
    label: "Colaboración",
    items: [
      { href: "collaboration.html#chat", label: "Chat", icon: "💬" },
      { href: "collaboration.html#busqueda-global", label: "Búsqueda global", icon: "🔍" },
      { href: "collaboration.html#notificaciones", label: "Notificaciones", icon: "🔔" },
      { href: "collaboration.html#archivos-adjuntos", label: "Adjuntos", icon: "📎" },
      { href: "collaboration.html#perfil", label: "Mi perfil", icon: "👤" },
    ],
  },
];

function renderSidebar(currentPage) {
  const root = document.getElementById("sidebar");
  if (!root) return;

  const parts = [];
  parts.push(`
    <div class="sidebar-header">
      <div class="logo">JE</div>
      <span>Manual JouveERP</span>
    </div>`);

  for (const section of NAV) {
    parts.push('<div class="sidebar-group">');
    if (section.label) {
      parts.push(`<div class="sidebar-group-label">${section.label}</div>`);
    }
    parts.push('<div class="sidebar-menu">');
    for (const item of section.items) {
      const isActive = item.href.split("#")[0] === currentPage;
      parts.push(`
        <a class="sidebar-link${isActive ? " active" : ""}" href="${item.href}">
          <span class="ic">${item.icon}</span>
          <span>${item.label}</span>
        </a>`);
    }
    parts.push("</div></div>");
  }

  root.innerHTML = parts.join("");
}

function initMermaid() {
  if (typeof window.mermaid === "undefined") return;
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  window.mermaid.initialize({
    startOnLoad: true,
    theme: isDark ? "dark" : "neutral",
    securityLevel: "loose",
    flowchart: { htmlLabels: true, curve: "basis" },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const current = (location.pathname.split("/").pop() || "index.html")
    .toLowerCase();
  renderSidebar(current);
  initMermaid();
});
