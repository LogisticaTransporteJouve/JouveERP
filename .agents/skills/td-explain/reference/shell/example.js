// Example page data: a client's cargas → liquidación R → one grouped Factura A with its CAE →
// the receipt that pays it → the libro IVA Ventas. The case (people, client, amounts, numbers) is
// made up; every mechanism traces to the code listed in each step's `code`, read from origin/main.
function mapLabels(){return{
 cargas:[L("Cargas","Cargas"),"shipments"],
 liq:[L("Liquidación R","R liquidación"),"freight_settlements"],
 next:[L("Servidor Next","Next server"),"server actions"],
 recibo:[L("Recibo","Receipt"),"create_receipt"],
 db:["Postgres","invoices"],
 inngest:["Inngest","issue-invoice"],
 libro:[L("Libro IVA Ventas","Sales VAT book"),"libro_iva_ventas"],
 journal:[L("Asiento","Journal entry"),L("trigger de status","status trigger")],
 afip:["AFIP","WSFEv1"]
};}
function edgeLabels(){return{
 group:L("agrupa","groups"),bill:L("Facturar","Invoice"),draft:L("borrador","draft"),enqueue:L("evento","event"),
 persist:"persist-cae",req:"FECAESolicitar",resp:"CAE",trigger:"→ emitted",
 allocate:L("imputa","allocates"),read:L("lee emitidas","reads emitted")
};}
const PEOPLE=()=>[
 {a:"J",n:"Julián",r:L("operaciones · carga los fletes","operations · enters the cargas")},
 {a:"M",n:"Marta",r:L("finanzas · liquida, factura y cobra","finance · settles, invoices and collects")},
 {a:"S",n:"Sofía",r:L("contadora externa · solo fiscal","external accountant · fiscal only")},
 {a:"I",n:"Inngest",r:L("corre solo","runs on its own"),c:"ai"}
];

