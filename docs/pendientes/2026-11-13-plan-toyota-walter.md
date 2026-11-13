# Cargar el Toyota Plan de Walter (2026-11-13)

Decisión en [`decisions/2026-11-13-plan-de-ahorro-como-sueldo.md`](../decisions/2026-11-13-plan-de-ahorro-como-sueldo.md).
Paso de datos en **producción**, después de promover `20261113100000_loan_plan_salary_employee`.
No se corrió.

## Antes

- [ ] Walter Dziurdzia activo en Personal.
- [ ] La planilla de **Octubre 2026** en borrador (si está cerrada, reabrirla —
      owner/admin—, pagar la cuota 52 y volver a cerrarla). Si no existe, se crea sola.

## 1. Crear el plan (Préstamos › Nuevo préstamo)

- Tipo **Plan de ahorro**, moneda **ARS**, canal **Facturado** (`jouve_fiscal`).
- Banco: «Toyota Plan Argentina S.A. de Ahorro para Fines Determinados».
- Descripción: «Toyota Plan Hilux 4x4 D/C DX 2.4 (grupo 933 orden 86)»; número
  «933-86»; cuenta de débito: Galicia.
- **Se le imputa a: Walter Dziurdzia.**
- Plan de cuotas: **Capital fijo (TNA)** con **TNA 0**, 84 cuotas, 1ª cuota
  **2022-07-13**, capital 84.571.909,80 (84 × 1.006.808,45: cada cuota queda en
  1.006.808,45, todo capital), **Ya pagadas (hasta la Nº) 51** (cuotas 1–51
  «pagada antes de cargar», sin movimiento ni línea en planilla). No usar
  «Cuotas iguales»: hoy manda el plan sin las ya pagadas.
- [ ] Editar la cuota 53: vencimiento **2026-11-12** (la serie mensual la pone el 13).
- Las cuotas futuras cambian cada mes con el valor móvil: se editan al llegar el cupón.

## 2. Desglose de las cuotas 52 y 53 (editor SQL, service role)

Mapeo del cupón a los campos del desglose (no hay campo «impuestos»):

| Cupón | Campo | Asiento |
| --- | --- | --- |
| Cuota pura | `capital` | Rodados en plan de ahorro |
| Cargas administrativas + monto diferido | `interest` | Intereses pagados |
| IVA | `iva` | IVA Crédito Fiscal |
| Seguro de bien | cargo `seguro` | Seguros de vehículos |
| Imp. débitos/créditos | cargo `otro`, cuenta 5.4.3 | Impuesto a los débitos y créditos bancarios |

```sql
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
with plan as (
  select id from public.loans
   where description = 'Toyota Plan Hilux 4x4 D/C DX 2.4 (grupo 933 orden 86)'
), idb as (
  select id from public.chart_of_accounts where code = '5.4.3' and is_active
)
select i.number,
       public.set_loan_installment_charges(
         i.id,
         jsonb_build_object('capital', 691870.98, 'interest', 113616.78, 'iva', 15377.49,
                            'perception', 0, 'iva_perception', 0),
         jsonb_build_array(
           jsonb_build_object('concept', 'seguro', 'description', 'Seguro de bien',
                              'amount', case i.number when 52 then 121195.05 else 178619.72 end,
                              'iva_amount', 0),
           jsonb_build_object('concept', 'otro', 'description', 'Imp. débitos y créditos',
                              'amount', case i.number when 52 then 6861.79 else 7323.48 end,
                              'iva_amount', 0, 'chart_account_id', (select id from idb))
         )) as amount
  from public.loan_installments i
 where i.loan_id = (select id from plan) and i.number in (52, 53);
-- Esperado: 52 → 948922.09 · 53 → 1006808.45
```

(Interés = 73.226,16 + 40.390,62 = 113.616,78.)

## 3. Pagar la cuota 52 desde el extracto

- [ ] Conciliación › Galicia › línea abierta del **2026-10-13** «Pago De Servicios ·
      TOYOTA PLAN» −948.922,09 › **Pagar cuota de préstamo…** › el plan, cuota 52.
- [ ] Verificar: asiento con 691.870,98 a Rodados en plan de ahorro (nada a Sueldos);
      en la planilla de Octubre 2026, fila de Walter con la línea «Plan de ahorro:
      Toyota Plan Hilux … · cuota 52» por 948.922,09, en Total y Pagado, Saldo sin cambio.
