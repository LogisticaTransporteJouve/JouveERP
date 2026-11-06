import { PAYMENT_ORDER_FORM_PERMISSIONS } from "@/features/payment-orders/lib/payment-order-form";

import type { GuidePage } from "../types";

import { attachmentPermission } from "./attachment-permissions";

// Purchases chapter: suppliers and their categories, purchase invoices and
// internal remitos, the ARCA received tray, payment orders and supplier aging.

export const purchasesPage: GuidePage = {
  file: "compras.html",
  title: "Compras",
  lead: "Proveedores, facturas y remitos de compra, comprobantes recibidos de ARCA, órdenes de pago y lo que se le debe a cada proveedor.",
  sections: [
    // ── Compras y Otras compras ───────────────────────────────────────────
    {
      id: "compras-y-otras-compras",
      title: "Compras y Otras compras",
      menuPath: "Compras · Otras compras",
      routes: [],
      permission: null,
      intro: [
        "En la barra lateral hay dos bloques con las mismas pantallas: **Compras** (el lado fiscal) y **Otras compras** (el lado interno). Los dos abren [[/suppliers]], [[/suppliers/categories]], [[/purchases]], [[/payment-orders]] y [[/aging-suppliers]]; lo que cambia es qué lado muestran.",
      ],
      concepts: [
        {
          title: "Qué cambia según el bloque que abriste",
          body: [
            "Al abrir un ítem del bloque **Compras**, el sistema pasa al lado fiscal y la pantalla muestra solo proveedores, facturas, órdenes de pago y deudas de canales fiscales. Al abrir uno de **Otras compras**, pasa al lado interno y muestra solo lo de canales internos.",
            "En **Otras compras** el ítem de las facturas se llama {{Remitos de compra}}: del lado interno no hay facturas sino remitos internos, que no llevan letra ni CAE y no van al Libro IVA Compras.",
            "{{Categorías}} es la misma lista en los dos bloques: las categorías de proveedores no tienen lado.",
            "Un usuario que solo puede ver lo fiscal (el contador externo) no ve el bloque **Otras compras**.",
          ],
        },
        {
          title: "Cada proveedor vive en un lado",
          body: [
            "Un proveedor de Compras tiene CUIT y condición frente al IVA (se completan desde AFIP). Uno de Otras compras tiene solo nombre y contacto, sin CUIT ni AFIP. El lado se elige al crearlo (según el bloque donde estás) y no cambia después.",
            "La ficha de un proveedor ([[/suppliers/[id]]]) siempre muestra el lado del proveedor, sin importar desde qué bloque llegaste.",
          ],
        },
        {
          title: "Qué va a la contabilidad",
          body: [
            "Solo los documentos de canales fiscales generan asientos: una factura de compra fiscal acredita **Proveedores** y debita el gasto, el IVA crédito fiscal y las percepciones; una orden de pago fiscal debita **Proveedores** y acredita la cuenta de donde sale la plata. Los remitos y las órdenes de pago internas no generan asientos.",
            "Si el mes del documento está cerrado, el sistema no deja cargarlo, editarlo ni anularlo (ver [[#periodos-cerrados]]).",
          ],
        },
      ],
      tasks: [],
    },

    // ── Proveedores ───────────────────────────────────────────────────────
    {
      id: "proveedores",
      title: "Proveedores",
      menuPath: "Compras › Proveedores (y Otras compras › Proveedores)",
      routes: ["/suppliers", "/suppliers/[id]"],
      permission: "suppliers:read",
      intro: [
        "La lista de proveedores del lado en el que estás. Del lado fiscal, cada uno con CUIT y condición frente al IVA; del lado interno, solo nombre y contacto.",
        "Columnas: {{Razón social}} (con el nombre fantasía debajo; el nombre lleva a la ficha), {{CUIT}}, {{Condición IVA}}, {{Categoría}}, {{Estado}} ({{Activo}} o {{Inactivo}}), {{Actualizado}} y {{Acciones}}. Arriba podés buscar por razón social, nombre fantasía o CUIT, filtrar por categoría ({{Todas las categorías}}) y destildar {{Solo activos}} para ver también los desactivados; {{Limpiar}} saca los filtros.",
        "Al hacer clic en un proveedor se abre su ficha, con tres pestañas: {{Cuenta corriente}}, {{Datos}} y {{Adjuntos}}.",
        "Para dar de alta muchos proveedores de una vez desde una planilla, está el importador de [[/admin/imports]].",
      ],
      screens: [
        {
          kind: "page",
          caption: "Compras › Proveedores",
          title: "Proveedores",
          actions: [
            { label: "Exportar" },
            { label: "Nuevo proveedor", variant: "primary" },
          ],
          toolbar: [
            {
              label: "Buscar por razón social, nombre fantasía o CUIT",
              kind: "input",
            },
            { label: "Todas las categorías", kind: "select" },
            { label: "Solo activos", kind: "checkbox", value: "sí" },
          ],
          table: {
            columns: [
              "Razón social",
              "CUIT",
              "Condición IVA",
              "Categoría",
              "Estado",
              "Actualizado",
              "Acciones",
            ],
            rows: [
              [
                "~Transportes del Sur S.A.",
                "~30-71234567-8",
                "~Responsable Inscripto",
                "~Combustible",
                "~Activo",
                "~03/11/2026",
                "~✎ 🗑",
              ],
              [
                "~Neumáticos Lanús S.R.L.",
                "~30-70987654-3",
                "~Responsable Inscripto",
                "~Repuestos",
                "~Activo",
                "~28/10/2026",
                "~✎ 🗑",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "La cuenta corriente del proveedor",
          body: [
            "La pestaña {{Cuenta corriente}} lista, de lo más nuevo a lo más viejo, las facturas, notas de crédito y débito, órdenes de pago, cheques rechazados y el ajuste de saldo del proveedor. Columnas: {{Fecha}}, {{Tipo}}, {{Documento}} (con el número enlazado al comprobante; una factura muestra {{Pagada}} o {{Parcial}}), {{Canal}}, {{Debe}} (lo que le debemos, con lo {{Pendiente:}} si está pagada en parte), {{Haber}} (pagos y créditos) y {{Acciones}}.",
            "El recuadro de arriba muestra el **Saldo pendiente total** del lado del proveedor: lo que falta pagar de facturas, notas de débito y cheques rechazados, menos lo pagado a cuenta sin imputar y las notas de crédito sin factura de origen. Debajo dice {{Les debemos}}, {{Saldo a favor}} o {{Saldo cero}}. Si hay movimientos en dólares, muestra un saldo en pesos y otro en dólares (nunca se suman).",
            "El saldo es siempre el de toda la cuenta: el filtro de fechas solo acota la tabla.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-proveedor",
          title: "Crear un proveedor",
          summary:
            "Del lado fiscal, el CUIT se verifica en AFIP y de ahí salen la razón social, la condición frente al IVA y el domicilio fiscal.",
          permission: "suppliers:write",
          prerequisites: [
            "Estar en el bloque correcto de la barra lateral: el proveedor se crea en el lado donde estás (Compras o Otras compras) y no se puede mover después.",
            "Del lado fiscal, {{Verificar AFIP}} pide además el permiso `padron:lookup` (lo tienen Owner, Admin y Finanzas): sin verificar el CUIT no se completa la razón social y no se puede crear el proveedor.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo proveedor",
              description:
                "Ingresá el CUIT y verificá AFIP para autocompletar los datos.",
              fields: [
                {
                  label: "CUIT",
                  kind: "input",
                  value: "30-71234567-8",
                  marker: 2,
                },
                {
                  label: "Razón social",
                  kind: "input",
                  value: "Transportes del Sur S.A.",
                },
                { label: "Nombre fantasía", kind: "input", marker: 3 },
                {
                  label: "Condición frente al IVA",
                  kind: "select",
                  value: "Responsable Inscripto",
                },
                { label: "Email", kind: "input" },
                { label: "Teléfono", kind: "input" },
                { label: "Domicilio fiscal (AFIP)", kind: "input", wide: true },
                { label: "Domicilio real", kind: "input", wide: true },
                { label: "Notas", kind: "textarea", wide: true },
                {
                  label: "Categoría",
                  kind: "select",
                  value: "Sin categoría",
                  marker: 4,
                  wide: true,
                },
                { label: "Canal", kind: "select", value: "Ninguno", marker: 5 },
                {
                  label: "Plazo de pago (días)",
                  kind: "input",
                  value: "30",
                  marker: 5,
                },
                {
                  label: "Cuenta de gasto",
                  kind: "select",
                  value: "Ninguna",
                  marker: 5,
                },
                {
                  label: "Centro de costo",
                  kind: "select",
                  value: "Ninguno",
                  marker: 5,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Crear proveedor", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            "En [[/suppliers]], hacé clic en {{Nuevo proveedor}}.",
            {
              text: "Del lado fiscal: escribí el {{CUIT}} y hacé clic en {{Verificar AFIP}}.",
              substeps: [
                "El sistema completa {{Razón social}}, {{Condición frente al IVA}} y {{Domicilio fiscal (AFIP)}} con lo que informa AFIP; esos tres campos no se escriben a mano.",
                "Si ya hay un proveedor con ese CUIT, avisa «Ya existe un proveedor con ese CUIT.» y muestra un enlace a su ficha.",
                "Del lado interno no hay CUIT: escribí el {{Nombre}} directamente.",
              ],
            },
            {
              text: "Completá los datos de contacto que tengas.",
              substeps: [
                "{{Nombre fantasía}}: cómo lo conocen en la empresa; también sirve para buscarlo.",
                "{{Email}} y {{Teléfono}}.",
                "{{Domicilio real}} (del lado interno, {{Domicilio}}): solo si difiere del fiscal.",
                "{{Notas}}: texto libre.",
              ],
            },
            "En {{Categoría}}, elegí una o dejá {{Sin categoría}}. Si tu usuario puede crear categorías, {{Nueva categoría}} al final de la lista crea una ahí mismo y la deja elegida.",
            {
              text: "Opcional: en **Al cargar una compra de este proveedor, completar con:**, cargá lo que se va a proponer en cada factura nueva de este proveedor (se puede cambiar en cada factura).",
              substeps: [
                "{{Canal}}: el canal que se elige solo al cargarle una compra.",
                "{{Plazo de pago (días)}}: de 1 a 365. El vencimiento de pago de la factura se propone como fecha de la factura más esos días.",
                "{{Cuenta de gasto}}: la cuenta contable a la que va el neto (si no elegís, va a Compras).",
                "{{Centro de costo}}: el centro al que se imputa el gasto.",
              ],
            },
            "Hacé clic en {{Crear proveedor}}.",
          ],
          after: [
            "Aparece el aviso «Proveedor creado.» y el proveedor queda activo en la lista del lado donde lo creaste.",
            "También podés crear un proveedor sin salir de una factura o una orden de pago: en el buscador de proveedor, el botón {{Nuevo}} abre este mismo formulario.",
          ],
          errors: [
            {
              message: "Ya existe un proveedor con ese CUIT.",
              fix: "No lo crees de nuevo: buscalo en la lista (destildá {{Solo activos}} si está desactivado) o seguí el enlace que muestra el formulario.",
            },
            {
              message: "El CUIT debe tener 11 dígitos.",
              fix: "Escribí el CUIT completo, con o sin guiones.",
            },
            {
              message:
                "CUIT inválido — debe tener 11 dígitos y empezar con 2 o 3.",
              fix: "Revisá el CUIT antes de hacer clic en {{Verificar AFIP}}.",
            },
            {
              message: "El CUIT … no existe en el padrón de AFIP.",
              fix: "Revisá el número con el proveedor: AFIP no lo encuentra.",
            },
            {
              message: "No tenés permiso para consultar el padrón.",
              fix: "Pedile a alguien de Finanzas, Admin u Owner que cree el proveedor.",
            },
            {
              message: "CUIT inválido (dígito verificador incorrecto).",
              fix: "Revisá el CUIT: algún dígito está mal tipeado.",
            },
            {
              message: "Razón social requerida.",
              fix: "Hacé clic en {{Verificar AFIP}} para traer la razón social antes de guardar.",
            },
            {
              message: "Nombre requerido.",
              fix: "Del lado interno, escribí un nombre de al menos 2 letras.",
            },
            {
              message: "Email inválido.",
              fix: "Corregí el email o dejalo vacío.",
            },
            {
              message: "No tenés permiso para crear proveedores.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: ["editar-proveedor", "crear-categoria-proveedor"],
          keywords: [
            "alta de proveedor",
            "nuevo proveedor",
            "CUIT",
            "AFIP",
            "padrón",
          ],
        },
        {
          id: "editar-proveedor",
          title: "Editar los datos de un proveedor",
          permission: "suppliers:write",
          steps: [
            {
              text: "Abrí el formulario de una de estas dos formas:",
              substeps: [
                "En [[/suppliers]], en la fila del proveedor, hacé clic en el lápiz ({{Editar}}).",
                "En la ficha del proveedor, abrí la pestaña {{Datos}}.",
              ],
            },
            "Cambiá lo que necesites: nombre fantasía, contacto, domicilio real, notas, categoría y lo que se completa al cargar una compra.",
            "Hacé clic en {{Guardar cambios}} (se habilita cuando cambiaste algo).",
          ],
          after: [
            "Aparece el aviso «Cambios guardados.». Los valores para nuevas compras se usan desde la próxima factura; las ya cargadas no cambian.",
            "El CUIT, la razón social, la condición frente al IVA y el domicilio fiscal de un proveedor fiscal no se editan: vienen de AFIP.",
            "Sin el permiso de escritura, la pestaña {{Datos}} muestra «No tenés permiso para editar proveedores.».",
          ],
          errors: [
            {
              message: "No tenés permiso para editar proveedores.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
            {
              message: "Email inválido.",
              fix: "Corregí el email o dejalo vacío.",
            },
          ],
          related: ["crear-proveedor"],
          keywords: [
            "modificar proveedor",
            "plazo de pago",
            "cuenta de gasto por defecto",
          ],
        },
        {
          id: "eliminar-o-desactivar-proveedor",
          title: "Eliminar o desactivar un proveedor",
          summary:
            "Un proveedor con movimientos no se elimina: se desactiva y deja de aparecer en las listas activas.",
          permission: "suppliers:write",
          screens: [
            {
              kind: "dialog",
              title: "Eliminar proveedor",
              description: "Transportes del Sur S.A. · CUIT 30-71234567-8",
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Desactivar", variant: "outline", marker: 2 },
                { label: "Eliminar", variant: "destructive", marker: 2 },
              ],
            },
          ],
          steps: [
            "En [[/suppliers]], en la fila del proveedor, hacé clic en el tacho ({{Eliminar}}). El sistema revisa si el proveedor tiene movimientos asociados.",
            {
              text: "Elegí según lo que muestre:",
              substeps: [
                "Si **tiene movimientos** (compras, órdenes de pago, cheques, saldo de apertura, adjuntos, movimientos de caja), lista cuántos hay y solo ofrece {{Desactivar}}.",
                "Si **no tiene movimientos**, podés {{Eliminar}} definitivamente o {{Desactivar}} para conservarlo.",
              ],
            },
          ],
          after: [
            "Desactivar: aviso «Proveedor desactivado.»; el proveedor queda guardado con todo su historial y solo se ve con {{Solo activos}} destildado.",
            "Eliminar: aviso «Proveedor eliminado.»; no se puede deshacer.",
          ],
          errors: [
            {
              message:
                "El proveedor tiene movimientos asociados. Desactivalo en lugar de eliminarlo.",
              fix: "Usá {{Desactivar}}.",
            },
            {
              message:
                "No se pudo verificar si el proveedor tiene movimientos asociados.",
              fix: "Reintentá; mientras no se pueda verificar, el sistema no deja eliminarlo.",
            },
            {
              message: "No tenés permiso para eliminar proveedores.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          keywords: ["borrar proveedor", "dar de baja", "inactivo"],
        },
        {
          id: "ver-cuenta-corriente-proveedor",
          title: "Ver y exportar la cuenta corriente de un proveedor",
          permission: "suppliers:read",
          screens: [
            {
              kind: "page",
              caption: "Ficha del proveedor › Cuenta corriente",
              title: "~Transportes del Sur S.A.",
              tabs: {
                labels: ["Cuenta corriente", "Datos", "Adjuntos"],
                active: 0,
              },
              actions: [
                { label: "Exportar resumen", variant: "outline", marker: 3 },
                { label: "Ajustar saldo", variant: "outline" },
                { label: "Nueva factura", variant: "outline" },
                { label: "Nueva orden de pago", variant: "primary" },
              ],
              toolbar: [
                { label: "Todas las fechas", kind: "select", marker: 2 },
              ],
              table: {
                columns: [
                  "Fecha",
                  "Tipo",
                  "Documento",
                  "Canal",
                  "Debe",
                  "Haber",
                  "Acciones",
                ],
                rows: [
                  [
                    "~04/11/2026",
                    "~Orden de Pago",
                    "~OP0003-00000041",
                    "~Jouve fiscal",
                    "~—",
                    "~$500.000,00",
                    "~👁",
                  ],
                  [
                    "~20/10/2026",
                    "~Factura",
                    "~A00002-00001234 Parcial",
                    "~Jouve fiscal",
                    "~$800.000,00",
                    "~—",
                    "~👁",
                  ],
                ],
              },
            },
          ],
          steps: [
            "En [[/suppliers]], hacé clic en el nombre del proveedor. Se abre la pestaña {{Cuenta corriente}}.",
            "Para ver un período, elegilo en el filtro de fechas ({{Todas las fechas}}, {{Este mes}}, {{Mes anterior}}, {{Personalizado}}…). El saldo de arriba no cambia: es el de toda la cuenta.",
            "Para llevarte el resumen, hacé clic en {{Exportar resumen}}, elegí {{PDF}} o {{Excel}} y el rango, y hacé clic en {{Descargar período}} o {{Todo el historial}}.",
            "Para abrir un comprobante, hacé clic en su número o en el ojo ({{Ver detalle}}).",
          ],
          after: [
            "Desde la misma pestaña podés cargar una compra ({{Nueva factura}}) o pagarle ({{Nueva orden de pago}}) con el proveedor ya elegido: ver [[#cargar-factura-de-compra]] y [[#emitir-orden-de-pago]].",
            "La tabla se actualiza sola cuando alguien carga una compra o una orden de pago de este proveedor.",
          ],
          related: ["ajustar-saldo-proveedor", "aging-de-proveedores"],
          keywords: [
            "cuenta corriente",
            "resumen de cuenta",
            "saldo proveedor",
            "cuánto le debemos",
            "extracto",
          ],
        },
        {
          id: "ajustar-saldo-proveedor",
          title: "Ajustar el saldo de un proveedor (saldo de apertura)",
          summary:
            "Fija la deuda real con el proveedor a una fecha de corte, por ejemplo al empezar a usar el sistema con facturas viejas a medio pagar.",
          permission: "opening_balances:write",
          prerequisites: [
            "Ser owner: los demás ven el botón deshabilitado con el aviso «Solo el owner puede tocar el ajuste de saldo.».",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Ajustar saldo",
              description:
                "Fijá la deuda real con el proveedor a una fecha. El sistema reconcilia el saldo al valor ingresado e imputa FIFO contra las facturas anteriores. Editable: re-correr sobrescribe.",
              fields: [
                {
                  label: "Fecha de corte",
                  kind: "date",
                  value: "31/12/2025",
                  marker: 2,
                },
                {
                  label: "Saldo real al corte ($)",
                  kind: "money",
                  value: "1.250.000,00",
                  marker: 3,
                },
                { label: "Notas (opcional)", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Registrar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la ficha del proveedor, pestaña {{Cuenta corriente}}, hacé clic en {{Ajustar saldo}}.",
            "En {{Fecha de corte}}, elegí la fecha a la que conocés la deuda real.",
            "En {{Saldo real al corte ($)}}, escribí cuánto le debían a esa fecha, en pesos (0 si no le debían nada; no puede ser negativo). Opcional: {{Notas (opcional)}}.",
            "Hacé clic en {{Registrar}} (si ya había un ajuste, el botón dice {{Actualizar}} y el recuadro {{Registrado actualmente}} muestra el anterior).",
          ],
          after: [
            "El sistema calcula lo que figura abierto hasta la fecha de corte (facturas y notas de débito en pesos menos notas de crédito y órdenes de pago emitidas) y, si es más que el saldo que ingresaste, da por pagada la diferencia, empezando por las facturas más viejas. Esas facturas bajan en el aging y en la cuenta corriente. Si el saldo ingresado es igual o mayor que lo abierto, no da nada por pagado: el ajuste no agrega deuda.",
            "En la cuenta corriente aparece una fila {{Ajuste de saldo}}, con un lápiz ({{Editar ajuste de saldo}}) y un tacho ({{Borrar ajuste de saldo}}) que solo puede usar el owner.",
            "Volver a registrarlo reemplaza el ajuste anterior y lo recalcula.",
          ],
          errors: [
            {
              message: "Ingresá un saldo válido (no negativo).",
              fix: "Escribí un importe de 0 o más.",
            },
            {
              message: "Ingresá la fecha de corte.",
              fix: "Elegí la fecha en {{Fecha de corte}}.",
            },
            {
              message: "Solo el owner puede ajustar saldos de proveedor.",
              fix: "Pedile el ajuste al owner.",
            },
          ],
          related: ["borrar-ajuste-saldo-proveedor"],
          keywords: [
            "saldo inicial",
            "saldo de apertura",
            "migración",
            "deuda anterior",
          ],
        },
        {
          id: "borrar-ajuste-saldo-proveedor",
          title: "Borrar el ajuste de saldo de un proveedor",
          permission: "opening_balances:write",
          prerequisites: ["Ser owner."],
          steps: [
            {
              text: "Abrí el borrado de una de estas formas:",
              substeps: [
                "En la cuenta corriente, en la fila {{Ajuste de saldo}}, hacé clic en el tacho ({{Borrar ajuste de saldo}}) y confirmá con {{Borrar}} en «¿Borrar el ajuste de saldo?».",
                "En el diálogo {{Ajustar saldo}} de un proveedor que ya tiene ajuste, hacé clic en {{Borrar}} (abajo a la izquierda) y confirmá.",
              ],
            },
          ],
          after: [
            "Aviso «Ajuste de saldo eliminado.». Las facturas que el ajuste daba por pagadas vuelven a figurar abiertas; el saldo vuelve al calculado por el sistema.",
          ],
          errors: [
            {
              message: "Solo el owner puede borrar el ajuste de saldo.",
              fix: "Pedíselo al owner.",
            },
          ],
          related: ["ajustar-saldo-proveedor"],
        },
        {
          id: "adjuntar-archivos-proveedor",
          title: "Adjuntar archivos a un proveedor",
          summary:
            "Constancia de inscripción, contratos y otros documentos del proveedor.",
          permission: attachmentPermission("supplier"),
          steps: [
            "En la ficha del proveedor, abrí la pestaña {{Adjuntos}}.",
            "En {{Tipo:}}, elegí {{Constancia de inscripción}}, {{Contrato}} u {{Otro}}.",
            "Arrastrá el archivo al recuadro o hacé clic para elegirlo del dispositivo.",
            "Para ver un adjunto, hacé clic en el ojo ({{Ver adjunto}}); para borrarlo, en el tacho ({{Borrar adjunto}}) y confirmá con {{Borrar}}.",
          ],
          after: [
            "Aviso «… adjuntado.» con el nombre del archivo. El adjunto queda también en [[/files]].",
            "Sin los permisos, la pestaña muestra los adjuntos pero no deja subir ni borrar.",
          ],
          errors: [
            {
              message: "Sin permiso para atachar a esa entidad.",
              fix: "Hace falta poder editar proveedores además de subir archivos.",
            },
          ],
          keywords: ["constancia", "contrato", "documentos del proveedor"],
        },
        {
          id: "exportar-proveedores",
          title: "Exportar la lista de proveedores",
          permission: "suppliers:read",
          steps: [
            "En [[/suppliers]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}} y hacé clic en {{Descargar período}} o {{Todo el historial}}.",
          ],
          after: [
            "Se descarga la lista del lado donde estás, con razón social, CUIT, condición IVA, categoría y estado. El rango de fechas filtra por la fecha de alta del proveedor.",
          ],
          keywords: ["listado de proveedores", "excel", "pdf"],
        },
      ],
    },

    // ── Categorías ────────────────────────────────────────────────────────
    {
      id: "categorias-de-proveedores",
      title: "Categorías de proveedores",
      menuPath: "Compras › Categorías",
      routes: ["/suppliers/categories", "/suppliers/categories/[id]"],
      permission: "suppliers:read",
      intro: [
        "Las categorías clasifican a los proveedores (por ejemplo Combustible, Repuestos, Peajes) para filtrar la lista de proveedores. Son las mismas en Compras y en Otras compras.",
        "Columnas: {{Nombre}} y {{Estado}} ({{Activa}} o {{Inactiva}}). Cada fila tiene el menú {{Acciones}} con {{Editar}} y {{Borrar}}. {{Exportar}} descarga la lista.",
        "Al hacer clic en el nombre de una categoría se abre su página: cuánto se le compró a sus proveedores en un período (ver [[#ver-gasto-de-categoria]]).",
      ],
      tasks: [
        {
          id: "ver-gasto-de-categoria",
          title: "Ver cuánto se gastó en una categoría",
          summary:
            "La página de una categoría suma las compras a sus proveedores en el lado que estás viendo: en Compras, las facturas recibidas; en Otras compras, los remitos internos.",
          permission: ["suppliers:read", "purchase_invoices:read"],
          prerequisites: [
            "Sin `purchase_invoices:read` la página abre igual, pero sin montos: muestra «No tenés permiso para ver compras: los montos de esta categoría no se muestran.».",
          ],
          screens: [
            {
              kind: "page",
              title: "~Combustible",
              subtitle:
                "Compras (facturas recibidas) a proveedores de esta categoría.",
              stats: [
                { label: "Total gastado", value: "$ 4.820.300,00" },
                { label: "Compras", value: "37" },
                { label: "Proveedores", value: "3" },
              ],
              table: {
                columns: ["Mes", "Compras", "Neto"],
                rows: [
                  ["~oct 2026", "~12", "~$ 1.610.000,00"],
                  ["~sep 2026", "~11", "~$ 1.402.500,00"],
                ],
              },
            },
          ],
          steps: [
            "En [[/suppliers/categories]], hacé clic en el nombre de la categoría.",
            "Elegí el período arriba a la derecha: arranca en {{Este año}}.",
            {
              text: "Leé los indicadores y las tablas:",
              substeps: [
                "{{Total gastado}}: neto sin IVA en pesos; las notas de crédito restan.",
                "{{Compras}}: comprobantes recibidos, NC y ND incluidas. {{Proveedores}}: los que tienen compras en el período.",
                "{{Por mes}} y {{Por proveedor}} (con link a cada proveedor), con cantidad de compras y neto.",
                "{{Últimas compras}}: las 20 más recientes del período, con link a cada una.",
              ],
            },
          ],
          after: [
            "Si el período tiene demasiados proveedores, {{Por proveedor}} avisa que la lista está incompleta y {{Proveedores}} muestra «≥»: elegí un período más corto.",
          ],
          errors: [
            {
              message: "No se pudieron leer los gastos de la categoría.",
              fix: "Hacé clic en reintentar; si sigue, recargá la página.",
            },
            {
              message: "No se pudieron leer las compras de la categoría.",
              fix: "Hacé clic en reintentar; si sigue, recargá la página.",
            },
          ],
          keywords: [
            "gasto por rubro",
            "cuánto gastamos",
            "categoría",
            "rubro",
          ],
        },
        {
          id: "crear-categoria-proveedor",
          title: "Crear una categoría de proveedores",
          permission: "suppliers:write",
          screens: [
            {
              kind: "dialog",
              title: "Nueva categoría",
              description:
                "Agregá una categoría para clasificar proveedores y gastos.",
              fields: [
                {
                  label: "Nombre",
                  kind: "input",
                  value: "Combustible",
                  marker: 2,
                },
                { label: "Activa", kind: "switch", value: "sí" },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/suppliers/categories]], hacé clic en {{Nueva categoría}}.",
            "Escribí el {{Nombre}} (hasta 60 caracteres).",
            "Dejá {{Activa}} encendido y hacé clic en {{Crear}}.",
          ],
          after: [
            "Aviso «Categoría creada.». La categoría aparece en el selector {{Categoría}} del formulario de proveedor.",
            "También se puede crear desde el formulario del proveedor: {{Nueva categoría}} al final del selector {{Categoría}}.",
          ],
          errors: [
            { message: "Ingresá un nombre.", fix: "Escribí el nombre." },
            { message: "Máximo 60 caracteres.", fix: "Acortá el nombre." },
            {
              message: 'Ya existe la categoría "…".',
              fix: "Usá la categoría existente (el nombre se compara sin mayúsculas).",
            },
            {
              message: "Ya existe una categoría con ese nombre.",
              fix: "Elegí otro nombre.",
            },
            {
              message: "No tenés permiso para crear categorías.",
              fix: "Pedíselo a alguien con permiso para editar proveedores.",
            },
          ],
          related: ["editar-categoria-proveedor"],
          keywords: ["rubro", "clasificar proveedores"],
        },
        {
          id: "editar-categoria-proveedor",
          title: "Editar o desactivar una categoría",
          permission: "suppliers:write",
          steps: [
            "En la fila de la categoría, abrí el menú {{Acciones}} y elegí {{Editar}}.",
            "Cambiá {{Nombre}}, o apagá {{Activa}} para que deje de ofrecerse al elegir categoría en un proveedor.",
            "Hacé clic en {{Guardar cambios}}.",
          ],
          after: [
            "Aviso «Cambios guardados.». Los proveedores que ya la tenían la conservan aunque esté inactiva.",
          ],
          errors: [
            {
              message: 'Ya existe la categoría "…".',
              fix: "Elegí otro nombre.",
            },
            {
              message: "No tenés permiso para editar categorías.",
              fix: "Pedíselo a alguien con permiso para editar proveedores.",
            },
          ],
        },
        {
          id: "borrar-categoria-proveedor",
          title: "Borrar una categoría",
          permission: "suppliers:write",
          steps: [
            "En la fila de la categoría, abrí el menú {{Acciones}} y elegí {{Borrar}}.",
            "En «¿Borrar categoría?», hacé clic en {{Borrar}}.",
          ],
          after: ["Aviso «Categoría borrada.»."],
          errors: [
            {
              message:
                "No se puede borrar: hay … proveedor(es) en esta categoría. Reasignalos primero o desactivá la categoría.",
              fix: "Cambiá la categoría de esos proveedores o, si preferís conservarla, desactivala desde {{Editar}}.",
            },
            {
              message: "La categoría está en uso, no se puede borrar.",
              fix: "Desactivala en lugar de borrarla.",
            },
            {
              message: "No tenés permiso para borrar categorías.",
              fix: "Pedíselo a alguien con permiso para editar proveedores.",
            },
          ],
        },
      ],
    },

    // ── Facturas de compra y remitos ──────────────────────────────────────
    {
      id: "facturas-de-compra",
      title: "Facturas de compra y remitos de compra",
      menuPath: "Compras › Compras (y Otras compras › Remitos de compra)",
      routes: ["/purchases", "/purchases/[id]"],
      permission: "purchase_invoices:read",
      intro: [
        "Del lado fiscal, la pantalla se llama {{Facturas de compra}}: facturas, notas de crédito y notas de débito que te mandan los proveedores de Compras, con su IVA, percepciones, cuenta de gasto y centro de costo. Del lado interno se llama {{Remitos internos de compra}}: compras a proveedores de Otras compras sin factura, que no van al Libro IVA.",
        "Columnas: {{Comprobante}} (tipo y número), {{Proveedor}}, {{Tipo}} ({{Fiscal}} o {{Interno}}), {{Fecha}}, {{Total}}, {{Estado}} ({{Recibida}} o {{Anulada}}) y {{Acciones}}. Arriba podés buscar por proveedor, CUIT o número, filtrar por fechas y por estado ({{Cualquier estado}}).",
        "Del lado fiscal, quien puede cargar compras ve además el botón {{Recibidos de ARCA}}, con la cantidad de comprobantes pendientes: ver [[/purchases/arca]].",
        "El detalle de una compra muestra el proveedor (con CAE, vencimiento del CAE y vencimiento de pago), los {{Totales}} ({{Neto}}, no gravado, exento, {{IVA}}, {{Otros tributos}} y su reparto, {{Total}}, {{Pagado}}, {{Acreditado}} y {{Saldo}}), los {{Ítems}} (o {{Sin detalle (cargada solo por totales)}}), el motivo si es NC/ND, las {{Órdenes de pago imputadas}}, los {{Remitos internos imputados}}, las notas y los adjuntos.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Compras › Compras",
          title: "Facturas de compra",
          subtitle:
            "Facturas, notas de crédito y débito recibidas de proveedores de Compras.",
          actions: [
            { label: "Recibidos de ARCA", variant: "outline" },
            { label: "Exportar", variant: "outline" },
            { label: "Cargar factura", variant: "primary" },
          ],
          toolbar: [
            { label: "Buscar por proveedor, CUIT o número", kind: "input" },
            { label: "Todas las fechas", kind: "select" },
            { label: "Cualquier estado", kind: "select" },
          ],
          table: {
            columns: [
              "Comprobante",
              "Proveedor",
              "Tipo",
              "Fecha",
              "Total",
              "Estado",
              "Acciones",
            ],
            rows: [
              [
                "~Factura A00002-00001234",
                "~Transportes del Sur S.A.",
                "~Fiscal",
                "~20/10/2026",
                "~$800.000,00",
                "~Recibida",
                "~👁 ✎ 🏷 ⊘",
              ],
              [
                "~Nota de Crédito NC00002-00000045",
                "~Transportes del Sur S.A.",
                "~Fiscal",
                "~25/10/2026",
                "~$50.000,00",
                "~Recibida",
                "~👁 ✎ 🏷 ⊘",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Estados de una compra",
          body: [
            "{{Recibida}}: cargada y vigente. Cuenta en la cuenta corriente, en el aging y (si es fiscal) en el Libro IVA Compras y la contabilidad. Solo una compra recibida se puede editar, recategorizar o anular.",
            "{{Anulada}}: ya no cuenta para saldos ni aging; su asiento se revierte. En la lista se ve atenuada y sin los botones de editar, recategorizar ni anular.",
          ],
        },
        {
          title: "Cómo se arma el total",
          body: [
            "El total tiene que ser exactamente neto + IVA + otros tributos + no gravado + exento. Si no da, el formulario muestra la diferencia, no deja guardar y ofrece {{Pasar la diferencia a No gravado}} (en una factura A) o {{Sumar la diferencia al neto}}.",
            "**Factura A**: el IVA se discrimina; el no gravado y el exento van en sus campos ({{No gravado}} y {{Exento}}, que solo aparecen en una A fiscal).",
            "**Facturas B y C**: el IVA, el exento y el no gravado van dentro del neto. El IVA se carga en 0 y, si hay ítems, con {{Sin alícuota}}.",
            "**Con detalle por ítem** ({{Cargar con detalle por ítem}}): el neto, el IVA y el total se calculan de las líneas (marcados «(auto)») y el Libro IVA Compras discrimina el IVA por alícuota. Sin detalle, se cargan solo los totales.",
          ],
        },
        {
          title: "Otros tributos: percepciones e impuestos",
          body: [
            "En una compra fiscal, si cargás {{Otros tributos}} aparece **Otros tributos: cómo se reparten**: {{Percepción IVA}}, {{Percepción Ganancias y otros nacionales}}, {{Percepción IIBB}}, {{Municipales}} e {{Impuestos internos}}. La suma tiene que dar exactamente el total de otros tributos; mientras no da, el formulario dice cuánto falta repartir o cuánto te pasaste.",
            "En la contabilidad, las percepciones de IVA, IIBB y Ganancias van a sus cuentas de crédito; los municipales y los impuestos internos se suman al gasto.",
          ],
        },
        {
          title: "Cuenta de gasto y centro de costo",
          body: [
            "La {{Cuenta de gasto}} es la cuenta contable a la que va el neto; si no elegís ninguna ({{Sin cuenta (Compras)}}) va a la cuenta Compras. El {{Centro de costo}} reparte el gasto por unidad (por ejemplo, un camión).",
            "Una nota de crédito o débito sin cuenta ni centro propios toma los de su factura de origen, y los sigue si después la factura se recategoriza.",
            "Una compra {{A cargo de empleado}} manda el neto a la cuenta del empleado (lo que el empleado le debe a la empresa) en lugar de a una cuenta de gasto.",
          ],
        },
        {
          title: "Remitos de compra (Otras compras)",
          body: [
            "Del lado interno no hay letra, CAE, no gravado, exento ni reparto de tributos. El número se propone solo: el siguiente de ese proveedor, tipo y punto de venta.",
            "Un remito se paga con una orden de pago interna y no genera asiento. Si más adelante el proveedor factura lo que entregó con remitos, la factura fiscal puede absorberlos: ver [[#imputar-remitos-internos]].",
          ],
        },
      ],
      tasks: [
        {
          id: "cargar-factura-de-compra",
          title: "Cargar una factura de compra",
          summary:
            "Del lado fiscal, cargás la factura que te mandó el proveedor. Si el proveedor la informó a ARCA, también podés aceptarla desde [[/purchases/arca]] sin tipear los importes.",
          permission: "purchase_invoices:write",
          prerequisites: [
            "El proveedor creado en el mismo lado ([[#crear-proveedor]]); si no existe, lo podés crear desde el formulario con {{Nuevo}}.",
            "Un canal activo del lado donde estás.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Cargar factura de compra",
              description:
                "Cargá los datos de la factura que te envió el proveedor o completalos desde el PDF o una foto. Para nota de crédito o débito elegí el tipo correspondiente.",
              fields: [
                {
                  label: "Proveedor",
                  kind: "picker",
                  value: "Transportes del Sur S.A.",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve fiscal · fiscal",
                  marker: 3,
                },
                { label: "Tipo", kind: "select", value: "Factura", marker: 3 },
                { label: "Letra", kind: "select", value: "A", marker: 4 },
                {
                  label: "Punto de venta",
                  kind: "input",
                  value: "2",
                  marker: 4,
                },
                { label: "Número", kind: "input", value: "1234", marker: 4 },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "20/10/2026",
                  marker: 5,
                },
                {
                  label: "Vencimiento de pago",
                  kind: "date",
                  value: "19/11/2026",
                  marker: 5,
                },
                {
                  label: "Cargar con detalle por ítem",
                  kind: "checkbox",
                  marker: 6,
                  wide: true,
                },
                {
                  label: "Neto",
                  kind: "money",
                  value: "650.000,00",
                  marker: 7,
                },
                { label: "IVA", kind: "money", value: "136.500,00", marker: 7 },
                {
                  label: "Otros tributos",
                  kind: "money",
                  value: "13.500,00",
                  marker: 7,
                },
                {
                  label: "Total",
                  kind: "money",
                  value: "800.000,00",
                  marker: 7,
                },
                {
                  label: "Cuenta de gasto",
                  kind: "select",
                  value: "Sin cuenta (Compras)",
                  marker: 9,
                },
                { label: "Centro de costo", kind: "select", marker: 9 },
                {
                  label: "Moneda",
                  kind: "select",
                  value: "ARS — Peso",
                  marker: 10,
                },
                {
                  label: "CAE proveedor (opcional)",
                  kind: "input",
                  marker: 11,
                },
                { label: "Vto. CAE proveedor", kind: "date", marker: 11 },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Cargar factura", variant: "primary", marker: 12 },
              ],
            },
          ],
          steps: [
            "En [[/purchases]] (bloque Compras), hacé clic en {{Cargar factura}}. También podés hacerlo desde la ficha del proveedor con {{Nueva factura}}.",
            "En {{Proveedor}}, buscá por razón social, nombre fantasía o CUIT y elegilo. Si tiene valores para compras nuevas, el sistema propone el canal, el vencimiento de pago, la cuenta de gasto y el centro de costo.",
            "Revisá el {{Canal}} y dejá {{Tipo}} en {{Factura}}.",
            {
              text: "Completá {{Letra}} ({{A}}, {{B}} o {{C}}), {{Punto de venta}} y {{Número}} tal como figuran en la factura.",
              substeps: [
                "Si ya cargaste un comprobante con ese número para el proveedor, el formulario avisa «Ya cargaste … de este proveedor» con un enlace, para que no la cargues dos veces.",
              ],
            },
            "Elegí la {{Fecha}} de la factura y el {{Vencimiento de pago}} (el aging cuenta los días desde este vencimiento).",
            {
              text: "Elegí cómo cargar los importes:",
              substeps: [
                "**Solo totales** (recomendado si no necesitás el detalle): dejá {{Cargar con detalle por ítem}} apagado.",
                "**Con detalle**: tildá {{Cargar con detalle por ítem}} y cargá una línea por concepto: descripción, cantidad, precio unitario y alícuota de IVA ({{0%}}, {{2.5%}}, {{5%}}, {{10.5%}}, {{21%}}, {{27%}} o {{Sin alícuota}}). {{Agregar ítem}} suma una línea; el tacho ({{Eliminar ítem}}) la quita.",
              ],
            },
            {
              text: "Cargá los importes de la factura.",
              substeps: [
                "{{Neto}} e {{IVA}} (con detalle se calculan solos).",
                "{{Otros tributos}}: el total de percepciones e impuestos; después repartilo en **Otros tributos: cómo se reparten** (ver los conceptos de arriba).",
                "En una factura A: {{No gravado}} y {{Exento}} si los tiene.",
                "{{Total}}: se propone como la suma; tiene que coincidir con el de la factura.",
              ],
            },
            "Si aparece el aviso de diferencia, corregí los importes o usá {{Pasar la diferencia a No gravado}} / {{Sumar la diferencia al neto}}.",
            "Elegí la {{Cuenta de gasto}} y el {{Centro de costo}}. Si la compra la paga un empleado y la empresa se la cobra, elegilo en {{A cargo de empleado}} (si no, {{No (gasto de la empresa)}}).",
            "Si la factura es en dólares, elegí {{USD — Dólar}} en {{Moneda}} y cargá la {{Cotización}} (mayor a 1).",
            "Opcional: {{CAE proveedor (opcional)}}, {{Vto. CAE proveedor}} y {{Notas}}.",
            "Hacé clic en {{Cargar factura}}.",
          ],
          after: [
            "Aviso «Factura cargada.». La compra queda {{Recibida}}, aparece en la cuenta corriente del proveedor, en el aging y en el Libro IVA Compras del mes.",
            "Se genera el asiento: Proveedores al haber por el total; el neto a la cuenta de gasto (o Compras, o la cuenta del empleado), el IVA crédito fiscal y las percepciones al debe, con el centro de costo elegido. En dólares, se convierte a pesos con la cotización cargada.",
            "Si coincide con un comprobante pendiente en [[/purchases/arca]] (mismo proveedor, tipo, letra, número e importes), ese comprobante pasa solo a {{Cargadas}}.",
          ],
          errors: [
            {
              message: "Seleccioná un proveedor.",
              fix: "Elegí el proveedor en {{Proveedor}}.",
            },
            {
              message: "Una factura de compra fiscal lleva letra.",
              fix: "Elegí la letra en {{Letra}}.",
            },
            {
              message:
                "Los importes no suman el total: neto + IVA + otros tributos + no gravado + exento tienen que dar el total del comprobante.",
              fix: "Corregí los importes o usá el botón que pasa la diferencia a no gravado o al neto.",
            },
            {
              message:
                "En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto: cargá el IVA en 0 y, si hay ítems, con «Sin alícuota».",
              fix: "Sumá el IVA al neto, dejá el IVA en 0 y, con ítems, elegí {{Sin alícuota}}.",
            },
            {
              message:
                "Con exento o no gravado en el encabezado, los ítems deben tener alícuota.",
              fix: "Elegí la alícuota de cada ítem, o pasá el exento o no gravado a una línea.",
            },
            {
              message: "Falta repartir ….",
              fix: "Completá el reparto de otros tributos hasta llegar al total.",
            },
            {
              message: "Te pasaste por ….",
              fix: "Bajá alguno de los importes del reparto de otros tributos.",
            },
            {
              message:
                "Los ítems no dan el total del comprobante: revisalos o confirmá que son correctos.",
              fix: "Revisá las líneas contra la factura o tildá {{Los ítems son correctos, guardar igual}}.",
            },
            {
              message:
                "Cargá la cotización del dólar (tiene que ser mayor a 1).",
              fix: "Escribí la cotización en {{Cotización}}.",
            },
            {
              message:
                "Ya cargaste esta factura del proveedor (mismo tipo / letra / PV / número).",
              fix: "Buscala en la lista: ya está cargada.",
            },
            {
              message: "Punto de venta requerido.",
              fix: "Escribí el punto de venta de la factura.",
            },
            {
              message: "Número requerido.",
              fix: "Escribí el número de la factura.",
            },
            {
              message:
                "La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa",
              fix: "Elegí otra cuenta de gasto.",
            },
            {
              message: "No tenés permiso para cargar una compra a un empleado.",
              fix: "Dejá {{A cargo de empleado}} en {{No (gasto de la empresa)}} o pedíselo a alguien de RRHH.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto o pedí que reabran el período ([[#periodos-cerrados]]).",
            },
            {
              message: "Factura cargada pero no se pudieron guardar los ítems.",
              fix: "La factura quedó cargada con los totales: editala y volvé a cargar las líneas.",
            },
            {
              message: "No tenés permiso para cargar facturas de compra.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: [
            "cargar-factura-desde-archivo",
            "cargar-nota-de-credito-o-debito-de-compra",
            "aceptar-comprobante-de-arca",
            "pagar-factura-de-compra",
          ],
          keywords: [
            "factura de proveedor",
            "cargar compra",
            "IVA compras",
            "percepciones",
            "gasto",
          ],
        },
        {
          id: "cargar-factura-desde-archivo",
          title: "Cargar una factura de compra desde el PDF o una foto",
          summary:
            "La IA lee el archivo, completa el formulario y deja el archivo adjunto a la factura.",
          permission: ["purchase_invoices:write", "files:write", "ai:read"],
          screens: [
            {
              kind: "dialog",
              title: "Cargar factura de compra",
              description:
                "Datos leídos de factura.pdf. Revisalos y corregí lo que haga falta; el archivo queda adjunto a la factura.",
              fields: [
                {
                  label: "Completar desde archivo",
                  kind: "input",
                  value: "factura.pdf",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Proveedor",
                  kind: "picker",
                  value: "Transportes del Sur S.A. ✦",
                  marker: 4,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Cargar factura", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/purchases]], hacé clic en {{Cargar factura}}. (Desde la ficha del proveedor, {{Nueva factura}} no ofrece completar desde archivo.)",
            "En el recuadro {{Completar desde archivo}}, arrastrá el PDF o la foto de la factura, o hacé clic para elegirlo.",
            "Esperá los tres pasos: {{Subiendo el archivo}}, {{Leyendo la factura con IA}} y {{Completando el formulario}}. Se abre el formulario completo, con el archivo a la izquierda (en pantallas grandes).",
            {
              text: "Revisá cada dato contra el archivo. Los campos que completó la IA tienen un ícono hasta que los tocás.",
              substeps: [
                "Si el proveedor no está cargado, aparece «El proveedor del comprobante todavía no está cargado.» con un botón para crearlo con su CUIT y razón social.",
                "Las advertencias de la lectura aparecen arriba del formulario.",
              ],
            },
            "Hacé clic en {{Cargar factura}}.",
          ],
          after: [
            "Aviso «Factura cargada con el archivo adjunto.». La factura queda como en [[#cargar-factura-de-compra]] y el archivo, en sus adjuntos.",
            "Si la lectura tarda, podés cerrar y seguir desde [[/documentos]] cuando esté listo.",
          ],
          errors: [
            {
              message: "El archivo no parece una factura de compra.",
              fix: "Probá con otro archivo ({{Probar con otro archivo}}) o cargala a mano.",
            },
            {
              message:
                "No se pudo leer el archivo. Cargá la factura a mano o probá con otra foto.",
              fix: "Sacá una foto más nítida o cargá los datos a mano.",
            },
            {
              message:
                "Está tardando más de lo normal. Podés cerrar y seguir desde Documentos cuando esté listo.",
              fix: "Hacé clic en {{Seguir esperando}} o retomala desde [[/documentos]].",
            },
          ],
          related: ["cargar-factura-de-compra"],
          keywords: ["escanear factura", "foto", "OCR", "IA", "leer PDF"],
        },
        {
          id: "cargar-nota-de-credito-o-debito-de-compra",
          title: "Cargar una nota de crédito o débito de un proveedor",
          permission: "purchase_invoices:write",
          prerequisites: [
            "La factura de origen cargada y recibida, del mismo proveedor y canal ([[#cargar-factura-de-compra]]).",
          ],
          steps: [
            "En [[/purchases]], hacé clic en {{Cargar factura}} y elegí el {{Proveedor}} y el {{Canal}}.",
            "En {{Tipo}}, elegí {{Nota de Crédito}} o {{Nota de Débito}}.",
            "Completá letra, punto de venta, número, fecha e importes como en una factura.",
            "En {{Factura origen}}, buscá la factura por número y elegila; en {{Motivo}}, explicá la razón (por ejemplo, «ajuste por devolución»).",
            "Al elegir la factura de origen, la nota toma su {{Moneda}} y su cotización, y la {{Moneda}} queda bloqueada: una NC/ND va en la misma moneda que su factura. Si la nota viene de ARCA, conserva la suya.",
            "Dejá {{Cuenta de gasto}} en {{La del comprobante de origen}} y {{Centro de costo}} en {{El del comprobante de origen}} para que tome los de la factura, o elegí otros.",
            "Hacé clic en {{Cargar factura}}.",
          ],
          after: [
            "Una nota de crédito baja lo que se le debe al proveedor y descuenta el saldo de la factura de origen; una nota de débito suma deuda y se paga como una factura.",
            "Su asiento es el de la factura, al revés en el caso de la nota de crédito.",
          ],
          errors: [
            {
              message: "El motivo es requerido para NC/ND.",
              fix: "Escribí el motivo.",
            },
            {
              message:
                "Elegí el comprobante de origen de la nota de crédito o débito.",
              fix: "Elegí la factura en {{Factura origen}}.",
            },
            {
              message: "La factura de origen es de otro proveedor",
              fix: "Elegí una factura del mismo proveedor.",
            },
            {
              message:
                "La factura de origen es de otro canal: una NC/ND va en el mismo canal que su factura",
              fix: "Cambiá el canal al de la factura de origen.",
            },
            {
              message:
                "La factura de origen está en otra moneda: una NC/ND va en la misma moneda que su factura",
              fix: "Cargá la nota en la moneda de la factura de origen (pasa con notas traídas de ARCA, que conservan su moneda).",
            },
            {
              message:
                "La edición deja un comprobante con más pagado o acreditado que su total",
              fix: "La nota de crédito supera lo que queda abierto de la factura (al cargarla o al editarla): revisá el importe.",
            },
          ],
          related: ["cargar-factura-de-compra"],
          keywords: [
            "NC",
            "ND",
            "nota de crédito proveedor",
            "devolución",
            "bonificación",
          ],
        },
        {
          id: "cargar-remito-de-compra",
          title: "Cargar un remito de compra (Otras compras)",
          permission: "purchase_invoices:write",
          prerequisites: [
            "Estar en **Otras compras › Remitos de compra** y tener el proveedor creado en Otras compras.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Cargar factura de compra",
              caption: "Otras compras › Remitos de compra",
              fields: [
                {
                  label: "Proveedor",
                  kind: "picker",
                  value: "Gomería El Tano",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve interno · interno",
                },
                { label: "Tipo", kind: "select", value: "Factura" },
                {
                  label: "Punto de venta",
                  kind: "input",
                  value: "1",
                  marker: 3,
                },
                { label: "Número", kind: "input", value: "18", marker: 3 },
                { label: "Fecha", kind: "date", value: "02/11/2026" },
                {
                  label: "Neto",
                  kind: "money",
                  value: "120.000,00",
                  marker: 4,
                },
                {
                  label: "Total",
                  kind: "money",
                  value: "120.000,00",
                  marker: 4,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Cargar factura", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En **Otras compras › Remitos de compra**, hacé clic en {{Cargar remito}}.",
            "Elegí el {{Proveedor}}. El formulario muestra «Gasto interno.»: sin letra fiscal ni CAE.",
            "El {{Número}} se completa solo con el siguiente de ese proveedor (y el punto de venta en 1); cambialo solo si hace falta.",
            "Cargá la fecha, los importes, la cuenta de gasto y el centro de costo.",
            "Hacé clic en {{Cargar factura}}.",
          ],
          after: [
            "El remito queda {{Recibida}} con el tipo «Remito interno». No va al Libro IVA ni genera asiento. Se paga con una orden de pago desde **Otras compras**.",
          ],
          errors: [
            {
              message: "No se pudo sugerir el número: …",
              fix: "Escribí el número a mano.",
            },
            {
              message: "Seleccioná un proveedor.",
              fix: "Elegí el proveedor.",
            },
          ],
          related: ["imputar-remitos-internos", "emitir-orden-de-pago"],
          keywords: [
            "remito interno",
            "compra sin factura",
            "gasto interno",
            "otras compras",
          ],
        },
        {
          id: "editar-factura-de-compra",
          title: "Editar una factura o remito de compra",
          permission: "purchase_invoices:write",
          prerequisites: ["La compra en estado {{Recibida}}."],
          steps: [
            "En [[/purchases]], en la fila de la compra, hacé clic en el lápiz ({{Editar}}).",
            "Esperá a que cargue el desglose («Cargando el desglose de la factura…»): hasta entonces los importes no se pueden cambiar.",
            "Corregí lo que haga falta. Una factura vieja sin letra puede quedar con {{— Sin letra}}; las demás llevan letra.",
            "Hacé clic en {{Guardar cambios}}.",
          ],
          after: [
            "Aviso «Cambios guardados.». Si cambiaste importes, fecha, cuenta, centro o moneda, el asiento se rehace.",
            "Si cambiás la cuenta de gasto o el centro de costo de una factura, sus notas de crédito y débito que los heredaban los siguen.",
            "Si la compra estaba vinculada a un comprobante de ARCA y cambiás proveedor, tipo, letra, punto de venta o número de modo que ya no coincide, el comprobante vuelve a {{Pendientes}} en [[/purchases/arca]].",
          ],
          errors: [
            {
              message:
                "No se puede cambiar el canal de una factura de compra recibida: anulala y cargala en el canal correcto",
              fix: "Anulá la compra ([[#anular-factura-de-compra]]) y cargala de nuevo en el canal correcto.",
            },
            {
              message:
                "No se puede cambiar el tipo de una factura de compra que ya tiene imputaciones o notas de crédito",
              fix: "Anulá primero las órdenes de pago o notas que la usan.",
            },
            {
              message:
                "El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras",
              fix: "Solo podés cambiar notas y datos que no van al Libro IVA, o pedí que reabran el período ([[#periodos-cerrados]]).",
            },
            {
              message:
                "El período contable de la factura está cerrado: los ítems figuran en el Libro IVA Compras y no se pueden cambiar. No se guardó ningún cambio.",
              fix: "Pedí que reabran el período para cambiar los ítems.",
            },
            {
              message:
                "El período contable … está cerrado y una NC/ND de esta factura es de ese período: su cuenta de gasto y su centro de costo siguen a la factura. Pedí que lo reabran en Contabilidad para cambiarlos",
              fix: "Pedí que reabran el período de la nota de crédito o débito.",
            },
            {
              message:
                "Esta factura es origen de una NC/ND: no se le puede cambiar el canal ni el proveedor",
              fix: "Anulá primero la nota de crédito o débito.",
            },
            {
              message:
                "Esta factura es origen de una NC/ND: no se le puede cambiar la moneda",
              fix: "Sus notas de crédito o débito están en esa moneda: anulalas antes de cambiarla, o dejá la moneda como está.",
            },
            {
              message:
                "La edición deja un comprobante con más pagado o acreditado que su total",
              fix: "El nuevo total es menor que lo pagado o acreditado: revisá el importe o anulá antes el pago.",
            },
            {
              message:
                "Otra factura del proveedor ya usa esa combinación de número.",
              fix: "Revisá letra, punto de venta y número.",
            },
            {
              message:
                "Los ítems de la factura todavía no se leyeron: para cambiar importes, esperá a que carguen o reintentá la lectura.",
              fix: "Esperá o hacé clic en {{Reintentar}}.",
            },
            {
              message:
                "El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.",
              fix: "El remito ya está absorbido por una factura fiscal: corregí la factura.",
            },
            {
              message: "No tenés permiso para editar facturas de compra.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: ["recategorizar-compra", "anular-factura-de-compra"],
          keywords: ["corregir factura", "modificar compra"],
        },
        {
          id: "recategorizar-compra",
          title: "Recategorizar una compra (cuenta de gasto y centro de costo)",
          summary:
            "Cambia solo a qué cuenta y centro va el gasto; no toca importes ni fechas.",
          permission: "purchase_invoices:write",
          prerequisites: ["La compra en estado {{Recibida}}."],
          screens: [
            {
              kind: "dialog",
              title: "Recategorizar gasto",
              description: "A00002-00001234 · Transportes del Sur S.A.",
              fields: [
                {
                  label: "Cuenta de gasto",
                  kind: "select",
                  value: "Mantenimiento de unidades",
                  marker: 2,
                },
                {
                  label: "Centro de costo",
                  kind: "select",
                  value: "AB123CD",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Recategorizar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/purchases]], en la fila de la compra, hacé clic en la etiqueta ({{Recategorizar}}).",
            "Elegí la nueva {{Cuenta de gasto}} ({{Sin cuenta (Compras)}} para la cuenta Compras) y/o el nuevo {{Centro de costo}}.",
            "Hacé clic en {{Recategorizar}}.",
          ],
          after: [
            "Aviso «Gasto recategorizado.». El asiento se rehace con la nueva cuenta y centro.",
            "Las notas de crédito y débito vigentes de la factura que tenían la cuenta o el centro anteriores se recategorizan con ella.",
          ],
          errors: [
            {
              message:
                "El período contable … está cerrado: pedí que lo reabran en Contabilidad para recategorizar",
              fix: "Pedí que reabran el período ([[#periodos-cerrados]]).",
            },
            {
              message:
                "La compra está a cargo de un empleado: su neto va a la cuenta del empleado, no a una cuenta de gasto",
              fix: "Si no corresponde al empleado, editá la compra y sacá {{A cargo de empleado}}.",
            },
            {
              message:
                "La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa",
              fix: "Elegí otra cuenta.",
            },
            {
              message: "El centro de costo no existe o está inactivo",
              fix: "Elegí un centro activo.",
            },
            {
              message: "No tenés permiso para recategorizar ese gasto.",
              fix: "Hace falta poder cargar facturas de compra.",
            },
          ],
          related: ["editar-factura-de-compra"],
          keywords: [
            "rubro",
            "imputar gasto",
            "centro de costo",
            "cuenta contable",
          ],
        },
        {
          id: "anular-factura-de-compra",
          title: "Anular una factura o remito de compra",
          permission: "purchase_invoices:cancel",
          prerequisites: [
            "La compra en estado {{Recibida}}, sin órdenes de pago vigentes imputadas, sin notas de crédito o débito vigentes y sin saldo de apertura que la dé por pagada.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Anular factura",
              description: "Factura A00002-00001234 · Transportes del Sur S.A.",
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Anular", variant: "destructive", marker: 2 },
              ],
            },
          ],
          steps: [
            "En [[/purchases]], en la fila de la compra, hacé clic en {{Anular}} (el ícono de prohibido).",
            "Hacé clic en {{Anular}} para confirmar.",
          ],
          after: [
            "Aviso «Factura anulada.». La compra pasa a {{Anulada}}, deja de contar en la cuenta corriente y el aging y, si es fiscal, su asiento se revierte con un asiento inverso.",
            "En la lista ya no muestra los botones de editar, recategorizar ni anular.",
          ],
          errors: [
            {
              message:
                "La factura tiene órdenes de pago imputadas. Anulá esas órdenes antes de anularla.",
              fix: "Anulá las órdenes de pago que figuran en {{Órdenes de pago imputadas}} ([[#anular-orden-de-pago]]).",
            },
            {
              message:
                "La factura tiene notas de crédito o débito cargadas. Anulá esas notas antes de anularla.",
              fix: "Anulá primero las notas de crédito o débito de la factura.",
            },
            {
              message:
                "La factura está saldada por el saldo inicial del proveedor. Recalculá el saldo inicial antes de anularla.",
              fix: "Pedile al owner que vuelva a registrar o borre el ajuste de saldo ([[#ajustar-saldo-proveedor]]).",
            },
            {
              message:
                "El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras",
              fix: "Pedí que reabran el período ([[#periodos-cerrados]]).",
            },
            {
              message:
                "El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.",
              fix: "El remito está absorbido por una factura fiscal; no se anula por separado.",
            },
            {
              message:
                "Esta nota de crédito acredita un remito imputado a una factura de Compras: no se puede cambiar ni anular mientras la factura esté vigente.",
              fix: "Es la nota que generó la imputación de remitos: se mantiene mientras la factura fiscal esté vigente.",
            },
            {
              message:
                "La factura ya estaba anulada o no se encontró. Recargá la página.",
              fix: "Recargá la página: otra persona ya la anuló.",
            },
            {
              message: "No tenés permiso para anular facturas de compra.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: ["anular-orden-de-pago"],
          keywords: [
            "anular compra",
            "dar de baja factura",
            "cancelar factura proveedor",
          ],
        },
        {
          id: "pagar-factura-de-compra",
          title: "Pagar una factura desde su detalle",
          summary:
            "{{Pagar}} abre la orden de pago con la factura ya elegida por lo que falta pagar.",
          permission: [...PAYMENT_ORDER_FORM_PERMISSIONS],
          prerequisites: [
            "Poder ver las cuentas de Tesorería (`accounts:read`): cada línea de pago elige una cuenta y, sin ese permiso, el botón no aparece.",
            "Una factura o nota de débito {{Recibida}} con saldo pendiente.",
          ],
          steps: [
            "En [[/purchases]], abrí la factura (ojo, {{Ver detalle}}) y hacé clic en {{Pagar}}.",
            "En «Pagar a proveedor», agregá los medios de pago y revisá el importe a imputar a la factura (viene con el saldo pendiente).",
            "Hacé clic en {{Emitir orden de pago}}.",
          ],
          after: [
            "Se emite la orden de pago como en [[#emitir-orden-de-pago]], imputada a esta factura. En el detalle, {{Pagado}} y {{Saldo}} se actualizan y la orden aparece en {{Órdenes de pago imputadas}}.",
          ],
          related: ["emitir-orden-de-pago"],
          keywords: ["pagar factura", "orden de pago desde factura"],
        },
        {
          id: "imputar-remitos-internos",
          title: "Imputar remitos internos a una factura fiscal",
          summary:
            "Cuando un proveedor factura lo que antes entregó con remitos internos, la factura absorbe esos remitos para no contar la compra dos veces.",
          permission: ["purchase_invoices:write", "payment_orders:write"],
          prerequisites: [
            "Una factura fiscal (tipo Factura), en pesos y {{Recibida}}.",
            "Remitos internos recibidos del proveedor de Otras compras ([[#cargar-remito-de-compra]]).",
            "Un punto de venta habilitado para órdenes de pago en el canal fiscal.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Imputar remitos a A00002-00001234",
              description:
                "Cada remito de Otras compras que esta factura incluye se cancela con una nota de crédito interna, para no contar la compra dos veces. Si estaba pagado, la orden de pago interna se anula y el pago pasa a una orden de pago de Compras aplicada a esta factura.",
              fields: [
                {
                  label: "Proveedor de Otras compras",
                  kind: "picker",
                  value: "Gomería El Tano",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Remitos",
                  kind: "checkbox",
                  value: "X00001-00000018 · $120.000,00",
                  marker: 3,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Imputar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "Abrí la factura fiscal y hacé clic en {{Imputar remitos internos}}.",
            "En {{Proveedor de Otras compras}}, elegí el proveedor interno que entregó los remitos.",
            "Tildá los remitos que la factura incluye. Un remito que no se puede imputar aparece deshabilitado con el motivo. Abajo ves el total de los remitos, el pago que pasa y lo {{Disponible en la factura:}}.",
            "Hacé clic en {{Imputar}}.",
          ],
          after: [
            "Aviso «Remito imputado.» o «Remitos imputados.». Cada remito queda cancelado con una nota de crédito interna; en la factura aparecen en {{Remitos internos imputados}} y el remito muestra «Imputado a la factura …».",
            "Si un remito estaba pagado, su orden de pago interna se anula y el pago pasa a una orden de pago de Compras imputada a la factura. En el detalle del remito, los totales muestran lo {{Acreditado}}.",
            "Mientras la factura esté vigente, el remito no admite pagos, notas ni anulación.",
          ],
          errors: [
            {
              message:
                "Los remitos suman más que la factura: revisá cuáles imputar.",
              fix: "Destildá remitos hasta no superar lo disponible.",
            },
            {
              message: "Un remito ya está imputado a otra factura.",
              fix: "Actualizá y elegí otros remitos.",
            },
            {
              message:
                "El canal fiscal no tiene un punto de venta habilitado para órdenes de pago.",
              fix: "Pedile a un owner o admin que habilite uno en [[/admin/afip/puntos-de-venta]].",
            },
            {
              message: "No tenés permiso para imputar remitos a una factura.",
              fix: "Hace falta poder cargar compras y emitir órdenes de pago.",
            },
          ],
          related: ["cargar-remito-de-compra"],
          keywords: [
            "remitos",
            "facturar remitos",
            "absorber remitos",
            "nota de crédito interna",
          ],
        },
        {
          id: "adjuntar-archivos-compra",
          title: "Adjuntar archivos a una compra",
          permission: attachmentPermission("purchase_invoice"),
          steps: [
            "Abrí la compra y bajá hasta {{Adjuntos}}.",
            "En {{Tipo:}}, elegí {{Comprobante}}, {{Remito}} u {{Otro}}.",
            "Arrastrá el archivo al recuadro o hacé clic para elegirlo.",
          ],
          after: [
            "El adjunto queda en la compra y en [[/files]]. En una compra anulada ya no se pueden subir adjuntos (sí ver y borrar los que tiene).",
          ],
          errors: [
            {
              message: "Sin permiso para atachar a esa entidad.",
              fix: "Hace falta poder cargar facturas de compra además de subir archivos.",
            },
          ],
          keywords: [
            "adjuntar factura",
            "PDF de la factura",
            "remito escaneado",
          ],
        },
        {
          id: "exportar-compras",
          title: "Exportar las compras",
          permission: "purchase_invoices:read",
          steps: [
            "En [[/purchases]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}}, el rango de fechas y hacé clic en {{Descargar período}} (o {{Todo el historial}}).",
          ],
          after: [
            "Se descargan las compras del lado donde estás: fecha, comprobante, proveedor, canal, estado y total.",
          ],
          keywords: ["listado de compras", "excel compras"],
        },
      ],
    },

    // ── Recibidos de ARCA ─────────────────────────────────────────────────
    {
      id: "recibidos-de-arca",
      title: "Recibidos de ARCA",
      menuPath: "Compras › Compras › Recibidos de ARCA",
      routes: ["/purchases/arca"],
      permission: "purchase_invoices:write",
      intro: [
        "La bandeja con los comprobantes que tus proveedores informaron a ARCA (Mis Comprobantes › Recibidos). Cada uno se acepta para cargarlo como compra, o se descarta si no corresponde. Se llega con el botón {{Recibidos de ARCA}} de [[/purchases]], del lado fiscal.",
        "Arriba está el recuadro {{Traer de ARCA}} (estado de la conexión con ARCA y la última corrida) y el recuadro para subir el archivo de Mis Comprobantes. Debajo, cuatro pestañas: {{Pendientes}}, {{Cargadas}}, {{Descartadas}} y {{No soportados}}.",
        "Columnas: {{Fecha}}, {{Proveedor}} (con el CUIT; «proveedor nuevo» si todavía no está cargado), {{Comprobante}} y {{Total}}.",
      ],
      concepts: [
        {
          title: "Las pestañas",
          body: [
            "{{Pendientes}}: lo que falta revisar. Cada fila tiene {{Ver detalle}}, {{Aceptar y cargar}} y {{Descartar}}.",
            "{{Cargadas}}: ya están en Compras. {{Ver compra}} abre la compra; si la compra se anuló dice {{Anulada}}.",
            "{{Descartadas}}: las que se decidió no cargar; {{Volver a pendientes}} las recupera.",
            "{{No soportados}}: facturas de crédito MiPyME (FCE) y tipo M, que todavía se cargan a mano.",
          ],
        },
        {
          title: "Cómo llegan los comprobantes",
          body: [
            "Todos los días el sistema trae solo los comprobantes de los últimos 60 días, si hay un usuario de ARCA cargado (lo carga un owner o admin en [[/admin/afip/puntos-de-venta]]).",
            "Lo que ya está en la bandeja nunca se duplica. Si cargaste una compra a mano y coincide con un comprobante pendiente, el comprobante pasa solo a {{Cargadas}}.",
          ],
        },
        {
          title: "Cuando los importes de ARCA no suman el total",
          body: [
            "A veces ARCA informa un total mayor que neto + no gravado + exento + IVA + otros tributos: suelen ser percepciones que no detalló, o un comprobante con solo el total. Ese comprobante entra igual a la bandeja tal como lo informó ARCA, y en la columna {{Comprobante}} dice «Los importes de ARCA no suman el total (diferencia $ …)».",
            "Al aceptarlo elegís a dónde va la diferencia: ver [[#aceptar-comprobante-de-arca]]. Nada se completa solo.",
            "No se leen (el aviso los cuenta como «no se pudieron leer» y nombra los primeros) las filas con un importe ilegible, con importes que suman más que el total, o con un detalle por alícuota o de otros tributos que no coincide con su propio subtotal.",
          ],
        },
      ],
      tasks: [
        {
          id: "traer-recibidos-de-arca",
          title: "Traer comprobantes de ARCA de meses elegidos",
          permission: "purchase_invoices:write",
          prerequisites: [
            "El usuario de ARCA cargado y aceptado: si falta o ARCA rechazó la clave, el recuadro lo dice y el botón queda deshabilitado.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Traer de ARCA",
              description:
                "Trae los comprobantes recibidos de los meses que elijas (hasta 12). Lo que ya está en la bandeja no se duplica.",
              fields: [
                {
                  label: "Desde",
                  kind: "input",
                  value: "septiembre de 2026",
                  marker: 2,
                },
                {
                  label: "Hasta",
                  kind: "input",
                  value: "noviembre de 2026",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Traer", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/purchases/arca]], en el recuadro {{Traer de ARCA}}, hacé clic en {{Traer de ARCA}}.",
            "Elegí el mes {{Desde}} y el mes {{Hasta}} (hasta 12 meses, sin meses futuros).",
            "Hacé clic en {{Traer}}.",
          ],
          after: [
            "Aviso «Pedido a ARCA del … al …. Te aviso acá cuando termine.». Mientras corre, el botón dice {{Trayendo…}}.",
            "Al terminar, la bandeja se actualiza y un aviso dice cuántos comprobantes trajo.",
          ],
          errors: [
            {
              message: "Elegí hasta … meses por vez.",
              fix: "Achicá el período y pedí el resto en otra corrida.",
            },
            {
              message: "El mes desde tiene que ser anterior al mes hasta.",
              fix: "Invertí los meses.",
            },
            {
              message: "El período no puede ser futuro.",
              fix: "Elegí meses hasta el actual.",
            },
            {
              message:
                "Falta cargar el usuario de ARCA: lo carga un owner o admin en Admin → AFIP → Puntos de venta.",
              fix: "Pedile a un owner o admin que lo cargue.",
            },
            {
              message:
                "JouveERP dejó de entrar a ARCA con la clave guardada: un owner o admin tiene que volver a cargarla en Admin → AFIP → Puntos de venta.",
              fix: "Pedile a un owner o admin que actualice la clave.",
            },
            {
              message: "No se pudo pedir a ARCA. Probá de nuevo en un rato.",
              fix: "Reintentá más tarde.",
            },
          ],
          related: ["subir-archivo-mis-comprobantes"],
          keywords: [
            "mis comprobantes",
            "sincronizar ARCA",
            "AFIP recibidos",
            "traer facturas",
          ],
        },
        {
          id: "subir-archivo-mis-comprobantes",
          title: "Subir el archivo de Mis Comprobantes › Recibidos",
          summary:
            "Para cargar la bandeja a mano con el archivo que bajaste de ARCA.",
          permission: "purchase_invoices:write",
          steps: [
            "En ARCA, bajá el archivo de Mis Comprobantes › Recibidos (CSV, TXT o Excel, tal como lo baja ARCA).",
            "En [[/purchases/arca]], arrastrá el archivo al recuadro {{O subí el archivo de ARCA → Mis Comprobantes → Recibidos}} o hacé clic para elegirlo.",
          ],
          after: [
            "Un aviso resume el resultado: cuántos son nuevos (y de ellos cuántos ya estaban cargados como compra o no son soportados), cuántos ya estaban en la bandeja y cuántos no se pudieron leer.",
          ],
          errors: [
            {
              message: "El archivo supera los 4 MB.",
              fix: "Bajá de ARCA un período más corto y subilo en partes.",
            },
            {
              message:
                "No se pudo guardar todo el archivo. Volvé a subirlo: lo que ya entró no se duplica.",
              fix: "Subí de nuevo el mismo archivo.",
            },
          ],
          related: ["traer-recibidos-de-arca"],
        },
        {
          id: "aceptar-comprobante-de-arca",
          title: "Aceptar un comprobante de ARCA y cargarlo como compra",
          summary:
            "Los datos y los importes vienen de ARCA y no se cambian: vos elegís canal, cuenta, centro de costo y el reparto de otros tributos.",
          permission: "purchase_invoices:write",
          screens: [
            {
              kind: "dialog",
              caption:
                "En la computadora el diálogo tiene dos columnas: a la izquierda el comprobante tal como lo informó ARCA (proveedor, número, fecha, moneda, CAE e importes), a la derecha la imputación. En el celular van una debajo de la otra.",
              title: "Aceptar comprobante recibido de ARCA",
              description:
                "Los datos y los importes vienen de ARCA → Mis Comprobantes y no se pueden cambiar. Elegí canal, cuenta y centro de costo, y aceptalo.",
              fields: [
                {
                  label: "Proveedor",
                  kind: "picker",
                  value: "Transportes del Sur S.A.",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve fiscal · fiscal",
                  marker: 3,
                },
                {
                  label: "Vencimiento de pago",
                  kind: "date",
                  value: "19/11/2026",
                  marker: 3,
                },
                { label: "Cuenta de gasto", kind: "select", marker: 3 },
                { label: "Centro de costo", kind: "select", marker: 3 },
                {
                  label: "A cargo de empleado",
                  kind: "select",
                  value: "No (gasto de la empresa)",
                },
                {
                  label: "Percepción IIBB",
                  kind: "money",
                  value: "13.500,00",
                  marker: 3,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              table: {
                columns: [
                  "Comprobante",
                  "Neto",
                  "IVA",
                  "Otros tributos",
                  "Total",
                ],
                rows: [
                  [
                    "Factura A00012-00004521",
                    "100.000,00",
                    "21.000,00",
                    "13.500,00",
                    "134.500,00",
                  ],
                ],
              },
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Aceptar comprobante", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la pestaña {{Pendientes}}, opcional: hacé clic en el ojo ({{Ver detalle}}) para ver lo que informó ARCA (neto e IVA por alícuota, no gravado, exento, otros tributos, total y CAE). Después hacé clic en {{Aceptar y cargar}}.",
            "Revisá el recuadro **Comprobante**: proveedor, número, fecha, moneda, CAE e importes (neto, no gravado, exento, IVA, otros tributos y total) tal como los informó ARCA; no se pueden cambiar. Debajo dice con qué líneas por alícuota se guarda. Si el proveedor no está cargado, crealo desde el botón «Crear proveedor «…»» que aparece en {{Proveedor}}: tiene que ser el de ese CUIT.",
            {
              text: "En **Imputación**, completá lo que no viene de ARCA:",
              substeps: [
                "{{Canal}} y {{Vencimiento de pago}}: el vencimiento arranca en la fecha del comprobante, o con el plazo de pago del proveedor si lo tiene.",
                "{{Cuenta de gasto}}, {{Centro de costo}} y {{A cargo de empleado}}.",
                "Si los importes de ARCA no suman el total, el recuadro **Comprobante** muestra la {{Diferencia sin detallar}} y en **Imputación** aparece **Diferencia de $ …: va a**. Elegí {{Otros tributos (percepciones)}} (después la repartís entre los tributos, como cualquier percepción) o {{No gravado}} (en facturas B y C dice {{Neto}}, porque ahí todo va al neto). El IVA y el total quedan como los informó ARCA. Hasta que elijas, {{Aceptar comprobante}} queda deshabilitado y abajo dice «Elegí a dónde va la diferencia para aceptar el comprobante.».",
                "Si ARCA informa solo el total de otros tributos, repartilo en **Otros tributos: cómo se reparten**.",
                "Si es en dólares, revisá la {{Cotización}}; si es una nota de crédito o débito, elegí la {{Factura origen}}.",
                "{{Notas}}, si querés.",
              ],
            },
            "Hacé clic en {{Aceptar comprobante}}.",
          ],
          after: [
            "Aviso «Comprobante de ARCA cargado.»: se crea la compra como en [[#cargar-factura-de-compra]] y el comprobante pasa a {{Cargadas}}.",
            "Si mientras tanto alguien la había cargado a mano con los mismos datos, no se duplica: aviso «Ya estaba cargado: quedó vinculado.».",
          ],
          errors: [
            {
              message:
                "Los importes de ARCA no suman el total: elegí a dónde va la diferencia de … (…).",
              fix: "Elegí en **Diferencia de $ …: va a** dónde se carga y volvé a aceptar.",
            },
            {
              message: "Falta repartir ….",
              fix: "Si la diferencia va a otros tributos, repartila entera en **Otros tributos: cómo se reparten**.",
            },
            {
              message:
                "Ya hay una compra con este número y otro total (…): revisala antes de aceptar.",
              fix: "Abrí la compra existente y corregila, o descartá el comprobante si la compra es la correcta.",
            },
            {
              message: "Ya existe esta factura anulada en Compras.",
              fix: "La factura se cargó y se anuló: descartá el comprobante si corresponde.",
            },
            {
              message: "El proveedor tiene que ser el de CUIT ….",
              fix: "Elegí (o creá) el proveedor con el CUIT del comprobante.",
            },
            {
              message: "Un comprobante de ARCA va a un canal fiscal.",
              fix: "Elegí un canal fiscal.",
            },
            {
              message: "Este comprobante ya fue procesado.",
              fix: "Actualizá la página: otra persona ya lo aceptó o descartó.",
            },
            {
              message: "Otra persona lo está cargando; probá en unos minutos.",
              fix: "Esperá unos minutos y revisá si ya pasó a {{Cargadas}}.",
            },
          ],
          related: [
            "descartar-comprobante-de-arca",
            "cargar-factura-de-compra",
          ],
          keywords: [
            "aceptar ARCA",
            "mis comprobantes recibidos",
            "importar facturas de AFIP",
            "importes no suman el total",
            "diferencia ARCA",
          ],
        },
        {
          id: "descartar-comprobante-de-arca",
          title: "Descartar un comprobante de ARCA o volverlo a pendientes",
          permission: "purchase_invoices:write",
          steps: [
            "En la pestaña {{Pendientes}}, en la fila del comprobante, hacé clic en el tacho ({{Descartar}}) y confirmá con {{Descartar}}.",
            "Para recuperarlo, en la pestaña {{Descartadas}} hacé clic en {{Volver a pendientes}}.",
          ],
          after: [
            "Un comprobante descartado no se carga como compra y no vuelve a aparecer en {{Pendientes}} aunque se traiga de nuevo de ARCA.",
          ],
          errors: [
            {
              message: "Otra persona lo está cargando; probá en unos minutos.",
              fix: "Alguien lo está aceptando ahora: esperá y revisá en qué pestaña quedó.",
            },
            {
              message: "Este comprobante ya fue procesado.",
              fix: "Actualizá la página.",
            },
          ],
          related: ["aceptar-comprobante-de-arca"],
        },
      ],
    },

    // ── Órdenes de pago ───────────────────────────────────────────────────
    {
      id: "ordenes-de-pago",
      title: "Órdenes de pago",
      menuPath: "Compras › Órdenes de pago (y Otras compras › Órdenes de pago)",
      routes: ["/payment-orders", "/payment-orders/[id]"],
      permission: "payment_orders:read",
      intro: [
        "Una orden de pago (OP) registra un pago a un proveedor: de qué cuentas sale la plata (transferencia, efectivo, cheque propio o cheque de terceros endosado) y a qué facturas se imputa. Cada canal tiene su propia numeración: `OP0003-00000041`.",
        "Columnas: {{OP}} (tachada si está anulada), {{Proveedor}}, {{Fecha}}, {{Total}}, {{Estado}} ({{Emitida}} o {{Anulada}}) y {{Acciones}}. Arriba podés buscar por proveedor o número, filtrar por fechas y por estado.",
        "El detalle de una OP muestra el proveedor, los {{Totales}} ({{Pago real}}, {{Total}}, {{Imputado}} y {{A cuenta}}), los {{Medios de pago}} (cuenta, cheque propio con su estado o cheque endosado), las {{Imputaciones}}, las notas, los adjuntos y el botón {{PDF}}.",
      ],
      screens: [
        {
          kind: "page",
          caption: "Compras › Órdenes de pago",
          title: "Órdenes de pago",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nueva orden de pago", variant: "primary" },
          ],
          toolbar: [
            { label: "Buscar por proveedor o número", kind: "input" },
            { label: "Todas las fechas", kind: "select" },
            { label: "Cualquier estado", kind: "select" },
          ],
          table: {
            columns: [
              "OP",
              "Proveedor",
              "Fecha",
              "Total",
              "Estado",
              "Acciones",
            ],
            rows: [
              [
                "~OP0003-00000041",
                "~Transportes del Sur S.A.",
                "~04/11/2026",
                "~$500.000,00",
                "~Emitida",
                "~👁 ☰ ✎ ⊘",
              ],
              [
                "~OP0003-00000040",
                "~Neumáticos Lanús S.R.L.",
                "~30/10/2026",
                "~$210.000,00",
                "~Emitida",
                "~👁 ☰ ✎ ⊘",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Medios de pago",
          body: [
            "{{Cuenta}}: sale de una cuenta de Tesorería (banco o caja) en la moneda de la OP. En una cuenta bancaria el campo de referencia pide {{Transferencia / nro mov}}.",
            "{{Endosar cheque}}: entrega al proveedor un cheque de terceros que está en cartera, del mismo canal y moneda. El cheque pasa a endosado.",
            "{{Emitir cheque}}: emite un cheque propio (físico o ECHEQ) contra una cuenta bancaria. Queda en [[/issued-checks]] como emitido; el cobro o el rechazo se registran después desde ahí.",
            "Una cartera de cheques no se puede usar como cuenta: de ella solo sale plata endosando un cheque.",
          ],
        },
        {
          title: "Imputación",
          body: [
            "{{Automática (los más viejos primero)}}: cancela las facturas y notas de débito pendientes del canal y la moneda de la OP, de la más vieja a la más nueva; lo que sobra queda a cuenta.",
            "{{Elegir comprobantes}}: elegís qué facturas cancela y cuánto de cada una.",
            "{{A cuenta (imputar después)}}: el pago queda a cuenta del proveedor y se imputa después con {{Imputar saldo a cuenta}}.",
            "Una OP solo cancela facturas del mismo proveedor, canal y moneda, y nunca más de lo que cada una tiene abierto.",
          ],
        },
        {
          title: "Qué genera una OP",
          body: [
            "Cada medio de pago genera un egreso en Tesorería en la cuenta correspondiente y, en un canal fiscal, el asiento: Proveedores al debe; al haber, la cuenta de cada medio (banco o caja, cheques diferidos emitidos para un cheque propio, cheques en cartera para un endoso). En dólares, si la cotización de la OP difiere de la de las facturas, se registra la diferencia de cambio.",
          ],
        },
      ],
      tasks: [
        {
          id: "emitir-orden-de-pago",
          title: "Emitir una orden de pago",
          permission: [...PAYMENT_ORDER_FORM_PERMISSIONS],
          prerequisites: [
            "Poder ver las cuentas de Tesorería (`accounts:read`): cada línea de pago elige una cuenta y, sin ese permiso, el botón no aparece.",
            "Un punto de venta habilitado para órdenes de pago en el canal.",
            "Las cuentas de Tesorería desde donde pagás, en la moneda de la OP.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nueva orden de pago",
              description:
                "El número se asigna automáticamente al canal. Una vez emitida, podés editar montos, imputaciones o anular.",
              fields: [
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve fiscal",
                  marker: 2,
                },
                { label: "Número", kind: "input", value: "41", marker: 2 },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "04/11/2026",
                  marker: 2,
                },
                { label: "Moneda", kind: "select", value: "ARS", marker: 2 },
                {
                  label: "Proveedor",
                  kind: "picker",
                  value: "Transportes del Sur S.A.",
                  marker: 3,
                  wide: true,
                },
                {
                  label: "Cuenta",
                  kind: "select",
                  value: "Banco Galicia · Banco · ARS",
                  marker: 4,
                },
                {
                  label: "Monto",
                  kind: "money",
                  value: "500.000,00",
                  marker: 4,
                },
                {
                  label: "Transferencia / nro mov",
                  kind: "input",
                  value: "48213",
                  marker: 4,
                },
                {
                  label: "Imputación",
                  kind: "select",
                  value: "Automática (los más viejos primero)",
                  marker: 5,
                  wide: true,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                {
                  label: "Emitir orden de pago",
                  variant: "primary",
                  marker: 7,
                },
              ],
            },
          ],
          steps: [
            "En [[/payment-orders]], hacé clic en {{Nueva orden de pago}}. También desde la ficha del proveedor ({{Nueva orden de pago}}), desde una factura ({{Pagar}}) o desde [[/treasury]].",
            {
              text: "Revisá {{Canal}}, {{Número}}, {{Fecha}} y {{Moneda}}.",
              substeps: [
                "El número se completa solo con el siguiente del canal. Solo en la primera OP de un canal se puede escribir (por ejemplo, para seguir la numeración de otro sistema); después queda fijo.",
                "En {{USD}}, completá {{Cotización (ARS por USD)}}: se propone la del día si está cargada, y tiene que ser mayor a 1.",
              ],
            },
            "En {{Proveedor}}, buscá y elegí el proveedor.",
            {
              text: "En {{Medios de pago}}, agregá una línea por cada forma de pago:",
              substeps: [
                "{{Cuenta}}: elegí la cuenta, el {{Monto}} y la referencia ({{Transferencia / nro mov}} o {{Referencia (opcional)}}).",
                "{{Endosar cheque}}: elegí un cheque de la lista de cheques en cartera; el monto es el del cheque.",
                "{{Emitir cheque}}: ver [[#pagar-con-cheque-propio]].",
                "Quitá una línea con el tacho ({{Quitar línea}}). El total de la OP es la suma de las líneas.",
              ],
            },
            {
              text: "En {{Imputación}}, elegí cómo se aplica el pago (ver los conceptos de arriba).",
              substeps: [
                "Con {{Elegir comprobantes}}, en {{Imputar a facturas}} tildá cada factura y ajustá el importe en {{Imputar}} (se propone lo {{Adeudado}}).",
              ],
            },
            "Revisá el resumen: {{Total a pagar}}, {{Imputado}} y {{A cuenta}}.",
            "Hacé clic en {{Emitir orden de pago}}.",
          ],
          after: [
            "Aviso «OP … emitida.». La OP queda {{Emitida}}, baja la deuda en la cuenta corriente y el aging del proveedor, y genera los egresos en Tesorería y (si es fiscal) el asiento.",
            "Los cheques endosados pasan a endosados; los cheques propios aparecen en [[/issued-checks]] como emitidos.",
          ],
          errors: [
            {
              message: "Seleccioná un proveedor.",
              fix: "Elegí el proveedor.",
            },
            {
              message: "Agregá al menos una línea de pago.",
              fix: "Agregá una cuenta, un endoso o un cheque propio.",
            },
            {
              message: "Cada línea de cuenta necesita una cuenta seleccionada.",
              fix: "Elegí la cuenta en cada línea.",
            },
            {
              message: "Cada línea necesita un monto mayor a cero.",
              fix: "Completá el monto o quitá la línea.",
            },
            {
              message: "Elegí al menos una factura, o pagá a cuenta.",
              fix: "Tildá una factura o elegí {{A cuenta (imputar después)}}.",
            },
            {
              message: "Las imputaciones (…) superan el total de la OP (…).",
              fix: "Bajá los importes a imputar o agregá medios de pago.",
            },
            {
              message:
                "Cargá la cotización del dólar (tiene que ser mayor a 1).",
              fix: "Completá la cotización.",
            },
            {
              message: "El canal … no tiene un punto de venta habilitado.",
              fix: "Pedile a un owner o admin que habilite un punto de venta en [[/admin/afip/puntos-de-venta]].",
            },
            {
              message: "El número … ya existe para ese canal/POS.",
              fix: "Otra OP tomó ese número: cerrá y volvé a abrir el formulario.",
            },
            {
              message:
                "La imputación excede el saldo abierto de la factura (… > …)",
              fix: "Bajá el importe imputado a esa factura.",
            },
            {
              message:
                "La factura es de otro canal que la orden de pago: una OP solo cancela facturas de su mismo canal",
              fix: "Emití la OP en el canal de la factura.",
            },
            {
              message:
                "La factura está en otra moneda que la orden de pago: una OP solo cancela facturas de su misma moneda",
              fix: "Emití la OP en la moneda de la factura.",
            },
            {
              message:
                "El cheque es de otro canal que la orden de pago: solo se endosa en una OP de su mismo canal",
              fix: "Endosá un cheque del canal de la OP.",
            },
            {
              message:
                'La cuenta "…" no tiene una cuenta contable asociada: no se puede asentar la orden de pago',
              fix: "Pedile a un owner o admin que revise la cuenta contable asociada a esa cuenta de Tesorería.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto ([[#periodos-cerrados]]).",
            },
            {
              message: "No tenés permiso para emitir órdenes de pago.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: [
            "pagar-con-cheque-propio",
            "imputar-orden-de-pago",
            "pagar-factura-de-compra",
          ],
          keywords: [
            "pagar proveedor",
            "OP",
            "transferencia",
            "endoso",
            "pago a proveedor",
          ],
        },
        {
          id: "pagar-con-cheque-propio",
          title: "Pagar con un cheque propio",
          permission: [...PAYMENT_ORDER_FORM_PERMISSIONS],
          prerequisites: [
            "Poder ver las cuentas de Tesorería (`accounts:read`): cada línea de pago elige una cuenta y, sin ese permiso, el botón no aparece.",
            "Una cuenta bancaria activa en la moneda de la OP (la chequera).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nueva orden de pago",
              caption: "Medios de pago › Emitir cheque propio",
              fields: [
                { label: "Tipo", kind: "select", value: "ECHEQ", marker: 2 },
                {
                  label: "Chequera (cuenta bancaria)",
                  kind: "select",
                  value: "Banco Galicia",
                  marker: 2,
                },
                { label: "Banco", kind: "input", value: "Galicia", marker: 2 },
                {
                  label: "Nº cheque",
                  kind: "input",
                  value: "00012345",
                  marker: 2,
                },
                {
                  label: "Fecha de vto.",
                  kind: "date",
                  value: "04/12/2026",
                  marker: 2,
                },
                {
                  label: "Monto",
                  kind: "money",
                  value: "300.000,00",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                {
                  label: "Emitir orden de pago",
                  variant: "primary",
                  marker: 3,
                },
              ],
            },
          ],
          steps: [
            "En el formulario de la orden de pago, en {{Medios de pago}}, hacé clic en {{Emitir cheque}}.",
            "En el recuadro {{Emitir cheque propio}}, completá {{Tipo}} ({{Físico}} o {{ECHEQ}}), {{Chequera (cuenta bancaria)}}, {{Banco}}, {{Nº cheque}}, {{Fecha de vto.}} y {{Monto}}.",
            "Terminá la OP como en [[#emitir-orden-de-pago]] y hacé clic en {{Emitir orden de pago}}.",
          ],
          after: [
            "El cheque queda en [[/issued-checks]] como emitido, ligado a la OP y al proveedor, con fecha de emisión igual a la de la OP. Su monto, moneda y cuenta solo se cambian editando la OP.",
            "Mientras el cheque esté emitido, la OP se puede editar o anular; una vez cobrado o rechazado, ya no.",
          ],
          errors: [
            {
              message: "La chequera (cuenta bancaria) es requerida.",
              fix: "Elegí la cuenta bancaria.",
            },
            {
              message: "Nº de cheque requerido.",
              fix: "Escribí el número del cheque.",
            },
            {
              message: "Banco del cheque requerido.",
              fix: "Escribí el banco.",
            },
            {
              message: "Fecha de vto. del cheque requerida.",
              fix: "Elegí la fecha de vencimiento.",
            },
          ],
          related: ["emitir-orden-de-pago", "anular-orden-de-pago"],
          keywords: ["cheque propio", "ECHEQ", "cheque diferido", "chequera"],
        },
        {
          id: "imputar-orden-de-pago",
          title: "Imputar el saldo a cuenta de una orden de pago",
          summary:
            "Aplica lo que una OP dejó a cuenta a facturas pendientes, o a cheques entregados al proveedor que fueron rechazados, sin editar la OP.",
          permission: "payment_orders:write",
          prerequisites: ["Una OP {{Emitida}} con saldo a cuenta."],
          screens: [
            {
              kind: "dialog",
              title: "~Imputar orden de pago OP0003-00000041",
              description:
                "Aplica lo que la OP tiene a cuenta a facturas pendientes del proveedor, o a cheques que se le entregaron y fueron rechazados. No cambia las líneas de pago ni los movimientos.",
              fields: [
                {
                  label: "Imputación",
                  kind: "select",
                  value: "Automática (los más viejos primero)",
                  marker: 2,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Imputar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/payment-orders]], en la fila de la OP, hacé clic en {{Imputar saldo a cuenta}}. El diálogo muestra el saldo a cuenta.",
            {
              text: "En {{Imputación}}, elegí:",
              substeps: [
                "{{Automática (los más viejos primero)}}: a las facturas pendientes más viejas.",
                "{{Elegir comprobantes}}: tildá las facturas y los importes.",
                "{{Cheques rechazados (los más viejos primero)}}: aparece si el proveedor tiene cheques rechazados pendientes; cubre esa deuda.",
              ],
            },
            "Hacé clic en {{Imputar}}.",
          ],
          after: [
            "Aviso «Imputado ….». Baja el saldo a cuenta de la OP y lo pendiente de las facturas o cheques rechazados. Las líneas de pago y los movimientos no cambian.",
          ],
          errors: [
            {
              message: "Esta orden de pago no tiene saldo a cuenta.",
              fix: "No hay nada para imputar: ya está aplicada entera.",
            },
            {
              message:
                "El proveedor no tiene facturas pendientes en este canal y moneda.",
              fix: "Cargá la factura y volvé a imputar después.",
            },
            {
              message:
                "El proveedor no tiene cheques rechazados pendientes en este canal y moneda.",
              fix: "Elegí imputar a facturas.",
            },
            {
              message: "Elegí al menos una factura.",
              fix: "Tildá al menos una factura.",
            },
            {
              message:
                "La imputación excede el saldo a cuenta de la orden de pago (…)",
              fix: "Bajá los importes.",
            },
            {
              message: "No tenés permiso para imputar órdenes de pago.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: ["emitir-orden-de-pago"],
          keywords: [
            "pago a cuenta",
            "imputar pago",
            "aplicar anticipo",
            "cheque rechazado",
          ],
        },
        {
          id: "editar-orden-de-pago",
          title: "Editar una orden de pago",
          permission: [...PAYMENT_ORDER_FORM_PERMISSIONS],
          prerequisites: [
            "Poder ver las cuentas de Tesorería (`accounts:read`): cada línea de pago elige una cuenta y, sin ese permiso, el botón no aparece.",
            "Una OP {{Emitida}}, sin cheques propios cobrados o rechazados y sin cheques endosados rechazados.",
          ],
          steps: [
            "En [[/payment-orders]], en la fila de la OP, hacé clic en el lápiz ({{Editar}}).",
            "Cambiá la fecha, las líneas de pago, las imputaciones o las notas. El canal, el número, la moneda y el proveedor no se cambian.",
            "Hacé clic en {{Guardar cambios}}.",
          ],
          after: [
            "Aviso «Orden de pago actualizada.». Los egresos en Tesorería y el asiento se rehacen con los nuevos datos. Lo imputado a cheques rechazados se mantiene.",
          ],
          errors: [
            {
              message:
                "No se puede editar la OP: tiene cheques propios ya cobrados o rechazados. Si uno se rechazó, la deuda ya volvió a la cuenta del proveedor: pagala con una OP nueva e imputala al cheque rechazado.",
              fix: "Emití una OP nueva para la diferencia.",
            },
            {
              message:
                "No se puede editar la OP: un cheque de terceros que endosó fue rechazado y la deuda ya volvió a la cuenta del proveedor. Pagala con una OP nueva e imputala al cheque rechazado.",
              fix: "Emití una OP nueva e imputala al cheque rechazado ([[#imputar-orden-de-pago]]).",
            },
            {
              message:
                "Lo imputado (… a facturas y … a cheques rechazados) supera el total de la OP (…). Lo imputado a cheques rechazados se mantiene al editar.",
              fix: "Bajá lo imputado a facturas o subí los medios de pago.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Pedí que reabran el período ([[#periodos-cerrados]]).",
            },
            {
              message: "No tenés permiso para editar órdenes de pago.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: ["anular-orden-de-pago"],
          keywords: ["modificar OP", "corregir pago"],
        },
        {
          id: "anular-orden-de-pago",
          title: "Anular una orden de pago",
          permission: "payment_orders:write",
          prerequisites: [
            "Una OP {{Emitida}}, sin cheques propios cobrados o rechazados y sin cheques endosados rechazados.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Anular OP OP0003-00000041",
              description:
                "La OP queda como anulada pero conserva el número en el correlativo. Las transactions generadas se borran automáticamente. Esta acción no se puede deshacer.",
              footer: [
                { label: "Volver", variant: "ghost" },
                { label: "Anular OP", variant: "destructive", marker: 2 },
              ],
            },
          ],
          steps: [
            "En [[/payment-orders]], en la fila de la OP, hacé clic en {{Anular}} (el ícono de prohibido).",
            "Hacé clic en {{Anular OP}}. No se puede deshacer.",
          ],
          after: [
            "Aviso «Orden de pago anulada.». La OP queda {{Anulada}} con su número; sus imputaciones dejan de contar y las facturas vuelven a quedar pendientes.",
            "Se borran sus egresos en Tesorería y el asiento se revierte. Los cheques endosados vuelven a cartera y los cheques propios todavía emitidos quedan anulados.",
          ],
          errors: [
            {
              message:
                "No se puede anular la orden de pago: tiene un cheque propio ya cobrado.",
              fix: "El pago ya salió del banco: no se anula.",
            },
            {
              message:
                "No se puede anular la orden de pago: un cheque propio que entregó fue rechazado y la deuda ya volvió a la cuenta del proveedor. Pagala con una OP nueva e imputala al cheque rechazado.",
              fix: "Emití una OP nueva e imputala al cheque rechazado.",
            },
            {
              message:
                "No se puede anular la orden de pago: un cheque de terceros que endosó fue rechazado y la deuda ya volvió a la cuenta del proveedor. Pagala con una OP nueva e imputala al cheque rechazado.",
              fix: "Emití una OP nueva e imputala al cheque rechazado.",
            },
            {
              message:
                "La orden de pago ya estaba anulada o no se encontró. Recargá la página.",
              fix: "Recargá la página.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Pedí que reabran el período ([[#periodos-cerrados]]).",
            },
            {
              message: "No tenés permiso para anular órdenes de pago.",
              fix: "Pedíselo a alguien con el permiso (ver [[#roles-y-permisos]]).",
            },
          ],
          related: ["editar-orden-de-pago", "anular-factura-de-compra"],
          keywords: ["anular OP", "cancelar pago", "revertir pago"],
        },
        {
          id: "descargar-pdf-orden-de-pago",
          title: "Descargar el PDF de una orden de pago",
          permission: "payment_orders:read",
          steps: [
            "En [[/payment-orders]], abrí la OP (ojo, {{Ver detalle}}).",
            "Hacé clic en {{PDF}}: se abre en otra pestaña para imprimirlo o mandarlo al proveedor.",
          ],
          keywords: ["imprimir OP", "comprobante de pago", "PDF"],
        },
        {
          id: "adjuntar-archivos-orden-de-pago",
          title: "Adjuntar archivos a una orden de pago",
          permission: attachmentPermission("payment_order"),
          steps: [
            "Abrí la OP y bajá hasta {{Adjuntos}}.",
            "En {{Tipo:}}, elegí {{Comprobante de pago}}, {{Transferencia}} u {{Otro}}.",
            "Arrastrá el archivo al recuadro o hacé clic para elegirlo.",
          ],
          errors: [
            {
              message: "Sin permiso para atachar a esa entidad.",
              fix: "Hace falta poder emitir órdenes de pago además de subir archivos.",
            },
          ],
          keywords: ["comprobante de transferencia", "adjuntar pago"],
        },
        {
          id: "exportar-ordenes-de-pago",
          title: "Exportar las órdenes de pago",
          permission: "payment_orders:read",
          steps: [
            "En [[/payment-orders]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}}, el rango y hacé clic en {{Descargar período}} (o {{Todo el historial}}).",
          ],
          after: [
            "Se descargan las OP del lado donde estás: fecha, número, proveedor, canal, moneda, total y estado.",
          ],
        },
      ],
    },

    // ── Aging de proveedores ──────────────────────────────────────────────
    {
      id: "aging-de-proveedores",
      title: "Aging de proveedores",
      menuPath: "Compras › Aging proveedores",
      routes: ["/aging-suppliers"],
      permission: [
        "suppliers:read",
        "purchase_invoices:read",
        "payment_orders:read",
      ],
      intro: [
        "Lo que se le debe a cada proveedor del lado donde estás, separado por antigüedad: facturas y notas de débito de compra menos lo pagado con órdenes de pago emitidas y lo acreditado con notas de crédito, más los cheques rechazados.",
        "Arriba, una tarjeta por tramo ({{0–30 días}}, {{30–60 días}}, {{60–90 días}}, {{90+ días}}) y {{Total adeudado}}, con la cantidad de proveedores y documentos, los cheques rechazados incluidos y lo pagado a cuenta sin imputar. Si hay deuda en dólares, muestra su equivalente en pesos al dólar oficial cargado.",
        "La tabla tiene una fila por proveedor (el nombre lleva a su ficha) con los tramos, {{Total}}, {{A cuenta}} (pagos sin imputar, aparte de los tramos) y {{Documentos}}.",
      ],
      concepts: [
        {
          title: "Cómo se cuentan los días",
          body: [
            "Los días se cuentan desde el vencimiento de pago de cada factura; si no tiene, desde su fecha. Por eso conviene cargar el {{Vencimiento de pago}} o el {{Plazo de pago (días)}} del proveedor.",
            "Lo pagado a cuenta (una OP sin imputar) no baja los tramos hasta que lo imputás ([[#imputar-orden-de-pago]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "exportar-aging-proveedores",
          title: "Exportar el aging de proveedores",
          permission: [
            "suppliers:read",
            "purchase_invoices:read",
            "payment_orders:read",
          ],
          steps: [
            "En [[/aging-suppliers]], hacé clic en {{Exportar}}.",
            "Elegí {{PDF}} o {{Excel}} y hacé clic en {{Descargar período}} o {{Todo el historial}}.",
          ],
          after: ["Se descarga el aging del lado donde estás."],
          keywords: [
            "deudas con proveedores",
            "cuentas por pagar",
            "vencidos",
            "antigüedad de deuda",
          ],
        },
      ],
    },
  ],
};