const FIGS=[
 ()=>fig(svg(560,164,L("Con qué precio entra cada carga","Which price each carga takes"),
   list(10,10,200,L("Entregadas en octubre","Delivered in October"),["Remito 0001-00004501","Remito 0001-00004502","Remito 0001-00004517 · "+L("sin flete","no flete")])+
   ar("M210,40 H249","on")+
   box(250,10,170,40,L("1 · flete de la carga","1 · the carga's flete"),"shipments.freight_amount","on")+
   ar("M335,50 V61")+tx(342,58,L("si no","else"),"el")+
   box(250,62,170,40,L("2 · tarifa del cliente","2 · the client's tariff"),L("vigente el día de entrega","in force on delivery day"),"on")+
   ar("M335,102 V113")+tx(342,110,L("si no","else"),"el")+
   box(250,114,170,40,L("3 · sin precio","3 · no price"),"amount = null","warn")+
   ar("M420,30 H439","on")+
   list(440,10,110,L("Precio","Price"),["a:400.000 · flete","a:350.000 · flete","a:250.000 · "+L("tarifa","tariff")])),
   L("freight_price elige el flete propio de la carga y, si no hay, la tarifa de flete del cliente.","freight_price takes the carga's own flete and, failing that, the client's freight tariff.")),

 ()=>fig(svg(560,166,L("La vida de una liquidación","A liquidación's life"),
   box(10,20,120,44,L("Borrador","Draft"),"draft","on")+ar("M130,42 H159","on")+
   box(160,20,150,44,L("Confirmada","Confirmed"),"R-00000012","on")+ar("M310,42 H339","on")+
   box(340,20,100,44,L("Facturada","Invoiced"),"invoiced","on")+ar("M440,42 H459","dash")+
   box(460,20,90,44,L("Cancelada","Cancelled"),"cancelled","dash")+
   list(10,84,250,L("Al confirmar","On confirm"),[L("reprecia cada carga","reprices each carga"),L("numera la R en orden, con lock","numbers the R in order, under a lock"),L("confirmar dos veces da la misma R","confirming twice returns the same R")])+
   list(280,84,270,L("Mientras está viva","While it is live"),["w:"+L("la carga no se factura sola","the carga isn't invoiced alone"),"w:"+L("ni se borra ni cambia de cliente","nor deleted or moved to another client"),L("el flete queda fijo al confirmar","its flete freezes on confirm")],"warn")),
   L("La R es un documento interno: no vale como factura. Se cancela solo con su factura anulada.","The R is an internal document: it is not an invoice. It is cancelled only once its invoice is void.")),

 ()=>fig(svg(560,190,L("Facturar la liquidación","Invoicing the liquidación"),
   box(10,20,140,48,L("Facturar","Invoice"),"R-00000012","on")+ar("M150,44 H179","on")+
   box(180,20,180,48,L("acción de liquidaciones","liquidaciones action"),"invoices:issue","on")+ar("M270,68 V83")+
   list(180,84,180,L("Antes de emitir","Before issuing"),["✓ "+L("confirmada y sin factura","confirmed and not invoiced"),"✓ "+L("cliente con CUIT","client has a CUIT"),"✓ "+L("cargas del mismo canal","cargas of the same channel"),"a:"+L("la reserva 15 min","claims it for 15 min")])+
   ar("M360,44 H389","on")+
   list(390,20,160,L("Una sola factura","One invoice"),["issueFiscalInvoiceAction",L("Factura A, servicios","Factura A, services"),L("1 línea por carga, 21%","1 line per carga, 21%"),"a:neto 1.000.000","a:IVA 210.000"])+
   ar("M470,124 V139","on")+box(390,140,160,40,L("Vincula","Links"),L("factura ↔ liquidación","invoice ↔ liquidación"),"on")),
   L("Facturar reusa el camino normal de emisión: es la única acción de negocio que cruza de feature.","Invoicing reuses the normal issuance path: the one business action allowed to cross features.")),

 ()=>fig(svg(560,154,L("Del borrador al CAE y al asiento","From draft to CAE and entry"),
   box(10,20,150,44,"issue-invoice",L("1 paso a la vez por PV","1 step at a time per PV"),"on")+ar("M160,42 H189","on")+
   box(190,20,160,44,"AFIP · WSFEv1",L("último + 1 → CAE","last + 1 → CAE"),"on")+ar("M350,42 H379","on")+
   box(380,20,170,44,"persist-cae","numero · cae · emitted","on")+
   ar("M465,64 V99","on")+box(380,100,170,44,"trigger",L("asiento automático","automatic entry"),"on")+
   ar("M85,64 V99","warn")+box(10,100,340,44,L("Si falla o se anula","If it fails or is cancelled"),L("la liquidación vuelve a confirmada y se puede refacturar","the liquidación goes back to confirmed and can be invoiced again"),"warn")),
   L("Numerar y pedir el CAE pasa en un solo step; el asiento lo postea la base al pasar a emitted.","Numbering and requesting the CAE happen in one step; the database posts the entry on emitted.")),

 ()=>fig(svg(560,154,L("El recibo cancela la factura","The receipt settles the invoice"),
   list(10,10,170,L("Paga el cliente","The client pays"),[L("transferencia 1.180.000","transfer 1,180,000"),L("retención IIBB 30.000","IIBB withholding 30,000"),"a:total 1.210.000"])+
   ar("M180,46 H209","on")+
   box(210,24,150,44,"createReceiptAction","receipts:write","on")+ar("M360,46 H389","on")+
   list(390,10,160,L("Imputa (FIFO)","Allocates (FIFO)"),["a:A 0003-00001042",L("saldo 1.210.000 → 0","balance 1,210,000 → 0"),L("misma moneda","same currency")])+
   ar("M285,68 V99","on")+box(210,100,150,44,"create_receipt",L("recibo + asiento","receipt + entry"),"on")),
   L("La retención cuenta en el total: el cliente queda acreditado por todo, y la factura sale del aging.","The withholding counts in the total: the client is credited for all of it, and the invoice leaves the aging.")),

 ()=>fig(svg(560,186,L("Qué filas entran al libro","Which rows reach the book"),
   box(10,20,150,48,L("Libro IVA Ventas","Sales VAT book"),"accounting:read","on")+ar("M160,44 H189","on")+
   list(190,20,190,"libro_iva_ventas",["✓ "+L("solo canales fiscales","fiscal channels only"),"✓ status = emitted","✓ "+L("fecha dentro del mes","date within the month"),L("montos en pesos (cotización)","amounts in pesos (rate)")])+
   ar("M380,44 H409","on")+
   list(410,20,140,L("Fila de la factura","The invoice's row"),["A 0003-00001042","a:CAE","neto 1.000.000","IVA 21% 210.000"])+
   box(190,130,190,44,L("Recibo y liquidación R","Receipt and R liquidación"),L("no entran: no son facturas","left out: not invoices"),"dash")),
   L("El libro se calcula al leerlo: es un RPC sobre las facturas emitidas del mes, no una tabla aparte.","The book is computed when read: an RPC over the month's emitted invoices, not a table of its own."))
];

