/*********************************
 * 收貨入庫（統一：PO / 進口報單）v4
 * - 收貨單ID 自動產生（PO→GR、報單→IR）
 * - 選擇來源（PO 或 報單）→ 明細帶出，剩餘可收自動計算
 * - 填本次收貨數量 → 產生批次
 *********************************/

let rcvSourceType = "";
let rcvSourceId = "";

/**
 * 並行載入異動明細與依 lot 彙總可用量（作廢預檢／執行用）。
 * 彙總成功時可用量以 map 為準，省去對整張 movements 逐 lot 加總。
 * @param {{ refreshMovements?: boolean }} [options] 作廢送出前建議 refreshMovements:true
 */
async function rcvFetchVoidData_(options) {
  const refreshMovements = options && options.refreshMovements === true;
  const availPack = await (typeof loadInventoryMovementAvailableMap_ === "function"
    ? loadInventoryMovementAvailableMap_()
    : Promise.resolve({ map: {}, failed: true }));
  return {
    // movements 改為按需查詢（renderRcvPostedReceipts_ 依本次顯示的 receipt ids 批次查）
    movements: [],
    availMap: (availPack && availPack.map) || {},
    availOk: !!(availPack && !availPack.failed)
  };
}

async function rcvFetchMovementsByRefs_(refType, refIds, options){
  const rt = String(refType || "").trim().toUpperCase();
  const ids = Array.isArray(refIds) ? refIds.map(x => String(x || "").trim()).filter(Boolean) : [];
  const refresh = !!(options && options.refresh === true);
  if(!rt || ids.length === 0) return [];
  try{
    const r = await callAPI({
      action: "list_inventory_movement_by_refs",
      ref_type: rt,
      ref_ids_json: JSON.stringify(ids),
      _ts: refresh ? String(Date.now()) : ""
    }, { method: "POST" });
    return (r && r.data) ? r.data : [];
  }catch(_e){
    // fallback：若後端尚未部署，優先用「近 N 天 movements」避免全表下載；
    // 僅在這也失敗時才退回全表。
    try{
      const r = await callAPI(
        { action: "list_inventory_movement_recent", days: 365, _ts: String(Date.now()) },
        { method: "POST" }
      );
      const mvRecent = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
      if(Array.isArray(mvRecent)){
        return mvRecent.filter(m => String(m.ref_type || "").toUpperCase() === rt && ids.includes(String(m.ref_id || "")));
      }
    }catch(_e2){}

    const mvAll = await getAll("inventory_movement", refresh ? { refresh: true } : undefined).catch(() => []);
    return (mvAll || []).filter(m => String(m.ref_type || "").toUpperCase() === rt && ids.includes(String(m.ref_id || "")));
  }
}
/** 明細行：{ item_no（畫面項次 1,2,3…）, product_id, order_qty, received_qty, remaining, unit, po_id?, po_item_id?, import_doc_id?, import_item_id? } */
let rcvLines = [];
let rcvProducts = [];
let rcvWarehouses = [];

function setRcvPostBtnState_(){
  const postBtn = document.getElementById("rcv_post_btn");
  if(!postBtn) return;

  if(!rcvSourceType){
    postBtn.disabled = true;
    postBtn.title = "請先選擇來源類型";
    return;
  }
  if(!rcvSourceId){
    postBtn.disabled = true;
    postBtn.title = "請先選擇" + (rcvSourceType === "PO" ? "PO" : "報單");
    return;
  }
  if(!Array.isArray(rcvLines) || rcvLines.length === 0){
    postBtn.disabled = true;
    postBtn.title = "尚無可收貨明細";
    return;
  }

  const anyRemaining = (rcvLines || []).some(r => Number(r?.remaining || 0) > 0);
  if(!anyRemaining){
    postBtn.disabled = true;
    postBtn.title = "所有品項剩餘可收皆為 0，無法產生批次";
    return;
  }

  // 尚未輸入任何本次收貨數量時，先禁用（避免按了才跳錯）
  const qtys = getRcvInputQtys();
  const hasQty = (qtys || []).some(q => Number(q || 0) > 0);
  if(!hasQty){
    postBtn.disabled = true;
    postBtn.title = "請至少輸入一筆本次收貨數量";
    return;
  }

  postBtn.disabled = false;
  postBtn.title = "產生批次";
}

