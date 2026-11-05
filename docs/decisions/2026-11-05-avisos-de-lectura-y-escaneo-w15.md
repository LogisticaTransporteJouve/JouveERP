# 2026-11-05 — Avisos de lectura en los diálogos y escaneo (w15)

**Decisión.** Auditoría w15 (S8 F1, F2; S6 F1, F2; S5 F1, F2). Solo código de
la app, sin migración.

**Canales sin leer, en cada diálogo.** Completa la sección «Canales del
layout» de
[`2026-11-05-listas-y-lecturas-de-canales-w14.md`](2026-11-05-listas-y-lecturas-de-canales-w14.md).
Con la lectura de canales fallida, también dicen «No se pudieron cargar los
canales.» con «Reintentar», debajo del selector de canal:

- Sueldos: «Pagos» de un período, pago masivo y movimiento de caja de un
  empleado;
- Importar;
- Conciliación bancaria: «Registrar movimiento» desde una línea;
- Asiento manual;
- Pago recurrente;
- Viaje;
- Proveedor.

«Facturar» en un remito interno dice lo mismo en lugar de «Configurá un único
canal fiscal activo para facturar.», y no deja emitir.

`components/channels-read-error-reach.test.ts` recorre
`features/**/components` y exige el aviso en cada componente que arma un
selector con `useScope().channels`. Las excepciones están en el test, y cada
una dice a qué componente le pasa la lista: cobrar, pagar, la grilla de
sueldos y la lista de Compras, que queda debajo del aviso de la página.

**Clientes de Productos y Tarifas de depósito.** `listClientsAction` lee por
páginas (`paginateRange`, orden `legal_name` + `id`). Si la lectura falla,
«Nuevo producto» y «Nueva tarifa» dicen «No se pudieron cargar los
clientes.» con «Reintentar» debajo del selector de cliente. Un usuario sin
`clients:read` sigue viendo el selector vacío, como antes.

**Escaneo: error de lectura y mensaje del dominio.**

| Falla                                 | Antes                                | Ahora                                              |
| ------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Tomar el borrador (`claimExtraction`) | «La extracción ya fue procesada.»    | «No se pudo tomar el documento. Reintentá.»        |
| Leer la cuenta de cartera (cheques)   | «La cuenta de cartera no es válida.» | «No se pudo leer la cuenta de cartera. Reintentá.» |
| Leer el archivo (`startExtraction`)   | «No encontramos el archivo.»         | «No se pudo leer el archivo. Reintentá.»           |

`createWithClaim` (`lib/actions/claim.ts`) recibe del `claim` tres
resultados: `won`, `lost` o `failed`. Lo usan el escaneo y la bandeja de ARCA,
que ya separaba la falla con una bandera propia. El mensaje del archivo es
también el que recibe el chat cuando propone escanear un adjunto
(`proposeDocumentScan`).

**Carga en un viaje viejo.** «Editar carga» lista el viaje de la carga aunque
no esté entre los 200 más recientes, con su fecha. Antes el selector quedaba
en blanco.

**Pipeline del escaneo.**

- `classify-expense`: si la lectura del catálogo de gastos sigue fallando en
  el último intento, la factura escaneada se guarda sin sugerencia de cuenta,
  como ya hacía `match`. Antes la extracción, ya pagada, terminaba `failed`.
- `classify-and-extract` lee primero el borrador y no hace las llamadas de
  visión si el borrador ya no existe o no está `pending_review`. Pasa, por
  ejemplo, cuando `inngest.send` falló y `startExtraction` lo borró, pero el
  evento sí había llegado. Los ids de los pasos y el evento no cambian.

**Rollback.** Solo código. Volver atrás:

- saca los avisos;
- devuelve la lista de clientes cortada en 1000;
- devuelve los mensajes de dominio ante una falla;
- vuelve a pagar la visión de un borrador borrado.

Si una corrida quedó en vuelo con el código nuevo y `classify-and-extract`
memorizó `null`, el código viejo leería `extracted.kind` sobre `null` y
fallaría, y `onFailure` marcaría `failed` un borrador que ya no existe (no
hace nada). Las corridas memorizadas con el código viejo siguen andando con
el nuevo.