const STEPS=[
 {nodes:["cargas"],edges:[],code:["features/freight-settlements/actions/freight-settlements-actions.ts:194-238","supabase/migrations/20261103090000_freight_settlements.sql:146"],
  es:{t:"Tres cargas entregadas",flow:"<b>Cargas</b> del cliente en el período",what:"En octubre Julián carga tres fletes de Frigorífico Del Sur; dos traen su flete y uno no.",facts:["Solo entran cargas entregadas del cliente que no se facturaron solas.","flag:Una carga sin flete y sin tarifa entra sin precio (amount null)."]},
  en:{t:"Three delivered cargas",flow:"The client's <b>cargas</b> in the period",what:"In October Julián enters three cargas for Frigorífico Del Sur; two carry their flete and one doesn't.",facts:["Only the client's delivered cargas not invoiced on their own qualify.","flag:A carga with no flete and no tariff comes in with no price (amount null)."]}},
 {nodes:["cargas","liq"],edges:["group"],code:["features/freight-settlements/actions/freight-settlements-actions.ts:241-330","supabase/migrations/20261103090000_freight_settlements.sql:172","supabase/migrations/20261103090000_freight_settlements.sql:412","supabase/migrations/20261103090000_freight_settlements.sql:612"],
  es:{t:"La liquidación R",flow:"<b>Cargas</b> → <b>liquidación R</b>",what:"El 3 de noviembre Marta las agrupa en un borrador y lo confirma: queda la R-00000012.",facts:["Una carga está en una sola liquidación viva a la vez."]},
  en:{t:"The R liquidación",flow:"<b>Cargas</b> → <b>R liquidación</b>",what:"On 3 November Marta groups them in a draft and confirms it: it becomes R-00000012.",facts:["A carga is in one live liquidación at a time."]}},
 {nodes:["liq","next","db"],edges:["bill","draft"],code:["features/freight-settlements/actions/freight-settlements-actions.ts:381-538","features/invoices/actions/invoices-actions.ts:160-568"],
  es:{t:"Una factura para todo",flow:"<b>Liquidación R</b> → <b>servidor Next</b> → <b>Postgres</b>",what:"Facturar emite una sola Factura A con una línea por carga al 21% y la vincula a la R.",facts:["Dos clics no emiten dos facturas: la liquidación se reserva antes de emitir.","flag:Si la factura sale pero el vínculo falla, el error pide anotar el comprobante antes de refacturar."]},
  en:{t:"One invoice for all",flow:"<b>R liquidación</b> → <b>Next server</b> → <b>Postgres</b>",what:"Invoice issues one Factura A with one line per carga at 21% and links it to the R.",facts:["Two clicks don't issue two invoices: the liquidación is claimed before issuing.","flag:If the invoice goes out but the link fails, the error asks to note the voucher before invoicing again."]}},
 {nodes:["next","inngest","afip","db","journal"],edges:["enqueue","req","resp","persist","trigger"],code:["lib/inngest/functions/issue-invoice.ts:325-439","lib/inngest/functions/issue-invoice.ts:565-639","lib/inngest/functions/issue-invoice-cae.ts:125","supabase/migrations/20261102200000_period_guard_pending_journal.sql:130-151","supabase/migrations/20261103090000_freight_settlements.sql:420"],
  es:{t:"AFIP da el CAE",flow:"<b>Inngest</b> → <b>AFIP</b> → <b>Postgres</b> → <b>asiento</b>",what:"issue-invoice pide el último número, solicita el CAE del 1042 y marca la factura emitida.",facts:["numero se guarda recién con el CAE; hasta entonces el intento vive en afip_attempted_numero.","flag:Con el período cerrado la factura queda emitida y su asiento espera en pending_journal_entries."]},
  en:{t:"AFIP grants the CAE",flow:"<b>Inngest</b> → <b>AFIP</b> → <b>Postgres</b> → <b>entry</b>",what:"issue-invoice asks for the last number, requests the CAE for 1042 and marks the invoice emitted.",facts:["numero is stored only with the CAE; until then the attempt lives in afip_attempted_numero.","flag:With the period closed the invoice stays emitted and its entry waits in pending_journal_entries."]}},
 {nodes:["recibo","db"],edges:["allocate"],code:["features/receipts/actions/receipts-actions.ts:735-894","supabase/migrations/20261031205518_receivables_payables.sql:831","supabase/migrations/20261031205518_receivables_payables.sql:919"],
  es:{t:"El cliente paga",flow:"<b>Recibo</b> → <b>Postgres</b>",what:"El 20 de noviembre Marta registra el recibo: transferencia más una retención de IIBB.",facts:["Sin imputación manual va FIFO sobre los comprobantes pendientes; «a cuenta» no imputa nada.","Un recibo solo cancela comprobantes de su misma moneda."]},
  en:{t:"The client pays",flow:"<b>Receipt</b> → <b>Postgres</b>",what:"On 20 November Marta records the receipt: a transfer plus an IIBB withholding.",facts:["Without manual allocations it goes FIFO over the pending vouchers; “on account” allocates nothing.","A receipt only settles vouchers in its own currency."]}},
 {nodes:["libro","db"],edges:["read"],code:["features/libro-iva/actions/libro-iva-actions.ts:31-70","features/libro-iva/lib/fetch-books.ts:25","supabase/migrations/20261031184339_ai_rpcs_fiscal_filter.sql:773"],
  es:{t:"Llega al libro IVA",flow:"<b>Libro IVA Ventas</b> → <b>Postgres</b>",what:"A fin de mes Sofía abre el libro IVA Ventas de noviembre y la factura aparece con su CAE.",facts:["Lee con la sesión del usuario, así que la RLS aplica.","Pedir un canal no fiscal lo rechaza el propio RPC."]},
  en:{t:"It reaches the VAT book",flow:"<b>Sales VAT book</b> → <b>Postgres</b>",what:"At month end Sofía opens November's Sales VAT book and the invoice is there with its CAE.",facts:["It reads with the user's session, so RLS applies.","Asking for a non-fiscal channel is refused by the RPC itself."]}}
];

