/*********************************
 * Traceability（API 版）
 * - Upstream：lot_relation (to_lot_id = current)
 * - Downstream：lot_relation (from_lot_id = current) + shipment_item（流向）
 *********************************/

let traceLots = [];
let traceRelations = [];
let traceMovements = [];
let traceShipments = [];
let traceShipmentItems = [];
let traceImportDocs = [];
let traceGoodsReceipts = [];
let traceProcessOrders = [];

async function traceInit(){
  await loadTraceCaches();
  const pending = window.__pendingTraceLotId;
  if(pending && typeof pending === "string") {
    delete window.__pendingTraceLotId;
    const input = document.getElementById("trace_lot_id");
    if(input){ input.value = pending; await runTrace(); }
  }
}

async function loadTraceCaches(){
  const [lots, relations, movements, shipments, shipmentItems, importDocs, goodsReceipts, processOrders] = await Promise.all([
    getAll("lot"),
    getAll("lot_relation").catch(() => []),
    getAll("inventory_movement").catch(() => []),
    getAll("shipment").catch(() => []),
    getAll("shipment_item").catch(() => []),
    getAll("import_document").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("process_order").catch(() => [])
  ]);
  traceLots = lots || [];
  traceRelations = relations || [];
  traceMovements = movements || [];
  traceShipments = shipments || [];
  traceShipmentItems = shipmentItems || [];
  traceImportDocs = importDocs || [];
  traceGoodsReceipts = goodsReceipts || [];
  traceProcessOrders = processOrders || [];
}

function traceGetAvailable(lotId){
  return traceMovements
    .filter(m => m.lot_id === lotId)
    .reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

function getLot(lotId){
  return traceLots.find(l => l.lot_id === lotId);
}

function fmtLotLine(lotId, depth){
  const lot = getLot(lotId);
  const indent = "  ".repeat(depth);
  if(!lot) return `${indent}- Lot: ${lotId} (找不到)\n`;

  const av = traceGetAvailable(lotId);
  const qa = lot.status || "PENDING";
  const inv = lot.inventory_status || "ACTIVE";
  const src = `${lot.source_type || ""}:${lot.source_id || ""}`;
  return `${indent}- Lot: ${lot.lot_id} | Product:${lot.product_id} | Type:${lot.type} | QA:${qa} | Inv:${inv} | Avail:${av} | Src:${src}\n`;
}

function traceUp(lotId, depth, visited){
  if(visited.has(lotId)) return "  ".repeat(depth) + `- (循環偵測) ${lotId}\n`;
  visited.add(lotId);

  let out = fmtLotLine(lotId, depth);

  // relations: parents are from_lot_id when to_lot_id == current
  const parents = traceRelations.filter(r => r.to_lot_id === lotId);
  parents.forEach(r => {
    out += "  ".repeat(depth+1) + `↳ relation:${r.relation_type} qty:${r.qty || ""} unit:${r.unit || ""} ref:${r.ref_type || ""}:${r.ref_id || ""}\n`;
    out += traceUp(r.from_lot_id, depth+2, visited);
  });

  // also show source docs (import/receipt/process)
  const lot = getLot(lotId);
  if(lot){
    if(lot.source_type === "IMPORT"){
      const doc = traceImportDocs.find(d => d.import_doc_id === lot.source_id) || null;
      if(doc){
        out += "  ".repeat(depth+1) + `↳ Import Doc: ${doc.import_no || ""} release:${doc.release_date || ""} supplier:${doc.supplier_id || ""}\n`;
      }else{
        out += "  ".repeat(depth+1) + `↳ Import Receipt/Ref: ${lot.source_id}\n`;
      }
    }
    if(lot.source_type === "PURCHASE"){
      const gr = traceGoodsReceipts.find(g => g.gr_id === lot.source_id) || null;
      if(gr){
        out += "  ".repeat(depth+1) + `↳ Goods Receipt: ${gr.gr_id} PO:${gr.po_id} date:${gr.receipt_date}\n`;
      }else{
        out += "  ".repeat(depth+1) + `↳ Goods Receipt/Ref: ${lot.source_id}\n`;
      }
    }
    if(lot.source_type === "PROCESS"){
      const po = traceProcessOrders.find(p => p.process_order_id === lot.source_id) || null;
      if(po){
        out += "  ".repeat(depth+1) + `↳ Process Order: ${po.process_order_id} type:${po.process_type} supplier:${po.supplier_id}\n`;
      }else{
        out += "  ".repeat(depth+1) + `↳ Process/Ref: ${lot.source_id}\n`;
      }
    }
  }

  return out;
}

function traceDown(lotId, depth, visited){
  if(visited.has(lotId)) return "  ".repeat(depth) + `- (循環偵測) ${lotId}\n`;
  visited.add(lotId);

  let out = fmtLotLine(lotId, depth);

  // downstream lots by relation
  const children = traceRelations.filter(r => r.from_lot_id === lotId);
  children.forEach(r => {
    out += "  ".repeat(depth+1) + `↳ relation:${r.relation_type} qty:${r.qty || ""} unit:${r.unit || ""} ref:${r.ref_type || ""}:${r.ref_id || ""}\n`;
    out += traceDown(r.to_lot_id, depth+2, visited);
  });

  // shipment flow
  const ships = traceShipmentItems.filter(si => si.lot_id === lotId);
  ships.forEach(si => {
    const sh = traceShipments.find(s => s.shipment_id === si.shipment_id);
    const indent = "  ".repeat(depth+1);
    out += `${indent}↳ Shipment: ${si.shipment_id} customer:${sh?.customer_id || ""} date:${dateInputValue_(sh?.ship_date)} qty:${si.ship_qty} unit:${si.unit}\n`;
  });

  return out;
}

async function runTrace(){
  const lotId = (document.getElementById("trace_lot_id")?.value || "").trim().toUpperCase();
  if(!lotId) return showToast("請輸入 Lot ID","error");

  await loadTraceCaches();

  const lot = getLot(lotId);
  const summaryEl = document.getElementById("traceSummary");
  const upEl = document.getElementById("traceUp");
  const downEl = document.getElementById("traceDown");

  if(!lot){
    if(summaryEl) summaryEl.textContent = "找不到批次";
    if(upEl) upEl.textContent = "";
    if(downEl) downEl.textContent = "";
    return;
  }

  const av = traceGetAvailable(lotId);
  if(summaryEl){
    summaryEl.textContent =
      `Lot: ${lot.lot_id}\n` +
      `Product: ${lot.product_id}\n` +
      `Type: ${lot.type}\n` +
      `QA: ${termLabel(lot.status || "PENDING")}\n` +
      `Inventory: ${termLabel(lot.inventory_status || "ACTIVE")}\n` +
      `Available: ${av}\n` +
      `Source: ${(lot.source_type||"")} ${(lot.source_id||"")}\n`;
  }

  if(upEl) upEl.textContent = traceUp(lotId, 0, new Set());
  if(downEl) downEl.textContent = traceDown(lotId, 0, new Set());
}

function resetTrace(){
  const a = document.getElementById("trace_lot_id");
  if(a) a.value = "";
  const b = document.getElementById("traceSummary");
  const c = document.getElementById("traceUp");
  const d = document.getElementById("traceDown");
  if(b) b.textContent = "";
  if(c) c.textContent = "";
  if(d) d.textContent = "";
}