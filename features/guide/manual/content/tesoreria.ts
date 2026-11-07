import { PAYMENT_ORDER_FORM_PERMISSIONS } from "@/features/payment-orders/lib/payment-order-form";

import type { GuidePage } from "../types";

// Treasury chapter: the summary and its shortcuts, cash flow, accounts, Caja,
// bank reconciliation, received and own checks, recurring payments and loans.

const TREASURY_READ = ["accounting:read", "accounts:read"] as const;

export const treasuryPage: GuidePage = {
  file: "tesoreria.html",
  title: "Tesorería",
  lead: "La plata de la empresa: saldos de cajas y bancos, movimientos, conciliación con el extracto, cheques recibidos y propios, pagos fijos y préstamos.",
  sections: [
    // ── Resumen ──────────────────────────────────────────────────────────
    {
      id: "tesoreria-resumen",
      title: "Resumen de tesorería",
      menuPath: "Tesorería › Resumen",
      routes: ["/treasury"],
      permission: TREASURY_READ,
      intro: [
        "La foto de la liquidez de hoy, de todos los canales juntos (fiscal e interno). Los saldos se calculan en vivo: saldo inicial de cada cuenta más sus movimientos de Caja hasta hoy, y el cambio se compara con el cierre del mes anterior.",
        "Arriba están las tarjetas {{Total ARS líquido}} y {{Total USD líquido}} (bancos, efectivo, billeteras e inversiones; la de dólares muestra además su equivalente en pesos a la última cotización cargada), {{Cheques en cartera ARS}} (con cuántos acreditan en 7 días o menos) y, si hay, {{Cheques en cartera USD}}. Si hay cheques en pesos que vencen en los próximos 7 días aparece el aviso {{Próximos a acreditarse (≤ 7 días)}}.",
        "Debajo está la tabla {{Cuentas}}, con el saldo actual de cada una (ver [[#cuentas]]).",
        "Si tenés permiso para ver cheques y hay cheques vendidos sin vencer o rechazados sin pagar al comprador, abajo aparece el bloque {{Cheques vendidos}} con el {{Pasivo contingente (vendidos sin vencer)}} y la {{Deuda con compradores (rechazados sin debitar)}}; {{Ver cheques}} lleva a [[/checks]].",
      ],
      screens: [
        {
          kind: "page",
          title: "Tesorería",
          actions: [
            { label: "Cobrar a cliente", variant: "outline" },
            { label: "Pagar a proveedor", variant: "outline" },
            { label: "Adelanto a empleado", variant: "outline" },
            { label: "Préstamo a empleado", variant: "outline" },
          ],
          stats: [
            { label: "Total ARS líquido", value: "$ 12.480.300,00" },
            { label: "Total USD líquido", value: "US$ 8.200,00" },
            { label: "Cheques en cartera ARS", value: "$ 3.150.000,00" },
          ],
        },
      ],
      concepts: [
        {
          title: "Qué cuenta como líquido",
          body: [
            "Líquido es lo que está en cuentas de tipo {{Cuenta bancaria}}, {{Efectivo}}, {{Billetera digital}} e {{Inversión}}. Los {{Cheques físicos en cartera}} y los {{e-cheq en cartera}} se suman aparte: no son liquidez hasta depositarlos. Pesos y dólares nunca se suman entre sí.",
          ],
        },
        {
          title: "El selector Lado (fiscal o interno)",
          body: [
            "Tesorería es una pantalla compartida por los dos lados. Por eso, cuando abrís {{Cobrar a cliente}} o {{Pagar a proveedor}} desde acá, el formulario muestra arriba el selector {{Lado}} con {{Fiscal}} (lo de Ventas y Compras) o {{Interno}} (lo de Otras ventas y Otras compras). Empieza en {{Fiscal}}.",
            "El lado elegido decide qué canales y qué clientes o proveedores ofrece el formulario: un recibo u orden de pago no mezcla un cliente de un lado con el canal del otro. Si cambiás el lado, el formulario se vuelve a cargar vacío.",
          ],
        },
        {
          title: "Cheques vendidos",
          body: [
            "Vender (descontar) un cheque es un endoso con recurso: si el cheque rebota, el comprador lo devuelve. Por eso lo vendido sin vencer se muestra como pasivo contingente, y lo rechazado que el comprador todavía no debitó como deuda. Ninguno de los dos está en el saldo de las cuentas.",
          ],
        },
      ],
      tasks: [
        {
          id: "ver-movimientos-de-una-cuenta",
          title: "Ver los movimientos de una cuenta",
          summary:
            "Cada cuenta tiene su página con sus movimientos, el saldo después de cada uno y, en un banco, su extracto.",
          permission: "transactions:read",
          steps: ["En [[/treasury]], hacé clic en el nombre de la cuenta."],
          after: [
            "Se abre la cuenta en {{Movimientos}}, con el mes actual: {{Debe}}, {{Haber}} y {{Saldo}} de cada movimiento. El período se cambia con el filtro de fecha.",
          ],
          related: ["caja", "filtrar-movimientos-caja"],
          keywords: [
            "saldo de una cuenta",
            "extracto",
            "movimientos del banco",
          ],
        },
        {
          id: "cobrar-a-cliente-desde-tesoreria",
          title: "Cobrar a un cliente desde Tesorería",
          summary:
            "Atajo para emitir un recibo sin ir a Recibos: es el mismo formulario y el mismo recibo.",
          permission: "receipts:write",
          prerequisites: [
            "Que exista al menos una cuenta activa donde entra la plata (ver [[#crear-cuenta]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Cobrar a cliente",
              description:
                "Emite un recibo: el cobro entra en la cuenta elegida y se imputa a los comprobantes (automático, elegidos o a cuenta).",
              fields: [
                { label: "Lado", kind: "select", value: "Fiscal", marker: 2 },
                { label: "Canal", kind: "select", marker: 3 },
                { label: "Número", kind: "input", value: "123" },
                { label: "Fecha", kind: "date", value: "05/11/2026" },
                { label: "Moneda", kind: "select", value: "ARS" },
                { label: "Cliente", kind: "picker", marker: 4, wide: true },
                { label: "Imputación", kind: "select", marker: 6, wide: true },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Emitir recibo", variant: "primary", marker: 7 },
              ],
            },
          ],
          steps: [
            "En [[/treasury]], hacé clic en {{Cobrar a cliente}}.",
            "En {{Lado}}, elegí {{Fiscal}} o {{Interno}} según de qué lado es el cliente y lo que se cobra.",
            "Completá {{Canal}}, {{Número}}, {{Fecha}} y {{Moneda}} del recibo.",
            "En {{Cliente}}, buscá y elegí el cliente.",
            {
              text: "En {{Líneas de pago}}, hacé clic en {{Agregar línea}} por cada medio de cobro y completá {{Cuenta}} (se ofrecen las activas de la moneda del recibo) y {{Monto}}.",
              substeps: [
                "Si la cuenta es una cartera de cheques, la línea pide además los datos del cheque ({{Fecha de emisión}}, {{Fecha de cobro}}, {{Banco}}, {{Firmante}}): el cheque entra a [[/checks]] como {{En cartera}}.",
                "Si tenés permiso de retenciones y el recibo es del lado fiscal, también podés cargar las retenciones que te hizo el cliente.",
              ],
            },
            {
              text: "En {{Imputación}}, elegí cómo se aplica el cobro:",
              substeps: [
                "{{Automática (los más viejos primero)}}: cancela los comprobantes pendientes del canal, del más viejo al más nuevo; lo que sobra queda a cuenta.",
                "{{Elegir comprobantes}}: marcás qué comprobantes cancela y cuánto de cada uno.",
                "{{A cuenta (imputar después)}}: queda a cuenta del cliente y se imputa después desde [[/receipts]].",
              ],
            },
            "Hacé clic en {{Emitir recibo}}.",
          ],
          after: [
            "Se crea el recibo igual que desde [[/receipts]]: la plata entra en las cuentas de las líneas de pago (aparece en [[/transactions]] como movimiento del recibo) y se cancelan los comprobantes imputados.",
            "Ese movimiento de Caja lo maneja el recibo: no se edita ni se borra desde Caja; se corrige editando o anulando el recibo.",
          ],
          errors: [
            {
              message: "Seleccioná un cliente.",
              fix: "Elegí el cliente en {{Cliente}} antes de emitir.",
            },
            {
              message: "Agregá al menos una línea de pago.",
              fix: "Hacé clic en {{Agregar línea}} y cargá cuenta y monto.",
            },
            {
              message: "Cada línea de pago necesita una cuenta.",
              fix: "Elegí la {{Cuenta}} en cada línea.",
            },
            {
              message: "Elegí al menos un comprobante, o cobrá a cuenta.",
              fix: "Marcá comprobantes o cambiá {{Imputación}} a {{A cuenta (imputar después)}}.",
            },
          ],
          related: ["pagar-a-proveedor-desde-tesoreria", "tesoreria-resumen"],
          keywords: [
            "recibo",
            "cobro",
            "cobranza",
            "cobrar",
            "lado",
            "fiscal",
            "interno",
          ],
        },
        {
          id: "pagar-a-proveedor-desde-tesoreria",
          title: "Pagar a un proveedor desde Tesorería",
          summary:
            "Atajo para emitir una orden de pago sin ir a Órdenes de pago: es el mismo formulario y la misma orden.",
          permission: [...PAYMENT_ORDER_FORM_PERMISSIONS],
          prerequisites: [
            "Que exista al menos una cuenta activa de la que sale la plata (ver [[#crear-cuenta]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Pagar a proveedor",
              description:
                "Emite una orden de pago: el pago sale de la cuenta elegida y se imputa a las facturas (automático, elegidas o a cuenta).",
              fields: [
                { label: "Lado", kind: "select", value: "Interno", marker: 2 },
                { label: "Canal", kind: "select", marker: 3 },
                { label: "Número", kind: "input" },
                { label: "Fecha", kind: "date", value: "05/11/2026" },
                { label: "Moneda", kind: "select", value: "ARS" },
                { label: "Proveedor", kind: "picker", marker: 4, wide: true },
                { label: "Imputación", kind: "select", marker: 6, wide: true },
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
            "En [[/treasury]], hacé clic en {{Pagar a proveedor}}.",
            "En {{Lado}}, elegí {{Fiscal}} o {{Interno}} según de qué lado es el proveedor.",
            "Completá {{Canal}}, {{Número}}, {{Fecha}} y {{Moneda}}.",
            "En {{Proveedor}}, buscá y elegí el proveedor.",
            {
              text: "En {{Medios de pago}}, agregá cómo se paga:",
              substeps: [
                "{{Cuenta}}: una línea con la cuenta de la que sale la plata y su monto.",
                "{{Endosar cheque}}: elegís un cheque de la cartera; pasa a {{Endosado}} (ver [[#endosar-cheque]]).",
                "{{Emitir cheque}}: un cheque propio de una chequera; queda en [[/issued-checks]].",
              ],
            },
            "En {{Imputación}}, elegí {{Automática (los más viejos primero)}}, {{Elegir comprobantes}} o {{A cuenta (imputar después)}}.",
            "Hacé clic en {{Emitir orden de pago}}.",
          ],
          after: [
            "Se crea la orden de pago igual que desde [[/payment-orders]]: la plata sale de las cuentas elegidas y se cancelan las facturas imputadas.",
            "Sus movimientos de Caja los maneja la orden: se corrigen editándola o anulándola, no desde Caja.",
          ],
          errors: [
            {
              message: "Seleccioná un proveedor.",
              fix: "Elegí el proveedor en {{Proveedor}}.",
            },
            {
              message: "Agregá al menos una línea de pago.",
              fix: "Agregá un medio de pago en {{Medios de pago}}.",
            },
            {
              message: "Elegí al menos una factura, o pagá a cuenta.",
              fix: "Marcá facturas o cambiá {{Imputación}} a {{A cuenta (imputar después)}}.",
            },
            {
              message: "La chequera (cuenta bancaria) es requerida.",
              fix: "En la línea {{Emitir cheque}}, elegí la cuenta bancaria del cheque.",
            },
          ],
          related: ["cobrar-a-cliente-desde-tesoreria", "endosar-cheque"],
          keywords: [
            "orden de pago",
            "OP",
            "pagar",
            "pago a proveedor",
            "lado",
          ],
        },
        {
          id: "adelanto-a-empleado",
          title: "Registrar un adelanto a un empleado",
          summary:
            "La plata sale de una caja o banco y va a la cuenta corriente del empleado: no es un gasto.",
          permission: ["hr:write", "transactions:write"],
          prerequisites: [
            "Que el empleado exista y esté activo.",
            "Una caja, banco o billetera activa (no sirve una cartera de cheques).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Adelanto a empleado",
              description:
                "Sale de la cuenta elegida y va a la cuenta corriente del empleado (no es un gasto). Se descuenta entero en la planilla del mes de la fecha.",
              fields: [
                { label: "Empleado", kind: "select", marker: 2, wide: true },
                { label: "Cuenta", kind: "select", value: "Caja chica (ARS)" },
                { label: "Canal", kind: "select" },
                { label: "Fecha", kind: "date", value: "05/11/2026" },
                { label: "~Importe (ARS)", kind: "money", value: "150.000,00" },
                { label: "Descripción (opcional)", kind: "input", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Registrar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/treasury]] (o en [[/transactions]]), hacé clic en {{Adelanto a empleado}} (se descuenta entero en la planilla del mes) o en {{Préstamo a empleado}} (en cuotas: pide la {{Cuota mensual}}, menor que el importe).",
            "En {{Empleado}}, elegí el empleado.",
            "Completá {{Cuenta}} (de donde sale la plata; la moneda del adelanto es la de la cuenta), {{Canal}}, {{Fecha}}, {{Importe}} y, si querés, {{Descripción (opcional)}}.",
            "Hacé clic en {{Registrar}}. La planilla solo descuenta planes en pesos: uno en dólares se salda con pagos del empleado.",
          ],
          after: [
            "Se registra un egreso en la cuenta elegida y un movimiento en la cuenta corriente del empleado. Si el canal es fiscal y el plan de cuentas tiene activa la cuenta de anticipos al personal, el asiento va contra ella y no contra gastos.",
            "Queda un plan que la planilla de sueldos descuenta: entero en el mes de la fecha (adelanto) o una cuota por mes (préstamo).",
            "Ese egreso lo maneja la cuenta corriente del empleado: no se edita monto, fecha ni cuenta desde Caja.",
          ],
          errors: [
            {
              message: "Importe inválido.",
              fix: "Escribí un importe mayor a cero.",
            },
            {
              message:
                "La cuota del plan tiene que ser mayor a cero y no superar el adelanto",
              fix: "Corregí la cuota mensual: entre cero y el importe del adelanto.",
            },
            {
              message:
                "Sin permiso para registrar adelantos o pagos de empleados.",
              fix: "Hace falta permiso de escritura en RRHH y en movimientos de Caja: pedíselo a un owner o admin.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "La fecha cae en un mes cerrado (ver [[#periodos-cerrados]]): usá una fecha de un mes abierto o pedí que lo reabran.",
            },
          ],
          keywords: [
            "adelanto de sueldo",
            "anticipo",
            "vale",
            "préstamo al empleado",
          ],
        },
      ],
    },

    // ── Flujo de caja ────────────────────────────────────────────────────
    {
      id: "flujo-de-caja",
      title: "Flujo de caja",
      menuPath: "Tesorería › Flujo de caja",
      routes: ["/treasury/cash-flow"],
      permission: TREASURY_READ,
      intro: [
        "Una tabla mensual, en pesos, de lo que entró y salió (los 3 meses anteriores y el actual, como {{Realizado}}) y de lo que se espera que entre y salga en los 6 meses siguientes ({{Proyectado}}). Es para control interno: incluye los dos lados.",
        "Arriba se ve el {{Saldo de caja hoy}} (cuentas líquidas activas). Si la proyección deja el saldo en negativo en algún mes, aparece el aviso «Te quedarías en negativo en …» con el mínimo.",
        "Columnas: {{Mes}}, {{Entradas}}, {{Salidas}}, {{Neto}}, {{Saldo proyectado}} y la marca {{Realizado}} o {{Proyectado}}. Debajo de cada importe se ve el desglose F (facturado, canal fiscal), I (interno) y O (otros: lo que no tiene canal, como cheques en cartera o pagos recurrentes cargados sin canal).",
        "La pantalla es de solo lectura: no tiene operaciones. Para cambiar la proyección cargá o corregí los documentos de los que sale.",
      ],
      concepts: [
        {
          title: "De dónde sale la proyección",
          body: [
            "Los meses pasados y el actual salen de los movimientos de Caja.",
            "Los futuros suman: los comprobantes de clientes pendientes (por vencimiento) y las facturas de proveedores pendientes, cada uno descontando lo cobrado o pagado a cuenta; los cheques {{En cartera}} por su fecha de cobro; las cuotas pendientes de [[/loans]]; y los [[/recurring-payments]] activos, en cada fecha en que vencen.",
            "Lo que ya está vencido y sin cobrar o pagar se ubica en el primer mes proyectado.",
            "Un pago recurrente de categoría {{Préstamo}} no se cuenta si ya hay un préstamo cargado del mismo lado: sus cuotas ya están en la proyección.",
            "Lo que está en dólares se convierte a la última cotización oficial cargada. Si no hay ninguna, se deja afuera y la pantalla avisa que faltan los importes en USD: cargá la cotización en [[/accounting/exchange-rates]].",
          ],
        },
      ],
      tasks: [],
    },

    // ── Cuentas ──────────────────────────────────────────────────────────
    {
      id: "cuentas",
      title: "Cuentas",
      menuPath: "Tesorería › Resumen › Cuentas",
      routes: ["/accounts", "/accounts/[id]"],
      permission: "accounts:read",
      intro: [
        "El padrón de cajas, bancos, billeteras, inversiones y carteras de cheques. Cada movimiento de Caja, recibo, orden de pago o cheque pasa por una de estas cuentas.",
        "La tabla muestra {{Nombre}} (con las notas debajo; el nombre abre la cuenta, con sus {{Movimientos}} y, en un banco, su {{Extracto}}), {{Tipo}}, {{Moneda}}, {{Saldo actual}}, {{Cambio del mes}} (contra el cierre del mes anterior), {{Último mov.}} y {{Acciones}} (una cuenta inactiva se ve atenuada). Los saldos se ven con permiso para ver tesorería.",
      ],
      screens: [
        {
          kind: "page",
          title: "Cuentas",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Nueva cuenta", variant: "primary" },
          ],
          table: {
            columns: [
              "Nombre",
              "Tipo",
              "Moneda",
              "Saldo actual",
              "Cambio del mes",
              "Último mov.",
              "Acciones",
            ],
            rows: [
              [
                "Banco Galicia ARS",
                "Cuenta bancaria",
                "ARS",
                "$ 0,00",
                "—",
                "—",
                "",
              ],
              [
                "Cartera cheques",
                "Cheques físicos en cartera",
                "ARS",
                "$ 0,00",
                "—",
                "—",
                "",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Tipos de cuenta",
          body: [
            "{{Cuenta bancaria}}: recibe depósitos de cheques y es la chequera de los cheques propios. {{Efectivo}}: cajas físicas. {{Billetera digital}}: Mercado Pago y similares. {{Inversión}}: plazos fijos, fondos.",
            "{{Cheques físicos en cartera}} y {{e-cheq en cartera}}: guardan los cheques de terceros. Sus movimientos los generan solo los cheques (cargar, depositar, endosar, vender, rechazar): no aceptan movimientos manuales ni transferencias en Caja.",
          ],
        },
        {
          title: "Qué se congela cuando la cuenta tiene movimientos",
          body: [
            "Una vez que la cuenta tiene movimientos, su tipo, su moneda y su saldo inicial ya no se cambian. El nombre y las notas sí. Para corregir el saldo se usa {{Ajustar saldo}} (solo el owner), que lo corrige con fecha.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-cuenta",
          title: "Crear una cuenta",
          permission: "accounts:write",
          screens: [
            {
              kind: "dialog",
              title: "Nueva cuenta",
              description:
                "Bancos, efectivo, billeteras, inversiones o cheques en cartera.",
              fields: [
                {
                  label: "Nombre",
                  kind: "input",
                  value: "Galicia ARS",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Cuenta bancaria",
                  marker: 3,
                },
                { label: "Moneda", kind: "select", value: "ARS", marker: 3 },
                {
                  label: "Saldo inicial",
                  kind: "money",
                  value: "0,00",
                  marker: 4,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Crear cuenta", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/treasury]], hacé clic en {{Nueva cuenta}}.",
            "En {{Nombre}}, escribí cómo la vas a reconocer (al menos 2 letras).",
            "Elegí el {{Tipo}} y la {{Moneda}} (ARS o USD). Pensalo bien: cuando la cuenta tenga movimientos no se cambian.",
            "Si querés, cargá el {{Saldo inicial}} (acepta negativos) y {{Notas}}.",
            "Hacé clic en {{Crear cuenta}}.",
          ],
          after: [
            "La cuenta aparece activa en la lista, en [[/treasury]] y en los selectores de cuenta de recibos, órdenes de pago y movimientos.",
            "También se la podés pedir al asistente (por ejemplo, «creá una cuenta de banco Galicia en dólares»): arma la propuesta {{Crear cuenta de tesorería}} y la cuenta se crea cuando la confirmás ([[#confirmar-propuesta-ia]]).",
          ],
          errors: [
            {
              message: "Nombre requerido.",
              fix: "Escribí un nombre de al menos 2 caracteres.",
            },
            {
              message: "Saldo inicial inválido.",
              fix: "Escribí el importe en formato argentino (por ejemplo `1.250,50`) o dejalo vacío.",
            },
            {
              message: "Ya existe una cuenta con ese nombre, tipo y moneda.",
              fix: "Usá otro nombre, o reactivá la cuenta existente si está inactiva.",
            },
          ],
          related: ["editar-cuenta", "ajustar-saldo-cuenta"],
          keywords: [
            "alta de cuenta",
            "nuevo banco",
            "nueva caja",
            "cartera de cheques",
          ],
        },
        {
          id: "editar-cuenta",
          title: "Editar una cuenta",
          permission: "accounts:write",
          steps: [
            "En [[/treasury]], en la fila de la cuenta, hacé clic en el lápiz ({{Editar}}).",
            "Cambiá {{Nombre}} o {{Notas}}. {{Tipo}}, {{Moneda}} y {{Saldo inicial}} solo se pueden cambiar si la cuenta todavía no tiene movimientos; si los tiene, aparecen bloqueados con la aclaración.",
            "Hacé clic en {{Guardar cambios}} (se habilita cuando cambiaste algo).",
          ],
          after: [
            "El nuevo nombre se ve en todas las pantallas que usan la cuenta.",
          ],
          errors: [
            {
              message:
                "No se puede cambiar la moneda de una cuenta con movimientos: creá otra cuenta en …",
              fix: "Creá una cuenta nueva en la otra moneda ([[#crear-cuenta]]).",
            },
            {
              message:
                "No se puede cambiar el tipo de una cuenta con movimientos: creá otra cuenta del tipo que necesitás",
              fix: "Creá una cuenta nueva del tipo que necesitás.",
            },
            {
              message:
                'No se puede cambiar el saldo inicial de una cuenta con movimientos: usá "Ajustar saldo", que lo corrige con fecha',
              fix: "Pedile al owner que use {{Ajustar saldo}} ([[#ajustar-saldo-cuenta]]).",
            },
            {
              message: "Ya existe una cuenta con ese nombre, tipo y moneda.",
              fix: "Elegí otro nombre.",
            },
          ],
          related: ["crear-cuenta", "desactivar-cuenta"],
          keywords: ["renombrar cuenta", "cambiar cuenta"],
        },
        {
          id: "desactivar-cuenta",
          title: "Desactivar o reactivar una cuenta",
          summary:
            "Una cuenta que ya no se usa se desactiva en vez de borrarse: conserva su historia.",
          permission: "accounts:write",
          steps: [
            "En [[/treasury]], en la fila de la cuenta, hacé clic en el botón de encendido ({{Desactivar}}; en una inactiva dice {{Reactivar}}).",
          ],
          after: [
            "Una cuenta inactiva se ve atenuada en la lista, deja de figurar en [[/treasury]] y no se ofrece para cargar movimientos, cobros ni pagos. Sus movimientos anteriores quedan.",
          ],
          keywords: ["dar de baja cuenta", "cerrar cuenta", "ocultar cuenta"],
        },
        {
          id: "ajustar-saldo-cuenta",
          title: "Ajustar el saldo de una cuenta (saldo de apertura)",
          summary:
            "Fija el saldo real de la cuenta a una fecha: el sistema registra un movimiento de ajuste por la diferencia con lo que calcula.",
          permission: "opening_balances:write",
          prerequisites: ["Ser owner: el botón no aparece para otros roles."],
          screens: [
            {
              kind: "dialog",
              title: "~Ajustar saldo · Banco Galicia ARS",
              description:
                "Fijá el saldo real de la cuenta al corte. El sistema inserta una transacción de ajuste por la diferencia con el saldo calculado. Se imputa al canal elegido.",
              fields: [
                {
                  label: "Fecha de ajuste",
                  kind: "date",
                  value: "30/04/2026",
                  marker: 2,
                },
                {
                  label: "~Saldo real al corte (ARS)",
                  kind: "money",
                  value: "4.512.300,00",
                  marker: 2,
                },
                {
                  label: "Canal de imputación",
                  kind: "select",
                  marker: 3,
                  wide: true,
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
            "En [[/treasury]], en la fila de la cuenta, hacé clic en {{Ajustar saldo}} (si ya tiene un ajuste dice {{Editar saldo}}).",
            "Elegí la {{Fecha de ajuste}} y escribí el {{Saldo real al corte}} (por ejemplo, el del extracto a esa fecha; acepta negativos).",
            "En una caja de efectivo o una cartera de cheques, elegí en {{Canal de imputación}} el canal al que va el ajuste (no hay uno por defecto). En un banco, una billetera o una inversión no se elige: va al canal fiscal. Si querés, agregá {{Notas (opcional)}}.",
            "Hacé clic en {{Registrar}} (o {{Actualizar}} si ya había un ajuste).",
          ],
          after: [
            "Se registra en Caja un movimiento de ajuste por la diferencia entre el saldo calculado a esa fecha y el real. Ese movimiento pertenece al saldo de apertura: no se edita ni se borra desde Caja.",
            "Si ya había un ajuste, se reemplaza: el anterior se borra y se vuelve a calcular.",
          ],
          errors: [
            {
              message: "Ingresá un saldo válido.",
              fix: "Escribí el saldo en formato argentino.",
            },
            {
              message: "Elegí un canal para imputar el ajuste.",
              fix: "Elegí un canal en {{Canal de imputación}}.",
            },
            {
              message: "No tenés permiso para ajustar saldos de cuentas.",
              fix: "Solo el owner ajusta saldos: pedíselo.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "La fecha de ajuste cae en un mes cerrado: usá otra fecha o pedí que lo reabran ([[#periodos-cerrados]]).",
            },
          ],
          related: ["borrar-saldo-de-apertura", "editar-cuenta"],
          keywords: [
            "saldo inicial",
            "saldo de apertura",
            "corregir saldo",
            "ajuste de caja",
          ],
        },
        {
          id: "borrar-saldo-de-apertura",
          title: "Borrar el ajuste de saldo de una cuenta",
          permission: "opening_balances:write",
          prerequisites: [
            "Ser owner.",
            "Que la cuenta tenga un ajuste cargado ([[#ajustar-saldo-cuenta]]).",
          ],
          steps: [
            "En [[/treasury]], en la fila de la cuenta, hacé clic en {{Editar saldo}}.",
            "Abajo a la izquierda, hacé clic en {{Borrar}}.",
            "Confirmá en el aviso {{Borrar el saldo de apertura}}.",
          ],
          after: [
            "Se elimina el movimiento de ajuste y el saldo de la cuenta vuelve a ser el calculado. No se puede deshacer.",
          ],
          errors: [
            {
              message: "No tenés permiso para borrar saldos.",
              fix: "Solo el owner puede hacerlo.",
            },
          ],
          related: ["ajustar-saldo-cuenta"],
        },
      ],
    },

    // ── Caja ─────────────────────────────────────────────────────────────
    {
      id: "caja",
      title: "Caja (movimientos)",
      menuPath: "Tesorería › Caja",
      routes: ["/transactions"],
      permission: "transactions:read",
      intro: [
        "Todos los movimientos de todas las cuentas, de los dos lados: ingresos, egresos y transferencias, los cargados a mano y los que generan los documentos (recibos, órdenes de pago, cheques, préstamos, sueldos, impuestos). Cada movimiento tiene un canal.",
        "Columnas: {{Fecha}}, {{Cuenta}} (clic para abrir la cuenta), {{Canal}}, {{Descripción}} (con el cliente si lo hay y la marca {{Conciliado}}), {{Debe}} (lo que entra) y {{Haber}} (lo que sale). El tipo ({{Ingreso}}, {{Egreso}}, {{Transferencia (entra)}}, {{Transferencia (sale)}}) se filtra arriba. En la página de una cuenta se suma {{Saldo}}, el saldo después de cada movimiento. La lista carga más al bajar.",
        "Arriba están los mismos atajos que en el resumen ({{Cobrar a cliente}}, {{Pagar a proveedor}}, {{Adelanto a empleado}}, {{Préstamo a empleado}}; ver [[#tesoreria-resumen]]) y {{Nuevo movimiento}}.",
      ],
      screens: [
        {
          kind: "page",
          title: "Caja",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Cobrar a cliente", variant: "outline" },
            { label: "Pagar a proveedor", variant: "outline" },
            { label: "Adelanto a empleado", variant: "outline" },
            { label: "Préstamo a empleado", variant: "outline" },
            { label: "Nuevo movimiento", variant: "primary" },
          ],
          toolbar: [
            { label: "Todas las fechas", kind: "select" },
            { label: "Todas las cuentas", kind: "select" },
            { label: "Cualquier tipo", kind: "select" },
            { label: "Conciliados o no", kind: "select" },
          ],
          table: {
            columns: [
              "Fecha",
              "Cuenta",
              "Canal",
              "Descripción",
              "Debe",
              "Haber",
            ],
            rows: [
              [
                "04/11/2026",
                "Banco Galicia ARS",
                "Jouve fiscal",
                "Comisión mantenimiento",
                "",
                "$ 12.500,00",
              ],
              [
                "03/11/2026",
                "Caja chica",
                "Jouve interno",
                "Venta de chatarra",
                "$ 40.000,00",
                "",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Movimientos manuales y movimientos de un documento",
          body: [
            "Un movimiento cargado con {{Nuevo movimiento}} es manual: se edita, se recategoriza y se borra desde acá.",
            "Un movimiento generado por un documento (recibo, orden de pago, comprobante, cheque, cuota o desembolso de préstamo, sueldo, impuesto, cuenta corriente de un empleado, saldo de apertura) se cambia desde su documento: en Caja no muestra el menú ⋯ y la base de datos rechaza editar su monto, fecha, cuenta o canal.",
            "Las transferencias son un par de movimientos ({{Transferencia (sale)}} y {{Transferencia (entra)}}): no se editan; se borran juntas.",
          ],
        },
        {
          title: "Movimientos conciliados",
          body: [
            "Un movimiento con la marca {{Conciliado}} ya está explicado por una línea del extracto bancario. No se borra ni cambia monto, fechas, cuenta, tipo, moneda o canal hasta desconciliar su línea en [[/treasury/reconciliation]]. La descripción y la cuenta de gasto sí se cambian.",
          ],
        },
        {
          title: "Qué asiento hace un movimiento manual",
          body: [
            "Solo los movimientos de un canal fiscal llegan al libro diario: los del canal interno no generan asiento. Lo que sigue vale para el canal fiscal.",
            "Un ingreso debita la caja o banco y acredita «ajustes de caja». Un egreso debita la {{Cuenta de gasto}} elegida (o «gastos» si no elegís ninguna) y acredita la caja o banco. Una transferencia debita la cuenta destino y acredita la de origen.",
            "Si el movimiento está en dólares, el asiento se hace en pesos a la cotización del día; sin cotización cargada para esa fecha, el asiento queda pendiente.",
          ],
        },
      ],
      tasks: [
        {
          id: "registrar-ingreso-o-egreso",
          title: "Registrar un ingreso o un egreso manual",
          summary:
            "Para lo que no tiene un documento propio: una comisión bancaria, un gasto menor, un ingreso varios. El cobro a un cliente es un recibo y el pago a un proveedor una orden de pago.",
          permission: "transactions:write",
          prerequisites: [
            "Una cuenta activa que no sea cartera de cheques ([[#crear-cuenta]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo movimiento",
              description:
                "Ingreso, egreso o transferencia entre cuentas. El mes devengado se autocompleta con el mes de la fecha.",
              fields: [
                {
                  label: "Cuenta",
                  kind: "select",
                  value: "Banco Galicia ARS · ARS",
                  marker: 3,
                  wide: true,
                },
                { label: "Canal", kind: "select", marker: 4 },
                {
                  label: "Monto",
                  kind: "money",
                  value: "12.500,00",
                  marker: 4,
                },
                { label: "Moneda", kind: "select", value: "ARS" },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "04/11/2026",
                  marker: 5,
                },
                {
                  label: "Mes devengado",
                  kind: "input",
                  value: "noviembre 2026",
                  marker: 5,
                },
                {
                  label: "Cuenta de gasto",
                  kind: "select",
                  value: "Sin cuenta (Gastos)",
                  marker: 6,
                },
                { label: "Descripción", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Registrar", variant: "primary", marker: 7 },
              ],
            },
          ],
          steps: [
            "En [[/transactions]], hacé clic en {{Nuevo movimiento}}.",
            "Arriba, elegí {{Ingreso}} o {{Egreso}}. Si es el cobro de un cliente o el pago a un proveedor, usá el botón que aparece ahí mismo ({{Cobrar a cliente}} o {{Pagar a proveedor}}): así se cancela su deuda.",
            "En {{Cuenta}}, elegí la caja, banco o billetera. La {{Moneda}} toma la de la cuenta.",
            "Elegí el {{Canal}} y escribí el {{Monto}} (mayor a cero).",
            "Revisá la {{Fecha}}. El {{Mes devengado}} se completa con el mes de la fecha; cambialo si el gasto o ingreso corresponde a otro mes.",
            "Si es un egreso, elegí la {{Cuenta de gasto}} (si no, va a {{Sin cuenta (Gastos)}}).",
            "Escribí una {{Descripción}} y hacé clic en {{Registrar}}.",
          ],
          after: [
            "El movimiento aparece en la lista y cambia el saldo de la cuenta en [[/treasury]].",
            "Si el canal es fiscal, se genera su asiento en el libro diario (ver «Qué asiento hace un movimiento manual» arriba).",
          ],
          errors: [
            {
              message: "Cuenta requerida.",
              fix: "Elegí la cuenta.",
            },
            {
              message: "Canal requerido.",
              fix: "Elegí el canal.",
            },
            {
              message:
                "La moneda del movimiento (…) no coincide con la de la cuenta (…): elegí una cuenta en …",
              fix: "Dejá en {{Moneda}} la moneda de la cuenta, o elegí una cuenta en la moneda del movimiento.",
            },
            {
              message:
                "Los movimientos en cuentas de cheques se manejan desde /checks (cargar, depositar, endosar).",
              fix: "Los cheques se cargan y mueven desde [[/checks]].",
            },
            {
              message:
                "La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa",
              fix: "Elegí otra cuenta de gasto, sin subcuentas.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "La fecha cae en un mes cerrado: usá una fecha de un mes abierto o pedí que lo reabran ([[#periodos-cerrados]]).",
            },
            {
              message: "No tenés permiso para registrar movimientos.",
              fix: "Pedile el permiso al owner o hacelo con un usuario de Finanzas, Admin u Owner.",
            },
          ],
          related: [
            "registrar-transferencia",
            "editar-movimiento-caja",
            "recategorizar-egreso",
          ],
          keywords: [
            "nuevo movimiento",
            "gasto",
            "ingreso varios",
            "comisión bancaria",
            "egreso de caja",
          ],
        },
        {
          id: "registrar-transferencia",
          title: "Registrar una transferencia entre cuentas",
          summary:
            "Pasar plata de una cuenta propia a otra, en la misma moneda.",
          permission: "transactions:write",
          prerequisites: [
            "Dos cuentas activas en la misma moneda que no sean carteras de cheques.",
          ],
          steps: [
            "En [[/transactions]], hacé clic en {{Nuevo movimiento}} y elegí {{Transferencia}}.",
            "Elegí la {{Cuenta origen}} y la {{Cuenta destino}} (tienen que ser distintas y de la misma moneda).",
            "Completá {{Canal}}, {{Monto}}, {{Fecha}}, {{Mes devengado}} y la {{Descripción}}.",
            "Hacé clic en {{Registrar}}.",
          ],
          after: [
            "Se crean dos movimientos enlazados: {{Transferencia (sale)}} en la cuenta de origen y {{Transferencia (entra)}} en la de destino. Si el canal es fiscal, el asiento debita el destino y acredita el origen.",
            "La transferencia no se edita: si está mal, se borra (se borran las dos mitades) y se carga de nuevo.",
          ],
          errors: [
            {
              message: "Cuenta origen requerida.",
              fix: "Elegí la cuenta de la que sale la plata.",
            },
            {
              message: "Origen y destino deben ser distintos.",
              fix: "Elegí otra cuenta destino.",
            },
            {
              message: "Moneda incompatible: … → ….",
              fix: "Las transferencias son entre cuentas de la misma moneda: elegí cuentas iguales en moneda.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto ([[#periodos-cerrados]]).",
            },
          ],
          related: ["registrar-ingreso-o-egreso", "borrar-movimiento-caja"],
          keywords: ["pase entre cuentas", "mover plata", "transferir"],
        },
        {
          id: "editar-movimiento-caja",
          title: "Editar un movimiento manual",
          permission: "transactions:write",
          prerequisites: [
            "Que el movimiento sea manual y no una transferencia: los de un documento se corrigen desde el documento.",
          ],
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar", marker: 1 },
                { label: "Recategorizar" },
                { label: "Borrar", destructive: true },
              ],
            },
            {
              kind: "dialog",
              title: "Editar movimiento",
              fields: [
                {
                  label: "~Monto (ARS)",
                  kind: "money",
                  value: "12.500,00",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "04/11/2026",
                  marker: 2,
                },
                {
                  label: "Mes devengado",
                  kind: "input",
                  value: "noviembre 2026",
                  marker: 2,
                },
                { label: "Cuenta de gasto", kind: "select", marker: 2 },
                {
                  label: "Descripción",
                  kind: "textarea",
                  marker: 2,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/transactions]], en la fila del movimiento, abrí el menú ⋯ y elegí {{Editar}}.",
            "Cambiá {{Monto}}, {{Fecha}}, {{Mes devengado}} o {{Descripción}}; en un egreso, también {{Cuenta de gasto}}. La cuenta, el canal y el tipo no se cambian: si están mal, borralo y cargalo de nuevo.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "Si el canal es fiscal, el asiento del movimiento se rehace con los datos nuevos.",
            "Si el movimiento está conciliado, el monto y las fechas aparecen bloqueados hasta desconciliar su línea en [[/treasury/reconciliation]].",
          ],
          errors: [
            {
              message:
                "Este movimiento fue generado por un documento (recibo, orden de pago, transferencia, comprobante o cheque propio). Editá el documento de origen, no el movimiento.",
              fix: "Abrí el documento (recibo, orden de pago, comprobante o cheque) y corregilo ahí.",
            },
            {
              message:
                "No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un documento (sueldo, préstamo, cheque, saldo inicial, impuesto, cuenta corriente de un empleado o resumen de tarjeta): editá el documento de origen",
              fix: "Corregí el sueldo, la cuota, el cheque, el saldo inicial, el impuesto o el movimiento del empleado desde su pantalla.",
            },
            {
              message:
                "El movimiento está conciliado con el extracto bancario: desconciliá su línea en Tesorería › Conciliación antes de cambiar monto, fecha, cuenta, tipo, moneda o canal",
              fix: "Desconciliá la línea ([[#desconciliar-linea]]), editá y volvé a conciliar.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "El movimiento o la fecha nueva caen en un mes cerrado ([[#periodos-cerrados]]).",
            },
          ],
          related: ["recategorizar-egreso", "borrar-movimiento-caja"],
          keywords: [
            "corregir movimiento",
            "cambiar monto",
            "modificar egreso",
          ],
        },
        {
          id: "recategorizar-egreso",
          title: "Recategorizar un egreso manual",
          summary:
            "Cambia solo la cuenta de gasto, aunque el egreso esté conciliado.",
          permission: "transactions:write",
          prerequisites: ["Que sea un egreso manual."],
          steps: [
            "En [[/transactions]], en la fila del egreso, abrí el menú ⋯ y elegí {{Recategorizar}}.",
            "En el diálogo {{Recategorizar gasto}}, elegí la nueva {{Cuenta de gasto}} (o {{Sin cuenta (Gastos)}}).",
            "Hacé clic en {{Recategorizar}}.",
          ],
          after: [
            "El monto, la fecha y la conciliación quedan como estaban; si el canal es fiscal, el asiento se rehace con la nueva imputación.",
          ],
          errors: [
            {
              message:
                "El egreso lo generó un documento (orden de pago, sueldo, préstamo, cheque, impuesto…): recategorizá el documento de origen",
              fix: "Recategorizá el documento de origen.",
            },
            {
              message:
                "La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa",
              fix: "Elegí una cuenta de gasto sin subcuentas.",
            },
            {
              message:
                "El período contable … está cerrado: pedí que lo reabran en Contabilidad para recategorizar",
              fix: "Pedí que reabran el mes ([[#periodos-cerrados]]).",
            },
          ],
          related: ["editar-movimiento-caja"],
          keywords: ["cuenta de gasto", "imputación", "reclasificar"],
        },
        {
          id: "borrar-movimiento-caja",
          title: "Borrar un movimiento",
          permission: "transactions:delete",
          prerequisites: [
            "Ser owner: solo el owner borra movimientos.",
            "Que sea manual o una transferencia y que no esté conciliado.",
          ],
          steps: [
            "En [[/transactions]], en la fila del movimiento, abrí el menú ⋯ y elegí {{Borrar}}.",
            "Confirmá en el aviso {{Borrar movimiento}}. Si es una transferencia, el aviso te recuerda que se borran los dos movimientos.",
          ],
          after: [
            "El movimiento desaparece con su asiento y el saldo de la cuenta se recalcula. No se puede deshacer.",
          ],
          errors: [
            {
              message: "Solo owner puede borrar movimientos.",
              fix: "Pedíselo al owner.",
            },
            {
              message:
                "No se puede borrar un movimiento generado por …: anulá o editá el documento de origen",
              fix: "Anulá o editá el documento que lo generó (recibo, orden de pago, cheque, cuota…).",
            },
            {
              message:
                "El movimiento está conciliado con el extracto bancario: desconciliá su línea en Tesorería › Conciliación antes de borrarlo",
              fix: "Desconciliá la línea primero ([[#desconciliar-linea]]).",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "El movimiento es de un mes cerrado ([[#periodos-cerrados]]).",
            },
          ],
          related: ["editar-movimiento-caja"],
          keywords: ["eliminar movimiento", "borrar transferencia"],
        },
        {
          id: "filtrar-movimientos-caja",
          title: "Filtrar los movimientos",
          permission: "transactions:read",
          steps: [
            {
              text: "En [[/transactions]], usá los filtros de arriba (se pueden combinar):",
              substeps: [
                "Período: {{Todas las fechas}}, {{Hoy}}, {{Ayer}}, {{Esta semana}}, {{Este mes}}, {{Mes anterior}}, {{Este año}}, {{Año anterior}} o {{Personalizado}} (elegís {{Desde}} y {{Hasta}} en dos calendarios).",
                "Cuenta: {{Todas las cuentas}} o una.",
                "Tipo: {{Cualquier tipo}}, {{Ingreso}}, {{Egreso}}, {{Transferencia (entra)}} o {{Transferencia (sale)}}.",
                "Conciliación: {{Conciliados o no}}, {{Conciliados}} o {{Sin conciliar}}.",
              ],
            },
            "Para volver a ver todo, hacé clic en {{Limpiar}} (aparece cuando hay algún filtro activo).",
          ],
          after: [
            "Los filtros quedan en la dirección de la página: podés compartir el enlace.",
            "Si llegaste desde el enlace de un asiento (libro diario o mayor), la lista muestra solo ese movimiento y arriba aparece {{Un solo movimiento}}: hacé clic ahí (o en {{Limpiar}}) para ver todos.",
          ],
          keywords: [
            "buscar movimiento",
            "movimientos del mes",
            "sin conciliar",
          ],
        },
        {
          id: "exportar-tesoreria",
          title: "Exportar cuentas, movimientos o cheques",
          summary:
            "Cuentas, Caja, Cheques recibidos, Cheques propios y Pagos recurrentes tienen el mismo botón para bajar el listado.",
          permission: {
            anyOf: [
              "accounts:read",
              "transactions:read",
              "cheques:read",
              "issued_checks:read",
              "recurring_payments:read",
            ],
          },
          screens: [
            {
              kind: "dialog",
              title: "Exportar",
              description:
                "Elegí el formato y el rango de fechas. También podés exportar todo el historial.",
              fields: [
                { label: "PDF", kind: "checkbox", marker: 2 },
                { label: "Excel", kind: "checkbox", marker: 2 },
                {
                  label: "Desde",
                  kind: "date",
                  value: "01/11/2026",
                  marker: 3,
                },
                {
                  label: "Hasta",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 3,
                },
              ],
              footer: [
                { label: "Todo el historial", variant: "outline", marker: 4 },
                { label: "Descargar período", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la pantalla del listado, hacé clic en {{Exportar}}.",
            "Elegí el formato: {{PDF}} o {{Excel}}.",
            "Elegí {{Desde}} y {{Hasta}} (por defecto, el mes actual).",
            "Hacé clic en {{Descargar período}}, o en {{Todo el historial}} para exportar sin filtro de fechas.",
          ],
          after: [
            "El PDF se abre en otra pestaña; el Excel se descarga. Es útil para ver los cheques viejos que la lista ya no muestra.",
          ],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Probá de nuevo; si sigue, acotá el rango de fechas.",
            },
          ],
          keywords: ["descargar", "excel", "pdf", "listado"],
        },
      ],
    },

    // ── Conciliación bancaria ────────────────────────────────────────────
    {
      id: "conciliacion-bancaria",
      title: "Conciliación bancaria",
      menuPath: "Tesorería › Conciliación",
      routes: ["/treasury/reconciliation"],
      permission: "transactions:read",
      intro: [
        "Compara, por cuenta y por mes, las líneas del extracto del banco con los movimientos de Caja de esa cuenta. Se concilian bancos, billeteras, cajas e inversiones (no las carteras de cheques).",
        "Arriba elegís {{Cuenta}} y {{Mes}}. Las tarjetas muestran {{Saldo según extracto}} (el último saldo que trae el extracto del mes), {{Saldo según libros}}, la {{Diferencia}} con lo que la explica (pendientes del extracto y movimientos sin conciliar) y {{Líneas}} conciliadas sobre el total.",
        "Debajo: las {{Sugerencias}} (si hay), la tabla {{Extracto}} con {{Fecha}}, {{Descripción}}, {{Importe}}, {{Saldo}} y {{Estado}} ({{Pendiente}}, {{Conciliada}}, {{No corresponde}}), y la tabla {{Movimientos del mes sin conciliar}}: lo que está en Caja y ninguna línea explica (cheques sin cobrar, transferencias en tránsito o un error de carga).",
      ],
      screens: [
        {
          kind: "page",
          title: "Conciliación bancaria",
          actions: [{ label: "Subir extracto", variant: "outline" }],
          toolbar: [
            {
              label: "Cuenta",
              kind: "select",
              value: "Banco Galicia ARS · Cuenta bancaria · ARS",
            },
            { label: "Mes", kind: "input", value: "octubre 2026" },
          ],
          stats: [
            { label: "Saldo según extracto", value: "$ 4.512.300,00" },
            { label: "Saldo según libros", value: "$ 4.499.800,00" },
            { label: "Diferencia", value: "$ 12.500,00" },
            { label: "Líneas", value: "41 / 43" },
          ],
          table: {
            columns: ["Fecha", "Descripción", "Importe", "Saldo", "Estado"],
            rows: [
              [
                "28/10/2026",
                "TRANSF. RECIBIDA 3071234",
                "$ 850.000,00",
                "$ 4.524.800,00",
                "Conciliada",
              ],
              [
                "31/10/2026",
                "COM. MANTENIMIENTO CTA",
                "-$ 12.500,00",
                "$ 4.512.300,00",
                "Pendiente",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Reglas de la conciliación",
          body: [
            "Los importes tienen que coincidir al centavo. Una conciliación es una línea con uno o varios movimientos, o un movimiento con varias líneas; nunca varias de cada lado.",
            "Mientras un movimiento está conciliado no se borra ni cambia monto, fecha, cuenta, tipo, moneda o canal. Desconciliar una línea de un movimiento partido desconcilia todas sus líneas.",
          ],
        },
      ],
      tasks: [
        {
          id: "importar-extracto-bancario",
          title: "Importar el extracto del banco",
          summary:
            "Las líneas del extracto se suben desde la cuenta ({{Subir extracto}}) o desde el importador, como tipo {{Extracto bancario}}. No crean movimientos en Caja: quedan para conciliar.",
          permission: ["imports:write", "transactions:write"],
          prerequisites: [
            "Ser owner o admin: el importador ([[/admin/imports]]) es solo para esos roles; sin el permiso, el botón {{Subir extracto}} no aparece.",
            "El extracto como lo baja el banco: planilla .xlsx (se lee la primera hoja), .csv o .txt (el de Banco Provincia, con su encabezado y totales, se lee tal cual; en el .xlsx de Banco Galicia se suman a la descripción el nombre y el CUIT de «Leyendas Adicionales», y las líneas «Pendiente» no se importan hasta que el banco las imputa), con una fila de títulos y hasta 5000 filas. Columnas: fecha y descripción (obligatorias), el importe con signo (negativo = débito) o dos columnas de débito y crédito, y si las trae, saldo, referencia y el código del banco (en Macro, «Código Causal»).",
            "La cuenta del extracto activa y de tipo banco, billetera, efectivo o inversión (no una cartera de cheques).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Subir extracto",
              description:
                "Subí el extracto que bajaste del banco (.csv, .txt o .xlsx). Las líneas que ya estaban cargadas se saltean.",
              fields: [{ label: "Archivo", kind: "input", marker: 2 }],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "~Importar 43 filas", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/treasury]], hacé clic en el nombre de la cuenta del banco y, en la pestaña {{Extracto}}, en {{Subir extracto}}. (También sirve [[/treasury/reconciliation]] con la {{Cuenta}} elegida.)",
            "{{Desde}} y {{Hasta}} vienen con el mes elegido en {{Mes}}: las líneas con fecha fuera de ese período no se importan. Cambialos si el extracto es de otro período.",
            "En {{Archivo}}, elegí la planilla. Se lee sola y todavía no se guarda nada: arriba del botón dice cuántas filas están listas, cuántas ya estaban cargadas y cuántas tienen error.",
            {
              text: "Si falta una columna o alguna fila tiene error, aparecen {{Columnas}} y la tabla de filas para corregirlo.",
              substeps: [
                "Cada dato muestra de qué columna lo lee (las reconoce por el título, como «Fecha», «Concepto», «Débito», «Crédito» o «Saldo»). Si alguna está mal o falta, elegila en su lista (o {{No está}}) y hacé clic en {{Volver a leer con estas columnas}}.",
                "Hacen falta {{Fecha}}, {{Descripción}} y el importe: {{Importe}} con signo, o {{Débito}} y {{Crédito}} si el banco los separa.",
              ],
            },
            "Hacé clic en el botón «Importar … filas» (cuenta solo las listas; si el archivo trae el código del banco de líneas que ya estaban cargadas sin él, dice también «y completar … códigos»).",
            "Elegí el {{Mes}} del extracto para ver sus líneas.",
          ],
          after: [
            "Las líneas aparecen en la tabla {{Extracto}} como {{Pendiente}}. No se crea ningún movimiento en Caja ni asiento.",
            "Las líneas que ya estaban (por ejemplo, de un extracto que se superpone con uno anterior) se saltean, y las filas con error quedan afuera. Si una línea ya cargada no tenía el código del banco y el archivo lo trae, se le completa el código; lo demás de la línea no cambia.",
            "Las que tienen un movimiento de la cuenta con el mismo importe y hasta 5 días de diferencia aparecen en {{Sugerencias}} ([[#aceptar-sugerencias-conciliacion]]).",
            "La importación queda en la lista {{Importaciones}} del importador. Si te equivocaste de cuenta o de archivo, {{Deshacer}} borra todas sus líneas, mientras ninguna esté conciliada ni marcada como que no corresponde.",
          ],
          errors: [
            {
              message:
                "El extracto es de una cuenta de banco, billetera, caja o inversión.",
              fix: "Elegí en {{Cuenta del extracto}} una cuenta que no sea cartera de cheques.",
            },
            {
              message: "La línea no tiene importe.",
              fix: "La fila no tiene importe ni débito o crédito: revisá la columna elegida o la planilla.",
            },
            {
              message: "La fecha es futura.",
              fix: "Revisá la fecha de esa fila o la columna elegida como {{Fecha}}.",
            },
            {
              message:
                "No se puede deshacer la importación: alguna línea del extracto ya está conciliada o marcada como que no corresponde",
              fix: "Desconciliá esas líneas ([[#desconciliar-linea]]) o volvelas a pendiente ([[#volver-linea-a-pendiente]]) y deshacé de nuevo.",
            },
          ],
          related: ["aceptar-sugerencias-conciliacion", "conciliar-linea"],
          keywords: ["extracto", "resumen bancario", "importar banco"],
        },
        {
          id: "aceptar-sugerencias-conciliacion",
          title: "Aceptar las sugerencias",
          summary:
            "El sistema propone parejas línea–movimiento con el mismo importe y hasta 5 días de diferencia; primero las que también coinciden en la referencia.",
          permission: "transactions:write",
          prerequisites: [
            "Haber importado el extracto ([[#importar-extracto-bancario]]).",
          ],
          steps: [
            "En [[/treasury/reconciliation]], elegí la {{Cuenta}} y el {{Mes}}.",
            "En {{Sugerencias}}, revisá cada pareja (columnas {{Extracto}}, {{Movimiento}} e {{Importe}}).",
            "Hacé clic en {{Aceptar}} en una fila, o en {{Aceptar todas}}.",
          ],
          after: [
            "Cada línea aceptada pasa a {{Conciliada}} con su movimiento debajo, y el movimiento muestra {{Conciliado}} en Caja.",
            "Si alguna no se pudo conciliar (por ejemplo, otro usuario la tocó), el aviso dice cuántas se conciliaron y por qué falló la primera; las demás quedan hechas.",
          ],
          errors: [
            {
              message: "No tenés permiso para conciliar.",
              fix: "Hace falta permiso para cargar movimientos de Caja.",
            },
            {
              message:
                "La línea ya está conciliada o marcada como que no corresponde",
              fix: "Otro usuario ya la resolvió: actualizá la pantalla.",
            },
          ],
          related: ["conciliar-linea"],
        },
        {
          id: "conciliar-linea",
          title: "Conciliar una línea con uno o varios movimientos",
          permission: "transactions:write",
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Conciliar…", marker: 1 },
                { label: "Crear movimiento…" },
                { label: "No corresponde…" },
              ],
            },
            {
              kind: "dialog",
              title: "Conciliar línea",
              description:
                "Elegí el movimiento de la cuenta que la explica, o varios que sumen su importe. Mientras esté conciliado, el movimiento no se edita ni se borra.",
              fields: [
                {
                  label: "~Pago OP 456 · 27/10/2026 · -$ 300.000,00",
                  kind: "checkbox",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "~Pago OP 457 · 27/10/2026 · -$ 200.000,00",
                  kind: "checkbox",
                  marker: 2,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Conciliar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la tabla {{Extracto}}, en una línea {{Pendiente}}, abrí el menú ⋯ y elegí {{Conciliar…}}.",
            "Marcá el movimiento que la explica, o varios que sumen su importe. Arriba se listan primero los del mismo sentido y fecha más cercana; abajo se ve cuánto falta para llegar al importe de la línea.",
            "Cuando lo elegido suma exactamente la línea, hacé clic en {{Conciliar}}.",
          ],
          after: [
            "La línea pasa a {{Conciliada}} y sus movimientos quedan bloqueados para editar monto y fechas o borrar.",
          ],
          errors: [
            {
              message:
                "Los movimientos suman … y la línea …: tienen que coincidir",
              fix: "Elegí movimientos que sumen exactamente el importe de la línea.",
            },
            {
              message:
                "Algún movimiento ya está conciliado con otra línea del extracto",
              fix: "Actualizá la pantalla: alguien lo concilió antes.",
            },
            {
              message:
                "La línea ya está conciliada o marcada como que no corresponde",
              fix: "Actualizá la pantalla.",
            },
          ],
          related: ["crear-movimiento-desde-extracto", "desconciliar-linea"],
          keywords: ["conciliar", "matchear", "puntear extracto"],
        },
        {
          id: "conciliar-movimiento-con-varias-lineas",
          title: "Conciliar un movimiento partido en varias líneas",
          summary:
            "Cuando el banco parte un movimiento (un depósito o una transferencia en dos o más líneas).",
          permission: "transactions:write",
          steps: [
            "En {{Movimientos del mes sin conciliar}}, en la fila del movimiento, hacé clic en el ícono de enlace ({{Conciliar con varias líneas}}).",
            "Marcá las líneas pendientes del extracto que suman su importe.",
            "Hacé clic en {{Conciliar}}.",
          ],
          after: [
            "Todas las líneas quedan {{Conciliada}} con ese movimiento. Desconciliar cualquiera de ellas desconcilia todas.",
          ],
          errors: [
            {
              message:
                "Las líneas suman … y el movimiento …: tienen que coincidir",
              fix: "Elegí líneas que sumen exactamente el movimiento.",
            },
            {
              message:
                "Alguna línea ya está conciliada o marcada como que no corresponde",
              fix: "Actualizá la pantalla.",
            },
          ],
          related: ["conciliar-linea"],
        },
        {
          id: "crear-movimiento-desde-extracto",
          title: "Crear el movimiento que falta desde una línea",
          summary:
            "Para lo que el banco cobró o pagó y no está en Caja: comisiones, intereses, débitos de impuestos.",
          permission: "transactions:write",
          screens: [
            {
              kind: "dialog",
              title: "Crear egreso",
              description:
                "Se carga en Caja como un movimiento manual de esta cuenta, con la fecha y el importe de la línea, y queda conciliado con ella.",
              fields: [
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Egreso manual",
                  marker: 2,
                  wide: true,
                },
                { label: "Canal", kind: "select", marker: 3, wide: true },
                { label: "Cuenta de gasto", kind: "select", marker: 3 },
                {
                  label: "Descripción",
                  kind: "input",
                  value: "COM. MANTENIMIENTO CTA",
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Crear y conciliar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la línea {{Pendiente}}, abrí el menú ⋯ y elegí {{Crear movimiento…}}. El diálogo dice {{Crear egreso}} o {{Crear ingreso}} según el signo de la línea.",
            "Si es un débito en pesos y tenés permiso de impuestos, en {{Tipo}} elegí {{Egreso manual}} (para pagar un impuesto ver [[#pagar-impuesto-desde-extracto]]).",
            "Elegí el {{Canal}}; si es un débito, también la {{Cuenta de gasto}} (obligatoria). Corregí la {{Descripción}} si querés (viene la de la línea).",
            "Hacé clic en {{Crear y conciliar}}.",
          ],
          after: [
            "Se crea en Caja un movimiento manual con la fecha y el importe de la línea (con su asiento si el canal es fiscal), y queda conciliado con ella.",
          ],
          errors: [
            {
              message: "Elegí la cuenta de gasto del débito.",
              fix: "Elegí la {{Cuenta de gasto}}.",
            },
            {
              message: "Elegí el canal.",
              fix: "Elegí el {{Canal}}.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "La línea es de un mes cerrado ([[#periodos-cerrados]]).",
            },
          ],
          related: ["pagar-impuesto-desde-extracto"],
          keywords: ["comisión bancaria", "gastos bancarios", "intereses"],
        },
        {
          id: "pagar-impuesto-desde-extracto",
          title: "Registrar desde el extracto el pago de un impuesto",
          summary:
            "Un débito en pesos del banco se registra como el pago de un impuesto ya cargado.",
          permission: ["transactions:write", "taxes:write"],
          prerequisites: [
            "Un impuesto pendiente o liquidado en [[/taxes]] con su cuenta contable elegida.",
          ],
          steps: [
            "En la línea de débito {{Pendiente}}, abrí el menú ⋯ y elegí {{Crear movimiento…}}.",
            "En {{Tipo}}, elegí {{Pago de impuesto}}.",
            "En {{Impuesto}}, elegí cuál paga la línea (se ve el período, el vencimiento y el importe).",
            "Si el importe de la línea y el del impuesto no coinciden, marcá la casilla que lo confirma: el pago queda por el importe de la línea y la diferencia en las notas.",
            "Hacé clic en {{Pagar y conciliar}}.",
          ],
          after: [
            "Se registra un egreso del canal fiscal con la fecha, la cuenta y el importe de la línea, con su asiento contra la cuenta del impuesto; el impuesto queda pagado y la línea conciliada.",
          ],
          errors: [
            {
              message:
                "La línea es de $ … y el impuesto de $ …: confirmá la diferencia para registrar el pago",
              fix: "Marcá la casilla de la diferencia o elegí otro impuesto.",
            },
            {
              message:
                "No tenés permiso para registrar el pago de un impuesto.",
              fix: "Hace falta permiso de impuestos además del de Caja.",
            },
          ],
          related: ["crear-movimiento-desde-extracto"],
          keywords: ["impuesto debitado", "VEP", "débito automático"],
        },
        {
          id: "marcar-linea-no-corresponde",
          title: "Marcar una línea como que no corresponde",
          summary:
            "Para una línea que no tiene que conciliarse acá (por ejemplo, un movimiento entre cuentas propias ya conciliado del otro lado).",
          permission: "transactions:write",
          steps: [
            "En la línea {{Pendiente}}, abrí el menú ⋯ y elegí {{No corresponde…}}.",
            "Escribí el {{Motivo}} (hasta 500 caracteres).",
            "Hacé clic en {{Marcar}}.",
          ],
          after: [
            "La línea pasa a {{No corresponde}} con su motivo debajo y sale de los pendientes.",
          ],
          errors: [
            {
              message:
                "Solo una línea pendiente se marca como que no corresponde",
              fix: "Actualizá la pantalla: la línea ya cambió de estado.",
            },
          ],
          related: ["volver-linea-a-pendiente"],
        },
        {
          id: "volver-linea-a-pendiente",
          title: "Volver a pendiente una línea que no corresponde",
          permission: "transactions:write",
          steps: [
            "En la línea {{No corresponde}}, abrí el menú ⋯ y elegí {{Volver a pendiente}}.",
          ],
          after: ["La línea vuelve a {{Pendiente}} y se puede conciliar."],
          related: ["marcar-linea-no-corresponde"],
        },
        {
          id: "desconciliar-linea",
          title: "Desconciliar una línea",
          summary: "Necesario para corregir o borrar un movimiento conciliado.",
          permission: "transactions:write",
          steps: [
            "En [[/treasury/reconciliation]], elegí la cuenta y el mes de la línea.",
            "En la línea {{Conciliada}}, abrí el menú ⋯ y elegí {{Desconciliar}}.",
          ],
          after: [
            "La línea vuelve a {{Pendiente}} y sus movimientos se pueden editar o borrar en Caja. Si el movimiento estaba partido en varias líneas, se desconcilian todas.",
          ],
          errors: [
            {
              message: "La línea no está conciliada",
              fix: "Actualizá la pantalla: ya la desconciliaron.",
            },
          ],
          related: ["conciliar-linea", "editar-movimiento-caja"],
          keywords: ["deshacer conciliación"],
        },
      ],
    },

    // ── Cheques recibidos ────────────────────────────────────────────────
    {
      id: "cheques-recibidos",
      title: "Cheques recibidos",
      menuPath: "Tesorería › Cheques recibidos",
      routes: ["/checks"],
      permission: "cheques:read",
      intro: [
        "La cartera de cheques de terceros, físicos y e-cheq. La mayoría entra sola con un recibo que cobra con cheque; también se cargan a mano.",
        "Arriba hay una tarjeta con el total por estado. La tabla muestra {{Tipo}}, {{Número}}, {{Banco}}, {{Firmante}} (y el cliente del que vino), {{Vencimiento}}, {{Monto}}, {{Estado}} y, en {{Acciones}}, los botones que el estado permite. Se ven todos los cheques en cartera y depositados; de los demás, los más recientes (el resto, con {{Exportar}}).",
        "Abajo está {{Ventas de cheques}}, con las ventas hechas y los cheques vendidos que rebotaron y hay que pagarle al comprador.",
        "Toda operación que mueve plata (cargar, depositar, acreditar, rechazar, vender, anular una venta, pagar al comprador) pide, además del permiso de cheques, permiso para cargar movimientos de Caja.",
      ],
      screens: [
        {
          kind: "page",
          title: "Cheques",
          actions: [
            { label: "Vender", variant: "outline" },
            { label: "Exportar", variant: "outline" },
            { label: "Nuevo cheque", variant: "primary" },
          ],
          stats: [
            { label: "En cartera", value: "$ 3.150.000,00" },
            { label: "Depositado", value: "$ 480.000,00" },
            { label: "Rechazado", value: "$ 0,00" },
          ],
          table: {
            columns: [
              "Tipo",
              "Número",
              "Banco",
              "Firmante",
              "Vencimiento",
              "Monto",
              "Estado",
              "Acciones",
            ],
            rows: [
              [
                "Físico",
                "00012345",
                "Banco Nación",
                "Transportes del Sur SRL",
                "20/11/2026",
                "$ 850.000,00",
                "En cartera",
                "Depositar · Rechazar",
              ],
              [
                "e-cheq",
                "88001234",
                "Galicia",
                "Agro Norte SA",
                "02/11/2026",
                "$ 480.000,00",
                "Depositado",
                "Marcar acreditado · Rechazar",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Estados de un cheque",
          body: [
            "{{En cartera}}: lo tenés vos. Se puede depositar, endosar (desde una orden de pago), vender o rechazar.",
            "{{Depositado}}: salió de la cartera a un banco. La plata ya entró a la cuenta con el depósito; falta confirmar la acreditación o registrar el rechazo.",
            "{{Acreditado}}: el banco lo acreditó. Fin del ciclo.",
            "{{Endosado}}: se le entregó a un proveedor en una orden de pago. Si rebota, se registra el rechazo.",
            "{{Vendido}}: se descontó con un banco o financiera. Si rebota, el comprador lo devuelve.",
            "{{Rechazado}}: rebotó. Queda como deuda del firmante (Deudores por cheques rechazados), que se cobra con un recibo al cliente.",
          ],
        },
        {
          title: "El canal de un cheque",
          body: [
            "Un cheque conserva el canal del recibo con que entró (o el que tomó la primera vez que se depositó, rechazó o endosó). Los diálogos lo muestran fijo; solo un cheque sin canal pide elegirlo.",
          ],
        },
      ],
      tasks: [
        {
          id: "cargar-cheque-recibido",
          title: "Cargar un cheque recibido a mano",
          summary:
            "Para un cheque que no entró por un recibo. Si es un pago de un cliente, conviene cargarlo con un recibo, que además cancela su deuda.",
          permission: ["cheques:write", "transactions:write"],
          prerequisites: [
            "Una cuenta de tipo {{Cheques físicos en cartera}} o {{e-cheq en cartera}} activa ([[#crear-cuenta]]).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo cheque",
              fields: [
                { label: "Tipo", kind: "select", value: "Físico", marker: 2 },
                {
                  label: "Número de check",
                  kind: "input",
                  value: "00012345",
                  marker: 2,
                },
                { label: "Moneda", kind: "select", value: "ARS", marker: 2 },
                { label: "Canal", kind: "select", marker: 3, wide: true },
                {
                  label: "Banco emisor",
                  kind: "input",
                  value: "Banco Nación",
                  marker: 4,
                },
                {
                  label: "Cuenta de cartera",
                  kind: "select",
                  value: "Cartera cheques",
                  marker: 4,
                },
                {
                  label: "Firmante (razón social)",
                  kind: "input",
                  value: "Transportes del Sur SRL",
                  marker: 5,
                },
                { label: "CUIT firmante (opcional)", kind: "input", marker: 5 },
                {
                  label: "Fecha de emisión",
                  kind: "date",
                  value: "01/11/2026",
                  marker: 6,
                },
                {
                  label: "Fecha de cobro",
                  kind: "date",
                  value: "20/11/2026",
                  marker: 6,
                },
                {
                  label: "Monto",
                  kind: "money",
                  value: "850.000,00",
                  marker: 6,
                },
                { label: "Notas (opcional)", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Registrar", variant: "primary", marker: 7 },
              ],
            },
          ],
          steps: [
            "En [[/checks]], hacé clic en {{Nuevo cheque}}.",
            "Elegí el {{Tipo}} ({{Físico}} o {{e-cheq}}; la cartera se elige sola según el tipo), escribí el {{Número de check}} y elegí la {{Moneda}}.",
            "Elegí el {{Canal}}.",
            "Escribí el {{Banco emisor}} y revisá la {{Cuenta de cartera}}.",
            "Completá {{Firmante (razón social)}} y, si lo tenés, {{CUIT firmante (opcional)}}.",
            "Completá {{Fecha de emisión}}, {{Fecha de cobro}} y {{Monto}}.",
            "Hacé clic en {{Registrar}}.",
          ],
          after: [
            "El cheque queda {{En cartera}} y entra el ingreso en la cuenta de cartera. Si el canal es fiscal, el asiento debita la cartera contra «ajustes de caja» (no cancela la deuda de ningún cliente).",
            "Desde ese momento sus datos de plata (monto, moneda, cartera, estado) se cambian solo con sus acciones.",
          ],
          errors: [
            {
              message: "Número requerido.",
              fix: "Escribí el número del cheque.",
            },
            {
              message: "Firmante requerido.",
              fix: "Escribí la razón social del firmante.",
            },
            {
              message: "Canal requerido.",
              fix: "Elegí el canal.",
            },
            {
              message:
                "Configurá una cuenta de cartera primero (Cheques físicos o e-cheq).",
              fix: "Creá una cuenta de cartera en [[/treasury]].",
            },
            {
              message: "Ya existe un cheque … para ….",
              fix: "Ese cheque ya está cargado: buscalo en la lista.",
            },
            {
              message:
                "Mueve plata de una cuenta: necesitás también permiso para cargar movimientos.",
              fix: "Pedí también el permiso de movimientos de Caja.",
            },
          ],
          related: ["depositar-cheque", "cobrar-a-cliente-desde-tesoreria"],
          keywords: ["alta de cheque", "cheque de tercero", "echeq", "cartera"],
        },
        {
          id: "depositar-cheque",
          title: "Depositar un cheque",
          permission: ["cheques:write", "transactions:write"],
          prerequisites: [
            "Que el cheque esté {{En cartera}}.",
            "Una cuenta bancaria activa en la moneda del cheque.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Depositar check 00012345",
              description:
                "Genera una transferencia desde la cartera a la cuenta bancaria. El check pasa a estado depositado hasta que el banco confirme.",
              fields: [
                {
                  label: "Cuenta destino",
                  kind: "select",
                  value: "Banco Galicia ARS",
                  marker: 2,
                  wide: true,
                },
                { label: "Canal", kind: "select", value: "Jouve fiscal" },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 3,
                },
                { label: "Descripción (opcional)", kind: "input", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Depositar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/checks]], en la fila del cheque, hacé clic en {{Depositar}}.",
            "En {{Cuenta destino}}, elegí el banco (solo se ofrecen cuentas bancarias de la moneda del cheque).",
            "Revisá el {{Canal}} (si el cheque no tiene, elegilo), la {{Fecha}} y, si querés, la {{Descripción (opcional)}}.",
            "Hacé clic en {{Depositar}}.",
          ],
          after: [
            "Se registra una transferencia de la cartera al banco: la plata ya cuenta en el saldo del banco.",
            "El cheque pasa a {{Depositado}}; cuando el banco lo acredite, marcalo ([[#acreditar-cheque]]).",
          ],
          errors: [
            {
              message: "Elegí la cuenta bancaria destino.",
              fix: "Elegí el banco en {{Cuenta destino}}.",
            },
            {
              message: "Elegí el canal del depósito.",
              fix: "Elegí el {{Canal}}.",
            },
            {
              message: "La cuenta bancaria es de otra moneda que el cheque.",
              fix: "Elegí un banco en la moneda del cheque.",
            },
            {
              message:
                "Un cheque se deposita en una cuenta bancaria, no en una cartera de cheques, caja o billetera.",
              fix: "Elegí una cuenta de tipo {{Cuenta bancaria}}.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto ([[#periodos-cerrados]]).",
            },
          ],
          related: ["acreditar-cheque", "rechazar-cheque"],
          keywords: ["depósito de cheque", "cobrar cheque"],
        },
        {
          id: "acreditar-cheque",
          title: "Marcar un cheque como acreditado",
          permission: ["cheques:write", "transactions:write"],
          prerequisites: ["Que el cheque esté {{Depositado}}."],
          steps: [
            "En [[/checks]], en la fila del cheque, hacé clic en {{Marcar acreditado}}.",
            "Elegí la {{Fecha de acreditación}} y, si querés, {{Notas (opcional)}}.",
            "Hacé clic en {{Marcar acreditado}}.",
          ],
          after: [
            "El cheque pasa a {{Acreditado}}. No mueve plata: entró con el depósito; este paso solo cierra el ciclo del cheque.",
          ],
          related: ["depositar-cheque"],
          keywords: ["acreditación", "cheque acreditado"],
        },
        {
          id: "endosar-cheque",
          title: "Endosar un cheque a un proveedor",
          summary:
            "Un cheque de la cartera se entrega como medio de pago en una orden de pago.",
          permission: [...PAYMENT_ORDER_FORM_PERMISSIONS],
          prerequisites: [
            "Que el cheque esté {{En cartera}} y en la moneda de la orden de pago.",
          ],
          steps: [
            "Abrí una orden de pago nueva: en [[/payment-orders]] o con {{Pagar a proveedor}} en [[/treasury]] ([[#pagar-a-proveedor-desde-tesoreria]]).",
            "En {{Medios de pago}}, hacé clic en {{Endosar cheque}}.",
            "En la lista {{Cheques en cartera}}, hacé clic en el cheque. Se agrega como línea {{Endoso de cheque}} por su monto.",
            "Completá el resto de la orden y emitila con {{Emitir orden de pago}}.",
          ],
          after: [
            "El cheque pasa a {{Endosado}} y sale de la cartera.",
            "Si después el cheque rebota, registralo con {{Rechazar}} ([[#rechazar-cheque]]): la deuda con el proveedor vuelve.",
          ],
          related: ["pagar-a-proveedor-desde-tesoreria", "rechazar-cheque"],
          keywords: ["endoso", "pagar con cheque de tercero"],
        },
        {
          id: "rechazar-cheque",
          title: "Registrar el rechazo de un cheque",
          summary:
            "Cuando un cheque rebota: en cartera, depositado, endosado o vendido.",
          permission: ["cheques:write", "transactions:write"],
          screens: [
            {
              kind: "dialog",
              title: "~Rechazar check 00012345",
              description:
                "El banco rechazó el cheque. Sale de la cuenta donde se depositó y queda como deuda del firmante (Deudores por cheques rechazados).",
              fields: [
                { label: "Canal", kind: "select", value: "Jouve fiscal" },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 2,
                },
                {
                  label: "Cuenta de la devolución",
                  kind: "select",
                  value: "La cuenta de la venta",
                  marker: 3,
                  wide: true,
                },
                { label: "Notas (opcional)", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Rechazar", variant: "destructive", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/checks]], en la fila del cheque, hacé clic en {{Rechazar}}.",
            "Revisá el {{Canal}} (si el cheque no tiene, elegilo), la {{Fecha}} y, si querés, {{Notas (opcional)}}.",
            {
              text: "Si el cheque estaba {{Vendido}}, elegí en {{Cuenta de la devolución}} cómo se le devuelve al comprador:",
              substeps: [
                "{{La cuenta de la venta}}: sale de la cuenta donde entró el neto.",
                "Otra cuenta de la lista: sale de esa.",
                "{{Todavía no lo debitó (queda como deuda)}}: no se mueve plata ahora; queda una deuda con el comprador que pagás después ([[#pagar-cheque-vendido-rechazado]]).",
              ],
            },
            "Hacé clic en {{Rechazar}}.",
          ],
          after: [
            "El cheque pasa a {{Rechazado}} y queda como deuda del firmante en «Deudores por cheques rechazados»; esa deuda se cobra después con un recibo al cliente.",
            "Según de dónde venía: si estaba en cartera, sale de la cartera; si estaba depositado, sale del banco donde se depositó; si estaba endosado, la deuda con el proveedor vuelve; si estaba vendido, sale la devolución al comprador (o queda la deuda).",
          ],
          errors: [
            {
              message: "Elegí el canal del rechazo.",
              fix: "Elegí el {{Canal}}.",
            },
            {
              message: "No se encontró la cuenta donde se depositó el cheque.",
              fix: "Avisale a un administrador: el depósito del cheque no tiene cuenta registrada.",
            },
            {
              message:
                "Elegí la cuenta de la que sale la devolución al comprador.",
              fix: "Elegí una cuenta en {{Cuenta de la devolución}}.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto ([[#periodos-cerrados]]).",
            },
          ],
          related: ["pagar-cheque-vendido-rechazado"],
          keywords: ["cheque rebotado", "cheque rechazado", "sin fondos"],
        },
        {
          id: "vender-cheques",
          title: "Vender (descontar) cheques",
          summary:
            "Descuento con un banco o financiera: los cheques salen de la cartera y el neto entra en una cuenta.",
          permission: ["cheques:write", "transactions:write"],
          prerequisites: [
            "Cheques {{En cartera}} de la misma moneda y del mismo canal.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Vender 2 cheques",
              description:
                "Descuento con un banco o financiera. Los cheques salen de la cartera, el neto entra en la cuenta elegida y los intereses y comisiones quedan como gasto financiero. Si un cheque vendido se rechaza, el comprador lo devuelve y queda como deuda del firmante.",
              fields: [
                {
                  label: "Comprador",
                  kind: "input",
                  value: "Financiera Andes SA",
                  marker: 3,
                },
                { label: "CUIT (opcional)", kind: "input", marker: 3 },
                {
                  label: "Cuenta donde entra el neto",
                  kind: "select",
                  value: "Banco Galicia ARS",
                  marker: 4,
                  wide: true,
                },
                { label: "Canal", kind: "select", value: "Jouve fiscal" },
                { label: "Fecha", kind: "date", value: "05/11/2026" },
                {
                  label: "Intereses",
                  kind: "money",
                  value: "45.000,00",
                  marker: 5,
                },
                {
                  label: "Comisiones y gastos",
                  kind: "money",
                  value: "8.000,00",
                  marker: 5,
                },
                { label: "Notas (opcional)", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Vender", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            "En [[/checks]], marcá la casilla de los cheques {{En cartera}} que vendés.",
            "Hacé clic en {{Vender}} (muestra cuántos elegiste).",
            "Escribí el {{Comprador}} y, si lo tenés, su {{CUIT (opcional)}}.",
            "En {{Cuenta donde entra el neto}}, elegí el banco, caja o billetera (de la moneda de los cheques). Revisá {{Canal}} y {{Fecha}}.",
            "Cargá {{Intereses}} y {{Comisiones y gastos}}. Abajo se ve el {{Valor nominal}} y el {{Neto a cobrar}}.",
            "Hacé clic en {{Vender}}.",
          ],
          after: [
            "Los cheques pasan a {{Vendido}}, el neto entra en la cuenta elegida y los intereses y comisiones quedan como gasto financiero (en el canal fiscal, con sus asientos).",
            "La venta aparece en {{Ventas de cheques}} y lo vendido sin vencer se ve como pasivo contingente en [[/treasury]].",
            "Los e-cheq que recibe Galicia se cargan con {{Cargar e-cheq de Galicia}} (en [[/checks]]): subís el «Listado de cheques recibidos», y cada e-cheq en custodia, en depósito o pagado desde la fecha elegida entra como el recibo del cliente que te lo endosó (o del librador, si te lo emitió a vos), con la fecha del endoso. En el extracto, cada «G. de Echeq Q<número>» propone {{Depositar cheque}} con su número: lo deposita en la cuenta, lo acredita y concilia la línea.",
            "Con el comprobante del banco es más rápido: {{Vender con comprobante}} lee el PDF del descuento (el «Comprobante final» de Banco Galicia), marca los cheques de la cartera que vende (por número e importe) y abre la venta con el comprador, la cuenta, la fecha y la operación. Si falta algún cheque en la cartera, dice cuál: cargalo y volvé a subirlo. Los intereses, el IVA, los sellos y el IIBB quedan en cero en la venta porque el banco los debita como líneas aparte del extracto, que se aceptan ahí.",
            "En el extracto, cada «Credito Descuento Documento» (uno por N° de préstamo del comprobante) propone {{Conciliar}} con los cheques vendidos que suman ese crédito.",
          ],
          errors: [
            {
              message:
                "Los cheques de una venta tienen que ser de la misma moneda.",
              fix: "Vendé por separado los cheques de cada moneda.",
            },
            {
              message:
                "Los cheques son de canales distintos: vendelos por separado.",
              fix: "Hacé una venta por canal.",
            },
            {
              message: "Falta el comprador.",
              fix: "Escribí el {{Comprador}}.",
            },
            {
              message: "Elegí la cuenta donde entra el neto.",
              fix: "Elegí la cuenta.",
            },
            {
              message: "El neto tiene que ser mayor a cero.",
              fix: "Revisá intereses y comisiones: no pueden igualar ni superar el valor de los cheques.",
            },
            {
              message: "El cheque … ya no está en cartera (…).",
              fix: "Otro usuario movió el cheque: actualizá la pantalla y sacalo de la selección.",
            },
            {
              message:
                "La cuenta destino tiene que estar en la moneda de los cheques (…).",
              fix: "Elegí una cuenta en la moneda de los cheques.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto ([[#periodos-cerrados]]).",
            },
          ],
          related: ["anular-venta-cheques", "rechazar-cheque"],
          keywords: ["descuento de cheques", "vender cheques", "financiera"],
        },
        {
          id: "anular-venta-cheques",
          title: "Anular una venta de cheques cargada por error",
          permission: ["cheques:write", "transactions:write"],
          prerequisites: [
            "Que ningún cheque de la venta se haya rechazado ni movido después, y que el mes de la venta no esté cerrado.",
          ],
          steps: [
            "En [[/checks]], en {{Ventas de cheques}}, hacé clic en {{Anular}} en la venta.",
            "Escribí el {{Motivo}}.",
            "Hacé clic en {{Anular venta}}.",
          ],
          after: [
            "Los cheques vuelven a {{En cartera}} y se borran la transferencia a la cuenta, los intereses y las comisiones. La venta queda en la lista como anulada, con su motivo.",
          ],
          errors: [
            {
              message: "Contá por qué se anula la venta.",
              fix: "Escribí el {{Motivo}}.",
            },
            {
              message:
                "El cheque … ya no está vendido (…): la venta no se anula.",
              fix: "Un cheque de la venta ya se rechazó o movió: la venta no se puede anular.",
            },
            {
              message:
                "El período contable … está cerrado: la venta ya no se anula.",
              fix: "Pedí que reabran el mes ([[#periodos-cerrados]]).",
            },
          ],
          related: ["vender-cheques"],
        },
        {
          id: "pagar-cheque-vendido-rechazado",
          title: "Pagarle al comprador un cheque vendido que rebotó",
          summary:
            "Cuando al rechazar elegiste que el comprador todavía no lo debitó, la deuda queda pendiente hasta que la pagás.",
          permission: ["cheques:write", "transactions:write"],
          prerequisites: [
            "Que el cheque figure en {{Cheques vendidos rechazados por pagar al comprador}}.",
          ],
          steps: [
            "En [[/checks]], en {{Cheques vendidos rechazados por pagar al comprador}}, hacé clic en {{Pagar}} en el cheque.",
            "Elegí la {{Cuenta}} de la que sale (de la moneda del cheque) y la {{Fecha}}.",
            "Hacé clic en {{Pagar}}.",
          ],
          after: [
            "Sale la plata de la cuenta elegida y la deuda con el comprador queda pagada.",
          ],
          errors: [
            {
              message: "El pago no puede ser anterior al rechazo (…).",
              fix: "Usá una fecha igual o posterior al rechazo.",
            },
            {
              message: "La cuenta tiene que estar en la moneda del cheque (…).",
              fix: "Elegí una cuenta en la moneda del cheque.",
            },
            {
              message:
                "La deuda se paga desde un banco, caja o billetera, no desde una cartera de cheques.",
              fix: "Elegí un banco, caja o billetera.",
            },
          ],
          related: ["rechazar-cheque"],
        },
      ],
    },

    // ── Cheques propios ──────────────────────────────────────────────────
    {
      id: "cheques-propios",
      title: "Cheques propios",
      menuPath: "Tesorería › Cheques propios",
      routes: ["/issued-checks"],
      permission: "issued_checks:read",
      intro: [
        "Los cheques que la empresa emite a proveedores, para seguir cuáles siguen en circulación. Los que se emiten en una orden de pago ({{Emitir cheque}} en {{Medios de pago}}) aparecen solos; la plata de esos se mueve con la orden.",
        "La tabla muestra {{Cheque}} (número y banco), {{Tipo}}, {{Beneficiario}}, {{Vence}}, {{Monto}}, {{Estado}} ({{Emitido}}, {{Cobrado}}, {{Rechazado}}, {{Anulado}}) y las {{Acciones}} de los cheques emitidos.",
      ],
      screens: [
        {
          kind: "page",
          title: "Cheques propios",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Cargar cheque", variant: "primary" },
          ],
          table: {
            columns: [
              "Cheque",
              "Tipo",
              "Beneficiario",
              "Vence",
              "Monto",
              "Estado",
              "Acciones",
            ],
            rows: [
              [
                "#45001234 Banco Galicia",
                "Físico",
                "Repuestos Pampa SRL",
                "15/11/2026",
                "$320.000,00",
                "Emitido",
                "",
              ],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "cargar-cheque-propio",
          title: "Cargar un cheque propio a mano",
          summary: "Para un cheque emitido fuera de una orden de pago.",
          permission: "issued_checks:write",
          prerequisites: ["Una cuenta bancaria activa (la chequera)."],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo cheque propio",
              description:
                "Registrá un cheque emitido fuera de una orden de pago. No mueve plata hasta que lo marques cobrado: ahí sale de la chequera como un gasto en Caja.",
              fields: [
                { label: "Tipo", kind: "select", value: "Físico", marker: 2 },
                {
                  label: "Número",
                  kind: "input",
                  value: "45001234",
                  marker: 2,
                },
                {
                  label: "Banco",
                  kind: "input",
                  value: "Banco Galicia",
                  marker: 2,
                },
                {
                  label: "Cuenta bancaria (chequera)",
                  kind: "select",
                  marker: 3,
                  wide: true,
                },
                { label: "Canal", kind: "select", marker: 3, wide: true },
                {
                  label: "Fecha de emisión",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 4,
                },
                {
                  label: "Fecha de cobro",
                  kind: "date",
                  value: "15/11/2026",
                  marker: 4,
                },
                {
                  label: "Monto",
                  kind: "money",
                  value: "320.000,00",
                  marker: 4,
                },
                { label: "Moneda", kind: "select", value: "ARS", marker: 4 },
                {
                  label: "Beneficiario (proveedor)",
                  kind: "picker",
                  marker: 5,
                  wide: true,
                },
                { label: "Nombre del beneficiario (opcional)", kind: "input" },
                { label: "CUIT beneficiario (opcional)", kind: "input" },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Cargar cheque", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            "En [[/issued-checks]], hacé clic en {{Cargar cheque}}.",
            "Completá {{Tipo}}, {{Número}} y {{Banco}}.",
            "Elegí la {{Cuenta bancaria (chequera)}} y el {{Canal}}.",
            "Completá {{Fecha de emisión}}, {{Fecha de cobro}}, {{Monto}} y {{Moneda}}.",
            "En {{Beneficiario (proveedor)}}, elegí el proveedor (de cualquiera de los dos lados). Si el cheque va a nombre de otra persona, completá {{Nombre del beneficiario (opcional)}} y {{CUIT beneficiario (opcional)}}.",
            "Hacé clic en {{Cargar cheque}}.",
          ],
          after: [
            "El cheque queda {{Emitido}}. No mueve plata ni genera asiento hasta que lo marques {{Cobrado}}: recién ahí sale de la chequera como un egreso en Caja ([[#marcar-cheque-propio-cobrado]]).",
          ],
          errors: [
            {
              message: "No tenés permiso para cargar cheques propios.",
              fix: "Hace falta el permiso de cheques propios: pedíselo al owner.",
            },
            {
              message: "Número requerido.",
              fix: "Escribí el número.",
            },
            {
              message: "Banco requerido.",
              fix: "Escribí el banco.",
            },
            {
              message: "Cuenta bancaria requerida.",
              fix: "Elegí la chequera.",
            },
            {
              message: "Canal requerido.",
              fix: "Elegí el canal.",
            },
            {
              message: "Ya cargaste un cheque con ese número del mismo banco.",
              fix: "Revisá el número: ese cheque ya está en la lista.",
            },
          ],
          related: ["editar-cheque-propio", "marcar-cheque-propio-cobrado"],
          keywords: ["cheque emitido", "chequera", "echeq propio"],
        },
        {
          id: "editar-cheque-propio",
          title: "Editar un cheque propio",
          permission: "issued_checks:write",
          prerequisites: ["Que el cheque esté {{Emitido}}."],
          steps: [
            "En [[/issued-checks]], en la fila del cheque, hacé clic en el lápiz ({{Editar}}).",
            "Corregí los datos o reasignalo a otro proveedor en {{Beneficiario (proveedor)}}. Si el cheque es de una orden de pago, el monto, la moneda y la cuenta aparecen bloqueados: se cambian editando la orden.",
            "Hacé clic en {{Guardar cambios}}.",
          ],
          errors: [
            {
              message:
                "El cheque está ligado a una orden de pago: el monto, la moneda, la cuenta y la OP se cambian editando la orden de pago.",
              fix: "Editá la orden de pago en [[/payment-orders]].",
            },
            {
              message:
                "El cheque ya no está emitido: su monto, moneda y cuenta quedaron registrados en Caja y no se pueden cambiar.",
              fix: "Ya se cobró, rechazó o anuló: no se puede corregir.",
            },
            {
              message: "Otro cheque del mismo banco ya usa ese número.",
              fix: "Revisá el número.",
            },
          ],
          related: ["cargar-cheque-propio"],
        },
        {
          id: "marcar-cheque-propio-cobrado",
          title: "Marcar un cheque propio como cobrado (debitado)",
          summary: "Cuando el banco debita el cheque de la cuenta.",
          permission: ["issued_checks:write", "transactions:write"],
          prerequisites: ["Que el cheque esté {{Emitido}}."],
          steps: [
            "En [[/issued-checks]], en la fila del cheque, hacé clic en el ícono {{Marcar cobrado}}.",
            "Confirmá con {{Cobrado}}. No pide fecha: el cobro queda con la fecha de hoy.",
          ],
          after: [
            "El cheque pasa a {{Cobrado}} y ya no cambia de estado.",
            "Si se cargó a mano (sin orden de pago), se registra en Caja, con fecha de hoy, el egreso de la chequera por el importe del cheque («Cobro cheque propio #…»), en el canal del cheque. Si el canal es fiscal, también se genera el asiento: debita la cuenta de gasto por defecto del proveedor beneficiario (o «gastos» si no tiene) y acredita el banco. Un cheque en dólares se asienta en pesos a la cotización de ese día; sin cotización cargada no se genera el asiento.",
            "Si es de una orden de pago, Caja no se mueve: la plata ya salió con la orden. Si el canal es fiscal, el asiento pasa el importe de «cheques diferidos emitidos» al banco.",
          ],
          errors: [
            {
              message:
                "El cheque no tiene canal: asignale uno antes de marcarlo cobrado",
              fix: "El cheque quedó sin canal y la edición no lo cambia: avisale a un administrador.",
            },
            {
              message:
                "El cheque ya no está emitido (se cobró, rechazó o anuló antes). Recargá la página.",
              fix: "Actualizá la página.",
            },
            {
              message:
                "Mueve plata de una cuenta: necesitás también permiso para cargar movimientos.",
              fix: "Pedí también el permiso de movimientos de Caja.",
            },
          ],
          related: ["marcar-cheque-propio-rechazado"],
          keywords: ["débito de cheque", "cheque debitado"],
        },
        {
          id: "marcar-cheque-propio-rechazado",
          title: "Marcar un cheque propio como rechazado",
          permission: ["issued_checks:write", "transactions:write"],
          prerequisites: ["Que el cheque esté {{Emitido}}."],
          steps: [
            "En [[/issued-checks]], en la fila del cheque, hacé clic en el ícono {{Marcar rechazado}}.",
            "Confirmá con {{Rechazado}}. El rechazo queda con la fecha de hoy.",
          ],
          after: [
            "El cheque pasa a {{Rechazado}} y ya no cambia de estado.",
            "Si salió de una orden de pago, la plata nunca salió del banco: se registra un ingreso en la chequera por su importe y la deuda con el proveedor vuelve (en el canal fiscal, con su asiento).",
            "Si se cargó a mano, no se mueve plata ni se genera asiento: nunca salió nada.",
          ],
          errors: [
            {
              message:
                "El cheque no tiene canal: asignale uno antes de marcarlo rechazado",
              fix: "El cheque quedó sin canal y la edición no lo cambia: avisale a un administrador.",
            },
            {
              message:
                "El cheque ya no está emitido (se cobró, rechazó o anuló antes). Recargá la página.",
              fix: "Actualizá la página.",
            },
          ],
          related: ["marcar-cheque-propio-cobrado"],
        },
        {
          id: "anular-cheque-propio",
          title: "Anular un cheque propio",
          permission: "issued_checks:write",
          prerequisites: [
            "Que esté {{Emitido}} y no sea de una orden de pago: el cheque de una orden se anula anulando o editando la orden.",
          ],
          steps: [
            "En [[/issued-checks]], en la fila del cheque, hacé clic en el ícono {{Anular}}.",
            "Confirmá en el aviso {{Anular este cheque}}.",
          ],
          after: [
            "El cheque pasa a {{Anulado}} y queda fuera de circulación. No se puede deshacer desde la pantalla.",
          ],
          related: ["cargar-cheque-propio"],
        },
      ],
    },

    // ── Pagos recurrentes ────────────────────────────────────────────────
    {
      id: "pagos-recurrentes",
      title: "Pagos recurrentes",
      menuPath: "Tesorería › Pagos recurrentes",
      routes: ["/recurring-payments"],
      permission: "recurring_payments:read",
      intro: [
        "Los compromisos de pago que se repiten (alquiler, servicios, préstamos, impuestos, sueldos fijos). No generan movimientos ni asientos: alimentan la proyección de [[/treasury/cash-flow]].",
        "La tabla muestra {{Descripción}}, {{Categoría}}, {{Monto}}, {{Frecuencia}}, {{Próx. venc.}} y el interruptor {{Activo}}.",
      ],
      tasks: [
        {
          id: "crear-pago-recurrente",
          title: "Cargar un pago recurrente",
          permission: "recurring_payments:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo pago recurrente",
              description:
                "Compromiso de egreso que se repite (alquiler, servicios, préstamos, impuestos, sueldos). Alimenta el cash-flow proyectado.",
              fields: [
                {
                  label: "Descripción",
                  kind: "input",
                  value: "Alquiler depósito",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Categoría",
                  kind: "select",
                  value: "Alquiler",
                  marker: 3,
                },
                {
                  label: "Frecuencia",
                  kind: "select",
                  value: "Mensual",
                  marker: 3,
                },
                {
                  label: "Monto",
                  kind: "money",
                  value: "1.200.000,00",
                  marker: 4,
                },
                { label: "Moneda", kind: "select", value: "ARS", marker: 4 },
                {
                  label: "Próximo vencimiento",
                  kind: "date",
                  value: "10/12/2026",
                  marker: 5,
                },
                { label: "Fin (opcional)", kind: "date", marker: 5 },
                {
                  label: "Canal (opcional)",
                  kind: "select",
                  value: "Ninguno",
                  marker: 6,
                  wide: true,
                },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 7 },
              ],
            },
          ],
          steps: [
            "En [[/recurring-payments]], hacé clic en {{Nuevo pago}}.",
            "Escribí la {{Descripción}}.",
            "Elegí la {{Categoría}} ({{Alquiler}}, {{Servicios}}, {{Préstamo}}, {{Impuesto}}, {{Sueldo fijo}} u {{Otro}}) y la {{Frecuencia}} ({{Semanal}}, {{Mensual}}, {{Trimestral}} o {{Anual}}).",
            "Escribí el {{Monto}} (mayor a cero) y elegí la {{Moneda}}.",
            "Elegí el {{Próximo vencimiento}} y, si termina, el {{Fin (opcional)}} (no puede ser anterior al próximo vencimiento).",
            "Si querés que la proyección lo cuente como fiscal o interno, elegí el {{Canal (opcional)}}; sin canal se proyecta como «otros».",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "El flujo de caja proyecta una salida en cada vencimiento hasta el fin. Un {{Préstamo}} recurrente no se proyecta si ya hay un préstamo cargado del mismo lado en [[/loans]].",
          ],
          errors: [
            {
              message: "Descripción requerida.",
              fix: "Escribí la descripción.",
            },
            {
              message: "El monto debe ser mayor a 0.",
              fix: "Escribí un monto mayor a cero.",
            },
            {
              message: "Fecha requerida.",
              fix: "Elegí el próximo vencimiento.",
            },
            {
              message: "El fin no puede ser anterior al próximo vencimiento.",
              fix: "Corregí la fecha de fin.",
            },
            {
              message: "No tenés permiso para crear pagos recurrentes.",
              fix: "Pedí el permiso de pagos recurrentes.",
            },
          ],
          related: ["editar-pago-recurrente", "flujo-de-caja"],
          keywords: ["alquiler", "servicios", "gasto fijo", "compromiso"],
        },
        {
          id: "editar-pago-recurrente",
          title: "Editar un pago recurrente",
          permission: "recurring_payments:write",
          steps: [
            "En [[/recurring-payments]], abrí el menú ⋯ de la fila y elegí {{Editar}}.",
            "En {{Editar pago recurrente}}, cambiá lo que necesites (por ejemplo, el {{Próximo vencimiento}} o el {{Monto}} actualizado).",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "La proyección del flujo de caja se recalcula con los datos nuevos.",
          ],
          errors: [
            {
              message: "No tenés permiso para editar pagos recurrentes.",
              fix: "Pedí el permiso de pagos recurrentes.",
            },
          ],
          related: ["crear-pago-recurrente"],
        },
        {
          id: "activar-pago-recurrente",
          title: "Pausar o reactivar un pago recurrente",
          permission: "recurring_payments:write",
          steps: [
            "En [[/recurring-payments]], usá el interruptor {{Activo}} de la fila.",
          ],
          after: [
            "Un pago inactivo deja de proyectarse en el flujo de caja, pero queda en la lista.",
          ],
          errors: [
            {
              message: "No se pudo cambiar el estado.",
              fix: "Probá de nuevo; si sigue, avisale a un administrador.",
            },
          ],
          related: ["borrar-pago-recurrente"],
        },
        {
          id: "borrar-pago-recurrente",
          title: "Borrar un pago recurrente",
          permission: "recurring_payments:write",
          steps: [
            "En [[/recurring-payments]], abrí el menú ⋯ de la fila y elegí {{Borrar}}.",
            "Confirmá en el aviso.",
          ],
          after: [
            "Se elimina el pago recurrente. No se puede deshacer: si solo querés pausarlo, usá el interruptor {{Activo}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para borrar pagos recurrentes.",
              fix: "Pedí el permiso de pagos recurrentes.",
            },
          ],
          related: ["activar-pago-recurrente"],
        },
      ],
    },

    // ── Tarjetas ─────────────────────────────────────────────────────────
    {
      id: "tarjetas",
      title: "Tarjetas de crédito",
      menuPath: "Tesorería › Tarjetas",
      routes: ["/card-statements"],
      permission: TREASURY_READ,
      intro: [
        "Los resúmenes de las tarjetas de crédito de la empresa (por ejemplo, la VISA Business de Banco Galicia). Cada consumo es un gasto de la empresa, con su cuenta contable, o un adelanto de sueldo de un empleado (un socio que también es empleado). Los cargos del banco (IVA, percepciones, sellos, comisión) van a sus cuentas.",
        "Nada se registra al cargar el resumen: los gastos y los adelantos entran en la cuenta del banco cuando el banco debita el pago, desde el extracto.",
      ],
      tasks: [
        {
          id: "cargar-resumen-tarjeta",
          title: "Cargar un resumen y definir qué es cada consumo",
          permission: [
            "accounting:read",
            "accounts:read",
            "transactions:write",
          ],
          steps: [
            "En [[/card-statements]], hacé clic en {{Subir resumen}} y elegí el PDF que bajás del home banking.",
            "Revisá lo que leyó (tarjetas, consumos, cargos y total), elegí la {{Cuenta que paga la tarjeta}} y hacé clic en {{Cargar}}.",
            "En cada tarjeta, elegí qué son por defecto sus consumos ({{Gasto de la empresa}} con su cuenta, o {{Adelanto de sueldo}} con el empleado): se aplica a sus consumos y se recuerda para los próximos resúmenes.",
            "Si un consumo es otra cosa, cambialo en su fila. Los cargos del banco ya vienen con su cuenta (los sellos, en «5.4.4 Impuesto de sellos»).",
          ],
          after: [
            "El resumen queda {{Pendiente}} hasta que el banco debita el pago. Si te equivocaste de archivo, {{Borrar resumen}} lo saca mientras no tenga ningún pago.",
          ],
          keywords: ["tarjeta", "visa", "resumen", "adelanto", "socio"],
        },
        {
          id: "pagar-resumen-tarjeta",
          title: "Pagar el resumen desde el extracto",
          permission: [
            "accounting:read",
            "accounts:read",
            "transactions:write",
          ],
          prerequisites: [
            "El resumen cargado, con todos sus consumos y cargos definidos.",
            "El extracto del banco con el débito del pago («Pago Visa Empresa» en Galicia).",
          ],
          steps: [
            "En la pestaña {{Extracto}} de la cuenta, la línea del pago muestra el resumen que paga y el botón {{Pagar resumen}}.",
            "Hacé clic en {{Pagar resumen}}. El banco debita los pesos y los dólares por separado: cada débito paga su parte, y el de dólares toma la cotización que aplicó el banco.",
          ],
          after: [
            "En la cuenta del banco, con la fecha del débito, queda un egreso por cada cuenta contable y un adelanto por cada empleado (en su cuenta corriente), y la línea del extracto queda conciliada con ellos.",
            "Si la parte que pagás tiene adelantos de sueldo, pide también el permiso de escritura de Personal; si tiene IVA o percepciones, el de Impuestos.",
            "Si pagaste con el débito equivocado, en el resumen deshacé el pago de los pesos (o de los dólares) y confirmá con {{Deshacer pago}}: borra sus egresos y adelantos con sus asientos, la línea del extracto vuelve a pendiente y los consumos se pueden cambiar otra vez.",
          ],
          keywords: ["pago tarjeta", "visa", "debito automatico"],
        },
      ],
    },

    // ── Préstamos ────────────────────────────────────────────────────────
    {
      id: "prestamos",
      title: "Préstamos y leasing",
      menuPath: "Tesorería › Préstamos",
      routes: ["/loans", "/loans/[id]"],
      permission: TREASURY_READ,
      intro: [
        "Los préstamos y leasings de la empresa con su cronograma de cuotas. Las cuotas pendientes se proyectan en [[/treasury/cash-flow]].",
        "La lista muestra {{Descripción}} (con el tipo, {{Préstamo}} o {{Leasing}}, y el número del banco), {{Banco}}, {{Capital}}, {{Capital adeudado}}, {{Cuotas pagas}}, {{Pendiente}} (con la cantidad de cuotas), {{Próx. venc.}} y {{Estado}} ({{Activo}}, {{Cancelado}} cuando se pagó la última cuota, {{Anulado}}).",
        "En el detalle (clic en la descripción o {{Ver cuotas}}) se ve lo mismo que en el home banking: arriba {{Capital adeudado}}, {{Cuotas pagas}}, {{Próxima cuota}} y {{Vencimiento próxima cuota}}; en {{General}} el estado, el monto original, la fecha de alta, el plazo y lo pendiente; en {{Tasas}} la TNA, la TEA, el CFT y los intereses pagados; y el {{Plan de cuotas}} con {{Total a pagar}}, {{Capital}}, {{Intereses}}, {{Otros}}, {{IVA}} y el estado de cada una ({{Pagada}}, {{Pagada (antes de cargar)}}, {{Vencida}} o la fecha en que vence).",
      ],
      screens: [
        {
          kind: "page",
          title: "Préstamos y leasing",
          actions: [{ label: "Nuevo préstamo", variant: "primary" }],
          table: {
            columns: [
              "Descripción",
              "Banco",
              "Capital",
              "Capital adeudado",
              "Cuotas pagas",
              "Pendiente",
              "Próx. venc.",
              "Estado",
            ],
            rows: [
              [
                "Préstamo a Sola Firma",
                "Banco Macro",
                "$ 18.000.000,00",
                "$ 1.783.037,51",
                "11/12",
                "$ 1.850.555,27 (1)",
                "03/12/2026",
                "Activo",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      concepts: [
        {
          title: "Qué asientos hace un préstamo",
          body: [
            "Como todo movimiento de Caja, solo genera asientos un préstamo de canal fiscal.",
            "Registrar el desembolso deja el ingreso en el banco y lo asienta contra la deuda del préstamo (pasivo).",
            "Pagar una cuota deja el egreso en la cuenta elegida. Si la cuota tiene desglose, el capital baja la deuda del préstamo y el resto va a intereses, IVA crédito fiscal y percepciones. Sin desglose, si el desembolso está registrado se toma primero como capital lo que todavía se debe y el resto como interés; si no, la cuota entera va a gastos.",
            "En un préstamo en dólares, el capital se da de baja a la cotización del desembolso y la diferencia con la del pago va a diferencia de cambio.",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-prestamo",
          title: "Cargar un préstamo o leasing",
          permission: "accounting:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo préstamo / leasing",
              description:
                "Cargá los datos del préstamo como los muestra el banco y su plan de cuotas. Las cuotas que el banco da por pagadas quedan pagadas, sin movimiento en Caja.",
              fields: [
                { label: "Tipo", kind: "select", value: "Préstamo", marker: 2 },
                { label: "Moneda", kind: "select", value: "ARS", marker: 2 },
                {
                  label: "Banco",
                  kind: "input",
                  value: "Banco Macro",
                  marker: 2,
                },
                {
                  label: "Número de préstamo",
                  kind: "input",
                  value: "7670122511",
                  marker: 2,
                },
                {
                  label: "Descripción",
                  kind: "input",
                  value: "Préstamo a Sola Firma",
                  marker: 3,
                },
                {
                  label: "Cuenta de débito",
                  kind: "select",
                  value: "Banco Macro",
                  marker: 3,
                },
                {
                  label: "Fecha de alta",
                  kind: "date",
                  value: "04/12/2025",
                  marker: 3,
                },
                {
                  label: "Monto original",
                  kind: "money",
                  value: "18.000.000,00",
                  marker: 3,
                },
                { label: "TNA (%)", kind: "input", value: "40,00", marker: 3 },
                {
                  label: "Plan de cuotas del banco",
                  kind: "textarea",
                  marker: 4,
                  wide: true,
                },
                { label: "Notas (opcional)", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/loans]], hacé clic en {{Nuevo préstamo}}.",
            "Elegí el {{Tipo}} ({{Préstamo}} o {{Leasing}}) y la {{Moneda}}, y escribí el {{Banco}} y el {{Número de préstamo}}.",
            "Escribí la {{Descripción}}, elegí la {{Cuenta de débito}} (de donde el banco debita las cuotas) y cargá la {{Fecha de alta}}, el {{Monto original}} y las tasas ({{TNA (%)}}, {{TEA (%)}}, {{CFT (%)}}) como figuran en el banco.",
            {
              text: "En {{Plan de cuotas}} elegí cómo se arman las cuotas.",
              substeps: [
                "{{Pegar del banco}}: en el home banking abrí el préstamo › Plan de cuotas, seleccioná la tabla entera, copiala y pegala. Toma cada cuota con su capital, intereses, otros rubros e IVA, y las que figuran pagadas.",
                "{{Francés (TNA)}}: capital más interés igual todos los meses, con la cantidad de {{Cuotas}} y la {{1ª cuota}}.",
                "{{Capital fijo (TNA)}}: el mismo capital todos los meses y el interés sobre lo que se debe (sistema alemán, como los de Banco Provincia). Si el banco cobra el interés por los días del período, marcá «Interés por días reales» (cuenta desde la {{Fecha de alta}}); si lista el capital y el interés como dos cuotas del mismo día, marcá «Interés en cuota aparte».",
                "{{Cuotas iguales}}: el monto original dividido en partes iguales, sin desglose.",
                "Si el banco numera cuotas al otorgar el préstamo (Banco Provincia: la 1 con los impuestos del otorgamiento y la 2 en $0, el día del alta), cargá cuántas en {{Cuotas del otorgamiento}} y el importe en {{Impuestos al otorgamiento}}: así los números coinciden con los del banco.",
                "Si el préstamo ya venía pagándose, poné en {{Ya pagadas (hasta la Nº)}} el número de la última cuota paga, como lo muestra el banco: quedan pagadas, sin movimiento en Caja.",
              ],
            },
            "Revisá la vista previa del plan y hacé clic en {{Crear}}.",
          ],
          after: [
            "Se crea el préstamo {{Activo}}, en el canal fiscal, con su plan. Cada cuota pendiente se puede editar después ([[#editar-cuota-prestamo]]).",
            "Las cuotas que el banco da por pagadas quedan {{Pagada (antes de cargar)}}: sin movimiento en Caja ni asiento, porque esa plata salió antes de usar el sistema. En ese caso no hace falta registrar el desembolso.",
            "Un préstamo nuevo todavía no tiene plata en Caja: registrá el desembolso cuando el banco lo deposite ([[#registrar-desembolso-prestamo]]).",
            "Cuando el banco debita una cuota, la línea del extracto propone {{Pagar cuota}}: un clic la paga y la concilia ([[#pagar-cuota-prestamo]]).",
          ],
          errors: [
            {
              message: "Descripción requerida.",
              fix: "Escribí la descripción.",
            },
            {
              message:
                "Faltan cuotas: copiá la tabla completa, de la primera a la última.",
              fix: "Copiá de nuevo la tabla del plan desde la cuota 1.",
            },
            {
              message: "Fecha requerida.",
              fix: "Elegí la fecha de la primera cuota.",
            },
            {
              message: "Sin permiso para crear préstamos.",
              fix: "Hace falta permiso de escritura en Contabilidad.",
            },
          ],
          related: ["registrar-desembolso-prestamo", "pagar-cuota-prestamo"],
          keywords: ["préstamo bancario", "leasing", "crédito", "cronograma"],
        },
        {
          id: "comprobantes-banco-prestamo",
          title:
            "Cargar los comprobantes de pago del banco (préstamo en curso)",
          summary:
            "Los pagos hechos antes de usar el sistema quedan en contabilidad con su detalle real (capital, intereses, punitorios, IVA y percepciones), sin movimiento en Caja.",
          permission: "accounting:write",
          prerequisites: [
            "El préstamo cargado con su {{Número de préstamo}} y su {{Fecha de alta}}, y con las cuotas pagadas antes ([[#crear-prestamo]]).",
            "Los comprobantes en PDF: en el home banking de Macro, préstamo › {{Comprobantes de pago}}, descargalos.",
          ],
          steps: [
            "Abrí el préstamo en [[/loans]].",
            "En {{Comprobantes del banco}}, hacé clic en {{Subir comprobantes}} y elegí todos los PDF (se pueden elegir varios; los de otro préstamo se descartan solos).",
            "Si el préstamo se otorgó antes del ejercicio abierto, hacé clic en {{Registrar la deuda al}} y la fecha: deja el capital que se debía ese día como deuda. Si se otorgó dentro del ejercicio, el botón es {{Registrar el desembolso del}} y la fecha de alta: asienta el ingreso del banco contra la deuda.",
          ],
          after: [
            "Cada comprobante queda en la tabla con su fecha, cuota, total, capital, intereses, IVA y percepciones.",
            "Los del ejercicio abierto (desde su primer día, por ejemplo el 1 de octubre si el ejercicio arranca en octubre) generan su asiento: el capital baja Préstamos financieros, intereses y punitorios van a Intereses pagados, el IVA a IVA Crédito Fiscal y las percepciones a sus cuentas, contra Bancos. Los de ejercicios anteriores se guardan sin asiento.",
            "No se crea ningún movimiento en Caja. Subir el mismo comprobante otra vez no lo duplica.",
            "Una cuota pagada desde el sistema (por ejemplo, desde el extracto) ya tiene su asiento y su comprobante no lo repite.",
          ],
          errors: [
            {
              message:
                "Cargá el número de préstamo del banco: con él se sabe qué comprobantes son de este préstamo.",
              fix: "El número está en el home banking, arriba del préstamo (por ejemplo 7670122511).",
            },
          ],
          related: ["crear-prestamo", "pagar-cuota-prestamo"],
          keywords: [
            "comprobante de pago",
            "préstamo en curso",
            "cierre de ejercicio",
            "asientos de préstamo",
          ],
        },
        {
          id: "registrar-desembolso-prestamo",
          title: "Registrar el desembolso de un préstamo",
          permission: ["accounting:write", "transactions:write"],
          prerequisites: [
            "Que el préstamo no esté anulado y no tenga el desembolso registrado.",
          ],
          steps: [
            "En el detalle del préstamo, junto a «El desembolso no está registrado en Caja», hacé clic en {{Registrar desembolso}}.",
            {
              text: "Elegí cómo registrarlo:",
              substeps: [
                "{{Registrar el ingreso ahora}}: elegí la {{Fecha}} y la {{Cuenta}} donde entró (de la moneda del préstamo).",
                "{{Usar un ingreso ya cargado en Caja}}: elegí en {{Ingreso}} un ingreso manual ya cargado; tiene que ser del mismo canal, moneda e importe que el capital.",
              ],
            },
            "Hacé clic en {{Registrar}}.",
          ],
          after: [
            "El detalle pasa a decir «Desembolso registrado en Caja». El ingreso queda asentado contra la deuda del préstamo y ya no se edita desde Caja.",
            "Con el desembolso registrado, el préstamo ya no se puede anular.",
          ],
          errors: [
            {
              message:
                "El ingreso tiene que ser del mismo canal, moneda e importe que el capital del préstamo (…)",
              fix: "Elegí un ingreso que coincida, o registrá el ingreso ahora.",
            },
            {
              message:
                "Solo se puede usar un ingreso manual de caja (no uno generado por otro documento)",
              fix: "Elegí un ingreso cargado a mano en Caja.",
            },
            {
              message: "El desembolso de este préstamo ya está registrado",
              fix: "Actualizá la pantalla.",
            },
            {
              message: "Sin permiso para registrar el desembolso.",
              fix: "Hace falta permiso de escritura en Contabilidad y en movimientos de Caja.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto ([[#periodos-cerrados]]).",
            },
          ],
          related: ["crear-prestamo"],
          keywords: ["desembolso", "acreditación del préstamo"],
        },
        {
          id: "editar-cuota-prestamo",
          title: "Editar una cuota (monto, vencimiento o desglose)",
          summary:
            "Para cuotas UVA, de tasa variable, o para separar capital e intereses.",
          permission: "accounting:write",
          prerequisites: [
            "Que la cuota esté {{Pendiente}} y el préstamo {{Activo}}.",
          ],
          steps: [
            "En el detalle del préstamo, en la fila de la cuota, hacé clic en {{Editar}}.",
            "Cambiá el {{Monto}} o el {{Vencimiento}}.",
            {
              text: "Para separar los componentes, marcá {{Desglosar capital, interés, IVA y cargos}} y completá:",
              substeps: [
                "{{Capital}}, {{Interés}}, {{IVA}}, {{Percepción}} y {{Otros cargos (sellos, punitorios)}}. El monto de la cuota pasa a ser la suma.",
              ],
            },
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "La cuota y la proyección del flujo de caja se actualizan. Con desglose, al pagarla el capital baja la deuda y el resto va a intereses, IVA y percepción.",
          ],
          errors: [
            {
              message: "Monto requerido.",
              fix: "Escribí el monto.",
            },
            {
              message: "El monto de la cuota tiene que ser mayor a 0.",
              fix: "Revisá el monto o el desglose.",
            },
            {
              message: "No se puede editar una cuota ya pagada.",
              fix: "Una cuota pagada no cambia.",
            },
            {
              message: "Sin permiso para editar cuotas.",
              fix: "Hace falta permiso de escritura en Contabilidad.",
            },
          ],
          related: ["pagar-cuota-prestamo"],
          keywords: ["cuota UVA", "desglose", "intereses"],
        },
        {
          id: "pagar-cuota-prestamo",
          title: "Pagar una cuota",
          permission: ["accounting:write", "transactions:write"],
          prerequisites: [
            "Que la cuota esté {{Pendiente}} y el préstamo {{Activo}}.",
            "Una cuenta activa en la moneda del préstamo (no una cartera de cheques).",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Pagar cuota 7",
              description:
                "Marca la cuota como pagada y registra el egreso en la cuenta elegida.",
              fields: [
                {
                  label: "Fecha de pago",
                  kind: "date",
                  value: "15/11/2026",
                  marker: 2,
                },
                {
                  label: "Monto",
                  kind: "money",
                  value: "1.000.000,00",
                  marker: 2,
                },
                { label: "Cuenta", kind: "select", marker: 3, wide: true },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Pagar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En el detalle del préstamo, en la fila de la cuota, hacé clic en {{Pagar}}.",
            "Revisá la {{Fecha de pago}} y el {{Monto}} (viene el de la cuota; si la cuota tiene desglose no se cambia).",
            "Elegí la {{Cuenta}} de la que sale el pago.",
            "Hacé clic en {{Pagar}}.",
          ],
          after: [
            "La cuota pasa a {{Pagada}} con su fecha e importe, y se registra el egreso en Caja con su asiento (ver «Qué asientos hace un préstamo»). Ese egreso se corrige desde el préstamo, no desde Caja.",
            "Cuando se paga la última cuota, el préstamo pasa a {{Cancelado}}.",
            "Si el banco ya debitó la cuota, es más rápido desde el extracto: en la pestaña {{Extracto}} de la cuenta, la línea del débito (en Macro, código 361) muestra la cuota que paga y el botón {{Pagar cuota}}. Paga la cuota con la fecha y el importe de la línea, desde la cuenta del extracto, y deja la línea conciliada. Aparece si el préstamo tiene esa {{Cuenta de débito}} y una cuota pendiente que vence hasta 31 días antes o después, por el mismo importe o con hasta un 10 % de diferencia. Si el importe no coincide (el banco cobró interés por días, punitorios o impuestos), {{Pagar cuota}} abre el desglose: Capital, Intereses, Intereses exceso (punitorios), IVA e Impuestos; cargalo como el detalle de la cuota del home banking, tiene que sumar el débito, y hacé clic en {{Pagar y conciliar}}.",
            "Una transferencia entre cuentas de la empresa (por ejemplo «Transf Inmed Cp» a DZ & Sons, o «Transf. Ctas Propias») muestra a qué cuenta fue o de cuál vino: elegila y {{Registrar transferencia}} la registra en las dos cuentas y concilia la línea; la de la otra cuenta se concilia sola si su extracto ya está cargado y tiene una sola línea igual (mismo importe, hasta 3 días de diferencia); si no, queda sugerida y la conciliás desde ahí.",
            "En Banco Provincia el extracto no trae código: las líneas se reconocen por el texto del concepto (por ejemplo «PAGO CUOTA DE PRESTAMO», «IMPUESTO DEBITO - LEY 25413», «RETENCION ARBA»). Una transferencia con el CUIT de la empresa se propone como transferencia entre cuentas propias. Galicia tampoco trae código y se lee igual, por el texto («Imp. Deb. Ley 25413», «Ing. Brutos S/ Cred», el interés, el IVA y los sellos de un descuento de cheques, «Transferencia De Terceros»). La primera vez que se sube un extracto de Macro, Provincia o Galicia a una cuenta sin códigos, los del banco se cargan solos. Una transferencia recibida muestra {{Crear recibo}}: con el cliente ya elegido si su CUIT está en la línea; si no (por ejemplo, un cliente interno, que no tiene CUIT), elegí el lado y el cliente, o crealo con {{Nuevo}}.",
          ],
          errors: [
            {
              message: "Elegí la cuenta de pago.",
              fix: "Elegí la {{Cuenta}}.",
            },
            {
              message:
                "La cuota tiene desglose: se paga por su importe (…). Corregí el desglose antes de pagar otro importe",
              fix: "Editá el desglose de la cuota si el importe pagado fue otro.",
            },
            {
              message: "La cuota no existe o ya está pagada",
              fix: "Actualizá la pantalla.",
            },
            {
              message:
                "El préstamo está anulado: no se pueden pagar sus cuotas",
              fix: "El préstamo fue anulado.",
            },
            {
              message: "Sin permiso para registrar pagos.",
              fix: "Hace falta permiso de escritura en Contabilidad y en movimientos de Caja.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá una fecha de un mes abierto ([[#periodos-cerrados]]).",
            },
          ],
          related: ["vincular-egreso-cuota", "editar-cuota-prestamo"],
          keywords: ["pagar cuota", "cuota del préstamo", "leasing"],
        },
        {
          id: "vincular-egreso-cuota",
          title: "Pagar una cuota con un egreso ya cargado en Caja",
          summary:
            "Si el banco debitó la cuota y ya la cargaste como egreso manual, se usa ese egreso en vez de crear otro.",
          permission: ["accounting:write", "transactions:write"],
          prerequisites: [
            "Un egreso manual en Caja del mismo canal y moneda que el préstamo.",
          ],
          steps: [
            "En el detalle del préstamo, en la fila de la cuota, hacé clic en {{Vincular egreso}}.",
            "En {{Egreso}}, elegí el egreso (se ofrecen los cercanos al vencimiento). Si la cuota tiene desglose, el egreso tiene que ser de su importe exacto.",
            "Hacé clic en {{Vincular}}.",
          ],
          after: [
            "La cuota queda pagada con la fecha e importe del egreso, sin duplicar el movimiento; el asiento del egreso se rehace como pago de la cuota.",
          ],
          errors: [
            {
              message:
                "Solo se puede usar un egreso manual de caja (no uno generado por otro documento)",
              fix: "Elegí un egreso cargado a mano.",
            },
            {
              message: "El egreso es de otro canal que el préstamo",
              fix: "Elegí un egreso del canal del préstamo.",
            },
            {
              message: "El egreso está en otra moneda que el préstamo",
              fix: "Elegí un egreso en la moneda del préstamo.",
            },
            {
              message:
                "La cuota tiene desglose: el egreso tiene que ser de su importe (…)",
              fix: "Elegí un egreso por el importe exacto, o corregí el desglose.",
            },
          ],
          related: ["pagar-cuota-prestamo"],
        },
        {
          id: "anular-prestamo",
          title: "Anular un préstamo cargado por error",
          permission: "accounting:write",
          prerequisites: [
            "Que esté {{Activo}}, sin desembolso registrado y sin cuotas pagadas.",
          ],
          steps: [
            "En [[/loans]], abrí el menú ⋯ de la fila y elegí {{Anular}}.",
            "Confirmá en el aviso.",
          ],
          after: [
            "El préstamo queda {{Anulado}} y deja de proyectarse en el flujo de caja.",
          ],
          errors: [
            {
              message:
                "No se puede anular el préstamo: tiene el desembolso registrado o cuotas pagadas, y sus movimientos quedarían en Caja y en el libro diario. Anulalo solo si se cargó por error y todavía no registró dinero.",
              fix: "Un préstamo con dinero registrado no se anula.",
            },
            {
              message: "Sin permiso para anular préstamos.",
              fix: "Hace falta permiso de escritura en Contabilidad.",
            },
          ],
          related: ["crear-prestamo"],
        },
      ],
    },
  ],
};
