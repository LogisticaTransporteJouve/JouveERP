# Crédito de NC que cancela otros comprobantes (2026-11-11)

Decisión
[`2026-11-11-credito-de-nc-cancela-comprobantes`](../decisions/2026-11-11-credito-de-nc-cancela-comprobantes.md).

- [x] **PR — sobrante de NC.** Migración `20261111215000_nc_credit_spill`
      (`v_invoice_open`, `invoice_own_open_amount`, `v_purchase_invoice_open`
      con el sobrante, guardas sobre la cifra propia, aging y saldo inicial
      sobre las vistas base). pgTAP `nc_credit_spill_test`.
- [ ] **Antes de promover** (SQL editor de producción, solo lectura, sobre el
      schema anterior). Las dos primeras tienen que dar 0 filas; la tercera
      lista a quién avisarle.

  1. NC en otra moneda que su origen (el sobrante no se reparte entre monedas):

     ```sql
     select 'venta' as lado, n.id, n.moneda, o.moneda as moneda_origen
       from public.invoices n join public.invoices o on o.id = n.invoice_origin_id
      where n.kind = 'nc' and n.status = 'emitted'
        and (coalesce(n.moneda, 'PES') in ('DOL', 'USD')) <> (coalesce(o.moneda, 'PES') in ('DOL', 'USD'))
     union all
     select 'compra', n.id, n.moneda, o.moneda
       from public.purchase_invoices n join public.purchase_invoices o on o.id = n.invoice_origin_id
      where n.kind = 'nc' and n.status = 'received'
        and (coalesce(n.moneda, 'PES') in ('DOL', 'USD')) <> (coalesce(o.moneda, 'PES') in ('DOL', 'USD'));
     ```

  2. NC vigentes cuyo origen no es una factura o ND vigente (su sobrante no se
     reparte):

     ```sql
     select 'venta' as lado, n.id, o.kind, o.status
       from public.invoices n join public.invoices o on o.id = n.invoice_origin_id
      where n.kind = 'nc' and n.status = 'emitted'
        and not (o.status = 'emitted' and o.kind in ('factura', 'nd'))
     union all
     select 'compra', n.id, o.kind, o.status
       from public.purchase_invoices n join public.purchase_invoices o on o.id = n.invoice_origin_id
      where n.kind = 'nc' and n.status = 'received'
        and not (o.status = 'received' and o.kind in ('factura', 'nd'));
     ```

  3. Clientes que netean 0 en una moneda pero no en cada canal: después del
     cambio **siguen abiertos** (el crédito de un canal no cruza a otro).
     Avisarle al dueño con esta lista antes de promover:

     ```sql
     with own as (
       select i.client_id, i.channel_id,
              coalesce(i.moneda, 'PES') in ('DOL', 'USD') as usd,
              i.imp_total
                - coalesce((select sum(ra.amount_applied) from public.receipt_allocations ra
                              join public.receipts r on r.id = ra.receipt_id
                             where ra.invoice_id = i.id and r.status = 'issued'), 0)
                - coalesce((select sum(b.amount_applied) from public.client_opening_balance_allocations b
                             where b.invoice_id = i.id), 0)
                - coalesce((select sum(n.imp_total) from public.invoices n
                             where n.invoice_origin_id = i.id and n.kind = 'nc' and n.status = 'emitted'), 0) as own
         from public.invoices i
        where i.status = 'emitted' and i.kind in ('factura', 'nd')
     ), part as (
       select client_id, channel_id, usd, sum(own) as saldo from own group by 1, 2, 3
     )
     select c.legal_name, p.channel_id, p.usd, p.saldo
       from part p join public.clients c on c.id = p.client_id
      where (p.client_id, p.usd) in (select client_id, usd from part group by 1, 2 having abs(sum(saldo)) <= 0.01)
        and abs(p.saldo) > 0.01
      order by 1, 2;
     ```

     Lo mismo para proveedores, con `v_purchase_invoice_open.open_amount`
     (antes del cambio es la cifra propia) agrupado por `supplier_id`,
     `channel_id` y moneda, sobre facturas y ND `received`.

- [ ] **Después de promover** (solo lectura). Por partición (cliente o
      proveedor, canal, moneda) **sin saldo inicial en esa moneda**, lo abierto
      tiene que ser `greatest(Σ own_open_amount, 0)`; tiene que dar 0 filas:

  ```sql
  select 'venta' as lado, o.client_id as parte, o.channel_id, o.currency,
         sum(o.open_amount) as abierto, greatest(sum(o.own_open_amount), 0) as esperado
    from public.v_invoice_open o
   where o.status = 'emitted' and o.kind in ('factura', 'nd')
     and not exists (select 1 from public.client_opening_balances b
                      where b.client_id = o.client_id
                        and (o.currency = 'ARS' or b.target_balance_usd is not null))
   group by 1, 2, 3, 4
  having abs(sum(o.open_amount) - greatest(sum(o.own_open_amount), 0)) > 0.01
  union all
  select 'compra', o.supplier_id, o.channel_id,
         case when coalesce(o.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end,
         sum(o.open_amount), greatest(sum(o.own_open_amount), 0)
    from public.v_purchase_invoice_open o
   where o.status = 'received' and o.kind in ('factura', 'nd')
     and not exists (select 1 from public.supplier_opening_balances b
                      where b.supplier_id = o.supplier_id
                        and (coalesce(o.moneda, 'PES') not in ('DOL', 'USD') or b.target_balance_usd is not null))
   group by 1, 2, 3, 4
  having abs(sum(o.open_amount) - greatest(sum(o.own_open_amount), 0)) > 0.01;
  ```

  Control por nombre: FLORES, UNGARO CARLOS y los 38 clientes y 4 proveedores
  que netean 0 (salvo los que marcó la consulta 3) no aparecen en
  `v_client_aging` / `v_supplier_aging`.
- [ ] Un cliente o proveedor con saldo inicial que no cierra: el owner corre
      «Ajustar saldo» con el mismo objetivo desde la pantalla (reescribe solo
      las imputaciones del saldo inicial). Ningún comprobante, recibo ni OP se
      edita.
- [ ] **Rollback.** El código anterior lee un `open_amount` igual o menor, nunca
      mayor. Su tope de NC llama a `invoice_open_amount`, que ahora descuenta el
      sobrante: es más estricto (puede rechazar una NC sobre un comprobante que
      otra NC ya cubre), nunca más laxo.
