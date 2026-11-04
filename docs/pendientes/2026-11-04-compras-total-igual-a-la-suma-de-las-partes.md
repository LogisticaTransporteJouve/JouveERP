# Compras: total igual a la suma de las partes (2026-11-04, auditoría w3)

- [x] Una compra cuyo total no da neto + IVA + otros tributos + no gravado +
      exento se rechaza al crearla o al cambiarle un importe: en el formulario
      (sin "guardar igual" en modo encabezado; un botón pasa la diferencia a
      no gravado en una A fiscal o al neto en las demás), en Zod, en la acción
      y, para las fiscales, en la base (`guard_purchase_invoice_total`).
- [x] Editar una compra sin mandar un importe ya no lo pisa: el schema de
      edición no tiene defaults (neto, IVA, otros tributos, moneda, cotización
      e ítems quedaban en 0, PES, 1 y sin ítems).
- [x] Al editar desde la lista, los importes quedan deshabilitados con
      "Cargando el desglose de la factura…" mientras carga, y con el motivo si
      la lectura falla.
- Las compras existentes con diferencia y las B/C con IVA: en **Antes de
  promover**.
- [ ] Las compras internas no tienen el guard en la base (no generan asiento);
      la app las valida igual.
- [x] **Auditoría w4** (`20261104120500`): el total de una compra cierra al
      centavo (formulario, Zod, acción y base); una B o C fiscal no guarda
      IVA, exento ni no gravado aunque venga de los ítems (la acción lee el
      IVA de las líneas y el guard ve lo que escribe
      `replace_purchase_invoice_items`); el renglón de totales del libro IVA
      Ventas (pantalla y PDF) muestra un total negativo de no gravado, exento
      u otros tributos.
- [ ] El lector de ARCA (`lib/afip/mis-comprobantes/parse.ts`) sigue
      aceptando un comprobante cuyo total difiere de sus partes en un
      centavo; al aceptarlo, la compra se rechaza con el mensaje del total.
      Lo ajusta la sesión dueña del robot y la bandeja.
