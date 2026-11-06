# Fiscal ventas, auditoría w9 (2026-11-04)

Decisión: `docs/decisions/2026-11-04-importacion-arca-atomica-y-subtotal-neto-en-a.md`.

- [x] **En una A, el subtotal de cada ítem es neto** (w9-s1 F1, w9-s7 F3).
      Vale para el PDF y el detalle: los ítems suman el «Subtotal» de los
      totales. La B sigue con el IVA incluido.
- [x] **El detalle muestra los mismos totales que el PDF** (w9-s8 N1). Una
      B con tributos muestra «Subtotal» y «Otros tributos». Esto también
      cierra el pendiente de w8 «La pantalla de detalle de una B muestra el
      precio unitario neto»: ahora lo muestra con IVA, como el PDF.
- [x] **La importación de ARCA guarda la cabecera y los ítems juntos**
      (w9-s5 F2, w9-s1 F2). Usa la RPC `import_arca_issued_invoice`, que
      necesita aprobación en `antes-de-promover.md`.
- [ ] **Ventas importadas sin ítems entre #393 y este cambio.** Si una
      corrida murió entre la cabecera y los ítems, esa venta quedó sin
      ítems. Entra en el pendiente de w8 «Re-leer de ARCA las ventas ya
      importadas», que sigue sin aprobar. La consulta del ítem `160100` de
      `antes-de-promover.md` las cuenta.
- [x] **pgTAP sin correr en la sesión.**
      `supabase/tests/arca_issued_import_atomic_test.sql` se escribió sin
      Supabase local. Corre en CI. — hecho: corre verde en el job `database` de CI (`main` en `e239ee7`).
