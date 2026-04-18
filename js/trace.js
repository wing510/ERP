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
let traceAvailByLotId = {};

function upper_(s){ return String(s || "").trim().toUpperCase(); }

async function copyTextFromEl(elId){
  const el = document.getElementById(String(elId || ""));
  const txt = String(el && ("value" in el ? el.value : el.textContent) || "").trim();
  if(!txt) return showToast("沒有可複製的內容","error");
  try{
    if(navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
      await navigator.clipboard.writeText(txt);
    }else{
      // fallback：舊瀏覽器
      const ta = document.createElement("textarea");
      ta.value = txt;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("已複製","success");
  }catch(_e){
    showToast("複製失敗","error");
  }
}

async function runTraceTx(){
  const txId = upper_(document.getElementById("trace_tx_id")?.value || "");
  if(!txId) return showToast("請輸入 transaction_id","error");

  const runBtn = document.getElementById("trace_tx_run_btn");
  const hint = document.getElementById("traceTxRunHint");
  const outEl = document.getElementById("traceTxResult");

  if(runBtn) runBtn.disabled = true;
  if(hint){ hint.style.display = "inline-block"; hint.textContent = "查詢中…"; }
  if(outEl) outEl.textContent = "查詢中…";

  try{
    const r = await callAPI({ action: "trace_transaction_bundle", transaction_id: txId, limit: 2000 }, { method:"POST" });
    const d = (r && r.data) ? r.data : null;
    if(!d){
      if(outEl) outEl.textContent = "查無資料";
      return;
    }
    if(outEl) outEl.textContent = JSON.stringify(d, null, 2);
  }catch(e){
    if(outEl) outEl.textContent = (e && e.message) ? e.message : String(e || "查詢失敗");
    showToast("查詢失敗","error");
  }finally{
    if(runBtn) runBtn.disabled = false;
    if(hint) hint.style.display = "none";
  }
}

function resetTraceTx(){
  const a = document.getElementById("trace_tx_id");
  const b = document.getElementById("traceTxResult");
  if(a) a.value = "";
  if(b) b.textContent = "";
}

async function fetchLotRelationsByLot_(lotId, direction){
  const id = upper_(lotId);
  if(!id) return [];
  try{
    const r = await callAPI({ action: "list_lot_relation_by_lot", lot_id: id, direction: direction || "ANY" });
    return (r && r.data) ? r.data : [];
  }catch(_e){
    // fallback：優先用後端 bundle（若有），再最後才全表
    try{
      const r = await callAPI({ action: "trace_lot_bundle", lot_id: id, max_lots: 1 }, { method: "POST" });
      const d = r && r.data ? r.data : null;
      const rels = Array.isArray(d?.relations) ? d.relations : [];
      if(direction === "UP") return rels.filter(x => upper_(x.to_lot_id) === id);
      if(direction === "DOWN") return rels.filter(x => upper_(x.from_lot_id) === id);
      return rels.filter(x => upper_(x.from_lot_id) === id || upper_(x.to_lot_id) === id);
    }catch(_eB){}

    const all = await getAll("lot_relation").catch(() => []);
    if(direction === "UP") return (all || []).filter(x => upper_(x.to_lot_id) === id);
    if(direction === "DOWN") return (all || []).filter(x => upper_(x.from_lot_id) === id);
    return (all || []).filter(x => upper_(x.from_lot_id) === id || upper_(x.to_lot_id) === id);
  }
}

async function fetchShipmentItemsByLot_(lotId){
  const id = upper_(lotId);
  if(!id) return [];
  try{
    const r = await callAPI({ action: "list_shipment_item_by_lot", lot_id: id });
    return (r && r.data) ? r.data : [];
  }catch(_e){
    // fallback：優先用後端 bundle（若有），再最後才全表
    try{
      const r = await callAPI({ action: "trace_lot_bundle", lot_id: id, max_lots: 1 }, { method: "POST" });
      const d = r && r.data ? r.data : null;
      const items = Array.isArray(d?.shipment_items) ? d.shipment_items : [];
      return items.filter(x => upper_(x.lot_id) === id);
    }catch(_eB){}

    const all = await getAll("shipment_item").catch(() => []);
    return (all || []).filter(x => upper_(x.lot_id) === id);
  }
}

async function fetchAvailByLot_(lotId){
  const id = upper_(lotId);
  if(!id) return 0;
  try{
    const r = await callAPI({ action: "list_inventory_movement_by_lot", lot_id: id });
    const mv = (r && r.data) ? r.data : [];
    return (mv || []).reduce((sum, m) => sum + Number(m.qty || 0), 0);
  }catch(_e){
    // fallback：舊版後端未支援時，優先用「近 N 天 movements」避免全表下載；
    // 僅在這也失敗時才退回全表。
    try{
      const r = await callAPI(
        { action: "list_inventory_movement_recent", days: 365, _ts: String(Date.now()) },
        { method: "POST" }
      );
      const mvRecent = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
      if(Array.isArray(mvRecent)){
        return mvRecent.filter(m => upper_(m.lot_id) === id).reduce((sum, m) => sum + Number(m.qty || 0), 0);
      }
    }catch(_e2){}

    const mv = await getAll("inventory_movement").catch(() => []);
    return (mv || []).filter(m => upper_(m.lot_id) === id).reduce((sum, m) => sum + Number(m.qty || 0), 0);
  }
}

async function buildTraceGraph_(rootLotId, maxLots){
  const MAX = Number(maxLots || 150);
  const root = upper_(rootLotId);
  // 優先使用後端 bundle：一次回來 relations / shipment_items / avail map（避免逐 lot 多次 API）
  try{
    const r = await callAPI({ action: "trace_lot_bundle", lot_id: root, max_lots: MAX }, { method: "POST" });
    const d = r && r.data ? r.data : null;
    if(d && (Array.isArray(d.relations) || Array.isArray(d.shipment_items) || typeof d.avail_by_lot_id === "object")){
      return {
        lotsVisitedCount: Array.isArray(d.lots) ? d.lots.length : 0,
        truncated: !!d.truncated,
        relations: Array.isArray(d.relations) ? d.relations : [],
        shipmentItems: Array.isArray(d.shipment_items) ? d.shipment_items : [],
        availByLotId: (d.avail_by_lot_id && typeof d.avail_by_lot_id === "object") ? d.avail_by_lot_id : {}
      };
    }
  }catch(_eBundle){}

  const visited = new Set();
  const queue = [root];
  const rels = [];
  const shipItems = [];
  const availMap = {};

  while(queue.length && visited.size < MAX){
    const cur = queue.shift();
    if(!cur || visited.has(cur)) continue;
    visited.add(cur);

    // 取得上下游 relations
    const [up, down] = await Promise.all([
      fetchLotRelationsByLot_(cur, "UP"),
      fetchLotRelationsByLot_(cur, "DOWN")
    ]);
    const both = ([]).concat(up || [], down || []);
    both.forEach(r => { if(r) rels.push(r); });

    both.forEach(r => {
      const fromId = upper_(r.from_lot_id);
      const toId = upper_(r.to_lot_id);
      if(fromId && !visited.has(fromId)) queue.push(fromId);
      if(toId && !visited.has(toId)) queue.push(toId);
    });

    // 取得本 lot 的出貨明細
    try{
      const si = await fetchShipmentItemsByLot_(cur);
      (si || []).forEach(x => { if(x) shipItems.push(x); });
    }catch(_e2){}

    // 取得本 lot 可用量（movement sum）
    try{
      availMap[cur] = await fetchAvailByLot_(cur);
    }catch(_e3){
      availMap[cur] = 0;
    }
  }

  // 去重（避免 up/down 重複）
  const relKey = (r)=>`${upper_(r.relation_id)}|${upper_(r.from_lot_id)}|${upper_(r.to_lot_id)}|${upper_(r.ref_type)}|${upper_(r.ref_id)}|${upper_(r.relation_type)}`;
  const uniqRel = [];
  const relSeen = new Set();
  (rels || []).forEach(r => {
    const k = relKey(r || {});
    if(relSeen.has(k)) return;
    relSeen.add(k);
    uniqRel.push(r);
  });

  const shipKey = (x)=>`${upper_(x.shipment_item_id)}|${upper_(x.shipment_id)}|${upper_(x.lot_id)}|${upper_(x.so_id)}|${upper_(x.so_item_id)}`;
  const uniqShip = [];
  const shipSeen = new Set();
  (shipItems || []).forEach(x => {
    const k = shipKey(x || {});
    if(shipSeen.has(k)) return;
    shipSeen.add(k);
    uniqShip.push(x);
  });

  return {
    lotsVisitedCount: visited.size,
    truncated: visited.size >= MAX && queue.length > 0,
    relations: uniqRel,
    shipmentItems: uniqShip,
    availByLotId: availMap
  };
}

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
  // 追溯畫面很容易被「全表 movements / relations / shipment_item」拖慢。
  // 這裡採分段載入：先載入主檔，等使用者輸入 lot 再按需抓明細（runTrace 補齊）。
  const [lots, shipments, importDocs, goodsReceipts, processOrders] = await Promise.all([
    getAll("lot"),
    (async ()=>{
      try{
        const r = await callAPI({ action: "list_shipment_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
        return (r && r.data) ? r.data : [];
      }catch(_e){
        return await getAll("shipment").catch(() => []);
      }
    })(),
    getAll("import_document").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("process_order").catch(() => [])
  ]);
  traceLots = lots || [];
  traceShipments = shipments || [];
  traceImportDocs = importDocs || [];
  traceGoodsReceipts = goodsReceipts || [];
  traceProcessOrders = processOrders || [];
  traceRelations = [];
  traceMovements = [];
  traceShipmentItems = [];
}

function traceGetAvailable(lotId){
  const id = upper_(lotId);
  if(id && traceAvailByLotId && traceAvailByLotId[id] != null) return Number(traceAvailByLotId[id] || 0);
  return (traceMovements || [])
    .filter(m => upper_(m.lot_id) === id)
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
  const id = upper_(lotId);
  if(visited.has(id)) return "  ".repeat(depth) + `- (循環偵測) ${id}\n`;
  visited.add(id);

  let out = fmtLotLine(id, depth);

  // relations: parents are from_lot_id when to_lot_id == current
  const parents = traceRelations.filter(r => upper_(r.to_lot_id) === id);
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
  const id = upper_(lotId);
  if(visited.has(id)) return "  ".repeat(depth) + `- (循環偵測) ${id}\n`;
  visited.add(id);

  let out = fmtLotLine(id, depth);

  // downstream lots by relation
  const children = traceRelations.filter(r => upper_(r.from_lot_id) === id);
  children.forEach(r => {
    out += "  ".repeat(depth+1) + `↳ relation:${r.relation_type} qty:${r.qty || ""} unit:${r.unit || ""} ref:${r.ref_type || ""}:${r.ref_id || ""}\n`;
    out += traceDown(r.to_lot_id, depth+2, visited);
  });

  // shipment flow
  const ships = traceShipmentItems.filter(si => upper_(si.lot_id) === id);
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

  const runBtn = document.getElementById("trace_run_btn");
  const hint = document.getElementById("traceRunHint");
  const resetBtn = (function(){
    const btns = Array.from(document.querySelectorAll(".search-toolbar button"));
    return btns.find(b => (b && b.textContent || "").includes("重設")) || null;
  })();
  const logBtn = (function(){
    const btns = Array.from(document.querySelectorAll(".search-toolbar button"));
    return btns.find(b => (b && b.textContent || "").trim() === "Log") || null;
  })();

  if(runBtn) runBtn.disabled = true;
  if(resetBtn) resetBtn.disabled = true;
  if(logBtn) logBtn.disabled = true;
  if(hint){ hint.style.display = "inline-block"; hint.textContent = "查詢中…"; }

  const summaryEl = document.getElementById("traceSummary");
  const upEl = document.getElementById("traceUp");
  const downEl = document.getElementById("traceDown");
  if(summaryEl) summaryEl.textContent = "查詢中…";
  if(upEl) upEl.textContent = "";
  if(downEl) downEl.textContent = "";

  try{
    await loadTraceCaches();
    // 逐層按需載入：relations/shipments/movements 都以 lot 為單位查詢，避免全表下載
    try{
      const g = await buildTraceGraph_(lotId, 150);
      traceRelations = g.relations || [];
      traceShipmentItems = g.shipmentItems || [];
      traceAvailByLotId = g.availByLotId || {};
      traceMovements = []; // 不再依賴全表 movements
      if(g.truncated){
        showToast("追溯範圍過大，已限制最多 150 個 Lot（可再優化成後端一次查詢）。","error");
      }
    }catch(_e0){
      // fallback：不要直接全表下載；只取此 lot 的必要資料
      try{
        const [up, down, ships, av] = await Promise.all([
          fetchLotRelationsByLot_(lotId, "UP").catch(() => []),
          fetchLotRelationsByLot_(lotId, "DOWN").catch(() => []),
          fetchShipmentItemsByLot_(lotId).catch(() => []),
          fetchAvailByLot_(lotId).catch(() => 0)
        ]);
        traceRelations = ([]).concat(up || [], down || []);
        traceShipmentItems = ships || [];
        traceAvailByLotId = { [String(lotId || "").trim().toUpperCase()]: Number(av || 0) };
        traceMovements = [];
      }catch(_e1){
        // 最後最後才全表（極端情況）
        try{ traceRelations = await getAll("lot_relation").catch(() => []); }catch(_e2){ traceRelations = []; }
        try{ traceShipmentItems = await getAll("shipment_item").catch(() => []); }catch(_e3){ traceShipmentItems = []; }
        try{ traceMovements = await getAll("inventory_movement").catch(() => []); }catch(_e4){ traceMovements = []; }
        traceAvailByLotId = {};
      }
    }
  } finally {
    if(runBtn) runBtn.disabled = false;
    if(resetBtn) resetBtn.disabled = false;
    if(logBtn) logBtn.disabled = false;
    if(hint) hint.style.display = "none";
  }

  const lot = getLot(lotId);

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
      `品檢：${typeof termLabelZhOnly === "function" ? termLabelZhOnly(lot.status || "PENDING") : termLabel(lot.status || "PENDING")}\n` +
      `庫存：${typeof termLabelZhOnly === "function" ? termLabelZhOnly(lot.inventory_status || "ACTIVE") : termLabel(lot.inventory_status || "ACTIVE")}\n` +
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