function rcvWarehouseLabelById_(warehouseId){
  const id = String(warehouseId || "").trim().toUpperCase();
  if(!id) return "—";
  const w = (rcvWarehouses || []).find(x => String(x.warehouse_id || "").trim().toUpperCase() === id) || null;
  if(!w) return id;
  const name = String(w.warehouse_name || "").trim();
  const cat = String(w.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  const namePart = name || id;
  return catLabel ? `${namePart}-${catLabel}` : namePart;
}
let rcvSuppliers = [];

const RCV_OPT_SEP = "│";

function rcvEscOptAttr_(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function rcvEscOptText_(s){
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}

function rcvSupplierDisplay_(supplierId){
  const id = String(supplierId || "").trim();
  if(!id) return "—";
  const s = (rcvSuppliers || []).find(x => String(x.supplier_id || "").trim() === id) || null;
  const name = String(s?.supplier_name || "").trim();
  return name || id;
}

/** 採購單號│供應商│下單日期│預計到貨日 */
function rcvFormatPoOptionLabel_(p){
  const po = String(p?.po_id || "").trim() || "—";
  const sup = rcvSupplierDisplay_(p?.supplier_id);
  const od = String(p?.order_date || "").trim() || "—";
  const ea = String(p?.expected_arrival_date || "").trim() || "—";
  return [po, sup, od, ea].join(RCV_OPT_SEP);
}

/** 報單ID│報單號│供應商│放行日 */
function rcvFormatImportOptionLabel_(d){
  const docId = String(d?.import_doc_id || "").trim() || "—";
  const no = String(d?.import_no || "").trim() || "—";
  const sup = rcvSupplierDisplay_(d?.supplier_id);
  const rel = String(d?.release_date || "").trim() || "—";
  return [docId, no, sup, rel].join(RCV_OPT_SEP);
}

function setRcvLotState_(text, type = ""){
  const el = document.getElementById("rcvLotState");
  if(!el) return;
  el.textContent = text || "";
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function setRcvReceiptState_(text, type = ""){
  const el = document.getElementById("rcvReceiptState");
  if(!el) return;
  el.textContent = text || "";
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function formatRcvProductDisplay_(productId){
  const p = (rcvProducts || []).find(x => x.product_id === productId) || {};
  const name = p.product_name || productId || "";
  const spec = p.spec || "";
  return spec ? `${name}（${spec}）` : name;
}

/**
 * 從其他列表跳轉到「收貨入庫」時使用（預先選好來源與單號）
 * sourceType: "PO" | "IMPORT"
 */
function gotoReceive(sourceType, sourceId){
  try{
    window.__ERP_RCV_PREFILL__ = {
      sourceType: (sourceType === "IMPORT" ? "IMPORT" : "PO"),
      sourceId: String(sourceId || "")
    };
  }catch(_e){}
  if(typeof navigate === "function") navigate("receive");
}

function generateRcvId() {
  if(rcvSourceType === "PO") return generateId("GR");
  if(rcvSourceType === "IMPORT") return generateId("IR");
  return "";
}

async function rcvInitWarehouseDropdown_(){
  const whEl = document.getElementById("rcv_warehouse");
  if(!whEl) return;
  try{
    const list = await getAll("warehouse").catch(()=>[]);
    const rows = (list || []).filter(w => String(w.status || "ACTIVE").toUpperCase() === "ACTIVE");
    rcvWarehouses = rows.slice();
    rows.sort((a,b)=>String(a.warehouse_id||"").localeCompare(String(b.warehouse_id||"")));
    if(rows.length){
      whEl.innerHTML =
        '<option value="">請選擇倉別</option>' +
        rows
          .map(w=>{
            const id = String(w.warehouse_id || "").toUpperCase();
            const name = String(w.warehouse_name || "").trim();
            const cat = String(w.category || "").trim().toUpperCase();
            const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
            const namePart = name || id;
            const label = catLabel ? `${namePart}-${catLabel}` : namePart;
            return `<option value="${id}">${label}</option>`;
          })
          .join("");
      whEl.value = rows[0]?.warehouse_id ? String(rows[0].warehouse_id).toUpperCase() : "";
    }else{
      whEl.innerHTML = '<option value="">尚無倉庫，請先至「Warehouses 倉庫」建立</option>';
    }
  }catch(_e){
    whEl.innerHTML = '<option value="">倉庫載入失敗</option>';
  }
  // 不強塞 MAIN，讓流程以「必選倉別」為準
}

async function renderRcvPostedReceipts_(){
  const tbody = document.getElementById("rcvPostedBody");
  if(!tbody) return;
  if(!rcvSourceType || !rcvSourceId){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:18px;">請先選擇 PO／報單</td></tr>`;
    return;
  }
  setTbodyLoading_(tbody, 7);
  try{
    /* 作廢改由按鈕 data-rcv-receipt-id 傳入 ID（空 select 無 option 時無法用 .value 設定） */
    if(rcvSourceType === "PO"){
      const [grAll, griAll, voidData] = await Promise.all([
        getAll("goods_receipt").catch(()=>[]),
        getAll("goods_receipt_item").catch(()=>[]),
        rcvFetchVoidData_()
      ]);
      const availOpts = { availMap: voidData.availMap, availOk: voidData.availOk };
      const rows = (grAll || []).filter(r => String(r.po_id || "") === String(rcvSourceId));
      rows.sort((a,b)=>String(b.receipt_date||"").localeCompare(String(a.receipt_date||"")));
      if(!rows.length){
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:18px;">此 PO 尚無收貨單</td></tr>`;
        return;
      }
      const movements = await rcvFetchMovementsByRefs_("GOODS_RECEIPT", rows.map(r => String(r.gr_id || "")), { refresh: false });
      const items = Array.isArray(griAll) ? griAll : [];
      const mv = Array.isArray(movements) ? movements : [];
      tbody.innerHTML = "";
      rows.forEach(r=>{
        const id = String(r.gr_id || "");
        const its = items.filter(x => String(x.gr_id || "") === id);
        const lineCount = its.length;
        const totalQty = its.reduce((s,x)=>s + Number(x.received_qty || 0), 0);
        const wh = rcvWarehouseLabelById_(r.warehouse || r.warehouse_id || "");
        const st = String(r.status || "").toUpperCase() || "OPEN";
        const stLabel = (typeof termLabel === "function" ? termLabel(st) : st);
        const ev = rcvVoidEligibilityForGr_(id, r, rcvSourceId, items, mv, availOpts);
        const canVoid = ev.ok;
        const disabled = canVoid ? "" : "disabled";
        const tip = canVoid ? "作廢此張收貨單（需選擇原因）" : ev.reason;
        const tipAttr = rcvEscOptAttr_(tip);
        const idAttr = rcvEscOptAttr_(id);
        tbody.innerHTML += `
          <tr>
            <td>${id}</td>
            <td>${r.receipt_date || ""}</td>
            <td>${wh}</td>
            <td>${lineCount}</td>
            <td>${Math.round(totalQty*10000)/10000}</td>
            <td>${stLabel}</td>
            <td>
              <button type="button" class="btn-secondary btn-sm" ${disabled} title="${tipAttr}" data-rcv-receipt-id="${idAttr}" onclick="voidPostedReceiptFromListBtn(this)">${canVoid ? "作廢" : "無法作廢"}</button>
            </td>
          </tr>
        `;
      });
    }else{
      const [irAll, iriAll, voidData] = await Promise.all([
        getAll("import_receipt").catch(()=>[]),
        getAll("import_receipt_item").catch(()=>[]),
        rcvFetchVoidData_()
      ]);
      const availOpts = { availMap: voidData.availMap, availOk: voidData.availOk };
      const rows = (irAll || []).filter(r => String(r.import_doc_id || "") === String(rcvSourceId));
      rows.sort((a,b)=>String(b.receipt_date||"").localeCompare(String(a.receipt_date||"")));
      if(!rows.length){
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:18px;">此報單尚無收貨單</td></tr>`;
        return;
      }
      const movements = await rcvFetchMovementsByRefs_("IMPORT_RECEIPT", rows.map(r => String(r.import_receipt_id || "")), { refresh: false });
      const items = Array.isArray(iriAll) ? iriAll : [];
      const mv = Array.isArray(movements) ? movements : [];
      tbody.innerHTML = "";
      rows.forEach(r=>{
        const id = String(r.import_receipt_id || "");
        const its = items.filter(x => String(x.import_receipt_id || "") === id);
        const lineCount = its.length;
        const totalQty = its.reduce((s,x)=>s + Number(x.received_qty || 0), 0);
        const wh = rcvWarehouseLabelById_(r.warehouse || r.warehouse_id || "");
        const st = String(r.status || "").toUpperCase() || "OPEN";
        const stLabel = (typeof termLabel === "function" ? termLabel(st) : st);
        const ev = rcvVoidEligibilityForIr_(id, r, rcvSourceId, items, mv, availOpts);
        const canVoid = ev.ok;
        const disabled = canVoid ? "" : "disabled";
        const tip = canVoid ? "作廢此張收貨單（需選擇原因）" : ev.reason;
        const tipAttr = rcvEscOptAttr_(tip);
        const idAttr = rcvEscOptAttr_(id);
        tbody.innerHTML += `
          <tr>
            <td>${id}</td>
            <td>${r.receipt_date || ""}</td>
            <td>${wh}</td>
            <td>${lineCount}</td>
            <td>${Math.round(totalQty*10000)/10000}</td>
            <td>${stLabel}</td>
            <td>
              <button type="button" class="btn-secondary btn-sm" ${disabled} title="${tipAttr}" data-rcv-receipt-id="${idAttr}" onclick="voidPostedReceiptFromListBtn(this)">${canVoid ? "作廢" : "無法作廢"}</button>
            </td>
          </tr>
        `;
      });
    }
  }catch(e){
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#991b1b;padding:18px;">已收列表載入失敗</td></tr>`;
  }
}

async function receiveInit() {
  const dateEl = document.getElementById("rcv_receipt_date");
  if (dateEl) dateEl.value = nowIso16();
  await rcvInitWarehouseDropdown_();
  const whSel = document.getElementById("rcv_warehouse");
  if(whSel && !whSel.dataset.bound){
    whSel.dataset.bound = "1";
    whSel.addEventListener("change", () => renderRcvLines());
  }
  // 並行預取 product / PO / 報單，後續選來源時會走快取
  const [products, suppliers] = await Promise.all([
    getAll("product").catch(() => []),
    getAll("supplier").catch(() => [])
  ]);
  rcvProducts = products || [];
  rcvSuppliers = (suppliers || []).filter((s) => String(s.status || "ACTIVE").toUpperCase() === "ACTIVE");
  // 預熱快取：選來源時較快
  Promise.all([getAll("purchase_order").catch(() => []), getAll("import_document").catch(() => [])]).catch(() => {});
  // 用 addEventListener 綁定，避免 inline onchange 找不到全域函數
  const srcType = document.getElementById("rcv_source_type");
  if (srcType) srcType.onchange = onRcvSourceTypeChange;
  const srcId = document.getElementById("rcv_source_id");
  if (srcId) srcId.onchange = onRcvSourceSelect;
  const postBtn = document.getElementById("rcv_post_btn");
  if (postBtn) postBtn.onclick = function(){ return postReceipt(postBtn); };
  const resetBtn = document.getElementById("rcv_reset_btn");
  if (resetBtn) resetBtn.onclick = resetRcvForm;
  const logBtn = document.getElementById("rcv_log_btn");
  if (logBtn) logBtn.onclick = openRcvLog;
  const voidBtn = document.getElementById("rcv_void_btn");
  if (voidBtn && !voidBtn.dataset.bound) {
    voidBtn.dataset.bound = "1";
    voidBtn.onclick = function(){ return voidPostedReceipt(voidBtn); };
  }
  const postedPanel = document.getElementById("rcvPostedPanel");
  if(postedPanel && !postedPanel.dataset.bound){
    postedPanel.dataset.bound = "1";
    postedPanel.addEventListener("toggle", function(){
      if(postedPanel.open){
        renderRcvPostedReceipts_();
      }
    });
  }
  rcvInitVoidModal_();

  // 其他列表跳轉進來：自動選好來源與單號
  let prefill = null;
  try{ prefill = window.__ERP_RCV_PREFILL__ || null; }catch(_e){ prefill = null; }
  if(prefill && prefill.sourceId){
    const srcType = document.getElementById("rcv_source_type");
    if(srcType) srcType.value = (prefill.sourceType === "IMPORT" ? "IMPORT" : "PO");
    await onRcvSourceTypeChange();

    const srcId = document.getElementById("rcv_source_id");
    if(srcId) srcId.value = prefill.sourceId;
    await onRcvSourceSelect();

    try{ delete window.__ERP_RCV_PREFILL__; }catch(_e){}
  }else{
    await onRcvSourceTypeChange();
    resetRcvForm();
  }
  setRcvReceiptState_("收庫流程：未載入 — 請先選擇來源類型與單號", "warn");
  setRcvLotState_("批次狀態：未產生", "warn");
}

async function onRcvSourceTypeChange() {
  rcvSourceType = document.getElementById("rcv_source_type")?.value || "";
  const label = document.getElementById("rcv_source_label");
  const sel = document.getElementById("rcv_source_id");
  if (!sel) return;

  if(!rcvSourceType){
    if(label) label.textContent = "選擇來源 *";
    sel.innerHTML = '<option value="">請先選擇來源類型</option>';
    rcvSourceId = "";
    rcvLines = [];
    renderRcvLines();
    document.getElementById("rcv_receipt_id").value = "";
    setRcvReceiptState_("收庫流程：未載入 — 請先選擇來源類型與單號", "warn");
    setRcvLotState_("批次狀態：未產生", "warn");
    await refreshRcvVoidReceiptOptions();
    setRcvPostBtnState_();
    return;
  }

  label.textContent = rcvSourceType === "PO" ? "選擇 PO *" : "選擇報單 *";
  sel.innerHTML = '<option value="">載入中…</option>';
  rcvSourceId = "";
  rcvLines = [];
  const rcvTbType = document.getElementById("rcvLinesBody");
  if (rcvTbType) setTbodyLoading_(rcvTbType, 10);
  document.getElementById("rcv_receipt_id").value = generateRcvId();
  setRcvReceiptState_("收庫流程：未載入 — 請先選擇來源類型與單號", "warn");
  setRcvLotState_("批次狀態：未產生", "warn");

  try {
    if (rcvSourceType === "PO") {
      const pos = await getAll("purchase_order");
      const openPOs = (pos || []).filter((p) => (p.status || "").toUpperCase() !== "CLOSED");
      openPOs.sort((a, b) => String(b.order_date || "").localeCompare(String(a.order_date || "")));
      sel.innerHTML =
        '<option value="">請選擇 PO</option>' +
        openPOs
          .map((p) => {
            const v = rcvEscOptAttr_(p.po_id);
            const t = rcvEscOptText_(rcvFormatPoOptionLabel_(p));
            return `<option value="${v}">${t}</option>`;
          })
          .join("");
      if (openPOs.length === 0) sel.innerHTML = '<option value="">尚無未結案 PO</option>';
    } else {
      const docs = await getAll("import_document");
      const list = (docs || []).filter((d) => (d.status || "").toUpperCase() !== "CANCELLED");
      list.sort((a, b) => String(b.order_date || "").localeCompare(String(a.order_date || "")));
      sel.innerHTML =
        '<option value="">請選擇報單</option>' +
        list
          .map((d) => {
            const v = rcvEscOptAttr_(d.import_doc_id);
            const t = rcvEscOptText_(rcvFormatImportOptionLabel_(d));
            return `<option value="${v}">${t}</option>`;
          })
          .join("");
      if (list.length === 0) sel.innerHTML = '<option value="">尚無報單，請先至「進口報單」建立</option>';
    }
  } catch (e) {
    sel.innerHTML = '<option value="">載入失敗</option>';
    console.error(e);
  }
  renderRcvLines();
  setRcvPostBtnState_();
  await refreshRcvVoidReceiptOptions();
}

async function onRcvSourceSelect() {
  rcvSourceId = document.getElementById("rcv_source_id")?.value || "";
  rcvLines = [];
  const tbody = document.getElementById("rcvLinesBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if(!rcvSourceType){
    document.getElementById("rcv_receipt_id").value = "";
    setRcvReceiptState_("收庫流程：未載入 — 請先選擇來源類型與單號", "warn");
    setRcvLotState_("批次狀態：未產生", "warn");
    await refreshRcvVoidReceiptOptions();
    setRcvPostBtnState_();
    return;
  }

  if (!rcvSourceId) {
    document.getElementById("rcv_receipt_id").value = generateRcvId();
    setRcvReceiptState_("收庫流程：未載入 — 請先選擇來源類型與單號", "warn");
    setRcvLotState_("批次狀態：未產生", "warn");
    await refreshRcvVoidReceiptOptions();
    setRcvPostBtnState_();
    return;
  }

  setTbodyLoading_(tbody, 10);

  try {
    if (rcvSourceType === "PO") {
  const allItems = await getAll("purchase_order_item");
      const items = (allItems || []).filter((it) => it.po_id === rcvSourceId);
      items.sort((a, b) => {
        const ca = String(a.created_at || "");
        const cb = String(b.created_at || "");
        if (ca && cb && ca !== cb) return ca.localeCompare(cb);
        return String(a.po_item_id || "").localeCompare(String(b.po_item_id || ""));
      });
      rcvLines = items.map((it, idx) => {
        const orderQty = Number(it.order_qty || 0);
      const received = Number(it.received_qty || 0);
        const remaining = Math.max(0, orderQty - received);
        return {
          item_no: idx + 1,
          product_id: it.product_id || "",
          order_qty: orderQty,
          received_qty: received,
          remaining,
          unit: it.unit || "",
          po_id: rcvSourceId,
          po_item_id: it.po_item_id,
        };
      });
    } else {
      const [importItems, importReceipts, receiptItems] = await Promise.all([
        getAll("import_item"),
        getAll("import_receipt"),
        getAll("import_receipt_item"),
      ]);
      const items = (importItems || []).filter((it) => it.import_doc_id === rcvSourceId);
      items.sort((a, b) => {
        const ca = String(a.created_at || "");
        const cb = String(b.created_at || "");
        if (ca && cb && ca !== cb) return ca.localeCompare(cb);
        return String(a.import_item_id || "").localeCompare(String(b.import_item_id || ""));
      });
      const receiptIds = (importReceipts || [])
        .filter(
          (r) =>
            r.import_doc_id === rcvSourceId && String(r.status || "").toUpperCase() !== "CANCELLED"
        )
        .map((r) => r.import_receipt_id);
      const receivedByItemId = {};
      (receiptItems || []).forEach((iri) => {
        if (receiptIds.includes(iri.import_receipt_id)) {
          const k = iri.import_item_id || iri.product_id;
          receivedByItemId[k] = (receivedByItemId[k] || 0) + Number(iri.received_qty || 0);
        }
      });
      rcvLines = items.map((it, idx) => {
        const orderQty = Number(it.declared_qty || 0);
        const received = receivedByItemId[it.import_item_id] || 0;
        const remaining = Math.max(0, orderQty - received);
        return {
          /* 進口：優先報單上的項次（item_no），無則依排序為 1,2,3；過帳仍用 import_item_id */
          item_no: it.item_no != null ? it.item_no : idx + 1,
          product_id: it.product_id || "",
          order_qty: orderQty,
          received_qty: received,
          remaining,
          unit: it.declared_unit || it.unit || "",
          import_doc_id: rcvSourceId,
          import_item_id: it.import_item_id,
        };
      });
    }

    renderRcvLines();
    document.getElementById("rcv_receipt_id").value = generateRcvId();
    setRcvReceiptState_(`收庫流程：已載入 — 明細 ${rcvLines.length} 筆`, "ok");
    setRcvLotState_("批次狀態：未產生", "warn");
  } catch (e) {
    console.error(e);
    rcvLines = [];
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#991b1b;padding:18px;">收貨明細載入失敗</td></tr>`;
    setRcvReceiptState_("收庫流程：明細載入失敗", "error");
  }
  await refreshRcvVoidReceiptOptions();
}

function rcvSumMovementQtyForLot_(movements, lotId) {
  return (movements || [])
    .filter((m) => m.lot_id === lotId)
    .reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

/** 優先用後端彙總 map；缺值或彙總失敗則退回 movements 加總 */
function rcvNetQtyForLot_(movements, lotId, availMap, availOk) {
  const id = String(lotId || "");
  if (!id) return 0;
  if (availOk && availMap && availMap[id] != null) {
    return Number(availMap[id] || 0);
  }
  return rcvSumMovementQtyForLot_(movements, id);
}

/** 作廢原因（原因碼 + 畫面標籤）；OTHER 須填補充說明 */
const RCV_VOID_REASONS = [
  { code: "WRONG_GOODS", label: "收錯貨／退貨" },
  { code: "WRONG_QTY", label: "收貨數量錯誤（已產生 Lot）" },
  { code: "WRONG_SOURCE", label: "來源單據選錯（PO／報單）" },
  { code: "DUPLICATE", label: "重複收貨" },
  { code: "WRONG_MASTER", label: "倉別／日期／效期等主檔錯誤" },
  { code: "SOURCE_CHANGE", label: "來源單取消或變更須回滾" },
  { code: "TEST", label: "測試或誤建單據" },
  { code: "OTHER", label: "其他（請填寫補充說明）" },
];

function rcvBuildVoidAuditLine_(voidCtx) {
  if (!voidCtx) return "";
  const note = String(voidCtx.reasonNote || "").trim();
  let s = `原因：${voidCtx.reasonLabel || voidCtx.reasonCode || ""}`;
  if (note) s += `；說明：${note}`;
  return s;
}

function rcvFormatVoidRemarkForReceipt_(voidCtx) {
  if (!voidCtx) return "";
  const u = typeof getCurrentUser === "function" ? getCurrentUser() : "";
  const t = typeof nowIso16 === "function" ? nowIso16() : "";
  return `[作廢 ${t}${u ? " " + u : ""}] ${rcvBuildVoidAuditLine_(voidCtx)}`;
}

/** 預檢：可否整張作廢（與 cancel* 邏輯一致） */
function rcvVoidEligibilityForGr_(gr_id, grRow, po_id_expected, griAll, movements, availOpts) {
  const av = availOpts || {};
  const availMap = av.availMap;
  const availOk = !!av.availOk;
  if (!grRow) return { ok: false, reason: "找不到收貨單" };
  if (String(grRow.status || "").toUpperCase() === "CANCELLED") return { ok: false, reason: "此收貨單已作廢" };
  if (String(grRow.po_id || "") !== String(po_id_expected || "")) return { ok: false, reason: "與目前選擇的 PO 不符" };
  const items = (griAll || []).filter((x) => String(x.gr_id || "") === String(gr_id));
  if (items.length === 0) return { ok: false, reason: "無收貨明細，無法作廢" };
  const dup = (movements || []).some(
    (m) => String(m.ref_type || "") === "GOODS_RECEIPT_CANCEL" && String(m.ref_id || "") === String(gr_id)
  );
  if (dup) return { ok: false, reason: "已有作廢沖銷紀錄" };
  for (const it of items) {
    const lotId = it.lot_id || "";
    const inMv = (movements || []).find(
      (m) =>
        m.lot_id === lotId &&
        String(m.movement_type || "").toUpperCase() === "IN" &&
        String(m.ref_type || "").toUpperCase() === "GOODS_RECEIPT" &&
        String(m.ref_id || "") === String(gr_id)
    );
    if (!inMv) return { ok: false, reason: `批號 ${lotId}：找不到對應入庫異動，無法作廢` };
    const inQty = Math.abs(Number(inMv.qty || 0));
    const net = rcvNetQtyForLot_(movements, lotId, availMap, availOk);
    if (net + 1e-9 < inQty) return { ok: false, reason: `可用量不足（批號 ${lotId}）` };
  }
  return { ok: true, reason: "" };
}

function rcvVoidEligibilityForIr_(import_receipt_id, irRow, doc_id_expected, iriAll, movements, availOpts) {
  const av = availOpts || {};
  const availMap = av.availMap;
  const availOk = !!av.availOk;
  if (!irRow) return { ok: false, reason: "找不到進口收貨單" };
  if (String(irRow.status || "").toUpperCase() === "CANCELLED") return { ok: false, reason: "此收貨單已作廢" };
  if (String(irRow.import_doc_id || "") !== String(doc_id_expected || "")) {
    return { ok: false, reason: "與目前選擇的報單不符" };
  }
  const items = (iriAll || []).filter((x) => String(x.import_receipt_id || "") === String(import_receipt_id));
  if (items.length === 0) return { ok: false, reason: "無收貨明細，無法作廢" };
  const dup = (movements || []).some(
    (m) =>
      String(m.ref_type || "") === "IMPORT_RECEIPT_CANCEL" && String(m.ref_id || "") === String(import_receipt_id)
  );
  if (dup) return { ok: false, reason: "已有作廢沖銷紀錄" };
  for (const it of items) {
    const lotId = it.lot_id || "";
    const inMv = (movements || []).find(
      (m) =>
        m.lot_id === lotId &&
        String(m.movement_type || "").toUpperCase() === "IN" &&
        String(m.ref_type || "").toUpperCase() === "IMPORT_RECEIPT" &&
        String(m.ref_id || "") === String(import_receipt_id)
    );
    if (!inMv) return { ok: false, reason: `批號 ${lotId}：找不到對應入庫異動，無法作廢` };
    const inQty = Math.abs(Number(inMv.qty || 0));
    const net = rcvNetQtyForLot_(movements, lotId, availMap, availOk);
    if (net + 1e-9 < inQty) return { ok: false, reason: `可用量不足（批號 ${lotId}）` };
  }
  return { ok: true, reason: "" };
}

async function refreshRcvVoidReceiptOptions() {
  const sel = document.getElementById("rcv_void_receipt_id");
  if (!sel) return;
  if (!rcvSourceId) {
    sel.innerHTML = '<option value="">請先選擇 PO／報單</option>';
    return;
  }
  try {
    if (rcvSourceType === "PO") {
      const all = await getAll("goods_receipt").catch(() => []);
      const rows = (all || []).filter(
        (r) => r.po_id === rcvSourceId && String(r.status || "").toUpperCase() !== "CANCELLED"
      );
      rows.sort((a, b) => String(b.receipt_date || "").localeCompare(String(a.receipt_date || "")));
      sel.innerHTML =
        '<option value="">請選擇要作廢的採購收貨單（GR）</option>' +
        rows.map((r) => `<option value="${r.gr_id}">${r.gr_id} — ${r.receipt_date || ""}</option>`).join("");
    } else {
      const all = await getAll("import_receipt").catch(() => []);
      const rows = (all || []).filter(
        (r) =>
          r.import_doc_id === rcvSourceId && String(r.status || "").toUpperCase() !== "CANCELLED"
      );
      rows.sort((a, b) => String(b.receipt_date || "").localeCompare(String(a.receipt_date || "")));
      sel.innerHTML =
        '<option value="">請選擇要作廢的進口收貨單（IR）</option>' +
        rows
          .map((r) => `<option value="${r.import_receipt_id}">${r.import_receipt_id} — ${r.receipt_date || ""}</option>`)
          .join("");
    }
  } catch (e) {
    sel.innerHTML = '<option value="">載入收貨單列表失敗</option>';
    console.error(e);
  }
}

function renderRcvLines() {
  const tbody = document.getElementById("rcvLinesBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const whSel = document.getElementById("rcv_warehouse");
  const whText = whSel && whSel.selectedOptions && whSel.selectedOptions[0]
    ? String(whSel.selectedOptions[0].textContent || "").trim()
    : "";
  rcvLines.forEach((row, idx) => {
    const orderLabel = rcvSourceType === "PO" ? "訂購數量" : "申報數量";
    const canReceive = Number(row.remaining || 0) > 0;
    const maxVal = canReceive ? row.remaining : 0;
    const placeholder = canReceive ? "0" : "剩餘=0";
    const disabledAttr = canReceive ? "" : 'disabled value="0"';
    tbody.innerHTML += `
      <tr>
        <td>${row.item_no}</td>
        <td>${formatRcvProductDisplay_(row.product_id)}</td>
        <td>${whText || "—"}</td>
        <td>${row.order_qty}</td>
        <td>${row.received_qty}</td>
        <td>${row.remaining}</td>
        <td><input type="number" id="rcv_qty_${idx}" min="0" max="${maxVal}" step="0.01" placeholder="${placeholder}" ${disabledAttr} style="width:100px;"></td>
        <td><input type="date" id="rcv_mfg_${idx}" style="width:120px;padding:4px 6px;"></td>
        <td><input type="date" id="rcv_exp_${idx}" style="width:120px;padding:4px 6px;"></td>
        <td>${row.unit}</td>
      </tr>
    `;
  });

  // 綁定輸入事件：即時更新「產生批次」按鈕狀態/提示
  rcvLines.forEach((row, idx) => {
    const q = document.getElementById(`rcv_qty_${idx}`);
    if(q){
      q.oninput = setRcvPostBtnState_;
      q.onchange = setRcvPostBtnState_;
    }
  });
  setRcvPostBtnState_();
}

function getRcvInputQtys() {
  return rcvLines.map((_, idx) => {
    const el = document.getElementById(`rcv_qty_${idx}`);
    return Math.max(0, Number(el?.value || 0));
  });
}

function getRcvLotDates() {
  return rcvLines.map((_, idx) => {
    const mfg = (document.getElementById(`rcv_mfg_${idx}`)?.value || "").trim();
    const exp = (document.getElementById(`rcv_exp_${idx}`)?.value || "").trim();
    return { manufacture_date: mfg, expiry_date: exp };
  });
}

function resetRcvForm() {
  rcvLines = [];
  renderRcvLines();
  document.getElementById("rcv_receipt_id").value = generateRcvId();
  const dateEl = document.getElementById("rcv_receipt_date");
  if (dateEl) dateEl.value = nowIso16();
  rcvInitWarehouseDropdown_().catch(()=>{});
  const rmEl = document.getElementById("rcv_remark");
  if (rmEl) rmEl.value = "";
  const sel = document.getElementById("rcv_source_id");
  if (sel) sel.value = "";
  rcvSourceId = "";
  refreshRcvVoidReceiptOptions().catch(() => {});
  setRcvReceiptState_("收庫流程：未載入 — 請先選擇來源類型與單號", "warn");
  setRcvPostBtnState_();
}

function openRcvLog() {
  const id = document.getElementById("rcv_receipt_id")?.value || "";
  const type = rcvSourceType === "PO" ? "goods_receipt" : "import_receipt";
  if (typeof openLogs === "function") openLogs(type, id, "inbound");
}

async function postReceipt(triggerEl) {
  const receiptId = (document.getElementById("rcv_receipt_id")?.value || "").trim().toUpperCase();
  const receiptDate = document.getElementById("rcv_receipt_date")?.value || "";
  const warehouse = (document.getElementById("rcv_warehouse")?.value || "").trim().toUpperCase();
  const remark = (document.getElementById("rcv_remark")?.value || "").trim();

  if (!rcvSourceType) return showToast("請選擇 來源類型", "error");
  if (!receiptId) return showToast("收貨單ID 必填", "error");
  if (!rcvSourceId) return showToast("請選擇 " + (rcvSourceType === "PO" ? "PO" : "報單"), "error");
  if (!receiptDate) return showToast("收貨日期 必填", "error");
  if (!warehouse) return showToast("倉別 必填", "error");

  const qtys = getRcvInputQtys();
  const lotDates = getRcvLotDates();
  const hasQty = qtys.some((q) => q > 0);
  if (!hasQty) return showToast("請至少輸入一筆本次收貨數量", "error");

  for(let i = 0; i < qtys.length; i++){
    if((qtys[i] || 0) <= 0) continue;
    const d = lotDates[i] || {};
    const mfg = d.manufacture_date || "";
    const exp = d.expiry_date || "";
    if(mfg && exp && exp < mfg){
      return showToast(`第 ${i + 1} 筆：有效期不可早於製造日`, "error");
    }
  }

  showSaveHint(triggerEl);
  try {
  if (rcvSourceType === "PO") {
    await postGoodsReceiptUnified(receiptId, receiptDate, warehouse, remark, qtys, lotDates);
  } else {
    await postImportReceiptUnified(receiptId, receiptDate, warehouse, remark, qtys, lotDates);
  }
  // 建立批次後：跳到 Lots，並以收貨單ID作為關鍵字（方便立刻 QA/確認）
  try{
    window.__ERP_PREFILL_LOTS_KEYWORD__ = receiptId;
  }catch(_e){}
  if(typeof navigate === "function") navigate("lots");
  } finally { hideSaveHint(); }
}

async function postGoodsReceiptUnified(gr_id, receipt_date, warehouse, remark, qtys, lotDates) {
  const po_id = rcvSourceId;
  const poHeader = await getOne("purchase_order", "po_id", po_id).catch(() => null);
  if (!poHeader) return showToast("找不到此 PO", "error");
  if (String(poHeader.status || "").toUpperCase() === "CANCELLED") {
    return showToast("此 PO 已取消，不能建立收貨單", "error");
  }
  const allItems = await getAll("purchase_order_item");
  const currentItems = (allItems || []).filter((it) => it.po_id === po_id);
  const itemMap = new Map(currentItems.map((it) => [it.po_item_id, it]));

  const gr = {
    gr_id,
    po_id,
    receipt_date,
    warehouse,
    status: "OPEN",
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
  };
  await createRecord("goods_receipt", gr);

  let created = 0;
  for (let idx = 0; idx < rcvLines.length; idx++) {
    const qty = qtys[idx] || 0;
    if (qty <= 0) continue;
    const row = rcvLines[idx];
    const it = itemMap.get(row.po_item_id);
    if (!it) continue;
    const ordered = Number(it.order_qty || 0);
    const received = Number(it.received_qty || 0);
    const remain = Math.max(0, ordered - received);
    if (qty > remain) {
      showToast(`項次 ${row.item_no}（${row.po_item_id}）超過剩餘可收`, "error");
      continue;
    }

    const p = (rcvProducts || []).find((x) => x.product_id === row.product_id);
    const lotType = p?.type || "RM";
    const lot_id = generateId("LOT");
    const dates = lotDates?.[idx] || {};

    await createRecord("lot", {
      lot_id,
      product_id: row.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      source_type: "PURCHASE",
      source_id: gr_id,
      qty: String(qty),
      unit: row.unit,
      type: lotType,
      status: "",
      inventory_status: "ACTIVE",
      received_date: receipt_date,
      manufacture_date: dates.manufacture_date || "",
      expiry_date: dates.expiry_date || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      remark: "",
      system_remark: `PO:${po_id} / ITEM:${row.po_item_id}`,
    });

    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id,
      product_id: row.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      qty: String(qty),
      unit: row.unit,
      ref_type: "GOODS_RECEIPT",
      ref_id: gr_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `PO IN: ${po_id}`,
    });

    await createRecord("goods_receipt_item", {
      gr_item_id: `GRI-${gr_id}-${String(created + 1).padStart(3, "0")}`,
      gr_id,
      po_id,
      po_item_id: row.po_item_id,
      product_id: row.product_id,
      received_qty: String(qty),
      unit: row.unit,
      lot_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
    });

    await updateRecord("purchase_order_item", "po_item_id", row.po_item_id, {
      received_qty: String(received + qty),
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });
    created++;
  }

  // 規則（與進口一致）：只要有「未作廢收貨單」→ PO 狀態視為 CLOSED
  // - 避免手動改狀態造成不一致
  // - 若本次沒有任何明細入庫（created=0），不改 PO 狀態，避免空收貨單誤關單
  if (created > 0) {
    const grAll = await getAll("goods_receipt").catch(() => []);
    const hasActive = (grAll || []).some((r) =>
      String(r.po_id || "") === String(po_id) &&
      String(r.status || "").toUpperCase() !== "CANCELLED"
    );
    await updateRecord("purchase_order", "po_id", po_id, {
      status: hasActive ? "CLOSED" : "OPEN",
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });
  }

  const poMsg = created === 0
    ? "本次沒有可收數量（本次收貨數量未填或超過可收量），未產生 Lot。"
    : `收貨完成：已產生 ${created} 個 Lot（PENDING）`;
  showToast(poMsg);
  setRcvLotState_(created === 0 ? "批次狀態：未產生" : `批次狀態：已產生 — ${created} 個（待QA）`, created === 0 ? "warn" : "ok");
  resetRcvForm();
  await onRcvSourceTypeChange();
}

async function postImportReceiptUnified(import_receipt_id, receipt_date, warehouse, remark, qtys, lotDates) {
  const import_doc_id = rcvSourceId;
  const doc = await getOne("import_document", "import_doc_id", import_doc_id).catch(() => null);
  if (!doc) return showToast("找不到此報單", "error");
  if (String(doc.status || "").toUpperCase() === "CANCELLED") {
    return showToast("此報單已取消，不能建立收貨單", "error");
  }
  const docNo = doc.import_no || "";

  const receipt = {
    import_receipt_id,
    import_doc_id,
    receipt_date,
    warehouse,
    status: "OPEN",
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
  };
  await createRecord("import_receipt", receipt);

  let created = 0;
  for (let idx = 0; idx < rcvLines.length; idx++) {
    const qty = qtys[idx] || 0;
    if (qty <= 0) continue;
    const row = rcvLines[idx];
    if (qty > row.remaining) {
      showToast(`項次 ${row.item_no}（${row.import_item_id}）超過剩餘可收`, "error");
      continue;
    }

    const p = (rcvProducts || []).find((x) => x.product_id === row.product_id);
    const lotType = p?.type || "RM";
    const lot_id = generateId("LOT");
    const dates = lotDates?.[idx] || {};

    await createRecord("lot", {
      lot_id,
      product_id: row.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      source_type: "IMPORT",
      source_id: import_receipt_id,
      qty: String(qty),
      unit: row.unit,
      type: lotType,
      status: "",
      inventory_status: "ACTIVE",
      received_date: receipt_date,
      manufacture_date: dates.manufacture_date || "",
      expiry_date: dates.expiry_date || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      remark: "",
      system_remark: `Import: ${import_doc_id}${docNo ? " / " + docNo : ""}`.trim(),
    });

    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id,
      product_id: row.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      qty: String(qty),
      unit: row.unit,
      ref_type: "IMPORT_RECEIPT",
      ref_id: import_receipt_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `Import IN: ${import_doc_id}`,
    });

    await createRecord("import_receipt_item", {
      import_receipt_item_id: `IRI-${import_receipt_id}-${String(created + 1).padStart(3, "0")}`,
      import_receipt_id,
      import_item_id: row.import_item_id || "",
      product_id: row.product_id,
      received_qty: String(qty),
      unit: row.unit,
      lot_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
    });
    created++;
  }

  // 規則：只要有「未作廢收貨單」→ 報單狀態視為 CLOSED
  if (created > 0) {
    const irAll = await getAll("import_receipt").catch(() => []);
    const hasActive = (irAll || []).some((r) =>
      String(r.import_doc_id || "") === String(import_doc_id) &&
      String(r.status || "").toUpperCase() !== "CANCELLED"
    );
    await updateRecord("import_document", "import_doc_id", import_doc_id, {
      status: hasActive ? "CLOSED" : "OPEN",
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });
  }

  const irMsg = created === 0
    ? "本次沒有可收數量（本次收貨數量未填或超過可收量），未產生 Lot。"
    : `進口收貨完成：已產生 ${created} 個 Lot（PENDING）`;
  showToast(irMsg);
  resetRcvForm();
  await onRcvSourceTypeChange();
}

function voidPostedReceiptFromListBtn(triggerEl) {
  if (!triggerEl || triggerEl.disabled) return;
  const rid = (triggerEl.getAttribute("data-rcv-receipt-id") || "").trim();
  if (!rid) return showToast("請選擇要作廢的收貨單", "error");
  rcvOpenVoidModal_(rid);
}

function rcvCloseVoidModal() {
  const modal = document.getElementById("rcvVoidModal");
  if (!modal) return;
  modal.classList.remove("rcv-void-modal-open");
  delete modal.dataset.rcvReceiptId;
  const note = document.getElementById("rcv_void_reason_note");
  if (note) note.value = "";
  const code = document.getElementById("rcv_void_reason_code");
  if (code) code.value = "";
}

function rcvOpenVoidModal_(receiptId) {
  const id = String(receiptId || "").trim();
  if (!id) return showToast("請選擇要作廢的收貨單", "error");
  if (!rcvSourceId) return showToast("請先選擇 PO 或進口報單", "error");
  const modal = document.getElementById("rcvVoidModal");
  const label = document.getElementById("rcvVoidModalReceiptLabel");
  const note = document.getElementById("rcv_void_reason_note");
  const code = document.getElementById("rcv_void_reason_code");
  if (!modal || !label) return;
  modal.dataset.rcvReceiptId = id;
  label.textContent =
    rcvSourceType === "PO"
      ? `採購收貨單（GR）：${id}`
      : `進口收貨單（IR）：${id}`;
  if (note) note.value = "";
  if (code) code.value = "";
  modal.classList.add("rcv-void-modal-open");
}

function rcvInitVoidModal_() {
  const sel = document.getElementById("rcv_void_reason_code");
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = "1";
    sel.innerHTML =
      '<option value="">請選擇作廢原因</option>' +
      RCV_VOID_REASONS.map(
        (r) =>
          `<option value="${rcvEscOptAttr_(r.code)}">${rcvEscOptText_(r.label)}</option>`
      ).join("");
  }
  const conf = document.getElementById("rcv_void_modal_confirm");
  if (conf && !conf.dataset.bound) {
    conf.dataset.bound = "1";
    conf.onclick = function () {
      rcvConfirmVoidModal_();
    };
  }
}

async function rcvConfirmVoidModal_() {
  const modal = document.getElementById("rcvVoidModal");
  const receiptId = (modal && modal.dataset.rcvReceiptId) || "";
  if (!receiptId.trim()) return showToast("缺少收貨單 ID", "error");
  const codeEl = document.getElementById("rcv_void_reason_code");
  const noteEl = document.getElementById("rcv_void_reason_note");
  const code = (codeEl && codeEl.value) || "";
  const note = (noteEl && noteEl.value) || "";
  if (!code) return showToast("請選擇作廢原因", "error");
  if (code === "OTHER" && !String(note).trim()) {
    return showToast("選擇「其他」請填寫補充說明", "error");
  }
  const meta = RCV_VOID_REASONS.find((x) => x.code === code);
  const reasonLabel = meta ? meta.label : code;
  const voidCtx = {
    reasonCode: code,
    reasonLabel,
    reasonNote: String(note).trim(),
  };
  const triggerEl = document.getElementById("rcv_void_modal_confirm");
  rcvCloseVoidModal();
  if (rcvSourceType === "PO") {
    await cancelGoodsReceiptUnified(receiptId, triggerEl, voidCtx);
  } else {
    await cancelImportReceiptUnified(receiptId, triggerEl, voidCtx);
  }
}

async function voidPostedReceipt(triggerEl, explicitReceiptId) {
  let receiptId = String(explicitReceiptId || "").trim();
  if (!receiptId) {
    receiptId = (document.getElementById("rcv_void_receipt_id")?.value || "").trim();
  }
  if (!receiptId) return showToast("請選擇要作廢的收貨單", "error");
  if (!rcvSourceId) return showToast("請先選擇 PO 或進口報單", "error");
  rcvOpenVoidModal_(receiptId);
}

/**
 * 作廢採購收貨：ADJUST 沖銷原 IN、Lot→VOID／QA REJECTED、goods_receipt→CANCELLED、回退 PO 已收。
 * 僅當各 Lot 之 movements 加總仍 ≥ 該筆入庫量（未被下游扣用）時允許。
 */
async function cancelGoodsReceiptUnified(gr_id, triggerEl, voidCtx) {
  const gr = await getOne("goods_receipt", "gr_id", gr_id).catch(() => null);
  if (!gr) return showToast("找不到收貨單", "error");
  if (String(gr.status || "").toUpperCase() === "CANCELLED") return showToast("此收貨單已作廢", "error");
  if (String(gr.po_id || "") !== String(rcvSourceId)) return showToast("收貨單與目前選擇的 PO 不符", "error");

  const [voidData, itemsAll] = await Promise.all([
    rcvFetchVoidData_({ refreshMovements: true }),
    getAll("goods_receipt_item").catch(() => [])
  ]);
  const movements = voidData.movements;
  const availMap = voidData.availMap;
  const availOk = voidData.availOk;
  const items = (itemsAll || []).filter((x) => x.gr_id === gr_id);
  if (items.length === 0) return showToast("無收貨明細，無法作廢", "error");

  const dupCancel = (movements || []).some(
    (m) => String(m.ref_type || "") === "GOODS_RECEIPT_CANCEL" && String(m.ref_id || "") === gr_id
  );
  if (dupCancel) return showToast("此收貨單已有作廢沖銷記錄", "error");

  const plan = [];
  for (const it of items) {
    const lotId = it.lot_id || "";
    const inMv = (movements || []).find(
      (m) =>
        m.lot_id === lotId &&
        String(m.movement_type || "").toUpperCase() === "IN" &&
        String(m.ref_type || "").toUpperCase() === "GOODS_RECEIPT" &&
        String(m.ref_id || "") === gr_id
    );
    if (!inMv) {
      return showToast(`批號 ${lotId}：找不到對應之採購入庫異動（IN），無法作廢`, "error");
    }
    const inQty = Math.abs(Number(inMv.qty || 0));
    const net = rcvNetQtyForLot_(movements, lotId, availMap, availOk);
    if (net + 1e-9 < inQty) {
      return showToast(
        `批號 ${lotId}：可用量不足（已有出庫／加工／調整等），無法作廢整張收貨單`,
        "error"
      );
    }
    plan.push({ it, inMv, lotId, inQty });
  }

  if (!voidCtx) {
    const ok = confirm(
      `確定作廢採購收貨單 ${gr_id}？\n\n將以庫存調整（ADJUST）沖銷入庫、Lot 標為不可用（VOID），並回退 PO 已收數量。`
    );
    if (!ok) return;
  }

  const adjRemark = voidCtx ? rcvBuildVoidAuditLine_(voidCtx) : "作廢沖銷";
  const voidTag = voidCtx ? ` | VOID:${voidCtx.reasonCode}` : "";

  showSaveHint(triggerEl);
  try {
    for (const { inMv, lotId, inQty } of plan) {
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "ADJUST",
        lot_id: lotId,
        product_id: inMv.product_id || "",
        warehouse_id: String(gr.warehouse || inMv.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
        qty: String(-Math.abs(inQty)),
        unit: inMv.unit || "",
        ref_type: "GOODS_RECEIPT_CANCEL",
        ref_id: gr_id,
        remark: adjRemark,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
        system_remark: `REVERSAL(IN) of ${inMv.movement_id || ""}${voidTag}`,
      });
    }
    for (const { it } of plan) {
      await updateRecord("lot", "lot_id", it.lot_id, {
        inventory_status: "VOID",
        status: "REJECTED",
        updated_by: getCurrentUser(),
        updated_at: nowIso16(),
      });
    }
    for (const it of items) {
      const poi = await getOne("purchase_order_item", "po_item_id", it.po_item_id).catch(() => null);
      if (!poi) continue;
      const dec = Number(it.received_qty || 0);
      const next = Math.max(0, Number(poi.received_qty || 0) - dec);
      await updateRecord("purchase_order_item", "po_item_id", it.po_item_id, {
        received_qty: String(next),
        updated_by: getCurrentUser(),
        updated_at: nowIso16(),
      });
    }

    // 與進口一致：只要有「未作廢收貨單」→ PO 狀態視為 CLOSED；否則 OPEN（除非 PO 已取消）
    const po_id = gr.po_id;
    try{
      const po = await getOne("purchase_order", "po_id", po_id).catch(() => null);
      if (po && String(po.status || "").toUpperCase() !== "CANCELLED") {
        const grAll = await getAll("goods_receipt").catch(() => []);
        const hasActive = (grAll || []).some((r) =>
          String(r.po_id || "") === String(po_id) &&
          String(r.status || "").toUpperCase() !== "CANCELLED"
        );
        await updateRecord("purchase_order", "po_id", po_id, {
          status: hasActive ? "CLOSED" : "OPEN",
          updated_by: getCurrentUser(),
          updated_at: nowIso16(),
        });
      }
    }catch(_e){}

    const voidLine = voidCtx ? rcvFormatVoidRemarkForReceipt_(voidCtx) : "";
    const prevRemark = String(gr.remark || "").trim();
    const nextRemark = voidLine ? (prevRemark ? `${prevRemark}\n${voidLine}` : voidLine) : prevRemark;

    await updateRecord("goods_receipt", "gr_id", gr_id, {
      status: "CANCELLED",
      ...(voidLine ? { remark: nextRemark || voidLine } : {}),
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });

    showToast("作廢完成：已沖銷入庫、Lot 已標示 VOID，並回退 PO 已收");
    await refreshRcvVoidReceiptOptions();
    await onRcvSourceSelect();
    const ppGr = document.getElementById("rcvPostedPanel");
    if (ppGr && ppGr.open) await renderRcvPostedReceipts_();
  } finally {
    hideSaveHint();
  }
}

