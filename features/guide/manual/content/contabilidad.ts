import type { GuidePage } from "../types";

// Contabilidad: the month's package for the accountant, chart of accounts,
// journal and ledger, libros IVA, balance, management result, cost centers,
// taxes, inflation adjustment and the USD rate.

export const accountingPage: GuidePage = {
  file: "contabilidad.html",
  title: "Contabilidad",
  lead: "Los libros que arman los documentos (diario, mayor, IVA, balance), lo que se carga a mano (asientos, cuentas, coeficientes, cotizaciones), los impuestos del mes y el resultado de gestión para el dueño.",
  sections: [
    // ── Paquete del mes ───────────────────────────────────────────────────
    {
      id: "paquete-del-mes",
      title: "Paquete del mes",
      menuPath: "Contabilidad › Paquete del mes",
      routes: ["/accounting/package"],
      permission: "accounting:read",
      intro: [
        "Lo que hay que revisar antes de mandarle un mes al contador, y todos los archivos que necesita, en una sola pantalla. Al entrar muestra el mes anterior (el que se acaba de cerrar); con {{Período}} elegís otro.",
        "Arriba, el estado del mes: una lista de controles, cada uno con un ícono de en orden, revisar o sin datos (si no se pudo leer, nunca se muestra como cero). Abajo, «Descargas de» y el mes: los libros IVA, el libro diario, el libro mayor y el balance de sumas y saldos. Al lado del título hay otro selector de mes, para no tener que subir: cambia el mismo mes que {{Período}}, el de toda la pantalla. Como dice la pantalla, «Cada archivo trae solo ese mes».",
        "Todos los controles miran solo los canales fiscales: lo que ven los libros y AFIP.",
      ],
      screens: [
        {
          kind: "page",
          title: "Paquete del mes",
          subtitle:
            "Lo que hay que revisar antes de mandarle el mes al contador, y todos los archivos que necesita.",
          toolbar: [{ label: "Período", kind: "picker", value: "oct 2026" }],
          table: {
            columns: ["~Control", "~Detalle"],
            rows: [
              [
                "Período cerrado",
                "Abierto: todavía se pueden cargar o cambiar asientos del mes.",
              ],
              [
                "Asientos pendientes",
                "Todos los comprobantes del mes tienen su asiento.",
              ],
              [
                "Comprobantes sin autorizar",
                "1 en borrador, 0 emitiéndose y 0 con error.",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Los controles",
          body: [
            "{{Período cerrado}}: si el mes ya se cerró (con la fecha de cierre) o sigue abierto. Ver [[#cerrar-periodo]].",
            "{{Asientos pendientes}}: comprobantes autorizados del mes que todavía esperan su asiento (por ejemplo, porque se autorizaron con el período cerrado); un proceso automático los reintenta.",
            "{{Asientos faltantes o desactualizados}}: documentos fiscales de cualquier período sin asiento o con un asiento que no coincide con el documento.",
            "{{Comprobantes sin autorizar}}: comprobantes fiscales con fecha en el mes que están en borrador, emitiéndose o con error.",
            "{{CAEA sin informar}}: comprobantes emitidos con CAEA que todavía no se informaron a AFIP.",
            "{{Compras fiscales sin letra}}: compras fiscales del mes sin letra A, B o C. No entran al libro IVA ni al TXT para ARCA.",
            "Cuando un control pide revisión aparece el botón {{Revisar}}, que lleva a la pantalla donde se arregla (libro diario, comprobantes o compras).",
          ],
        },
      ],
      tasks: [
        {
          id: "revisar-paquete-del-mes",
          title: "Revisar el mes antes de mandarlo al contador",
          permission: "accounting:read",
          steps: [
            "Entrá a [[/accounting/package]].",
            "Si no es el mes que querés, elegí otro en {{Período}}.",
            {
              text: "Recorré la lista de controles del estado del mes. En cada control que pida revisión, hacé clic en {{Revisar}} y resolvelo en la pantalla que se abre:",
              substeps: [
                "Comprobantes sin autorizar o CAEA sin informar: en [[/invoices]].",
                "Compras fiscales sin letra: en [[/purchases]], editá la compra y cargale la letra.",
                "Asientos pendientes o faltantes: en [[/accounting/journal]]. Si el período está cerrado, los asientos pendientes se generan al reabrirlo ([[#reabrir-periodo]]).",
              ],
            },
            "Cuando todo está en orden, cerrá el período ([[#cerrar-periodo]]) y descargá los archivos ([[#descargar-paquete-del-mes]]).",
          ],
          after: ["Esta pantalla solo lee: no cambia nada."],
          errors: [
            {
              message: "No tenés permiso para ver la contabilidad.",
              fix: "Pedile a un owner el acceso a Contabilidad ([[#roles-y-permisos]]).",
            },
          ],
          related: ["descargar-paquete-del-mes", "cerrar-periodo"],
          keywords: ["cierre de mes", "contador", "checklist", "paquete"],
        },
        {
          id: "descargar-paquete-del-mes",
          title: "Descargar los libros del mes",
          permission: "accounting:read",
          screens: [
            {
              kind: "page",
              caption: "Paquete del mes › Descargas",
              title: "Paquete del mes",
              toolbar: [
                {
                  label: "Mes de las descargas",
                  kind: "picker",
                  value: "oct 2026",
                  marker: 1,
                },
              ],
              actions: [
                { label: "Exportar PDF", variant: "outline", marker: 2 },
                { label: "Exportar Excel", variant: "outline", marker: 2 },
                { label: "TXT AFIP", variant: "outline", marker: 3 },
                { label: "PDF", variant: "outline", marker: 4 },
                { label: "Excel", variant: "outline", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/accounting/package]], elegí el mes en el selector al lado del título «Descargas de …» (o en {{Período}}, arriba: es el mismo mes). Cada archivo trae solo ese mes.",
            "En las filas {{Libro IVA Ventas}} y {{Libro IVA Compras}}, {{Exportar PDF}} abre el libro en otra pestaña y {{Exportar Excel}} descarga la planilla.",
            "{{TXT AFIP}} descarga los dos archivos del Libro IVA Digital de ese libro (comprobantes y alícuotas) para importar en ARCA. Ver [[#exportar-txt-libro-iva]].",
            "En {{Libro diario}}, {{Libro mayor}} y {{Balance de sumas y saldos}}, {{PDF}} abre el libro en otra pestaña y {{Excel}} lo descarga.",
          ],
          after: [
            "Los libros IVA incluyen todos los canales fiscales. El libro diario lista los asientos del período línea por línea; el mayor, cada cuenta con movimientos desde su saldo anterior; el balance, los saldos acumulados al cierre del período.",
            "Los libros IVA dicen «Previo» en el título mientras el período está abierto y «Definitivo» cuando está cerrado.",
          ],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Probá de nuevo; si sigue, avisá al administrador del sistema.",
            },
          ],
          related: ["exportar-libro-iva", "exportar-txt-libro-iva"],
          keywords: [
            "descargar libros",
            "libro diario pdf",
            "mayor excel",
            "sumas y saldos",
          ],
        },
      ],
    },

    // ── Plan de cuentas ───────────────────────────────────────────────────
    {
      id: "plan-de-cuentas",
      title: "Plan de cuentas",
      menuPath: "Contabilidad › Plan de cuentas",
      routes: ["/accounting/chart"],
      permission: "accounting:read",
      intro: [
        "La jerarquía de cuentas contables, en árbol. Cada cuenta tiene un código con niveles separados por punto (por ejemplo `1.1.2.3`, hasta 8 niveles), un nombre, un tipo contable y, si corresponde, un rol del sistema y una categoría para el estado de resultados.",
        "Al abrirla se ven desplegados los capítulos (nivel 1). {{Expandir todo}} y {{Colapsar todo}} abren o cierran el árbol entero; la flecha de cada fila abre o cierra esa rama. Las cuentas inactivas se ven atenuadas con la marca {{Inactiva}}.",
        "Los asientos (automáticos y manuales) usan solo cuentas hoja: las que no tienen subcuentas.",
      ],
      screens: [
        {
          kind: "page",
          title: "Plan de cuentas",
          subtitle:
            "Jerarquía contable. Las cuentas con rol del sistema son destinos de asientos automáticos.",
          actions: [
            { label: "Expandir todo", variant: "outline" },
            { label: "Colapsar todo", variant: "outline" },
            { label: "Nueva cuenta", variant: "primary" },
          ],
          table: {
            columns: ["Cuenta"],
            rows: [
              ["~1 Activo"],
              ["~1.1.1 Caja general · Activo · Caja"],
              ["~4.2.2 RECPAM · Resultado negativo"],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Tipo contable",
          body: [
            "{{Activo}}, {{Pasivo}}, {{Patrimonio}}, {{Resultado positivo}} (ingresos), {{Resultado negativo}} (gastos) o {{Cuenta de orden}}. El balance y el estado de resultados agrupan por este tipo.",
          ],
        },
        {
          title: "Rol del sistema",
          body: [
            "Marca la cuenta como destino de un tipo de asiento automático: {{Caja}}, {{Banco}}, {{Clientes}}, {{Proveedores}}, {{IVA Débito Fiscal}}, {{IVA Crédito Fiscal}}, {{Ventas}}, {{Gastos}}, {{Diferencias de cambio}}, etc. Solo una cuenta activa puede tener cada rol.",
            "Si un asiento automático necesita un rol que no tiene cuenta activa asignada, el documento no se puede asentar y el error nombra el rol que falta.",
          ],
        },
        {
          title: "Categoría EERR",
          body: [
            "Texto libre (por ejemplo `gastos_operativos`) que agrupa las cuentas de resultado en la pestaña {{Estado de Resultados}} de [[/accounting/balance]]. Las cuentas sin categoría, o con una que la cascada no conoce, van a «Otros ingresos y egresos». Las categorías que arman la cascada son `ingresos_operativos`, `costo`, `gastos_operativos`, `gastos_administrativos`, `ingresos_financieros`, `gastos_financieros`, `otros_ingresos` e `impuesto_ganancias`.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-cuenta-contable",
          title: "Crear una cuenta contable",
          permission: "accounting:write",
          screens: [
            {
              kind: "dialog",
              title: "Nueva cuenta",
              description:
                "Elegí la cuenta padre y el sistema sugiere el siguiente código disponible.",
              fields: [
                {
                  label: "Cuenta padre",
                  kind: "select",
                  value: "5.1 Gastos operativos",
                  wide: true,
                  marker: 2,
                },
                { label: "Código", kind: "input", value: "5.1.7", marker: 3 },
                { label: "Nombre", kind: "input", value: "Peajes", marker: 3 },
                {
                  label: "Tipo contable",
                  kind: "select",
                  value: "Resultado negativo",
                  wide: true,
                  marker: 4,
                },
                {
                  label: "Categoría EERR",
                  kind: "input",
                  value: "gastos_operativos",
                  wide: true,
                  marker: 4,
                },
                {
                  label: "Rol del sistema",
                  kind: "select",
                  value: "(ninguno)",
                  wide: true,
                  marker: 4,
                },
                {
                  label: "Activa",
                  kind: "switch",
                  value: "Sí",
                  wide: true,
                  marker: 4,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Crear", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/accounting/chart]], hacé clic en {{Nueva cuenta}}. Para crear una subcuenta de una cuenta puntual, también podés usar {{Agregar hija}} en el menú ⋯ de su fila: el diálogo se abre con esa cuenta como padre.",
            "En {{Cuenta padre}}, elegí la cuenta de la que depende. Si es un capítulo nuevo (nivel 1), elegí {{(sin padre — capítulo raíz)}}.",
            {
              text: "Completá {{Código}} y {{Nombre}}:",
              substeps: [
                "Con padre, el código se completa solo con el siguiente número libre entre sus hermanas (por ejemplo `5.1.7`); debajo se ve el nivel.",
                "Sin padre, escribí el número del capítulo (por ejemplo `6`).",
                "El nombre tiene que tener al menos 2 caracteres.",
              ],
            },
            {
              text: "Revisá el resto de los datos:",
              substeps: [
                "{{Tipo contable}}: se copia del padre; cambialo si hace falta.",
                "{{Categoría EERR}}: opcional; también se copia del padre.",
                "{{Rol del sistema}}: dejalo en {{(ninguno)}} salvo que la cuenta tenga que recibir un asiento automático.",
                "{{Activa}}: las cuentas inactivas no aparecen en los selectores ni reciben asientos automáticos.",
              ],
            },
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "La cuenta aparece en el árbol bajo su padre. Desde ese momento se puede usar en asientos manuales si es hoja.",
            "Una vez creada, el código y el padre no se pueden cambiar.",
          ],
          errors: [
            {
              message: "Formato: 1.1.2.3 (números separados por punto).",
              fix: "Escribí el código solo con números separados por punto.",
            },
            {
              message: "Ya existe una cuenta con ese código.",
              fix: "Usá otro código o buscá la cuenta existente en el árbol.",
            },
            {
              message: "Otra cuenta activa ya tiene ese rol del sistema.",
              fix: "Quitale el rol a la otra cuenta (o desactivala) antes de asignarlo a esta.",
            },
            {
              message: "El código … no es hijo directo de ….",
              fix: "El código tiene que empezar con el código del padre y agregar un solo nivel (por ejemplo, hija de `5.1` es `5.1.7`).",
            },
            {
              message: "Una cuenta raíz (nivel 1) no puede tener padre.",
              fix: "Si el código tiene un solo número, elegí {{(sin padre — capítulo raíz)}}.",
            },
            {
              message: "Una cuenta hija debe tener cuenta padre.",
              fix: "Elegí la cuenta padre en {{Cuenta padre}}.",
            },
            {
              message: "Nombre requerido.",
              fix: "Escribí un nombre de al menos 2 caracteres.",
            },
            {
              message: "No tenés permiso para crear cuentas.",
              fix: "Pedíselo a alguien con permiso de escritura en Contabilidad ([[#roles-y-permisos]]).",
            },
          ],
          related: ["editar-cuenta-contable", "borrar-cuenta-contable"],
          keywords: [
            "alta de cuenta",
            "nueva cuenta contable",
            "subcuenta",
            "agregar hija",
          ],
        },
        {
          id: "editar-cuenta-contable",
          title: "Editar o desactivar una cuenta contable",
          permission: "accounting:write",
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar", marker: 1 },
                { label: "Agregar hija" },
                { label: "Borrar", destructive: true },
              ],
            },
            {
              kind: "dialog",
              title: "Editar cuenta",
              description:
                "Cambiá datos no estructurales de la cuenta. Código y padre no se modifican una vez creada.",
              fields: [
                { label: "Código", kind: "input", value: "5.1.7" },
                {
                  label: "Nombre",
                  kind: "input",
                  value: "Peajes y estacionamientos",
                  marker: 2,
                },
                {
                  label: "Tipo contable",
                  kind: "select",
                  value: "Resultado negativo",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Categoría EERR",
                  kind: "input",
                  value: "gastos_operativos",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Rol del sistema",
                  kind: "select",
                  value: "(ninguno)",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Activa",
                  kind: "switch",
                  value: "No",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar cambios", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/accounting/chart]], abrí el menú ⋯ de la cuenta y elegí {{Editar}}.",
            "Cambiá {{Nombre}}, {{Tipo contable}}, {{Categoría EERR}}, {{Rol del sistema}} o {{Activa}}. {{Código}} se ve pero no se puede cambiar.",
            "Hacé clic en {{Guardar cambios}} (se habilita cuando cambiaste algo).",
          ],
          after: [
            "Desactivar una cuenta la saca de los selectores y de los asientos automáticos, pero conserva sus movimientos: es la forma de dar de baja una cuenta que ya se usó.",
          ],
          errors: [
            {
              message: "Nombre requerido.",
              fix: "Escribí un nombre de al menos 2 caracteres.",
            },
            {
              message: "Otra cuenta activa ya tiene ese rol del sistema.",
              fix: "Quitale el rol a la otra cuenta antes de asignarlo a esta.",
            },
            {
              message: "No tenés permiso para editar cuentas.",
              fix: "Pedíselo a alguien con permiso de escritura en Contabilidad.",
            },
          ],
          related: ["crear-cuenta-contable", "borrar-cuenta-contable"],
          keywords: [
            "renombrar cuenta",
            "desactivar cuenta",
            "rol del sistema",
          ],
        },
        {
          id: "borrar-cuenta-contable",
          title: "Borrar una cuenta contable",
          permission: "accounting:write",
          steps: [
            "En [[/accounting/chart]], abrí el menú ⋯ de la cuenta y elegí {{Borrar}}.",
            "Confirmá con {{Borrar}}. No se puede deshacer.",
          ],
          after: [
            "La cuenta desaparece del plan. Solo se puede borrar una cuenta sin subcuentas y sin movimientos; si ya se usó, desactivala ([[#editar-cuenta-contable]]).",
          ],
          errors: [
            {
              message:
                "No se puede borrar: tiene … cuenta(s) hija(s). Borralas primero o desactivá la cuenta.",
              fix: "Borrá primero las subcuentas, o desactivá la cuenta en lugar de borrarla.",
            },
            {
              message:
                "La cuenta tiene movimientos asociados, no se puede borrar.",
              fix: "Desactivala desde {{Editar}}.",
            },
            {
              message: "No tenés permiso para borrar cuentas.",
              fix: "Pedíselo a alguien con permiso de escritura en Contabilidad.",
            },
          ],
          related: ["editar-cuenta-contable"],
          keywords: ["eliminar cuenta", "baja de cuenta"],
        },
      ],
    },

    // ── Libro diario ──────────────────────────────────────────────────────
    {
      id: "libro-diario",
      title: "Libro diario",
      menuPath: "Contabilidad › Libro diario",
      routes: ["/accounting/journal"],
      permission: "accounting:read",
      intro: [
        "Los asientos contables, del más nuevo al más viejo. Casi todos se generan solos desde comprobantes, compras, recibos, órdenes de pago y movimientos de caja; los manuales se cargan acá.",
        "Cada fila muestra fecha, período de devengamiento, descripción, origen, canal y el total del Debe. Al hacer clic se despliegan las líneas: {{Código}}, {{Cuenta}}, {{Descripción}}, {{Debe}} y {{Haber}}, con los {{Totales}} y, si el asiento viene de un comprobante emitido, un comprobante de compra, un recibo, una orden de pago o un movimiento de caja, un enlace **Ver …** que abre ese documento (un movimiento de caja se abre en [[/transactions]] mostrando solo ese movimiento).",
        "Arriba, el contador de asientos cargados; al llegar al final de la lista se cargan solos los siguientes 50.",
      ],
      screens: [
        {
          kind: "page",
          title: "Libro diario",
          subtitle:
            "Asientos contables generados desde comprobantes, recibos, órdenes de pago y movimientos de caja.",
          actions: [
            { label: "Períodos cerrados", variant: "outline" },
            { label: "Nuevo asiento", variant: "primary" },
          ],
          toolbar: [
            { label: "Período (YYYY-MM)", kind: "picker", value: "nov 2026" },
            { label: "Origen", kind: "select", value: "Todos los orígenes" },
            { label: "Canal", kind: "select", value: "Todos los canales" },
          ],
          table: {
            columns: ["~Fecha", "~Período", "~Descripción", "Origen", "~Debe"],
            rows: [
              [
                "~04/11/2026",
                "~2026-11",
                "~Factura A 0003-00001234",
                "~Comprobante emitido",
                "~$ 1.210.000,00",
              ],
              [
                "~03/11/2026",
                "~2026-11",
                "~Ajuste previsión incobrables",
                "~Manual",
                "~$ 85.000,00",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Asientos automáticos y reversas",
          body: [
            "Cuando se emite, modifica o anula un documento, el sistema genera, rehace o revierte su asiento. Un asiento de reversa copia el original con Debe y Haber invertidos y se ve sombreado, con un ícono de flecha hacia atrás antes de la descripción.",
            "Los asientos automáticos no se editan a mano: se corrigen corrigiendo el documento de origen.",
          ],
        },
        {
          title: "Períodos cerrados",
          body: [
            "Un mes cerrado no admite asientos nuevos, ediciones ni reversas con fecha en ese mes. Owner y admin ven el botón {{Períodos cerrados}} para cerrar o reabrir meses: ver [[#cerrar-periodo]] y [[#reabrir-periodo]].",
          ],
        },
      ],
      tasks: [
        {
          id: "filtrar-libro-diario",
          title: "Buscar asientos en el libro diario",
          permission: "accounting:read",
          steps: [
            {
              text: "En [[/accounting/journal]], usá los filtros (al entrar muestra el mes actual):",
              substeps: [
                "{{Período (YYYY-MM)}}: el mes de devengamiento. {{Hoy}} vuelve al mes actual y {{Limpiar}} saca el filtro para ver todos los meses.",
                "{{Origen}}: {{Todos los orígenes}}, {{Movimiento de caja}}, {{Comprobante emitido}}, {{Comprobante de compra}}, {{Recibo}}, {{Orden de pago}}, {{Cheque recibido}} o {{Cheque propio}}. Los asientos manuales y los de préstamos bancarios (la deuda inicial y los comprobantes de pago de cuotas, que se ven con origen «Otro origen») solo aparecen con {{Todos los orígenes}}.",
                "{{Canal}}: {{Todos los canales}} o uno puntual.",
              ],
            },
            "Hacé clic en un asiento para ver sus líneas. Si viene de un comprobante emitido, un comprobante de compra, un recibo, una orden de pago o un movimiento de caja, el enlace **Ver …** lo abre.",
            "Si hay más asientos de los que se ven, bajá hasta el final de la lista: se cargan solos.",
          ],
          after: [
            "Si un asiento no balancea, al desplegarlo aparece «Asiento desbalanceado» con la diferencia.",
          ],
          errors: [
            {
              message: "No se pudo leer el libro diario.",
              fix: "Actualizá la página; si sigue, avisá al administrador del sistema.",
            },
          ],
          related: ["consultar-libro-mayor"],
          keywords: ["asientos", "buscar asiento", "diario"],
        },
        {
          id: "crear-asiento-manual",
          title: "Cargar un asiento manual",
          summary:
            "Para ajustes, previsiones, reexpresiones y todo lo que no sale de un documento.",
          permission: "accounting:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo asiento manual",
              description:
                "Ajustes, previsiones, reexpresiones — el asiento queda en el libro diario con origen “Manual”. Debe y Haber tienen que balancear.",
              fields: [
                {
                  label: "Fecha",
                  kind: "date",
                  value: "31/10/2026",
                  marker: 2,
                },
                {
                  label: "Canal fiscal (opcional)",
                  kind: "select",
                  value: "Sin canal",
                  marker: 2,
                },
                {
                  label: "Descripción",
                  kind: "input",
                  value: "Previsión incobrables octubre",
                  wide: true,
                  marker: 2,
                },
              ],
              table: {
                columns: ["Cuenta", "Debe", "Haber"],
                rows: [
                  ["~5.1.9 Deudores incobrables", "~85.000,00", ""],
                  ["~1.1.4.9 Previsión incobrables", "", "~85.000,00"],
                ],
                marker: 3,
              },
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear asiento", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/accounting/journal]], hacé clic en {{Nuevo asiento}}.",
            {
              text: "Completá el encabezado:",
              substeps: [
                "{{Fecha}}: define el período del asiento (el mes de esa fecha). Si ese mes está cerrado, el asiento se rechaza.",
                "{{Canal fiscal (opcional)}}: {{Sin canal}} o un canal fiscal activo.",
                "{{Descripción}}: obligatoria, hasta 500 caracteres.",
              ],
            },
            {
              text: "Cargá las líneas (empieza con dos):",
              substeps: [
                "En cada línea elegí la {{Cuenta}} (solo cuentas hoja activas) y el importe en {{Debe}} o en {{Haber}}: al escribir en una columna se borra la otra.",
                "{{Agregar línea}} suma una línea; el tacho ({{Quitar línea}}) saca una, siempre que queden al menos dos.",
              ],
            },
            "Mirá el pie: muestra los totales de Debe y Haber y dice {{Balanceado}} cuando coinciden; si no, muestra la diferencia.",
            "Hacé clic en {{Crear asiento}}. Se habilita cuando el asiento balancea, no es por cero, tiene descripción y fecha, y toda línea con importe tiene cuenta.",
          ],
          after: [
            "El asiento queda en el libro diario con origen «Manual» y aparece en el mayor y el balance de sus cuentas.",
            "Un asiento manual no se edita ni se borra desde la pantalla. Para anularlo, cargá otro con las mismas cuentas y Debe y Haber invertidos ([[#revertir-asiento-manual]]).",
          ],
          errors: [
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un período abierto o pedile a un owner o admin que reabra el mes ([[#reabrir-periodo]]).",
            },
            {
              message: "El asiento no balancea: Debe … ≠ Haber ….",
              fix: "Corregí los importes hasta que el pie diga {{Balanceado}}.",
            },
            {
              message:
                "Cada línea lleva importe en Debe o en Haber (solo uno).",
              fix: "Dejá el importe en una sola columna por línea; quitá las líneas sin importe.",
            },
            {
              message:
                "Un asiento manual va sin canal o en un canal fiscal activo",
              fix: "Elegí {{Sin canal}} o un canal fiscal activo.",
            },
            {
              message: "Descripción requerida.",
              fix: "Escribí la descripción del asiento.",
            },
            {
              message: "No tenés permiso para cargar asientos.",
              fix: "Pedíselo a alguien con permiso de escritura en Contabilidad ([[#roles-y-permisos]]).",
            },
          ],
          related: [
            "revertir-asiento-manual",
            "cerrar-periodo",
            "generar-asiento-recpam",
          ],
          keywords: [
            "asiento manual",
            "ajuste contable",
            "previsión",
            "reexpresión",
            "nuevo asiento",
          ],
        },
        {
          id: "revertir-asiento-manual",
          title: "Revertir un asiento manual",
          summary:
            "Los asientos manuales no tienen un botón de reversa: se anulan con un asiento inverso.",
          permission: "accounting:write",
          steps: [
            "En [[/accounting/journal]], desplegá el asiento a revertir y anotá sus cuentas e importes.",
            "Hacé clic en {{Nuevo asiento}} y cargá las mismas cuentas con los importes del {{Debe}} en el {{Haber}} y viceversa, con una descripción que nombre el asiento que revierte.",
            "Hacé clic en {{Crear asiento}}.",
          ],
          after: [
            "Los dos asientos quedan en el libro diario y se compensan en el mayor y el balance.",
            "Los asientos automáticos no se revierten así: se revierten solos al anular o corregir su documento.",
          ],
          errors: [
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un período abierto o pedí que reabran el mes ([[#reabrir-periodo]]).",
            },
          ],
          related: ["crear-asiento-manual"],
          keywords: [
            "anular asiento",
            "contraasiento",
            "reversa",
            "deshacer asiento",
          ],
        },
      ],
    },

    // ── Libro mayor ───────────────────────────────────────────────────────
    {
      id: "libro-mayor",
      title: "Libro mayor",
      menuPath: "Contabilidad › Libro mayor",
      routes: ["/accounting/libro-mayor"],
      permission: "accounting:read",
      intro: [
        "Los movimientos de una cuenta con el saldo acumulado línea por línea, desde el saldo anterior a la fecha {{Desde}}. Sirve para controlar o conciliar una cuenta.",
      ],
      screens: [
        {
          kind: "page",
          title: "Libro mayor",
          toolbar: [
            { label: "Cuenta", kind: "select", value: "1.1.1.1 Caja general" },
            { label: "Desde", kind: "date", value: "01/10/2026" },
            { label: "Hasta", kind: "date", value: "31/10/2026" },
          ],
          stats: [
            { label: "Total Debe", value: "~2.450.000,00" },
            { label: "Total Haber", value: "~1.980.000,00" },
            { label: "Saldo final", value: "~1.320.000,00" },
          ],
          table: {
            columns: [
              "Fecha",
              "Período",
              "Descripción",
              "Origen",
              "Debe",
              "Haber",
              "Saldo",
            ],
            rows: [
              ["~01/10/2026", "", "Saldo anterior", "", "", "", "~850.000,00"],
              [
                "~03/10/2026",
                "~2026-10",
                "~Cobro recibo 0001-00000456",
                "~Recibo",
                "~300.000,00",
                "",
                "~1.150.000,00",
              ],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "consultar-libro-mayor",
          title: "Ver el mayor de una cuenta",
          permission: "accounting:read",
          steps: [
            "Entrá a [[/accounting/libro-mayor]].",
            "En {{Cuenta}}, elegí la cuenta (la lista trae las cuentas activas, ordenadas por código). Una cuenta que agrupa a otras, como 1.1.1 Caja y bancos, muestra los movimientos de todas sus subcuentas juntos, con una columna {{Cuenta}} que dice de cuál es cada uno.",
            "Opcional: acotá las fechas con {{Desde}} y {{Hasta}}. Sin fechas se ven todos los movimientos.",
            {
              text: "Leé el resultado:",
              substeps: [
                "Arriba, {{Total Debe}}, {{Total Haber}} y {{Saldo final}}.",
                "Con {{Desde}}, la primera fila es el {{Saldo anterior}} a esa fecha.",
                "Cada fila tiene fecha, período, descripción, origen, Debe, Haber y el saldo acumulado; si el asiento viene de un comprobante emitido, un comprobante de compra, un recibo, una orden de pago o un movimiento de caja, el origen enlaza a ese documento (el movimiento de caja, a [[/transactions]] mostrando solo ese movimiento); los de cheques y los de préstamos bancarios («Otro origen») muestran el origen sin enlace y los manuales, «—». Las reversas se ven sombreadas.",
              ],
            },
          ],
          after: [
            "Si el rango tiene más de 999 movimientos, se ven solo los primeros y un aviso dice que los datos son parciales: los totales corresponden a esas líneas. Acotá las fechas para ver el resto.",
            "Para descargar el mayor de todas las cuentas de un mes, usá [[#descargar-paquete-del-mes]].",
          ],
          errors: [
            {
              message: "No se pudo leer el libro mayor.",
              fix: "Usá el botón para reintentar; si sigue, avisá al administrador del sistema.",
            },
          ],
          related: ["filtrar-libro-diario", "descargar-paquete-del-mes"],
          keywords: [
            "mayor",
            "saldo de cuenta",
            "movimientos de una cuenta",
            "conciliar cuenta",
          ],
        },
      ],
    },

    // ── Libro IVA Ventas ──────────────────────────────────────────────────
    {
      id: "libro-iva-ventas",
      title: "Libro IVA Ventas",
      menuPath: "Contabilidad › Libro IVA Ventas",
      routes: ["/accounting/libro-iva-ventas"],
      permission: "accounting:read",
      intro: [
        "Los comprobantes emitidos fiscales del período, agrupados por alícuota (RG 1361) y en pesos: los que están en moneda extranjera se convierten con la cotización informada a AFIP. Solo entran canales fiscales; los internos no van al libro IVA.",
        "Arriba se elige {{Período}} (por defecto el mes actual) y {{Canal fiscal}} ({{Todos los canales fiscales}} o uno). El título dice «Previo» mientras el período está abierto y «Definitivo» cuando está cerrado, con la razón social y el C.U.I.T. de la empresa.",
      ],
      screens: [
        {
          kind: "page",
          title: "Libro IVA Ventas",
          actions: [{ label: "TXT AFIP", variant: "outline" }],
          toolbar: [
            { label: "Período", kind: "picker", value: "oct 2026" },
            {
              label: "Canal fiscal",
              kind: "select",
              value: "Todos los canales fiscales",
            },
          ],
          table: {
            columns: [
              "Fecha",
              "TC",
              "Comprobante",
              "Razón social",
              "C.U.I.T.",
              "C.I.",
              "Neto",
              "IVA",
              "No gravado",
              "Exento",
              "Percepciones",
              "Total",
              "Moneda orig.",
              "CAE",
            ],
            rows: [
              [
                "~02/10/2026",
                "~FC",
                "~A 0003-00001230",
                "~Transportes del Sur S.A.",
                "~30-71234567-8",
                "~RI",
                "~1.000.000,00",
                "~210.000,00",
                "",
                "",
                "",
                "~1.210.000,00",
                "",
                "~76012345678901",
              ],
              [
                "~15/10/2026",
                "~NC",
                "~A 0003-00000045",
                "~Transportes del Sur S.A.",
                "~30-71234567-8",
                "~RI",
                "~-100.000,00",
                "~-21.000,00",
                "",
                "",
                "",
                "~-121.000,00",
                "",
                "~76012345678999",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Cómo se lee",
          body: [
            "Una fila por comprobante. {{TC}}: FC factura, NC nota de crédito (todos sus importes en negativo, así cada columna suma su total), ND nota de débito. {{C.I.}}: la condición de IVA del cliente (RI, RM, EX, CF, NC).",
            "Hay un par Neto/IVA por cada alícuota que aparece en el mes, y después No gravado, Exento, {{Percepciones}} y {{Total}}. {{Moneda orig.}} muestra el importe y la cotización de los comprobantes en moneda extranjera. El número de comprobante abre el comprobante.",
            "Avisos arriba de la tabla: comprobantes sin CAE (AFIP rechazaría la presentación), comprobantes sin ítems (por ejemplo importados de ARCA, que van en la alícuota que surge de IVA / neto; si no cierra con ninguna quedan en «Sin alícuota» y el TXT los excluye) y comprobantes en moneda extranjera sin cotización (quedan sin convertir: revisalos antes de presentar).",
          ],
        },
      ],
      tasks: [
        {
          id: "consultar-libro-iva-ventas",
          title: "Ver el libro IVA Ventas de un mes",
          permission: "accounting:read",
          steps: [
            "Entrá a [[/accounting/libro-iva-ventas]].",
            "Elegí el mes en {{Período}} y, si querés uno solo, el canal en {{Canal fiscal}}.",
            "Revisá los avisos de arriba de la tabla antes de presentar, y los {{Totales}} al pie.",
          ],
          errors: [
            {
              message: "No se pudo leer el libro IVA Ventas.",
              fix: "Hacé clic en {{Reintentar}}. Mientras el libro no se pueda leer, no se puede exportar.",
            },
            {
              message: "No tenés permiso para ver el libro IVA.",
              fix: "Pedile a un owner el acceso a Contabilidad.",
            },
          ],
          related: ["exportar-libro-iva", "exportar-txt-libro-iva"],
          keywords: [
            "libro iva",
            "iva ventas",
            "subdiario de ventas",
            "débito fiscal",
          ],
        },
        {
          id: "exportar-libro-iva",
          title: "Exportar un libro IVA a PDF o Excel",
          permission: "accounting:read",
          steps: [
            "En [[/accounting/libro-iva-ventas]] o [[/accounting/libro-iva-compras]], elegí {{Período}} y {{Canal fiscal}}.",
            "Debajo de la tabla, hacé clic en {{Exportar PDF}} (abre el libro en otra pestaña) o en {{Exportar Excel}} (descarga `libro-iva-ventas-AAAA-MM.xlsx` o `libro-iva-compras-AAAA-MM.xlsx`).",
          ],
          after: [
            "El archivo respeta el período y el canal elegidos.",
            "Si el libro no se pudo leer, los botones no aparecen hasta que se lea bien.",
          ],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Probá de nuevo; si sigue, avisá al administrador del sistema.",
            },
          ],
          related: ["exportar-txt-libro-iva", "descargar-paquete-del-mes"],
          keywords: ["pdf libro iva", "excel libro iva", "descargar libro iva"],
        },
        {
          id: "exportar-txt-libro-iva",
          title: "Exportar el TXT del Libro IVA Digital para ARCA",
          summary:
            "Los dos archivos de importación (comprobantes y alícuotas) de Portal IVA / IVA Simple.",
          permission: "accounting:read",
          steps: [
            "En [[/accounting/libro-iva-ventas]] o [[/accounting/libro-iva-compras]] (o en [[/accounting/package]]), elegí el {{Período}}.",
            "Hacé clic en {{TXT AFIP}}.",
            "Leé los avisos: cada comprobante que no se pudo exportar aparece en un aviso aparte con el motivo.",
            "En ARCA, importá los dos archivos y elegí que los importes están expresados en la moneda original del comprobante.",
          ],
          after: [
            "Se descargan dos archivos: `LIBRO_IVA_DIGITAL_VENTAS_CBTE_…` y `LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_…` (o los de `COMPRAS`). El TXT siempre incluye todos los canales fiscales, aunque la pantalla esté filtrada por uno.",
            "Cada comprobante va con su moneda y su cotización. El aviso de éxito dice cuántos comprobantes se exportaron. Queda registrado en la auditoría.",
            "Una compra traída de ARCA que era un recibo, una liquidación o un comprobante M se declara con su propio código AFIP, aunque en [[/purchases]] figure como factura.",
          ],
          errors: [
            {
              message: "No hay comprobantes para exportar en ese período.",
              fix: "Revisá el período elegido.",
            },
            {
              message: "Venta …: sin tipo de comprobante AFIP — excluida.",
              fix: "Revisá ese comprobante en [[/invoices]]: no se puede declarar sin tipo AFIP.",
            },
            {
              message: "Compra …: sin letra A/B/C — excluida.",
              fix: "Editá la compra en [[/purchases]] y cargale la letra.",
            },
            {
              message: "Compra …: proveedor sin CUIT — excluida.",
              fix: "Cargale el CUIT al proveedor y volvé a exportar.",
            },
            {
              message: "…: no se pudo derivar la alícuota — excluida.",
              fix: "El IVA del comprobante no cierra con ninguna alícuota: revisá sus importes.",
            },
            {
              message:
                "…: el total (…) no es la suma de sus partes (…); ARCA lo va a rechazar.",
              fix: "El comprobante se exporta igual, pero corregí sus importes antes de presentar.",
            },
            {
              message: "No tenés permiso para exportar el libro IVA.",
              fix: "Pedile a un owner el acceso a Contabilidad.",
            },
          ],
          related: ["exportar-libro-iva", "descargar-paquete-del-mes"],
          keywords: [
            "txt arca",
            "libro iva digital",
            "citi",
            "portal iva",
            "iva simple",
            "exportar afip",
          ],
        },
      ],
    },

    // ── Libro IVA Compras ─────────────────────────────────────────────────
    {
      id: "libro-iva-compras",
      title: "Libro IVA Compras",
      menuPath: "Contabilidad › Libro IVA Compras",
      routes: ["/accounting/libro-iva-compras"],
      permission: "accounting:read",
      intro: [
        "Los comprobantes recibidos fiscales del período, agrupados por alícuota (RG 1361) y en pesos: los que están en moneda extranjera se convierten con su propia cotización. Solo entran canales fiscales; los gastos internos no van al libro IVA.",
        "Tiene los mismos filtros, avisos y exportaciones que [[#libro-iva-ventas]]. La columna {{C.I.}} es la condición de IVA del proveedor y la del CAE es {{CAE prov.}}.",
      ],
      concepts: [
        {
          title: "Columnas propias de compras",
          body: [
            "Después de las alícuotas vienen {{Imp. int.}}, {{No gravado}}, {{Exento}} y {{Percepciones}}, con un renglón por tipo y su código: B = IIBB, I = IVA, G = Ganancias y otros nacionales, M = municipales.",
            "Las facturas B y C no discriminan IVA: van en la columna «Sin discriminar» con el IVA incluido, y el TXT las declara sin alícuota.",
          ],
        },
      ],
      tasks: [
        {
          id: "consultar-libro-iva-compras",
          title: "Ver el libro IVA Compras de un mes",
          permission: "accounting:read",
          steps: [
            "Entrá a [[/accounting/libro-iva-compras]].",
            "Elegí el mes en {{Período}} y, si querés uno solo, el canal en {{Canal fiscal}}.",
            "Revisá los avisos (compras sin CAE del proveedor, sin ítems o en moneda extranjera sin cotización) y los {{Totales}} al pie. El número de comprobante abre la compra.",
            "Para descargarlo, seguí [[#exportar-libro-iva]] o [[#exportar-txt-libro-iva]].",
          ],
          errors: [
            {
              message: "No se pudo leer el libro IVA Compras.",
              fix: "Hacé clic en {{Reintentar}}.",
            },
          ],
          related: ["exportar-libro-iva", "exportar-txt-libro-iva"],
          keywords: [
            "iva compras",
            "crédito fiscal",
            "subdiario de compras",
            "percepciones",
          ],
        },
      ],
    },

    // ── Balance / EERR ────────────────────────────────────────────────────
    {
      id: "balance-eerr",
      title: "Balance y estado de resultados",
      menuPath: "Contabilidad › Balance / EERR",
      routes: ["/accounting/balance"],
      permission: "accounting:read",
      intro: [
        "Los saldos contables hasta el cierre de un período, calculados desde los asientos, en tres pestañas: {{Balance de saldos}}, {{Estado de Resultados}} y {{Balance General}}.",
        "Filtros: {{Período de corte}} y {{Desde (opcional)}}. Al abrir, muestran el ejercicio en curso: desde su primer mes hasta el mes actual. {{Limpiar rango}} saca el {{Desde (opcional)}}.",
        "Atajos: {{Ejercicio actual}} pone el rango desde el primer mes del ejercicio en curso hasta el mes actual; {{Ejercicio anterior}}, el ejercicio anterior completo. Debajo de los filtros, una línea dice qué suma cada pestaña (por ejemplo, «resultados del ejercicio 2025/26 (oct 2025 – mar 2026)»).",
      ],
      screens: [
        {
          kind: "page",
          title: "Balance",
          toolbar: [
            { label: "Período de corte", kind: "picker", value: "oct 2026" },
            { label: "Desde (opcional)", kind: "input" },
          ],
          actions: [
            { label: "Ejercicio actual", variant: "outline" },
            { label: "Ejercicio anterior", variant: "outline" },
          ],
          tabs: {
            labels: [
              "Balance de saldos",
              "Estado de Resultados",
              "Balance General",
            ],
            active: 0,
          },
          table: {
            columns: ["Código", "Cuenta", "Debe", "Haber", "Saldo"],
            rows: [
              [
                "~1.1.1",
                "~Caja general",
                "~2.450.000,00",
                "~1.130.000,00",
                "~1.320.000,00",
              ],
              [
                "~2.1.1",
                "~Proveedores",
                "~400.000,00",
                "~950.000,00",
                "~-550.000,00",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "El ejercicio",
          body: [
            "El ejercicio (año fiscal) empieza en el mes que se configura en [[/accounting/settings]]; en Jouve va de octubre a septiembre (por ejemplo, 01/10/2025 – 30/09/2026).",
            "Sin {{Desde (opcional)}}, el {{Estado de Resultados}} suma desde el primer mes del ejercicio que contiene el {{Período de corte}} hasta el corte, y en {{Balance General}} el resultado se separa en {{Resultado del período}} (desde ese mismo mes) y {{Resultados de períodos anteriores}}. Las cuentas patrimoniales (activo, pasivo, patrimonio) siempre son acumuladas hasta el corte.",
          ],
        },
      ],
      tasks: [
        {
          id: "consultar-balance-de-saldos",
          title: "Ver el balance de sumas y saldos",
          permission: "accounting:read",
          steps: [
            "Entrá a [[/accounting/balance]] y elegí el {{Período de corte}}.",
            "Opcional: elegí {{Desde (opcional)}} para ver solo los movimientos del rango.",
            "En la pestaña {{Balance de saldos}}, revisá el aviso de arriba: {{Balance balanceado}} si Σ Debe = Σ Haber, o {{Balance DESBALANCEADO}} con la diferencia.",
          ],
          after: [
            "Cada fila es una cuenta con movimientos: {{Código}}, {{Cuenta}}, {{Debe}}, {{Haber}} y {{Saldo}}; al pie, los {{Totales}}. Para descargarlo, ver [[#descargar-paquete-del-mes]].",
          ],
          errors: [
            {
              message: "No se pudieron leer los saldos.",
              fix: "Actualizá la página; si sigue, avisá al administrador del sistema.",
            },
          ],
          related: ["ver-estado-de-resultados", "ver-balance-general"],
          keywords: [
            "sumas y saldos",
            "balance de comprobación",
            "saldos contables",
          ],
        },
        {
          id: "ver-estado-de-resultados",
          title: "Ver el estado de resultados",
          permission: "accounting:read",
          steps: [
            "En [[/accounting/balance]], elegí el {{Período de corte}} y, para ver un mes o un rango, {{Desde (opcional)}}. Para el ejercicio, usá {{Ejercicio actual}} o {{Ejercicio anterior}}.",
            "Abrí la pestaña {{Estado de Resultados}}.",
            "Leé la cascada de arriba hacia abajo: {{Ventas}}, {{Costo de los servicios}}, {{Resultado bruto}}, gastos operativos y de administración, {{Resultado operativo}}, resultados financieros y otros, y {{Resultado antes de impuestos}}. Los gastos van en negativo. Cada renglón sale de la categoría EERR de sus cuentas; hacé clic en uno para ver sus cuentas. Una cuenta con una categoría que la cascada no conoce, o sin categoría, va a «Otros ingresos y egresos».",
          ],
          after: [
            "Al pie, {{Resultado del período}} con la marca {{Ganancia}} o {{Pérdida}}. Sin {{Desde (opcional)}}, el resultado es el del ejercicio hasta el corte (desde su primer mes); para ver el ejercicio anterior completo, usá {{Ejercicio anterior}}.",
          ],
          related: ["consultar-balance-de-saldos", "crear-cuenta-contable"],
          keywords: [
            "eerr",
            "estado de resultados",
            "ganancias y pérdidas",
            "resultado del ejercicio",
          ],
        },
        {
          id: "ver-balance-general",
          title: "Ver el balance general",
          permission: "accounting:read",
          steps: [
            "En [[/accounting/balance]], elegí el {{Período de corte}}.",
            "Abrí la pestaña {{Balance General}}.",
            "A la izquierda, {{Activo}}; a la derecha, {{Pasivo}} y {{Patrimonio neto}}, con los resultados separados en {{Resultados de períodos anteriores}} y {{Resultado del período}}.",
            "Abajo, el control «Total Pasivo + PN» muestra ✓ si cuadra con el activo y ✗ si no.",
          ],
          after: [
            "El balance general siempre es acumulado hasta el corte, diga lo que diga {{Desde (opcional)}}: ese filtro solo define desde cuándo cuenta el resultado del período.",
          ],
          related: ["consultar-balance-de-saldos", "ver-estado-de-resultados"],
          keywords: [
            "balance general",
            "situación patrimonial",
            "activo pasivo",
          ],
        },
      ],
    },

    // ── Resultado de gestión ──────────────────────────────────────────────
    {
      id: "resultado-de-gestion",
      title: "Resultado de gestión",
      menuPath: "Contabilidad › Resultado de gestión",
      routes: ["/management"],
      permission: "management:read",
      intro: [
        "Fiscal + interno: ¿la operación deja plata? Es una vista para uso interno ({{Uso interno}}): no es el EERR fiscal y no se presenta a bancos, ARCA ni terceros (para eso, [[#balance-eerr]]). El contador externo no la ve.",
        "Filtros: {{Año fiscal}} (los últimos cinco, según el inicio del ejercicio de [[/accounting/settings]]), {{Base}} ({{Devengado}} o {{Percibido}}) y {{Ajustado por inflación}}. El recuadro {{Limitaciones de esta versión}} explica qué no se calcula todavía.",
        "La pantalla muestra, en orden: los indicadores ({{Margen bruto %}}, {{Margen operativo %}}, {{Resultado operativo (EBITDA aprox.)}} y {{Generación de caja}}, contra los mismos meses del año anterior), la {{Cascada del año fiscal}} con el {{Comparativo con el año anterior}}, la tabla {{Mes a mes}}, {{Margen por camión}}, {{Sin clasificar}} y {{Sueldos: pagado en el mes vs. liquidado del período}}.",
      ],
      screens: [
        {
          kind: "page",
          title: "Resultado de gestión",
          toolbar: [
            { label: "Año fiscal", kind: "select", value: "2025/26" },
            { label: "Base", kind: "select", value: "Devengado" },
            { label: "Ajustado por inflación", kind: "checkbox" },
          ],
          stats: [
            { label: "Margen bruto %", value: "~41,20 %" },
            { label: "Margen operativo %", value: "~18,40 %" },
            {
              label: "Resultado operativo (EBITDA aprox.)",
              value: "~$ 42.300.000,00",
            },
            { label: "Generación de caja", value: "~$ 15.100.000,00" },
          ],
          table: {
            columns: ["Concepto", "~oct", "~nov", "Fiscal", "Interno", "Total"],
            rows: [
              [
                "Servicios",
                "~20.000.000",
                "~22.500.000",
                "~38.000.000",
                "~4.500.000",
                "~42.500.000",
              ],
              [
                "Margen bruto",
                "~8.200.000",
                "~9.300.000",
                "~15.600.000",
                "~1.900.000",
                "~17.500.000",
              ],
              [
                "Margen bruto %",
                "~41,00 %",
                "~41,33 %",
                "~41,05 %",
                "~42,22 %",
                "~41,18 %",
              ],
              [
                "Margen operativo",
                "~3.600.000",
                "~4.100.000",
                "~6.900.000",
                "~800.000",
                "~7.700.000",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Devengado y percibido",
          body: [
            "{{Devengado}} cuenta los documentos en el mes al que corresponden (facturas, compras, sueldos). {{Percibido}} cuenta lo cobrado y pagado en el mes; un cobro o pago a cuenta sin imputar va a servicios o a pagos a proveedores.",
            "{{Ajustado por inflación}} reexpresa las cifras; el detalle de una cifra siempre muestra los importes nominales.",
          ],
        },
        {
          title: "Las líneas",
          body: [
            "{{Servicios}}; los costos directos con su detalle ({{Total personal}}, cargas sociales, combustible, mantenimiento, seguros y peajes) y su subtotal {{Costos directos}}; {{Margen bruto}} (servicios menos costos directos) y {{Margen bruto %}}; los gastos de estructura con su detalle (alquileres, impuestos operativos, administración, pagos a proveedores y otros) y su subtotal {{Gastos de estructura}}; {{Sin clasificar}}; {{Margen operativo}} y {{Margen operativo %}}; {{Costo financiero}}; {{Resultado después de financiación}}; {{Capital de préstamos}}, {{Inversión en flota}}, {{Venta de bienes de uso}} y {{Anticipos al personal}}; {{Generación de caja}}; {{Financiamiento recibido}}; y {{Variación de caja}}.",
            "{{Margen bruto %}} y {{Margen operativo %}} son el margen sobre los servicios de cada mes (y del año, en las columnas finales, por lado); muestran «—» cuando no hay servicios. No suman en ningún total y no abren documentos.",
            "Cada cuenta del plan va a una de esas «cajas» según el catálogo de clasificación ([[#clasificar-cuentas-de-gestion]]). Una cuenta de resultado sin clasificar suma en {{Sin clasificar}}.",
            "Los movimientos en dólares sin cotización (o, si son fiscales, sin asiento) no se suman: un aviso muestra el neto en US$ y enlaza a [[/accounting/exchange-rates]] y [[/accounting/package]].",
          ],
        },
      ],
      tasks: [
        {
          id: "consultar-resultado-de-gestion",
          title: "Ver el resultado de gestión del año",
          permission: "management:read",
          steps: [
            "Entrá a [[/management]]. Al abrir muestra el año fiscal actual, en {{Devengado}} y sin ajuste por inflación.",
            "Elegí {{Año fiscal}}, {{Base}} y, si querés, marcá {{Ajustado por inflación}}.",
            "En {{Mes a mes}}, elegí en {{Meses en}} si las columnas de los meses muestran {{Total}}, {{Fiscal}} o {{Interno}}. Las tres columnas finales siempre muestran los totales del año por lado.",
          ],
          after: [
            "Si las cifras pueden estar incompletas (se llegó al tope de lectura o hay filas que no se saben clasificar), un aviso lo dice arriba de los indicadores.",
          ],
          errors: [
            {
              message: "No se pudo calcular el resultado de gestión.",
              fix: "Actualizá la página; si sigue, avisá al administrador del sistema.",
            },
          ],
          related: [
            "ver-documentos-de-una-cifra",
            "exportar-resultado-de-gestion",
            "ver-margen-por-camion",
          ],
          keywords: [
            "gestión",
            "rentabilidad",
            "margen",
            "ebitda",
            "deja plata",
            "resultado interno",
          ],
        },
        {
          id: "ver-documentos-de-una-cifra",
          title: "Ver los documentos detrás de una cifra",
          permission: "management:read",
          steps: [
            "En la tabla {{Mes a mes}} de [[/management]], hacé clic en un importe distinto de cero (de un mes, o de las columnas {{Fiscal}}, {{Interno}} o {{Total}} para el año).",
            "El diálogo lista los comprobantes y movimientos detrás de la cifra: {{Fecha}}, {{Documento}}, {{Contraparte}}, {{Lado}} e {{Importe}}, con el total al pie.",
            "Hacé clic en un documento para abrirlo (solo si tenés acceso a su módulo).",
          ],
          after: [
            "Los importes son nominales aunque esté marcado {{Ajustado por inflación}}. Si hay muchos documentos se ven los 500 de mayor importe.",
          ],
          errors: [
            {
              message: "No se pudo leer el detalle.",
              fix: "Cerrá el diálogo y probá de nuevo; si son demasiados documentos, elegí un mes.",
            },
          ],
          related: ["consultar-resultado-de-gestion"],
          keywords: ["drill", "detalle de la cifra", "de dónde sale"],
        },
        {
          id: "exportar-resultado-de-gestion",
          title: "Exportar la tabla mes a mes",
          permission: "management:read",
          steps: [
            "En [[/management]], dejá los filtros como querés exportarlos (año, base, inflación y {{Meses en}}).",
            "En el encabezado de {{Mes a mes}}, hacé clic en {{CSV}} o en {{Excel}}.",
          ],
          after: [
            "Se descarga `gestion-uso-interno-<año>-<base>` con el título, los filtros y la leyenda de uso interno arriba. La exportación queda registrada en la auditoría.",
          ],
          errors: [
            {
              message: "No se pudo generar el archivo.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["consultar-resultado-de-gestion"],
          keywords: ["exportar gestión", "excel gestión", "csv"],
        },
        {
          id: "clasificar-cuentas-de-gestion",
          title: "Clasificar cuentas para gestión",
          summary:
            "A qué caja del resultado de gestión va cada cuenta del plan. No cambia asientos ni el EERR fiscal.",
          permission: "management:write",
          prerequisites: [
            "Ser owner o admin: son los únicos roles con permiso para editar el catálogo.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Clasificar cuentas para gestión",
              description:
                "A qué caja del resultado de gestión va cada cuenta del plan. No cambia asientos ni el EERR fiscal.",
              fields: [
                {
                  label: "~5.1.7 Peajes",
                  kind: "select",
                  value: "Costos operativos › Peajes",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "~5.3.1 Intereses bancarios",
                  kind: "select",
                  value: "Costo financiero › Intereses",
                  wide: true,
                },
              ],
              footer: [],
            },
          ],
          steps: [
            "En [[/management]], en el bloque {{Sin clasificar}}, hacé clic en {{Clasificar cuentas}} (o en {{Clasificar}} al lado de una cuenta puntual, que la pone primera).",
            {
              text: "En la fila de cada cuenta, elegí su caja:",
              substeps: [
                "{{Servicios}}.",
                "{{Costos operativos}} con su detalle (sueldos, cargas sociales, combustible, mantenimiento, seguros, peajes, alquileres, impuestos operativos, administración, pagos a proveedores u otros).",
                "{{Costo financiero}} con su detalle (intereses, cargos bancarios, descuento de cheques, cargos y sellos de préstamos).",
                "{{Capital de préstamos}}, {{Inversión en flota}} o {{Venta de bienes de uso}}.",
                "{{Neutro (no suma)}}: la cuenta no entra al resultado.",
                "{{Excluido (no es caja: amortización, RECPAM)}}: queda fuera del cálculo y se informa aparte.",
              ],
            },
            "Cada cambio se guarda al elegirlo. Cerrá el diálogo cuando termines.",
          ],
          after: [
            "La cuenta deja de sumar en {{Sin clasificar}} y pasa a su línea. Las cuentas sin clasificar aparecen primero en la lista. El cambio queda en la auditoría.",
          ],
          errors: [
            {
              message: "No tenés permiso para clasificar cuentas de gestión.",
              fix: "Pedíselo a un owner o admin.",
            },
            {
              message: "No se pudo guardar la clasificación.",
              fix: "Volvé a elegir la caja; si sigue, avisá al administrador del sistema.",
            },
          ],
          related: ["consultar-resultado-de-gestion"],
          keywords: ["sin clasificar", "catálogo", "bucket", "caja de gestión"],
        },
        {
          id: "ver-margen-por-camion",
          title: "Ver el margen por camión",
          permission: "management:read",
          steps: [
            "En [[/management]], bajá hasta {{Margen por camión}}.",
            "Cada fila es un camión: viajes, ingreso, costo de viajes, combustible, mantenimiento, neto y margen.",
          ],
          after: [
            "Siempre es el año fiscal completo, devengado y sin ajuste por inflación, aunque arriba se haya elegido otra base.",
            "Lo que no es de un camión va aparte, sin repartir.",
            "Si un camión tiene cargas sin facturar, su neto dice «pendiente de facturar»: no es definitivo.",
          ],
          errors: [
            {
              message: "No se pudo calcular el margen por camión.",
              fix: "Actualizá la página.",
            },
          ],
          related: ["consultar-resultado-de-gestion"],
          keywords: ["rentabilidad por camión", "margen camión", "flota"],
        },
      ],
    },

    // ── Impuestos ─────────────────────────────────────────────────────────
    {
      id: "impuestos",
      title: "Impuestos",
      menuPath: "Contabilidad › Impuestos",
      routes: ["/taxes"],
      permission: "taxes:read",
      intro: [
        "Cada obligación es un documento con período, vencimiento, importe y estado: IVA, Ingresos Brutos, anticipos de Ganancias, SICORE, cargas sociales (F931), monotributo u otro. Pagarlo registra el egreso en caja y su asiento.",
        "Una lista con las columnas {{Impuesto}}, {{Período}}, {{Vence}}, {{Importe}}, {{Estado}} y {{Pago}}. El selector de año la filtra. Un impuesto por pagar con el vencimiento pasado se marca {{Vencido}}; uno sin importe dice {{Sin liquidar}}, y uno calculado desde el libro IVA lleva {{(estimado)}}.",
        "Los anulados no se muestran en la lista; debajo se informa cuántos hay.",
      ],
      screens: [
        {
          kind: "page",
          title: "Impuestos",
          actions: [
            { label: "Preparar el mes", variant: "outline" },
            { label: "Nuevo impuesto", variant: "primary" },
          ],
          table: {
            columns: [
              "Impuesto",
              "Período",
              "Vence",
              "Importe",
              "Estado",
              "Pago",
            ],
            rows: [
              [
                "~IVA",
                "~octubre de 2026",
                "~18/11/2026",
                "~$ 1.250.000,00 (estimado)",
                "~Pendiente",
                "—",
              ],
              [
                "~IIBB (Buenos Aires)",
                "~octubre de 2026",
                "~16/11/2026",
                "~$ 310.000,00",
                "~Liquidado",
                "—",
              ],
              [
                "~SICORE",
                "~septiembre de 2026",
                "~10/10/2026",
                "~$ 95.000,00",
                "~Pagado",
                "~10/10/2026 · Banco Galicia",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Estados",
          body: [
            "{{Pendiente}}: cargado, todavía sin DDJJ. {{Liquidado}}: la DDJJ está hecha y tiene importe. {{Pagado}}: tiene el pago registrado (con {{Pagar}} o vinculando un movimiento); solo se le editan las notas y los adjuntos. {{Anulado}}: no corre más; no se puede editar ni volver atrás.",
            "Un impuesto por pagar que vence en los próximos 7 días (o ya venció) genera una tarea automática «Pagar … del período …», que se cierra sola al pagarlo. Un IVA que solo deja saldo a favor (sin importe) no genera tarea.",
          ],
        },
      ],
      tasks: [
        {
          id: "preparar-impuestos-del-mes",
          title: "Preparar los impuestos del mes",
          summary:
            "Crea de una vez los impuestos del mes que se declara, copiando los del mes anterior.",
          permission: "taxes:write",
          steps: [
            "En [[/taxes]], hacé clic en {{Preparar el mes}}.",
            "Leé el aviso (dice qué mes prepara y desde cuál copia) y confirmá con {{Preparar}}.",
          ],
          after: [
            "Se prepara el mes anterior al actual (el que se declara ahora): se crean los mismos impuestos que hubo el mes previo, con el mismo tipo, detalle, jurisdicción y cuenta contable, sin importe y con el vencimiento un mes después.",
            "Los que ya están cargados para ese mes no se duplican: correrlo dos veces no crea nada nuevo. El aviso dice cuántos se prepararon.",
          ],
          errors: [
            {
              message:
                "Otro usuario cargó impuestos de ese período al mismo tiempo. Actualizá la página y probá de nuevo.",
              fix: "Actualizá la página y volvé a hacer clic en {{Preparar el mes}}.",
            },
            {
              message: "No tenés permiso para cargar impuestos.",
              fix: "Pedíselo a alguien con permiso de escritura en Impuestos ([[#roles-y-permisos]]).",
            },
          ],
          related: ["cargar-impuesto", "estimar-iva"],
          keywords: [
            "copiar impuestos",
            "preparar mes",
            "vencimientos del mes",
          ],
        },
        {
          id: "cargar-impuesto",
          title: "Cargar un impuesto",
          permission: "taxes:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo impuesto",
              description:
                "Cada impuesto es un documento: período, vencimiento, importe y estado. El pago se registra después con “Pagar”.",
              fields: [
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Ingresos Brutos",
                  marker: 2,
                },
                { label: "Detalle (opcional)", kind: "input", marker: 2 },
                {
                  label: "Jurisdicción",
                  kind: "input",
                  value: "Buenos Aires",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Período",
                  kind: "input",
                  value: "oct 2026",
                  marker: 2,
                },
                {
                  label: "Vencimiento",
                  kind: "date",
                  value: "16/11/2026",
                  marker: 2,
                },
                {
                  label: "Importe",
                  kind: "money",
                  value: "Sin liquidar",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Cuenta contable del pago",
                  kind: "select",
                  value: "2.1.5 IIBB a pagar",
                  wide: true,
                  marker: 2,
                },
                { label: "Notas", kind: "textarea", wide: true, marker: 2 },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Cargar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/taxes]], hacé clic en {{Nuevo impuesto}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Tipo}}: {{IVA (posición mensual)}}, {{Ingresos Brutos}}, {{Anticipo de Ganancias}}, {{SICORE (retenciones y percepciones)}}, {{Cargas sociales (F931)}}, {{Monotributo}} u {{Otro}}.",
                "{{Detalle (opcional)}}; si el tipo es {{Otro}}, el campo se llama {{Nombre}} y es obligatorio (por ejemplo, bienes personales o una tasa municipal).",
                "{{Jurisdicción}}: solo para Ingresos Brutos (Buenos Aires, CABA, Convenio Multilateral…).",
                "{{Período}}: por defecto el mes anterior. {{Vencimiento}}: por defecto hoy.",
                "{{Importe}}: vacío si todavía no está liquidado. En IVA, {{Estimar}} lo calcula desde el libro IVA ([[#estimar-iva]]).",
                "{{Saldo a favor técnico para el mes siguiente}}: solo en IVA; el que deja la DDJJ de este período. El estimado del mes siguiente lo descuenta.",
                "{{Cuenta contable del pago}}: la deuda fiscal o el gasto que cancela el pago. En IVA y SICORE se propone sola la cuenta con el rol del sistema que corresponde. Podés dejar {{Elegir después}}, pero hace falta para pagar.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Cargar}}.",
          ],
          after: [
            "El impuesto queda {{Pendiente}} en la lista. Para adjuntarle el VEP o la DDJJ, abrilo de nuevo ([[#adjuntar-vep-ddjj]]).",
          ],
          errors: [
            {
              message:
                "Ya hay un impuesto de ese tipo y período (con la misma jurisdicción y nombre). Editá el existente o anulalo.",
              fix: "Buscá el impuesto existente en la lista y editalo.",
            },
            {
              message: "Poné el nombre del impuesto.",
              fix: "Con tipo {{Otro}}, completá {{Nombre}}.",
            },
            {
              message: "El importe tiene que ser mayor a cero.",
              fix: "Corregí el importe o dejalo vacío si todavía no está liquidado.",
            },
            {
              message: "Importe inválido.",
              fix: "Escribí el importe con coma decimal, por ejemplo `125.000,50`.",
            },
            {
              message: "Saldo a favor inválido.",
              fix: "Corregí el saldo a favor o dejalo vacío.",
            },
            {
              message:
                "La cuenta contable del impuesto debe ser una cuenta hoja activa de pasivo, activo o gasto (no caja, banco, clientes ni proveedores)",
              fix: "Elegí otra cuenta de la lista.",
            },
            {
              message: "No tenés permiso para cargar impuestos.",
              fix: "Pedíselo a alguien con permiso de escritura en Impuestos.",
            },
          ],
          related: [
            "preparar-impuestos-del-mes",
            "estimar-iva",
            "pagar-impuesto",
          ],
          keywords: [
            "nuevo impuesto",
            "cargar iva",
            "iibb",
            "f931",
            "ganancias",
            "sicore",
            "vencimiento",
          ],
        },
        {
          id: "estimar-iva",
          title: "Estimar el IVA a pagar desde el libro IVA",
          permission: ["taxes:write", "accounting:read"],
          steps: [
            "Abrí un impuesto de tipo {{IVA (posición mensual)}} (nuevo, o {{Editar y adjuntar}} desde el menú ⋯) con el {{Período}} que querés estimar.",
            "Al lado de {{Importe}}, hacé clic en {{Estimar}}.",
            {
              text: "Revisá el recuadro de la posición estimada:",
              substeps: [
                "IVA débito (ventas fiscales) menos IVA crédito (compras fiscales).",
                "Menos las retenciones y percepciones de IVA sufridas en el mes: las de los cobros, las de las compras y las {{Percepción IVA}} de las cuotas de préstamos (y de los comprobantes del banco) con fecha en el mes.",
                "Menos el saldo a favor que dejó el IVA del mes anterior (si no hay IVA cargado de ese mes, lo avisa: restalo a mano si corresponde).",
              ],
            },
            "Si da a pagar, el importe se completa y queda marcado como estimado. Revisalo contra la DDJJ y hacé clic en {{Guardar}} (o {{Cargar}}).",
          ],
          after: [
            "Si da saldo a favor, no completa importe: cargá el saldo a favor en {{Saldo a favor técnico para el mes siguiente}} y, si no hay nada que pagar, anulá el impuesto.",
            "Si cambiás el importe a mano, deja de figurar como estimado.",
          ],
          errors: [
            {
              message:
                "Para estimar el IVA necesitás ver el libro IVA (Contabilidad).",
              fix: "Pedile a un owner el acceso a Contabilidad, o cargá el importe a mano.",
            },
            {
              message:
                "Hay una retención de IVA en un recibo en dólares sin cotización: cargala en el recibo para estimar el IVA.",
              fix: "Abrí el recibo en dólares del mes y cargale la cotización.",
            },
            {
              message: "No se pudo leer el IVA del mes anterior.",
              fix: "Probá de nuevo.",
            },
            {
              message:
                "No se pudieron leer las percepciones de IVA de los préstamos del período.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["cargar-impuesto", "consultar-libro-iva-ventas"],
          keywords: [
            "posición de iva",
            "calcular iva",
            "saldo técnico",
            "estimar",
          ],
        },
        {
          id: "adjuntar-vep-ddjj",
          title: "Editar un impuesto y adjuntar el VEP o la DDJJ",
          permission: "taxes:write",
          prerequisites: [
            "Para adjuntar archivos hace falta además el permiso de escritura en Archivos.",
          ],
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar y adjuntar", marker: 1 },
                { label: "Pagar" },
                { label: "Vincular movimiento existente" },
                { label: "Marcar liquidado" },
                { label: "Anular", destructive: true },
              ],
            },
          ],
          steps: [
            "En [[/taxes]], abrí el menú ⋯ del impuesto y elegí {{Editar y adjuntar}} (en uno pagado dice {{Notas y adjuntos}}).",
            "Corregí los datos que hagan falta. En uno pagado solo se pueden cambiar las {{Notas}}.",
            "En {{VEP, DDJJ y comprobantes}}, elegí el {{Tipo:}} ({{VEP}}, {{DDJJ}}, {{Comprobante de pago}} u {{Otro}}) y arrastrá el archivo o elegilo desde el dispositivo.",
            "Hacé clic en {{Guardar}} si cambiaste datos (los adjuntos se guardan al subirlos).",
          ],
          after: [
            "Los adjuntos quedan en el impuesto y los ve quien tenga acceso a Impuestos, incluido el contador externo.",
          ],
          errors: [
            {
              message:
                "El impuesto ya está pagado: solo se editan las notas (para cambiar el pago, deshacelo)",
              fix: "Para cambiar importe o datos, primero deshacé el pago ([[#deshacer-pago-de-impuesto]]).",
            },
            {
              message: "El impuesto está anulado: no se puede editar",
              fix: "Cargalo de nuevo si hace falta.",
            },
            {
              message: "No tenés permiso para editar impuestos.",
              fix: "Pedíselo a alguien con permiso de escritura en Impuestos.",
            },
          ],
          related: [
            "cargar-impuesto",
            "marcar-impuesto-liquidado",
            "ver-adjuntos-de-impuesto",
          ],
          keywords: [
            "vep",
            "ddjj",
            "adjuntar",
            "comprobante de pago",
            "editar impuesto",
          ],
        },
        {
          id: "marcar-impuesto-liquidado",
          title: "Marcar un impuesto como liquidado (o volverlo a pendiente)",
          permission: "taxes:write",
          steps: [
            "Asegurate de que el impuesto tenga {{Importe}} ([[#adjuntar-vep-ddjj]]).",
            "En [[/taxes]], abrí el menú ⋯ del impuesto {{Pendiente}} y elegí {{Marcar liquidado}}.",
            "Para deshacerlo, en un impuesto {{Liquidado}} elegí {{Volver a pendiente}}.",
          ],
          after: ["El estado cambia en la lista; el impuesto sigue por pagar."],
          errors: [
            {
              message:
                "Para marcar el impuesto como liquidado cargá su importe",
              fix: "Editá el impuesto, cargá el importe y volvé a marcarlo.",
            },
          ],
          related: ["pagar-impuesto"],
          keywords: ["liquidado", "ddjj presentada"],
        },
        {
          id: "pagar-impuesto",
          title: "Pagar un impuesto",
          summary: "Registra el egreso en caja o banco y su asiento.",
          permission: ["taxes:write", "transactions:write"],
          prerequisites: [
            "El impuesto tiene que tener {{Cuenta contable del pago}} ([[#adjuntar-vep-ddjj]]).",
            "Para ver las cuentas de pago hace falta además el permiso de lectura de Cuentas.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Pagar IIBB (Buenos Aires)",
              description:
                "Período octubre de 2026. Registra el egreso en la cuenta elegida y su asiento contra 2.1.5 IIBB a pagar.",
              fields: [
                {
                  label: "Fecha de pago",
                  kind: "date",
                  value: "16/11/2026",
                  marker: 2,
                },
                {
                  label: "Importe",
                  kind: "money",
                  value: "310.000,00",
                  marker: 2,
                },
                {
                  label: "Pagado desde",
                  kind: "select",
                  value: "Banco Galicia",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Pagar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/taxes]], abrí el menú ⋯ del impuesto y elegí {{Pagar}}.",
            {
              text: "Completá el pago:",
              substeps: [
                "{{Fecha de pago}}: por defecto hoy. Tiene que caer en un período contable abierto.",
                "{{Importe}}: viene con el del impuesto; tiene que ser mayor a cero.",
                "{{Pagado desde}}: una cuenta de caja o banco activa en pesos.",
              ],
            },
            "Hacé clic en {{Pagar}}.",
          ],
          after: [
            "Se crea un egreso en la cuenta elegida, en el canal fiscal, con la descripción «Pago de … — período …», y su asiento debita la cuenta contable del impuesto contra la caja o el banco.",
            "El impuesto pasa a {{Pagado}}; la columna {{Pago}} muestra la fecha y la cuenta. Si no tenía importe, toma el pagado. La tarea automática de pago se cierra.",
          ],
          errors: [
            {
              message: "Indicá el importe pagado.",
              fix: "Cargá un importe mayor a cero.",
            },
            {
              message: "Elegí la cuenta contable del impuesto antes de pagarlo",
              fix: "Editá el impuesto y elegí {{Cuenta contable del pago}}.",
            },
            {
              message:
                "El período contable … está cerrado: usá una fecha de pago de un período abierto o pedí que lo reabran en Contabilidad.",
              fix: "Cambiá la fecha de pago o pedí que reabran el mes ([[#reabrir-periodo]]).",
            },
            {
              message:
                "Los impuestos se pagan en pesos: elegí una cuenta en ARS",
              fix: "Elegí una cuenta en pesos.",
            },
            {
              message: "La cuenta de pago no existe o está inactiva",
              fix: "Elegí otra cuenta.",
            },
            {
              message: "No hay un canal fiscal activo para registrar el pago",
              fix: "Avisá al administrador del sistema.",
            },
            {
              message: "El impuesto no existe o ya está pagado o anulado",
              fix: "Actualizá la página: otro usuario ya lo pagó o lo anuló.",
            },
            {
              message: "No tenés permiso para pagar impuestos.",
              fix: "Hace falta permiso de escritura en Impuestos y en Caja: pedíselo a un owner.",
            },
          ],
          related: ["vincular-pago-de-impuesto", "deshacer-pago-de-impuesto"],
          keywords: [
            "pagar impuesto",
            "vep pagado",
            "egreso impuesto",
            "pago afip",
          ],
        },
        {
          id: "vincular-pago-de-impuesto",
          title: "Usar un egreso que ya está en Caja como pago del impuesto",
          summary:
            "Cuando la transferencia a ARCA o a la provincia ya se cargó en Caja, para no registrar el egreso dos veces.",
          permission: ["taxes:write", "transactions:write"],
          prerequisites: [
            "Hace falta además el permiso de lectura de Caja.",
            "El impuesto tiene que tener {{Cuenta contable del pago}}.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Vincular movimiento existente",
              table: {
                columns: ["~Movimiento", "~Importe"],
                rows: [
                  [
                    "~Transferencia ARBA · 15/11/2026 (1 día antes) · Banco Galicia",
                    "~$ 310.000,00",
                  ],
                ],
                marker: 2,
              },
              footer: [
                { label: "Cancelar", variant: "outline" },
                {
                  label: "Vincular y marcar pagado",
                  variant: "primary",
                  marker: 4,
                },
              ],
            },
          ],
          steps: [
            "En [[/taxes]], abrí el menú ⋯ del impuesto y elegí {{Vincular movimiento existente}}.",
            "Elegí el egreso de la lista. Aparecen los egresos manuales en pesos del canal fiscal, sin documento, de hasta 15 días antes o después del vencimiento, con la distancia al vencimiento y la diferencia de importe; si hay muchos, se pasan de página con las flechas.",
            "Si el importe del movimiento no coincide con el del impuesto, marcá la casilla que confirma vincularlo igual: el pago queda por el importe del movimiento y la diferencia en las notas.",
            "Hacé clic en {{Vincular y marcar pagado}}.",
          ],
          after: [
            "El impuesto pasa a {{Pagado}} y el asiento del movimiento se rehace para debitar la cuenta contable del impuesto (la cuenta de gasto que tenía queda guardada para poder deshacerlo).",
            "Si no aparece el pago, es que no está cargado: usá [[#pagar-impuesto]].",
          ],
          errors: [
            {
              message:
                "El movimiento es de $ … y el impuesto de $ …: confirmá la diferencia para vincularlo",
              fix: "Marcá la casilla de la diferencia o elegí otro movimiento.",
            },
            {
              message:
                "Solo se puede vincular un egreso manual de caja o banco (no uno generado por otro documento)",
              fix: "Elegí otro movimiento o registrá el pago con {{Pagar}}.",
            },
            {
              message:
                "El movimiento es de un canal no fiscal: un impuesto se paga desde el canal fiscal",
              fix: "Elegí un egreso del canal fiscal.",
            },
            {
              message:
                "Los impuestos se pagan en pesos: el movimiento está en …",
              fix: "Elegí un egreso en pesos.",
            },
            {
              message:
                "El período contable … está cerrado: el asiento del movimiento no se puede rehacer. Pedí que lo reabran en Contabilidad.",
              fix: "Pedí que reabran el mes del movimiento ([[#reabrir-periodo]]).",
            },
            {
              message: "El impuesto ya está pagado o anulado",
              fix: "Actualizá la página.",
            },
            {
              message: "No tenés permiso para vincular pagos de impuestos.",
              fix: "Hace falta permiso de escritura en Impuestos y de lectura y escritura en Caja.",
            },
          ],
          related: ["pagar-impuesto", "deshacer-pago-de-impuesto"],
          keywords: [
            "vincular pago",
            "transferencia ya cargada",
            "no duplicar egreso",
          ],
        },
        {
          id: "deshacer-pago-de-impuesto",
          title: "Deshacer el pago de un impuesto",
          permission: ["taxes:write", "transactions:write"],
          steps: [
            "En [[/taxes]], abrí el menú ⋯ del impuesto {{Pagado}} y elegí {{Deshacer pago}}.",
            "Leé el aviso y confirmá con {{Deshacer pago}}.",
          ],
          after: [
            "El impuesto vuelve al estado e importe que tenía antes del pago.",
            "Si el pago se registró con {{Pagar}}, se borra el egreso de caja con su asiento. Si se vinculó un movimiento existente, el movimiento queda en Caja como egreso suelto con la cuenta de gasto que tenía, y su asiento se rehace.",
          ],
          errors: [
            {
              message:
                "El pago está conciliado con el extracto bancario: desconciliá la línea antes de deshacerlo",
              fix: "Desconciliá la línea en la pestaña {{Extracto}} de la cuenta ([[/accounts]]) y volvé a intentar.",
            },
            {
              message:
                "El período contable … está cerrado: el pago no se puede deshacer. Pedí que lo reabran en Contabilidad.",
              fix: "Pedí que reabran el mes del pago ([[#reabrir-periodo]]).",
            },
            {
              message: "No tenés permiso para deshacer pagos de impuestos.",
              fix: "Hace falta permiso de escritura en Impuestos y en Caja.",
            },
          ],
          related: ["pagar-impuesto", "vincular-pago-de-impuesto"],
          keywords: ["anular pago impuesto", "revertir pago", "deshacer pago"],
        },
        {
          id: "anular-impuesto",
          title: "Anular un impuesto",
          permission: "taxes:write",
          steps: [
            "En [[/taxes]], abrí el menú ⋯ de un impuesto {{Pendiente}} o {{Liquidado}} y elegí {{Anular}}.",
            "Confirmá con {{Anular}}.",
          ],
          after: [
            "Queda {{Anulado}}: sale de la lista y de las tareas. No se puede deshacer; si hace falta, cargalo de nuevo.",
            "Un impuesto pagado no se anula: primero deshacé el pago.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar impuestos.",
              fix: "Pedíselo a alguien con permiso de escritura en Impuestos.",
            },
          ],
          related: ["cargar-impuesto", "deshacer-pago-de-impuesto"],
          keywords: ["anular impuesto", "borrar impuesto", "sin saldo a pagar"],
        },
        {
          id: "ver-adjuntos-de-impuesto",
          title: "Ver los adjuntos de un impuesto (solo lectura)",
          summary:
            "Para quien ve Impuestos sin poder editarlos, como el contador externo.",
          permission: "taxes:read",
          steps: [
            "En [[/taxes]], en la fila del impuesto, hacé clic en el clip ({{Ver adjuntos}}).",
            "En el diálogo {{Adjuntos}}, abrí el VEP, la DDJJ o el comprobante que necesites.",
          ],
          related: ["adjuntar-vep-ddjj"],
          keywords: ["ver vep", "ver ddjj", "contador"],
        },
      ],
    },

    // ── Ajuste por inflación ──────────────────────────────────────────────
    {
      id: "ajuste-por-inflacion",
      title: "Ajuste por inflación",
      menuPath: "Contabilidad › Ajuste inflación",
      routes: ["/accounting/inflation"],
      permission: "accounting:read",
      intro: [
        "RG 4667: el coeficiente mensual que se usa para reexpresar los saldos no monetarios al preparar el balance ajustado, y el asiento de RECPAM de cada período.",
        "La tabla muestra {{Período}}, {{Coeficiente}}, {{Fuente / Notas}} y {{Estado}} («Sin aplicar» o «Aplicado» con la fecha).",
      ],
      screens: [
        {
          kind: "page",
          title: "Ajuste por inflación",
          actions: [{ label: "Cargar coeficiente", variant: "primary" }],
          table: {
            columns: ["Período", "Coeficiente", "Fuente / Notas", "Estado"],
            rows: [
              ["~2026-10", "~1,028500", "~IPIM INDEC", "~Sin aplicar"],
              ["~2026-09", "~1,031200", "~IPIM INDEC", "~Aplicado 06/10/2026"],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "cargar-coeficiente-inflacion",
          title: "Cargar el coeficiente de un mes",
          permission: "accounting:write",
          screens: [
            {
              kind: "dialog",
              title: "Cargar coeficiente mensual",
              description: "Coeficiente IPIM o el que indique el contador.",
              fields: [
                {
                  label: "Período (YYYY-MM)",
                  kind: "input",
                  value: "oct 2026",
                  marker: 2,
                },
                {
                  label: "Coeficiente",
                  kind: "input",
                  value: "1,028500",
                  marker: 2,
                },
                {
                  label: "Fuente",
                  kind: "input",
                  value: "IPIM INDEC",
                  marker: 2,
                },
                { label: "Notas", kind: "textarea", wide: true, marker: 2 },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Cargar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/accounting/inflation]], hacé clic en {{Cargar coeficiente}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Período (YYYY-MM)}}: el mes.",
                "{{Coeficiente}}: con coma decimal; `1,058432` es una inflación del 5,8432% en el período. Tiene que ser mayor a cero.",
                "{{Fuente}} y {{Notas}}: opcionales.",
              ],
            },
            "Hacé clic en {{Cargar}}.",
          ],
          after: [
            "El coeficiente queda «Sin aplicar» hasta que se genere su asiento.",
          ],
          errors: [
            {
              message: "Ya hay un coeficiente para ese período.",
              fix: "Borrá el existente si está mal y cargalo de nuevo.",
            },
            {
              message: "Debe ser mayor a cero.",
              fix: "Escribí el coeficiente, por ejemplo `1,028500`.",
            },
            {
              message: "Formato YYYY-MM.",
              fix: "Elegí el período.",
            },
            {
              message: "No tenés permiso.",
              fix: "Pedíselo a alguien con permiso de escritura en Contabilidad.",
            },
          ],
          related: ["generar-asiento-recpam"],
          keywords: ["ipim", "coeficiente", "inflación", "rg 4667"],
        },
        {
          id: "generar-asiento-recpam",
          title: "Generar el asiento de ajuste (RECPAM) de un período",
          permission: "accounting:write",
          steps: [
            "En [[/accounting/inflation]], en la fila del período, hacé clic en {{Generar asiento}}.",
            "Se abre {{Nuevo asiento manual}} con la descripción «Ajuste por inflación RG 4667 — período …» y la primera línea apuntando a la cuenta RECPAM (código `4.2.2`) si existe en el plan.",
            "Cargá los importes y las contrapartidas como en [[#crear-asiento-manual]] y hacé clic en {{Crear asiento}}.",
          ],
          after: [
            "El asiento queda en el libro diario y se vincula al coeficiente: el estado pasa a «Aplicado» con la fecha y el botón cambia a {{Desvincular}}.",
          ],
          errors: [
            {
              message: "El asiento se creó pero no se pudo vincular: …",
              fix: "El asiento ya está en el libro diario: no lo cargues de nuevo. Avisá al administrador del sistema para vincularlo.",
            },
            {
              message: "El período ya tiene un asiento aplicado.",
              fix: "Si hay que rehacerlo, primero desvinculá el asiento anterior.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un período abierto o pedí que reabran el mes.",
            },
          ],
          related: ["crear-asiento-manual", "desvincular-asiento-recpam"],
          keywords: ["recpam", "asiento de inflación", "reexpresión"],
        },
        {
          id: "desvincular-asiento-recpam",
          title: "Desvincular el asiento de un coeficiente",
          permission: "accounting:write",
          steps: [
            "En [[/accounting/inflation]], en la fila del período aplicado, hacé clic en {{Desvincular}}.",
            "Confirmá con {{Desvincular}}.",
          ],
          after: [
            "El coeficiente vuelve a «Sin aplicar». El asiento sigue en el libro diario: si corresponde, cargá su reversión a mano ([[#revertir-asiento-manual]]).",
          ],
          errors: [
            {
              message: "El período no tiene asiento aplicado.",
              fix: "Actualizá la página: ya estaba desvinculado.",
            },
          ],
          related: ["generar-asiento-recpam", "revertir-asiento-manual"],
          keywords: ["desaplicar ajuste", "rehacer recpam"],
        },
        {
          id: "borrar-coeficiente-inflacion",
          title: "Borrar un coeficiente",
          permission: "accounting:write",
          steps: [
            "En [[/accounting/inflation]], en la fila del período, hacé clic en el tacho ({{Borrar}}).",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "El coeficiente se borra. Si tenía un asiento aplicado, el asiento queda en el libro diario sin vínculo: conviene desvincularlo y revertirlo antes.",
          ],
          errors: [
            {
              message: "No se pudo borrar.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["desvincular-asiento-recpam"],
          keywords: ["eliminar coeficiente"],
        },
      ],
    },

    // ── Cotización USD ────────────────────────────────────────────────────
    {
      id: "cotizacion-usd",
      title: "Cotización USD",
      menuPath: "Contabilidad › Cotización USD",
      routes: ["/accounting/exchange-rates"],
      permission: "accounting:read",
      intro: [
        "La referencia oficial del BCRA: pesos por 1 dólar, una por día. Se usa para pasar a pesos lo que está en dólares; para una fecha sin cotización se toma la anterior más cercana.",
        "La tabla muestra {{Fecha}}, {{ARS por USD}}, {{Fuente}} ({{BCRA}} o {{Manual}}) y {{Notas}}.",
      ],
      concepts: [
        {
          title: "Carga automática",
          body: [
            "De lunes a viernes a las 11:00 (hora de Argentina) el sistema trae sola la cotización del BCRA. No pisa una cotización ya cargada para esa fecha: si el BCRA no responde, se carga a mano.",
            "Una carga manual reemplaza la del BCRA para esa fecha.",
          ],
        },
      ],
      screens: [
        {
          kind: "page",
          title: "Cotización USD",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Cargar cotización", variant: "primary" },
          ],
          table: {
            columns: ["Fecha", "ARS por USD", "Fuente", "Notas"],
            rows: [
              ["~05/11/2026", "~1.452,500000", "BCRA", "—"],
              ["~04/11/2026", "~1.449,000000", "Manual", "~BCRA no publicó"],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "cargar-cotizacion-usd",
          title: "Cargar una cotización a mano",
          permission: "accounting:write",
          screens: [
            {
              kind: "dialog",
              title: "Cargar cotización USD",
              description:
                "ARS por 1 USD. Una carga manual sobreescribe la del BCRA para esa fecha.",
              fields: [
                {
                  label: "Fecha",
                  kind: "date",
                  value: "04/11/2026",
                  marker: 2,
                },
                {
                  label: "ARS por USD",
                  kind: "money",
                  value: "1.449,00",
                  marker: 2,
                },
                { label: "Notas", kind: "textarea", wide: true, marker: 2 },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/accounting/exchange-rates]], hacé clic en {{Cargar cotización}}.",
            {
              text: "Completá los datos:",
              substeps: [
                "{{Fecha}}.",
                "{{ARS por USD}}: con punto de miles y coma decimal (`1.180,50`), hasta 6 decimales.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Guardar}}. Si la cotización difiere en más del 30% de la cotización cargada más cercana, el sistema pregunta {{¿Seguro?}}: revisala y confirmá con {{Guardar igual}} o cancelá.",
          ],
          after: [
            "Queda con fuente {{Manual}}. Si ya había una cotización para esa fecha, se reemplaza. El cambio queda en la auditoría.",
          ],
          errors: [
            {
              message: "Cotización inválida.",
              fix: "Escribí un número mayor a cero, por ejemplo `1.180,50`.",
            },
            {
              message: "No se pudo guardar la cotización.",
              fix: "Probá de nuevo.",
            },
            {
              message: "No tenés permiso.",
              fix: "Pedíselo a alguien con permiso de escritura en Contabilidad.",
            },
          ],
          related: ["borrar-cotizacion-usd"],
          keywords: ["dólar", "tipo de cambio", "cotización manual", "bcra"],
        },
        {
          id: "borrar-cotizacion-usd",
          title: "Borrar una cotización",
          permission: "accounting:write",
          steps: [
            "En [[/accounting/exchange-rates]], en la fila de la fecha, hacé clic en el tacho ({{Borrar}}).",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "Las conversiones que usaban esa fecha pasan a tomar la cotización anterior más cercana.",
          ],
          errors: [
            {
              message: "No se pudo borrar la cotización.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["cargar-cotizacion-usd"],
          keywords: ["eliminar cotización"],
        },
        {
          id: "exportar-cotizaciones",
          title: "Exportar las cotizaciones",
          permission: "accounting:read",
          steps: [
            "En [[/accounting/exchange-rates]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}} y el rango de fechas de cotización con {{Desde}} y {{Hasta}} (por defecto, del 1 del mes a hoy).",
            "Hacé clic en {{Descargar período}}, o en {{Todo el historial}} para todas las fechas.",
          ],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Probá de nuevo.",
            },
          ],
          keywords: ["exportar dólar", "histórico cotizaciones"],
        },
      ],
    },

    // ── Configuración contable ────────────────────────────────────────────
    {
      id: "configuracion-contable",
      title: "Configuración contable",
      menuPath: "Contabilidad › Configuración contable",
      routes: ["/accounting/settings"],
      permission: "accounting:read",
      intro: [
        "Los datos de la empresa que usan los reportes contables. Por ahora, el {{Inicio del ejercicio}}: el mes en que empieza el año fiscal.",
      ],
      screens: [
        {
          kind: "page",
          title: "Configuración contable",
          subtitle: "Datos de la empresa que usan los reportes contables.",
          actions: [{ label: "Cambiar", variant: "outline" }],
        },
      ],
      concepts: [
        {
          title: "Qué usa el inicio del ejercicio",
          body: [
            "El {{Estado de Resultados}} y el {{Resultado del período}} del {{Balance General}} cuando {{Desde (opcional)}} está vacío, los atajos {{Ejercicio actual}} y {{Ejercicio anterior}} de [[/accounting/balance]], el {{Año fiscal}} de [[/management]] y el estado de resultados del asistente cuando se le pide «el ejercicio».",
            "Un ejercicio se nombra por los años que abarca: con inicio en octubre, el ejercicio 2025/26 va del 01/10/2025 al 30/09/2026. Con inicio en enero, es el año calendario (por ejemplo, 2026).",
          ],
        },
      ],
      tasks: [
        {
          id: "cambiar-inicio-del-ejercicio",
          title: "Cambiar el inicio del ejercicio",
          permission: "accounting:admin",
          screens: [
            {
              kind: "dialog",
              title: "Inicio del ejercicio",
              fields: [
                {
                  label: "Mes de inicio",
                  kind: "select",
                  value: "Octubre",
                  wide: true,
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/accounting/settings]], hacé clic en {{Cambiar}}.",
            "Elegí el {{Mes de inicio}}. Debajo se ve qué meses abarca el ejercicio.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "Aparece {{Inicio del ejercicio guardado.}} y los reportes del ejercicio pasan a sumar desde ese mes. No se toca ningún asiento. El cambio queda en la auditoría.",
          ],
          errors: [
            {
              message:
                "No tenés permiso para cambiar la configuración contable.",
              fix: "Solo el dueño o un administrador lo cambia ([[#roles-y-permisos]]).",
            },
            {
              message: "No se pudo guardar la configuración.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["ver-estado-de-resultados", "ver-balance-general"],
          keywords: [
            "ejercicio",
            "año fiscal",
            "cierre de ejercicio",
            "octubre",
          ],
        },
      ],
    },
  ],
};