function accessFig(){
  const m=matrix(560,330,90,["Julián","Marta","Sofía"],[
   [L("Cargar la carga y su flete","Enter the carga and its flete"),["y","-","-"]],
   [L("Liquidar y facturar","Settle and invoice"),["-","y","-"]],
   [L("Registrar el recibo","Record the receipt"),["-","y","-"]],
   [L("Ver la factura y su CAE","See the invoice and its CAE"),["-","y","y"]],
   [L("Ver el libro IVA Ventas","See the Sales VAT book"),["-","y","y"]]],40);
  return fig(svg(560,m.h,L("Quién hace qué","Who does what"),m.b),
   L("Julián es operations, Marta es finance y Sofía es fiscal_reader (solo lee canales fiscales).","Julián is operations, Marta is finance and Sofía is fiscal_reader (reads fiscal channels only)."));
}
const T={
 es:{eyebrow:"Facturación · cómo funciona hoy",title:"De la carga al libro",lede:"Qué pasa entre que se entregan las cargas de un cliente y que su factura aparece cobrada y en el libro IVA Ventas: quién precia, quién liquida, quién habla con AFIP, quién imputa y quién asienta.",
  caseL:"El caso",caseStory:"En octubre Julián carga tres fletes de Frigorífico Del Sur S.A. El 3 de noviembre Marta los liquida en la R-00000012 y la factura: Factura A 0003-00001042 por $1.210.000 (neto $1.000.000 + IVA 21%). El 20 el cliente paga con una transferencia y una retención de IIBB, y a fin de mes Sofía, la contadora externa, revisa el libro IVA Ventas.",
  foot:"Ejemplo de la skill td-explain, leído de origin/main 1938f0b (3 nov 2026). Personas, cliente, montos y números son inventados."},
 en:{eyebrow:"Invoicing · how it works today",title:"From carga to book",lede:"What happens between a client's cargas being delivered and their invoice showing as paid and in the Sales VAT book: who prices, who settles, who talks to AFIP, who allocates and who posts.",
  caseL:"The case",caseStory:"In October Julián enters three cargas for Frigorífico Del Sur S.A. On 3 November Marta settles them in R-00000012 and invoices it: Factura A 0003-00001042 for $1,210,000 (net $1,000,000 + 21% VAT). On the 20th the client pays with a transfer and an IIBB withholding, and at month end Sofía, the external accountant, checks the Sales VAT book.",
  foot:"td-explain skill example, read from origin/main 1938f0b (3 Nov 2026). People, client, amounts and numbers are made up."}
};
const GOTCHAS=[
 {es:["La R no es una factura","La liquidación es un documento interno; lo fiscal es la Factura A que la cobra.","No va al libro IVA"],en:["The R is not an invoice","The liquidación is an internal document; the fiscal one is the Factura A that bills it.","It doesn't reach the VAT book"]},
 {es:["Una factura caída libera la R","Si la factura falla o se anula, el trigger devuelve la liquidación a confirmada.","Se puede refacturar sin rehacerla"],en:["A dead invoice frees the R","If the invoice fails or is cancelled, a trigger puts the liquidación back to confirmed.","It can be invoiced again without redoing it"]},
 {es:["Emitida no siempre es asentada","Con el período cerrado, el asiento espera en pending_journal_entries.","El mayor no la muestra hasta postearla"],en:["Emitted is not always posted","With the period closed, the entry waits in pending_journal_entries.","The ledger doesn't show it until it is posted"]}
];
const SECTIONS=()=>[
 {t:L("Quién hace qué","Who does what"),s:L("Según los permisos de cada rol, con las personas del caso.","Under each role's permissions, with the people of the case."),html:`<div class="panel">${accessFig()}</div>`},
 {t:L("Lo que no es obvio","What isn't obvious"),s:"",html:`<div class="gotchas">${GOTCHAS.map(g=>`<div class="g"><b>${g[lang][0]}</b><p>${g[lang][1]}</p><span class="why">${g[lang][2]}</span></div>`).join("")}</div>`}
];
