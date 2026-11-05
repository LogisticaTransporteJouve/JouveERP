# 2026-11-05 — Listas y lecturas de canales: lo que queda (auditoría w14)

Decisión: [`2026-11-05-listas-y-lecturas-de-canales-w14.md`](../decisions/2026-11-05-listas-y-lecturas-de-canales-w14.md).

- [ ] **Etiqueta del comprobante en Compras con canales sin leer.** Con la
      lectura de canales fallida, la columna «Tipo» muestra «—», pero la
      etiqueta del comprobante (columna «Comprobante») sigue diciendo
      «Factura» y no «Remito interno» en una compra interna. El aviso de
      arriba de la página explica que faltan los canales.
- [ ] **Selectores de canal vacíos.** Con la lectura fallida,
      `useSideChannels` sigue dejando el selector vacío (no sabe de qué lado
      es cada canal); ahora tiene el aviso «No se pudieron cargar los
      canales.» debajo. Si se quisiera ofrecer igual los canales de la
      página, habría que filtrar por el `is_fiscal` de cada opción.
- [ ] **Cargas y Pallets sin paginar en la pantalla.** Las dos listas ahora
      traen todas las filas (hasta 100.000, el tope de `paginateRange`). Con
      muchos miles conviene paginar en el servidor, como Comprobantes.