/**
 * 作廢進口收貨：同上，但不涉及 PO（進口已收由 import_receipt_item 匯總）。
 */
async function cancelImportReceiptUnified(import_receipt_id, triggerEl, voidCtx) {
  const ir = await getOne("import_receipt", "import_receipt_id", import_receipt_id).catch(() => null);
  if (!ir) return showToast("找不到進口收貨單", "error");
  if (String(ir.status || "").toUpperCase() === "CANCELLED") return showToast("此收貨單已作廢", "error");
  if (String(ir.import_doc_id || "") !== String(rcvSourceId)) {
    return showToast("收貨單與目前選擇的報單不符", "error");
  }

  const [voidDataIr, itemsAll] = await Promise.all([
    rcvFetchVoidData_({ refreshMovements: true }),
    getAll("import_receipt_item").catch(() => [])
  ]);
  const movements = voidDataIr.movements;
  const availMap = voidDataIr.availMap;
  const availOk = voidDataIr.availOk;
  const items = (itemsAll || []).filter((x) => x.import_receipt_id === import_receipt_id);
  if (items.length === 0) return showToast("無收貨明細，無法作廢", "error");

  const dupCancel = (movements || []).some(
    (m) => String(m.ref_type || "") === "IMPORT_RECEIPT_CANCEL" && String(m.ref_id || "") === import_receipt_id
  );
  if (dupCancel) return showToast("此收貨單已有作廢沖銷記錄", "error");

  const plan = [];
  for (const it of items) {
    const lotId = it.lot_id || "";
    const inMv = (movements || []).find(
      (m) =>
        m.lot_id === lotId &&
        String(m.movement_type || "").toUpperCase() === "IN" &&
        String(m.ref_type || "").toUpperCase() === "IMPORT_RECEIPT" &&
        String(m.ref_id || "") === import_receipt_id
    );
    if (!inMv) {
      return showToast(`批號 ${lotId}：找不到對應之進口入庫異動（IN），無法作廢`, "error");
    }
    const inQty = Math.abs(Number(inMv.qty || 0));
    const net = rcvNetQtyForLot_(movements, lotId, availMap, availOk);
    if (net + 1e-9 < inQty) {
      return showToast(
        `批號 ${lotId}：可用量不足（已有出庫／加工／調整等），無法作廢整張收貨單`,
        "error"
      );
    }
    plan.push({ it, inMv, lotId, inQty });
  }

  if (!voidCtx) {
    const ok = confirm(
      `確定作廢進口收貨單 ${import_receipt_id}？\n\n將以庫存調整（ADJUST）沖銷入庫，並將 Lot 標為不可用（VOID）。`
    );
    if (!ok) return;
  }

  const adjRemark = voidCtx ? rcvBuildVoidAuditLine_(voidCtx) : "作廢沖銷";
  const voidTag = voidCtx ? ` | VOID:${voidCtx.reasonCode}` : "";

  showSaveHint(triggerEl);
  try {
    for (const { inMv, lotId, inQty } of plan) {
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "ADJUST",
        lot_id: lotId,
        product_id: inMv.product_id || "",
        warehouse_id: String(ir.warehouse || inMv.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
        qty: String(-Math.abs(inQty)),
        unit: inMv.unit || "",
        ref_type: "IMPORT_RECEIPT_CANCEL",
        ref_id: import_receipt_id,
        remark: adjRemark,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
        system_remark: `REVERSAL(IN) of ${inMv.movement_id || ""}${voidTag}`,
      });
    }
    for (const { it } of plan) {
      await updateRecord("lot", "lot_id", it.lot_id, {
        inventory_status: "VOID",
        status: "REJECTED",
        updated_by: getCurrentUser(),
        updated_at: nowIso16(),
      });
    }

    const voidLineIr = voidCtx ? rcvFormatVoidRemarkForReceipt_(voidCtx) : "";
    const prevIrRemark = String(ir.remark || "").trim();
    const nextIrRemark = voidLineIr ? (prevIrRemark ? `${prevIrRemark}\n${voidLineIr}` : voidLineIr) : prevIrRemark;

    await updateRecord("import_receipt", "import_receipt_id", import_receipt_id, {
      status: "CANCELLED",
      ...(voidLineIr ? { remark: nextIrRemark || voidLineIr } : {}),
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });

    // 規則：若此報單已無任何「未作廢收貨單」→ 報單狀態回到 OPEN（除非報單已取消）
    try{
      const docId = ir.import_doc_id;
      const doc = await getOne("import_document", "import_doc_id", docId).catch(() => null);
      if (doc && String(doc.status || "").toUpperCase() !== "CANCELLED") {
        const irAll = await getAll("import_receipt").catch(() => []);
        const hasActive = (irAll || []).some((r) =>
          String(r.import_doc_id || "") === String(docId) &&
          String(r.status || "").toUpperCase() !== "CANCELLED"
        );
        await updateRecord("import_document", "import_doc_id", docId, {
          status: hasActive ? "CLOSED" : "OPEN",
          updated_by: getCurrentUser(),
          updated_at: nowIso16(),
        });
      }
    }catch(_e){}

    showToast("作廢完成：已沖銷入庫、Lot 已標示 VOID");
    await refreshRcvVoidReceiptOptions();
    await onRcvSourceSelect();
    const ppIr = document.getElementById("rcvPostedPanel");
    if (ppIr && ppIr.open) await renderRcvPostedReceipts_();
  } finally {
    hideSaveHint();
  }
}
