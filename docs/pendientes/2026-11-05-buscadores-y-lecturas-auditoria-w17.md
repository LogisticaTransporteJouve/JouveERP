# 2026-11-05 — Buscadores y lecturas fallidas: lo que queda (auditoría w17)

Decisión: [`2026-11-05-buscadores-y-lecturas-auditoria-w17.md`](../decisions/2026-11-05-buscadores-y-lecturas-auditoria-w17.md).

- [ ] **Fichas de cliente, proveedor, viaje y empleado.** Ante una lectura
      fallida vuelven a la lista sin avisar (`redirect`). Deberían ir a la
      pantalla de error con «Reintentar», como ahora los comprobantes
      (auditoría w17-s6 F2).
- [ ] **Documentos con más de 100 en un estado.** Hoy se avisa que se
      muestran los 100 más recientes. Para ver los anteriores haría falta
      paginar la lectura.
- [ ] **Id mal formado en el detalle de un comprobante.** Cae en «Algo salió
      mal» en vez de «No encontramos lo que buscás». Un enlace de la app
      nunca lo arma.
- [ ] **Endosante sin `clients:read`.** El buscador de endosante de «Crear
      cheques en cartera» no distingue la falta de permiso: dice «No se
      pudieron buscar los clientes.» con un «Reintentar» que no puede andar.
