# NC de ARCA vinculadas por total y liquidaciones cerradas, auditoría w11 (2026-11-04)

Decisión: `docs/decisions/2026-11-04-nc-de-arca-por-total-y-reabrir-liquidaciones.md`.

- [x] **Una NC importada sin `CbtesAsoc` no acredita de más una factura**
      (w11-s1 F1). `matchOriginByTotal` busca la factura en la misma moneda
      y toma la más reciente a la que sus NC ya vinculadas le dejan lugar
      para el total de la NC. Si ninguna tiene lugar, la NC se guarda sin
      origen (`origin_unlinked`) y el aging reparte su crédito.
- [x] **La importación no trae comprobantes en otra moneda que pesos o
      dólares** (w11-s1 F2). El comprobante queda como hueco
      (`arca_sync.unsupported_currency` en los logs) y la conciliación con
      ARCA lo sigue mostrando. No se agregó un `check` en `invoices.moneda`:
      no está confirmado qué guarda producción (consulta abajo).
- [x] **Solo un owner o un admin reabren una liquidación cerrada**, también
      por PATCH directo (w11-s4 F1, `20261104190100`). Una entry o un extra
      ya no se pasan de un período cerrado a uno en borrador.
- [ ] **Decidir qué hacer con las NC ya vinculadas de más en producción.**
      Las importaciones anteriores pudieron vincular dos NC del mismo total
      a una misma factura, o una NC en pesos a una factura en dólares. Este
      cambio no toca filas existentes. La consulta de solo lectura del ítem
      de `20261104190100` en `antes-de-promover.md` las lista. Para cada
      fila, el dueño (con el contador) decide:
  - dejarla como está, si la vinculación es correcta (por ejemplo, NC
    parciales que ARCA asoció);
  - o desvincular las NC que sobran (`invoice_origin_id = null`,
    `origin_unlinked = true`), para que el aging reparta su crédito entre
    las facturas más vencidas del cliente. Eso cambia el saldo por factura
    del aging, no el saldo del cliente ni el asiento. Necesita una
    migración de datos aprobada aparte; no se hizo.
- [ ] **Confirmar las monedas guardadas en producción** antes de agregar un
      `check (moneda in ('PES','DOL'))` a `invoices` (como `NOT VALID` y
      luego `validate`). Solo lectura:
      `select moneda, count(*) from public.invoices group by moneda order by moneda;`
- [ ] **Una NC por total más vieja que las 100 facturas más recientes del
      mismo total** queda sin origen aunque una factura más vieja tenga
      lugar. Es lo seguro (el aging reparte su crédito); se puede
      vincular a mano.
- [ ] **`payroll_periods` en estado cerrado todavía deja cambiar `kind`,
      `notes` y `posts_employee_accounts`** a quien tiene `hr:write`. Un
      cambio de `posts_employee_accounts` antes de cerrar evita escribir los
      descuentos en la cuenta del empleado. Ninguna pantalla los escribe; si
      se quiere cerrar, va en un trigger aparte.
