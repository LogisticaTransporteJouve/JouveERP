# 2026-11-04 — Más lecturas que fallan y la vista previa de archivos (auditoría w11)

Sigue la regla de w10
(`docs/decisions/2026-11-04-errores-de-sueldos-y-lecturas-fallidas-w10.md`):
una lectura que falla muestra qué no se pudo leer y «Reintentar», nunca el
estado vacío.

**Pantallas que ahora lo hacen:**

- **Tesorería.** Si no se puede leer el resumen, la página muestra «No se
  pudo cargar el resumen de tesorería.» en lugar de las tarjetas y la tabla
  de cuentas. Antes decía «ARS 0,00» líquido y «Sin cuentas para el filtro
  actual.». Los botones «Cobrar a cliente», «Pagar a proveedor» y
  «Adelanto a empleado» siguen visibles.
- **RRHH › Vencimientos.** Ya no dice «Ningún documento por vencer en los
  próximos 30 días» cuando la lectura falló. Ese mensaje vacío perdió el
  emoji: la UI es monocroma.
- **Documentos del empleado.** Ya no dice «Sin documentos cargados.»
  cuando la lectura falló.
- **«Historial de estados» de una carga.** Ya no dice «Sin cambios de
  estado.» cuando la lectura falló.

**Vista previa de un archivo** (`FilePreviewSurface`, en el borrador de
una factura de compra escaneada y en la revisión de un documento): el
spinner «Cargando archivo…» se muestra solo mientras se pide la URL
firmada. Si el pedido falla, dice «No se pudo cargar el archivo.» con
«Reintentar», que vuelve a pedirla. Antes, una URL que no llegaba quedaba
cargando para siempre. En el celular, donde el borrador muestra solo el
enlace «Ver <archivo>», el error y «Reintentar» van en su lugar.
