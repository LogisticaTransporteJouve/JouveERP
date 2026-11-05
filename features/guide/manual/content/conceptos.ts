import type { GuidePage } from "../types";

// Cross-cutting concepts: how to use the guide, roles and per-user access,
// fiscal and internal channels, closed periods. Each domain chapter links
// here instead of repeating them.

export const conceptsPage: GuidePage = {
  file: "conceptos.html",
  title: "Conceptos generales",
  lead: "Lo que vale para todo el sistema: cómo pedir ayuda, quién puede hacer qué, los dos lados (fiscal e interno) y los períodos cerrados.",
  sections: [
    {
      id: "usar-la-guia",
      title: "Cómo usar esta guía",
      routes: [],
      permission: null,
      intro: [
        "La guía describe el sistema tal como está hoy: cada nombre de botón, campo o pestaña que aparece **así** es el texto exacto de la pantalla, y un test del sistema avisa cuando la pantalla cambia y la guía queda vieja.",
      ],
      concepts: [
        {
          title: "Desde el sistema",
          body: [
            "En el pie de la barra lateral, {{Guía de uso}} abre esta guía en otra pestaña.",
            "En el encabezado de cada pantalla, el botón **?** ({{Ayuda de esta pantalla}}) abre directamente la sección de la pantalla donde estás.",
            "En la barra lateral, el bloque {{Guía}} resume la pantalla actual en dos o tres líneas y enlaza a su sección.",
          ],
        },
        {
          title: "Preguntarle al asistente",
          body: [
            "En el chat del asistente podés preguntar «¿cómo hago una nota de crédito?» o «¿dónde cargo un cheque rechazado?»: busca en esta guía y responde con los pasos y el enlace a la sección. Si la tarea pide un permiso que tu usuario no tiene, te lo dice.",
          ],
        },
        {
          title: "Cómo leer una tarea",
          body: [
            "**Quién puede** lista los roles que tienen el permiso según la matriz de roles; el owner además puede quitarle un módulo a un usuario puntual (ver [[#roles-y-permisos]]).",
            "**Antes** es lo que tiene que existir para empezar. Los **pasos** siguen el orden de la pantalla; los números en los dibujos marcan dónde hacer clic en cada paso.",
            "**Qué pasa después** cuenta los efectos: asientos, saldos, CAE de AFIP, avisos, qué queda bloqueado. **Si aparece un error** lista los mensajes exactos que puede mostrar el sistema y qué hacer con cada uno.",
          ],
        },
      ],
      tasks: [],
    },
    {
      id: "roles-y-permisos",
      title: "Roles, permisos y accesos por usuario",
      menuPath: "Administración › Usuarios",
      routes: [],
      permission: null,
      intro: [
        "Cada usuario tiene uno o más roles. Un rol trae un conjunto fijo de permisos (por ejemplo `invoices:issue` para emitir comprobantes). El sistema esconde los módulos y botones que tu usuario no puede usar y, si igual se intenta, responde con un error de permiso.",
      ],
      concepts: [
        {
          title: "Los roles",
          body: [
            "**Owner**: acceso total; es el único que asigna el rol owner, edita los accesos por usuario, borra movimientos de caja y carga saldos de apertura.",
            "**Admin**: acceso total excepto el rol owner y los accesos por usuario.",
            "**Finanzas**: clientes, caja, comprobantes y cobranzas.",
            "**Operaciones**: flota, viajes, combustible, mantenimientos.",
            "**Depósito**: pallets, productos, movimientos de stock.",
            "**Chofer**: acceso de chofer (próximamente).",
            "**Contador externo**: solo lectura de lo fiscal: comprobantes, compras, libros IVA y contabilidad. Siempre ve solo el lado fiscal.",
          ],
        },
        {
          title: "Accesos por usuario",
          body: [
            "El owner puede quitarle a un usuario un módulo que su rol sí trae (por ejemplo, que alguien de Finanzas no vea Sueldos). Quitar la lectura de un módulo lo oculta entero del menú y de las consultas del asistente; los datos que otro módulo muestra con su propio permiso se siguen viendo ahí.",
            "Un owner no se puede quitar accesos a sí mismo ni a otro owner. Los cambios se hacen en [[/admin/users]].",
          ],
        },
        {
          title: "Cuando falta un permiso",
          body: [
            "La guía igual muestra las tareas que tu usuario no puede hacer, con los roles que sí pueden: pedíselas a alguien con ese rol o pedile al owner el acceso.",
          ],
        },
      ],
      tasks: [],
    },
    {
      id: "periodos-cerrados",
      title: "Períodos contables cerrados",
      menuPath: "Contabilidad › Libro diario",
      routes: [],
      permission: "accounting:read",
      intro: [
        "Cerrar un mes congela su contabilidad: un período cerrado no admite asientos nuevos, ediciones, reversas ni emisión de comprobantes fiscales con fecha en ese mes. Cualquier operación que generaría o cambiaría un asiento de ese mes se rechaza con un mensaje que nombra el período.",
      ],
      tasks: [
        {
          id: "cerrar-periodo",
          title: "Cerrar un período contable",
          summary:
            "Se hace cuando el contador terminó el mes, para que nadie cambie lo ya declarado.",
          permission: "accounting:write",
          prerequisites: [
            "Ser owner o admin: aunque otro rol tenga el permiso, solo owner y admin cierran y reabren períodos.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Libro diario › Períodos cerrados",
              title: "Períodos cerrados",
              description:
                "Un período cerrado no admite asientos nuevos, ediciones, reversas ni emisión de comprobantes fiscales con fecha en ese mes.",
              fields: [
                {
                  label: "Período",
                  kind: "input",
                  value: "octubre de 2026",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cerrar período", variant: "primary", marker: 3 },
                { label: "Listo" },
              ],
            },
          ],
          steps: [
            "En [[/accounting/journal]], hacé clic en {{Períodos cerrados}}.",
            "En {{Período}}, elegí el mes.",
            "Hacé clic en {{Cerrar período}} y confirmá en el aviso.",
          ],
          after: [
            "El mes queda en la lista con la fecha de cierre. Desde ese momento no se pueden registrar, editar ni revertir asientos con fecha en ese mes.",
            "Si AFIP autoriza un comprobante con fecha en un mes cerrado, su asiento queda pendiente y se genera al reabrir; la lista lo indica en cada período.",
          ],
          errors: [
            {
              message: "Solo owner/admin pueden cerrar períodos.",
              fix: "Pedile el cierre a un owner o admin.",
            },
            {
              message: "El período ya está cerrado.",
              fix: "No hace falta hacer nada: ya figura en la lista.",
            },
          ],
          related: ["reabrir-periodo"],
          keywords: ["cierre de mes", "bloquear mes", "cerrar mes"],
        },
        {
          id: "reabrir-periodo",
          title: "Reabrir un período contable",
          permission: "accounting:write",
          prerequisites: ["Ser owner o admin."],
          steps: [
            "En [[/accounting/journal]], hacé clic en {{Períodos cerrados}}.",
            "En la fila del mes, hacé clic en {{Reabrir}} y confirmá.",
          ],
          after: [
            "Se vuelven a poder registrar y modificar asientos con fecha en ese mes.",
            "Los comprobantes autorizados por AFIP mientras estuvo cerrado reciben ahora su asiento; el aviso dice cuántos se generaron.",
          ],
          errors: [
            {
              message: "Solo owner/admin pueden reabrir períodos.",
              fix: "Pedile la reapertura a un owner o admin.",
            },
            {
              message: "El período no estaba cerrado.",
              fix: "Otro usuario ya lo reabrió: actualizá la pantalla.",
            },
          ],
          related: ["cerrar-periodo"],
        },
      ],
    },
  ],
};
