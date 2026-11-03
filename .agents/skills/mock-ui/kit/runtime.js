// JouveERP mock runtime: state → HTML in the real shell's canvas, plus `ui` helpers whose
// classes come from window.KIT (read from the real components/ui at build time).
(function () {
  "use strict";

  var KIT = window.KIT;
  var CONFIG = window.MOCK_CONFIG || {};
  var S = KIT.slots;

  // ---------- small utils ----------
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // The app's own cn() (clsx + tailwind-merge): a later class wins a conflict, as in the components.
  function cx() {
    return window.MockShell.cn.apply(null, arguments);
  }
  function attrs(o) {
    if (!o) return "";
    if (typeof o === "string") return " " + o;
    return Object.keys(o).map(function (k) {
      var v = o[k];
      return v === false || v == null ? "" : v === true ? " " + k : " " + k + '="' + esc(v) + '"';
    }).join("");
  }
  function act(action, arg) {
    return !action ? "" : ' data-action="' + esc(action) + '"' + (arg == null ? "" : ' data-arg="' + esc(arg) + '"');
  }

  // ---------- ui: JouveERP primitives (components/ui) ----------
  var ui = {};

  ui.esc = esc;
  ui.cx = cx;

  // A lucide icon by kebab name. build.mjs bundles the icon nodes this mock names from the repo's
  // own lucide-react (MockShell.icons), and drawIcons() swaps each placeholder for the <svg>
  // lucide-react renders, so no icon CDN is needed.
  ui.icon = function (name, cls) {
    return '<i data-lucide="' + esc(name) + '" class="' + esc(cls || "") + '"></i>';
  };

  function drawIcons() {
    var icons = (window.MockShell && window.MockShell.icons) || {};
    document.querySelectorAll("i[data-lucide]").forEach(function (el) {
      var name = el.getAttribute("data-lucide");
      var node = icons[name];
      if (!node) return;
      var body = node.map(function (n) {
        return "<" + n[0] + Object.keys(n[1]).filter(function (k) { return k !== "key"; }).map(function (k) {
          return " " + k.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }) + '="' + esc(n[1][k]) + '"';
        }).join("") + "/>";
      }).join("");
      var tmp = document.createElement("span");
      tmp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="' +
        esc(cx("lucide lucide-" + name, el.getAttribute("class"))) + '">' + body + "</svg>";
      el.replaceWith(tmp.firstChild);
    });
  }

  function buttonInner(label, o) {
    return (o.icon ? ui.icon(o.icon) : "") + (label ? "<span>" + label + "</span>" : "") +
      (o.iconRight ? ui.icon(o.iconRight, "size-3 opacity-70") : "");
  }

  // <Button>: variant default|destructive|outline|secondary|ghost|link,
  // size default|xs|sm|lg|icon|icon-xs|icon-sm|icon-lg.
  ui.button = function (label, o) {
    o = o || {};
    var cls = KIT.variants.button[(o.variant || "default") + "/" + (o.size || "default")];
    return '<button type="button" data-slot="button" class="' + cx(cls, o.cls) + '"' + act(o.action, o.arg) +
      (o.disabled ? " disabled" : "") + attrs(o.attrs) + ">" + buttonInner(label, o) + "</button>";
  };

  // <Badge>: variant default|secondary|destructive|outline|ghost|link.
  ui.badge = function (label, o) {
    o = o || {};
    return '<span data-slot="badge" class="' + cx(KIT.variants.badge[o.variant || "default"], o.cls) + '"' + attrs(o.attrs) + ">" +
      (o.icon ? ui.icon(o.icon) : "") + label + "</span>";
  };

  // <Input>. `input` names the action called on every keystroke with the new value.
  ui.input = function (o) {
    o = o || {};
    return '<input data-slot="input" class="' + cx(S.input, o.cls) + '"' + attrs({
      id: o.id, type: o.type || "text", value: o.value, placeholder: o.placeholder, "data-input": o.input,
    }) + attrs(o.attrs) + ">";
  };

  ui.textarea = function (o) {
    o = o || {};
    return '<textarea data-slot="textarea" class="' + cx(S.textarea, o.cls) + '"' + attrs({
      id: o.id, placeholder: o.placeholder, rows: o.rows, "data-input": o.input,
    }) + attrs(o.attrs) + ">" + esc(o.value) + "</textarea>";
  };

  ui.label = function (text, o) {
    o = o || {};
    return '<label data-slot="label" class="' + cx(S.label, o.cls) + '"' + attrs({ for: o.for }) + ">" + text + "</label>";
  };

  ui.checkbox = function (checked, o) {
    o = o || {};
    var st = checked ? "checked" : "unchecked";
    return '<button type="button" role="checkbox" aria-checked="' + !!checked + '" data-state="' + st + '" data-slot="checkbox" class="' +
      cx(S.checkbox, o.cls) + '"' + act(o.action, o.arg) + attrs({ "aria-label": o.label }) + attrs(o.attrs) + ">" +
      (!checked ? "" : '<span data-state="checked" data-slot="checkbox-indicator" class="' + S["checkbox-indicator"] + '" style="pointer-events:none">' +
        ui.icon("check", "size-3.5") + "</span>") + "</button>";
  };

  // <Switch>: size default|sm.
  ui.switch = function (checked, o) {
    o = o || {};
    var st = checked ? "checked" : "unchecked";
    return '<button type="button" role="switch" aria-checked="' + !!checked + '" data-state="' + st + '" data-slot="switch" data-size="' +
      (o.size || "default") + '" class="' + cx(S.switch, o.cls) + '"' + act(o.action, o.arg) + attrs({ "aria-label": o.label }) + attrs(o.attrs) +
      '><span data-state="' + st + '" data-slot="switch-thumb" class="' + S["switch-thumb"] + '"></span></button>';
  };

  ui.separator = function (o) {
    o = o || {};
    var orientation = o.vertical ? "vertical" : "horizontal";
    return '<div data-orientation="' + orientation + '" role="none" data-slot="separator-root" class="' + cx(S["separator-root"], o.cls) + '"></div>';
  };

  ui.skeleton = function (cls) {
    return '<div data-slot="skeleton" class="' + cx(S.skeleton, cls) + '"></div>';
  };

  // The app's loading icon: <Loader2 className="size-4 animate-spin" />.
  ui.spinner = function (cls) {
    return ui.icon("loader-circle", cx("size-4 animate-spin", cls));
  };

  ui.avatar = function (initials, o) {
    o = o || {};
    return '<span data-slot="avatar" class="' + cx(S.avatar, o.cls) + '"><span data-slot="avatar-fallback" class="' +
      cx(S["avatar-fallback"], o.fallbackCls) + '">' + esc(initials) + "</span></span>";
  };

  ui.card = function (o) {
    o = o || {};
    var head = o.title || o.description || o.action;
    return '<div data-slot="card" class="' + cx(S.card, o.cls) + '"' + attrs(o.attrs) + ">" +
      (!head ? "" : '<div data-slot="card-header" class="' + S["card-header"] + '">' +
        (o.title ? '<div data-slot="card-title" class="' + S["card-title"] + '">' + o.title + "</div>" : "") +
        (o.description ? '<div data-slot="card-description" class="' + S["card-description"] + '">' + o.description + "</div>" : "") +
        (o.action ? '<div data-slot="card-action" class="' + S["card-action"] + '">' + o.action + "</div>" : "") + "</div>") +
      (o.content != null ? '<div data-slot="card-content" class="' + cx(S["card-content"], o.contentCls) + '">' + o.content + "</div>" : "") +
      (o.footer ? '<div data-slot="card-footer" class="' + S["card-footer"] + '">' + o.footer + "</div>" : "") + "</div>";
  };

  // Tabs list. items: [{ value, label, icon }]. Clicking calls `action` with the tab's value.
  ui.tabs = function (items, active, o) {
    o = o || {};
    return '<div role="tablist" data-slot="tabs-list" class="' + cx(S["tabs-list"], o.cls) + '">' + items.map(function (t) {
      var on = t.value === active;
      return '<button type="button" role="tab" aria-selected="' + on + '" data-state="' + (on ? "active" : "inactive") +
        '" data-slot="tabs-trigger" class="' + cx(S["tabs-trigger"], o.triggerCls) + '"' + act(o.action, t.value) + ">" +
        (t.icon ? ui.icon(t.icon) : "") + t.label + "</button>";
    }).join("") + "</div>";
  };

  // Table. head: header cells (string or { html, cls }); rows: HTML from ui.tr.
  ui.table = function (head, rows, o) {
    o = o || {};
    return '<div data-slot="table-container" class="' + cx(S["table-container"], o.containerCls) + '"><table data-slot="table" class="' +
      cx(S.table, o.cls) + '"><thead data-slot="table-header" class="' + S["table-header"] + '"><tr data-slot="table-row" class="' +
      S["table-row"] + '">' + head.map(function (h) { return ui.th(h); }).join("") + '</tr></thead><tbody data-slot="table-body" class="' +
      S["table-body"] + '">' + rows.join("") + "</tbody></table></div>";
  };
  ui.th = function (h) {
    var c = typeof h === "string" ? { html: h } : h;
    return '<th data-slot="table-head" scope="col" class="' + cx(S["table-head"], c.cls) + '">' + c.html + "</th>";
  };
  ui.td = function (html, cls, extra) {
    return '<td data-slot="table-cell" class="' + cx(S["table-cell"], cls) + '"' + attrs(extra) + ">" + html + "</td>";
  };
  // cells: strings (wrapped in ui.td) or HTML that already starts with <td.
  ui.tr = function (cells, o) {
    o = o || {};
    return '<tr data-slot="table-row" class="' + cx(S["table-row"], o.cls) + '"' + (o.selected ? ' data-state="selected"' : "") +
      act(o.action, o.arg) + attrs(o.attrs) + ">" + cells.map(function (c) {
        return /^\s*<td/.test(c) ? c : ui.td(c);
      }).join("") + "</tr>";
  };

  // Overlays render into #mock-layer from the app's `overlay(state)`. `close` names the action
  // that dismisses them (default "close", which clears state.overlay); Escape and the backdrop call it too.
  ui.dialog = function (o) {
    var close = o.close || "close";
    return '<div data-state="open" data-slot="dialog-overlay" class="' + S["dialog-overlay"] + '"' + act(close) + "></div>" +
      '<div role="dialog" aria-modal="true" data-state="open" data-slot="dialog-content" class="' + cx(S["dialog-content"], o.cls) + '">' +
      '<div data-slot="dialog-header" class="' + S["dialog-header"] + '"><h2 data-slot="dialog-title" class="' + S["dialog-title"] + '">' + o.title + "</h2>" +
      (o.description ? '<p data-slot="dialog-description" class="' + S["dialog-description"] + '">' + o.description + "</p>" : "") + "</div>" +
      (o.body || "") + (o.footer ? '<div data-slot="dialog-footer" class="' + S["dialog-footer"] + '">' + o.footer + "</div>" : "") +
      '<button type="button" class="' + S["dialog-close"] + '"' + act(close) + ">" + ui.icon("x") + '<span class="sr-only">Close</span></button></div>';
  };

  ui.sheet = function (o) {
    var close = o.close || "close";
    return '<div data-state="open" data-slot="sheet-overlay" class="' + S["sheet-overlay"] + '"' + act(close) + "></div>" +
      '<div role="dialog" aria-modal="true" data-state="open" data-slot="sheet-content" class="' + cx(S["sheet-content"], o.cls) + '">' +
      '<div data-slot="sheet-header" class="' + S["sheet-header"] + '"><h2 data-slot="sheet-title" class="' + S["sheet-title"] + '">' + o.title + "</h2>" +
      (o.description ? '<p data-slot="sheet-description" class="' + S["sheet-description"] + '">' + o.description + "</p>" : "") + "</div>" +
      (o.body || "") + (o.footer ? '<div data-slot="sheet-footer" class="' + S["sheet-footer"] + '">' + o.footer + "</div>" : "") +
      '<button type="button" class="' + S["sheet-close"] + '"' + act(close) + ">" + ui.icon("x", "size-4") + '<span class="sr-only">Close</span></button></div>';
  };

  // Dropdown menu content. items: { label, icon, action, arg, shortcut, checked, destructive } | "separator" | { heading }.
  ui.menu = function (items, o) {
    o = o || {};
    return '<div role="menu" data-state="open" data-side="bottom" data-slot="dropdown-menu-content" class="' + cx(S["dropdown-menu-content"], o.cls) + '">' +
      items.map(function (it) {
        if (it === "separator") return '<div role="separator" data-slot="dropdown-menu-separator" class="' + S["dropdown-menu-separator"] + '"></div>';
        if (it.heading) return '<div data-slot="dropdown-menu-label" class="' + S["dropdown-menu-label"] + '">' + it.heading + "</div>";
        if (it.checked != null) {
          return '<div role="menuitemcheckbox" aria-checked="' + !!it.checked + '" data-state="' + (it.checked ? "checked" : "unchecked") +
            '" data-slot="dropdown-menu-checkbox-item" class="' + S["dropdown-menu-checkbox-item"] + '"' + act(it.action, it.arg) + ">" +
            '<span class="' + S["dropdown-menu-item-indicator"] + '">' + (it.checked ? ui.icon("check", "size-4") : "") + "</span>" + it.label + "</div>";
        }
        return '<div role="menuitem" data-slot="dropdown-menu-item" data-variant="' + (it.destructive ? "destructive" : "default") + '" class="' +
          S["dropdown-menu-item"] + '"' + act(it.action, it.arg) + ">" + (it.icon ? ui.icon(it.icon) : "") + it.label +
          (it.shortcut ? '<span data-slot="dropdown-menu-shortcut" class="' + S["dropdown-menu-shortcut"] + '">' + it.shortcut + "</span>" : "") + "</div>";
      }).join("") + "</div>";
  };

  // A trigger with its popup (menu, popover, select list). While `popup` is set it renders in a
  // fixed layer under the trigger, like Radix's portal, so tables and scroll areas never clip it.
  // `close` names the action an outside click runs; `block` makes the wrapper full width (a form select).
  var popupSeq = 0;
  ui.anchor = function (trigger, popup, o) {
    o = o || {};
    var wrap = o.block ? "flex w-full" : "inline-flex";
    if (!popup) return '<span class="' + wrap + '">' + trigger + "</span>";
    var id = "p" + ++popupSeq;
    return '<span class="' + wrap + '" data-popup-anchor="' + id + '">' + trigger + "</span>" +
      '<template data-popup="' + id + '" data-align="' + (o.align || "start") + '"' + (o.close ? ' data-close="' + esc(o.close) + '"' : "") + ">" + popup + "</template>";
  };

  ui.popover = function (html, o) {
    o = o || {};
    return '<div data-state="open" data-side="bottom" data-slot="popover-content" class="' + cx(S["popover-content"], o.cls) + '">' + html + "</div>";
  };

  // <Select> trigger; pair with ui.selectContent inside ui.anchor while open.
  ui.select = function (value, o) {
    o = o || {};
    return '<button type="button" role="combobox" data-state="' + (o.open ? "open" : "closed") + '" data-slot="select-trigger" data-size="' +
      (o.size || "default") + '" class="' + cx(S["select-trigger"], o.cls) + '"' + act(o.action, o.arg) + (value ? "" : " data-placeholder") +
      '><span data-slot="select-value" class="truncate">' + (value || esc(o.placeholder || "")) + "</span>" + ui.icon("chevron-down", "size-4 opacity-50") + "</button>";
  };
  ui.selectContent = function (options, selected, o) {
    o = o || {};
    return '<div role="listbox" data-state="open" data-side="bottom" data-slot="select-content" class="' + cx(S["select-content"], o.cls) + '"><div class="p-1">' +
      options.map(function (opt) {
        var v = typeof opt === "string" ? { value: opt, label: opt } : opt;
        return '<div role="option" data-slot="select-item" class="' + S["select-item"] + '"' + act(o.action, v.value) + ">" +
          '<span class="' + S["select-item-indicator"] + '">' + (v.value === selected ? ui.icon("check", "size-4") : "") + "</span>" + v.label + "</div>";
      }).join("") + "</div></div>";
  };

  // Hover tooltip around any trigger.
  ui.tooltip = function (trigger, text) {
    return '<span class="group/mock-tip relative inline-flex">' + trigger +
      '<span data-state="delayed-open" data-side="top" data-slot="tooltip-content" class="' + S["tooltip-content"] +
      ' pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 group-hover/mock-tip:block">' + text + "</span></span>";
  };

  // <StatGrid> of <StatTile>s (components/ui/stat-tile.tsx). tiles: [{ label, value, note }].
  ui.stats = function (tiles) {
    return KIT.templates.statGrid.replace("__TILES__", tiles.map(function (t) {
      var html = KIT.templates.statTile.replace("__LABEL__", esc(t.label)).replace("__VALUE__", t.value);
      return t.note ? html.replace("__NOTE__", t.note) : html.replace(/<p[^>]*>__NOTE__<\/p>/, "");
    }).join(""));
  };

  // <Section> (components/ui/section.tsx): a page block with title, description, actions and body.
  ui.section = function (o) {
    var html = KIT.templates.section.replace("__TITLE__", o.title).replace("__BODY__", o.body || "");
    html = o.description ? html.replace("__DESCRIPTION__", o.description) : html.replace(/<p[^>]*>__DESCRIPTION__<\/p>/, "");
    return o.actions ? html.replace("__ACTIONS__", o.actions) : html.replace(/<div[^>]*>__ACTIONS__<\/div>/, "");
  };

  // Marks what this proposal adds (`inline` for inline content, `inset` for a whole panel). Hidden in client mode (toolbar "Nuevo" toggle, or "client": true in mock.json).
  ui.isNew = function (html, o) {
    o = o || {};
    return '<div class="mock-new' + (o.inline ? " mock-new-inline" : "") + (o.inset ? " mock-new-inset" : "") + (o.cls ? " " + o.cls : "") + '">' + html + "</div>";
  };

  // ---------- app runtime ----------
  var app = null;
  var state = null;
  var stage = document.createElement("div");
  stage.id = "stage";
  stage.className = "contents";
  var layer = document.getElementById("mock-layer");
  var popups = document.createElement("div");
  document.body.appendChild(popups);

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function render() {
    var focused = document.activeElement;
    var keep = focused && focused.id && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")
      ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : null;

    var shown = openSurfaces();
    var scrolls = keepScroll();
    stage.innerHTML = app.view(state);
    layer.innerHTML = app.overlay ? app.overlay(state) || "" : "";
    placePopups();
    settle(shown);
    restoreScroll(scrolls);
    if (app.page) {
      var p = app.page(state) || {};
      window.MockShell.update({ path: p.nav });
    }
    drawIcons();

    if (keep) {
      var el = document.getElementById(keep.id);
      if (el) {
        el.focus();
        try { el.setSelectionRange(keep.start, keep.end); } catch (e) {}
      }
    }
  }

  // A re-render replaces the DOM, so scroll areas would jump to the top. `data-scroll="id"` keeps an
  // area's position; `data-scroll-end="key"` scrolls it to the bottom whenever the key changes (a chat
  // that gained a message).
  function keepScroll() {
    var kept = {};
    document.querySelectorAll("[data-scroll]").forEach(function (el) {
      kept[el.getAttribute("data-scroll")] = { top: el.scrollTop, end: el.getAttribute("data-scroll-end") };
    });
    return kept;
  }
  function restoreScroll(kept) {
    var toEnd = [];
    document.querySelectorAll("[data-scroll]").forEach(function (el) {
      var was = kept[el.getAttribute("data-scroll")];
      var end = el.getAttribute("data-scroll-end");
      if (end != null && (!was || was.end !== end)) toEnd.push(el);
      else if (was) el.scrollTop = was.top;
    });
    // Again after the shell has settled: a render that also switched the layout (page ↔ bare
    // card) only gets its final heights once React has committed.
    var bottom = function () { toEnd.forEach(function (el) { el.scrollTop = el.scrollHeight; }); };
    bottom();
    if (toEnd.length) setTimeout(bottom, 0);
  }

  // Overlays and menus animate in once, like the real ones; a re-render must not replay it.
  var SURFACES = ["dialog-overlay", "dialog-content", "sheet-overlay", "sheet-content", "dropdown-menu-content", "select-content", "popover-content"];
  function openSurfaces() {
    var seen = {};
    SURFACES.forEach(function (slot) { seen[slot] = document.querySelectorAll('[data-slot="' + slot + '"]').length; });
    return seen;
  }
  function settle(before) {
    SURFACES.forEach(function (slot) {
      document.querySelectorAll('[data-slot="' + slot + '"]').forEach(function (el, n) {
        if (n < before[slot]) el.style.animation = "none";
      });
    });
  }

  function placePopups() {
    popups.innerHTML = "";
    document.querySelectorAll("template[data-popup]").forEach(function (t) {
      var box = document.createElement("div");
      box.style.position = "fixed";
      box.style.zIndex = "60";
      box.setAttribute("data-popup-box", t.getAttribute("data-popup"));
      box.setAttribute("data-align", t.getAttribute("data-align"));
      if (t.hasAttribute("data-close")) box.setAttribute("data-close", t.getAttribute("data-close"));
      box.innerHTML = t.innerHTML;
      popups.appendChild(box);
    });
    positionPopups();
  }

  function positionPopups() {
    popups.querySelectorAll("[data-popup-box]").forEach(function (box) {
      var anchor = document.querySelector('[data-popup-anchor="' + box.getAttribute("data-popup-box") + '"]');
      if (!anchor) return;
      var r = anchor.getBoundingClientRect();
      // Menus and popovers sit 4px below (sideOffset); the select content carries its own translate-y-1.
      box.style.top = r.bottom + (box.querySelector('[data-slot="select-content"]') ? 0 : 4) + "px";
      if (box.getAttribute("data-align") === "end") box.style.right = window.innerWidth - r.right + "px";
      else box.style.left = r.left + "px";
      box.style.minWidth = r.width + "px";
    });
  }
  window.addEventListener("resize", positionPopups);
  document.addEventListener("scroll", positionPopups, true);

  // The app's own toasts (sonner, mounted by the shell); a plain box if the shell isn't up yet.
  function toast(text) {
    if (window.MockShell && window.MockShell.toast) return window.MockShell.toast(text);
    var t = document.createElement("div");
    t.className = "mock-toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function run(name, arg, el, ev) {
    var fn = app.actions && app.actions[name];
    if (fn) fn(state, arg, el, ev);
    else if (name === "close") state.overlay = null;
    else return toast("No es parte de esta maqueta");
    render();
  }

  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-action]");
    // An outside click dismisses open popups, as Radix does.
    var open = popups.querySelector("[data-popup-box][data-close]");
    if (open && !ev.target.closest("[data-popup-box], [data-popup-anchor]")) {
      ev.preventDefault();
      return run(open.getAttribute("data-close"), null, null, ev);
    }
    if (!el || el.disabled) return;
    ev.preventDefault();
    run(el.getAttribute("data-action"), el.getAttribute("data-arg"), el, ev);
  });

  document.addEventListener("input", function (ev) {
    var name = ev.target.getAttribute && ev.target.getAttribute("data-input");
    if (name) run(name, ev.target.value, ev.target, ev);
  });

  // Enter (without Shift) in a field with data-enter runs that action, like the chat composer.
  document.addEventListener("keydown", function (ev) {
    var name = ev.key === "Enter" && !ev.shiftKey && ev.target.getAttribute && ev.target.getAttribute("data-enter");
    if (!name) return;
    ev.preventDefault();
    run(name, ev.target.value, ev.target, ev);
  });

  // Escape closes the innermost surface first: an open popup, then the dialog or sheet.
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    var open = popups.querySelector("[data-popup-box][data-close]");
    if (open) run(open.getAttribute("data-close"), null, null, ev);
    else if (layer.innerHTML.trim()) run("close", null, null, ev);
  });

  // ---------- the mock's own toolbar (outside JouveERP's UI) ----------
  function toolbar() {
    var hasHelp = !!(CONFIG.steps || CONFIG.intro);
    var bar = document.createElement("div");
    bar.className = "mock-bar";
    bar.innerHTML =
      '<button type="button" data-mock="new" aria-pressed="true" title="Mostrar lo nuevo"><span class="mock-new-key"></span>Nuevo</button>' +
      (hasHelp ? '<button type="button" data-mock="help" aria-pressed="false" title="Cómo probarlo"><i data-lucide="circle-help"></i></button>' : "") +
      '<button type="button" data-mock="theme" title="Claro / oscuro"><i data-lucide="sun-moon"></i></button>' +
      '<button type="button" data-mock="restart" title="Empezar de nuevo"><i data-lucide="rotate-ccw"></i></button>';
    document.body.appendChild(bar);

    var help = null;
    if (hasHelp) {
      help = document.createElement("div");
      help.className = "mock-help";
      help.innerHTML = "<h2>" + esc(CONFIG.title || "Maqueta") + "</h2>" + (CONFIG.intro ? "<p>" + esc(CONFIG.intro) + "</p>" : "") +
        (CONFIG.steps ? "<ol>" + CONFIG.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" : "");
      help.hidden = !!CONFIG.client;
      document.body.appendChild(help);
      bar.querySelector('[data-mock="help"]').setAttribute("aria-pressed", String(!help.hidden));
    }

    function setClean(clean) {
      document.documentElement.classList.toggle("mock-clean", clean);
      bar.querySelector('[data-mock="new"]').setAttribute("aria-pressed", String(!clean));
    }
    setClean(!!CONFIG.client);

    bar.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-mock]");
      if (!b) return;
      var what = b.getAttribute("data-mock");
      if (what === "new") setClean(!document.documentElement.classList.contains("mock-clean"));
      if (what === "help") {
        help.hidden = !help.hidden;
        b.setAttribute("aria-pressed", String(!help.hidden));
      }
      if (what === "theme") {
        var dark = !document.documentElement.classList.contains("dark");
        try { localStorage.setItem("jouve-mock-theme", dark ? "dark" : "light"); } catch (e) {}
        document.documentElement.classList.toggle("dark", dark);
      }
      if (what === "restart") {
        state = clone(app.initial);
        render();
      }
    });
  }

  // ---------- entry point ----------
  window.Mock = {
    // def: { state, view(s), overlay?(s), page?(s) → { nav }, actions: { name(s, arg, el, ev) } }
    app: function (def) {
      app = def;
      app.initial = clone(def.state);
      state = clone(def.state);
      toolbar();
      // The shell attaches the stage on its first commit and draws the mock from there.
      var drawn = false;
      window.MockShell.mountShell(document.getElementById("mock-root"), stage, CONFIG, function () {
        if (drawn) return;
        drawn = true;
        render();
      });
    },
    // The real sidebar, header and tab bar call this with the route they link to ("/invoices").
    shell: function (target) { run("nav", target); },
    render: render,
    toast: toast,
  };
  window.ui = ui;
})();
