// Applies JouveERP's .dark class from the viewer's choice (data-theme / mock toggle) or the OS setting.
(function () {
  var root = document.documentElement, mq = matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    var picked = null;
    try { picked = localStorage.getItem("jouve-mock-theme"); } catch (e) {}
    if (picked === "system") picked = null;
    var t = picked || root.getAttribute("data-theme");
    root.classList.toggle("dark", t ? t === "dark" : mq.matches);
  }
  apply();
  mq.addEventListener("change", apply);
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  window.__applyTheme = apply;
})();
