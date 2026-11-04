# 2026-11-04 — Sin `accounts:read`, se ocultan los selectores de cuenta, no la página

**Decisión.** Denegarle `accounts:read` a un usuario oculta Cuentas y lo que
elige una cuenta en otros módulos, pero esos módulos siguen andando:

- **Recibos y Órdenes de pago:** se ocultan «Nuevo» y «Editar» (las líneas
  eligen cuenta). Imputar y anular siguen.
- **Movimientos:** se ocultan el filtro por cuenta, Cobrar, Pagar, Adelanto
  y Nuevo movimiento.
- **Cheques:** se ocultan Nuevo cheque, Depositar y Vender. Rechazar sigue;
  si el cheque estaba vendido, la devolución queda contra la venta o como
  deuda del comprador.
- **Sueldos (mes):** se oculta el pago masivo. El diálogo de pagos de cada
  empleado y los de adelanto y pago del empleado muestran «No tenés permiso
  para ver cuentas.» adentro del diálogo.

Para leer las cuentas fuera de Cuentas se usa `useAccountOptions`
(`features/accounts/hooks/use-accounts.ts`). Nunca suspende ni tira: sin
permiso devuelve una lista vacía y un mensaje. Comparte el cache de
`useAccountsList`. `AccountOptionsGate` lo usa en los diálogos que no
reciben los permisos del usuario. El mes de sueldos precarga las cuentas
cuando el usuario puede pagar.

**Por qué.** `useAccountsList` es una query con suspense. Estaba montada
fuera de un diálogo abierto, y sin permiso su error llegaba al
`error.tsx` de la ruta y tiraba la página entera. CLAUDE.md dice que
denegar `<x>:read` oculta ese módulo, no los datos que otro módulo muestra
con su propio permiso.

**Descartado.** Devolver `[]` desde `useAccountsList` cuando la lectura
falla: la página de Cuentas mostraría un error como una lista vacía.
