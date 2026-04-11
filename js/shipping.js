/**
 * Shipment（API 版）
 * - 過帳時：shipment + shipment_item + inventory_movement(SHIP_OUT)
 * - 回寫 sales_order_item.shipped_qty 與 sales_order.status
 */

let shipDraft = [];
let shipLots = [];
let shipMovements = []; // legacy: 保留變數以避免其他函式引用報錯
let shipAvailableByLotId_ = {};
let shipCustomers = [];
let shipSalesOrders = [];
let shipSalesItems = [];
let shipSalesItemsBySoId_ = {};
let shipSalesItemsLoadingBySoId_ = {};
let shipProducts = [];
let shipWarehouses = [];
let shipEditing = false;
let shipReadOnlyDraft = false;
/** 主檔狀態由系統維護（過帳/作廢 bundle 回寫），前端僅顯示用 */
let shipLoadedStatus_ = "OPEN";
let shipGoodsReceiptIdToPoId = {};
let shipImportReceiptIdToDocId = {};
let shipImportDocIdToImportNo = {};
/** 點選明細列：草稿為 DRAFT-*；已載入出貨單為 shipment_item_id */
let shipSelectedLineId_ = "";

function updateShipStatusHint_(){
  const el = document.getElementById("shipStatusHint");
  const invEl = document.getElementById("shipInvState");
  if(!el) return;
  if(shipEditing && shipReadOnlyDraft){
    const st = String(shipLoadedStatus_ || "").trim().toUpperCase();
    el.textContent = "出貨流程：已載入 — " + (termLabel(st) || st) + "（僅可檢視）";
    if(invEl){
      invEl.textContent =
        st === "POSTED" ? "扣庫狀態：已過帳 — 已扣庫" :
        st === "CANCELLED" ? "扣庫狀態：已作廢 — 已反沖" :
        "扣庫狀態：未過帳 — 未扣庫";
      invEl.style.color =
        st === "POSTED" ? "#166534" :
        st === "CANCELLED" ? "#991b1b" :
        "#92400e";
    }
  }else{
    el.textContent = "出貨流程：新單 — 填主檔與明細後按下方「建立並過帳出貨」扣庫";
    if(invEl){
      invEl.textContent = "扣庫狀態：未過帳 — 建立並過帳後才扣庫";
      invEl.style.color = "#92400e";
    }
  }
}

function setShipButtons_(){
  const postBtn = document.getElementById("ship_post_btn");
  const cancelBtn = document.getElementById("ship_cancel_btn");
  const st = String(shipLoadedStatus_ || "OPEN").toUpperCase();

  if(postBtn){
    // 建單（並過帳）只在「新單草稿」可用
    postBtn.disabled = !!shipEditing;
    postBtn.title = shipEditing ? "請先清除回到新單，才能建立並過帳" : "建立並過帳出貨（扣庫）";
  }
  if(cancelBtn){
    if(!shipEditing){
      cancelBtn.disabled = true;
      cancelBtn.title = "請先載入出貨單";
    }else if(st === "CANCELLED"){
      cancelBtn.disabled = true;
      cancelBtn.title = "此出貨單已作廢";
    }else if(st !== "POSTED"){
      cancelBtn.disabled = true;
      cancelBtn.title = "僅 POSTED 出貨單可作廢";
    }else{
      cancelBtn.disabled = false;
      cancelBtn.title = "作廢此出貨單（將反沖庫存並回寫 SO）";
    }
  }
}

function formatShipProductDisplay_(productId){
  const p = (shipProducts || []).find(x => x.product_id === productId) || {};
  const name = p.product_name || productId || "";
  const spec = p.spec || "";
  return spec ? `${name}（${spec}）` : name;
}

function shipFindProduct_(productId){
  const id = String(productId || "").trim();
  if(!id) return null;
  return (shipProducts || []).find(p => String(p.product_id || "").trim() === id) || null;
}

async function shippingInit(){
  await loadShipMasterData();
  const lotKw = document.getElementById("ship_lot_picker_keyword");
  if(lotKw && !lotKw.dataset.bound){
    lotKw.dataset.bound = "1";
    lotKw.addEventListener("input", () => renderShipLotPicker_(getShipLotsForPicker_()));
  }
  const lotView = document.getElementById("ship_lot_picker_viewmode");
  if(lotView && !lotView.dataset.bound){
    lotView.dataset.bound = "1";
    lotView.addEventListener("change", () => renderShipLotPicker_(getShipLotsForPicker_()));
  }
  const showInel = document.getElementById("ship_show_ineligible_lots");
  if(showInel && !showInel.dataset.bound){
    showInel.dataset.bound = "1";
    showInel.addEventListener("change", () => renderShipLotPicker_(getShipLotsForPicker_()));
  }
  resetShipForm();
  setShipButtons_();
  try{ shipUpdateAllocModeUI_(); }catch(_e){}
  // 從銷售單跳轉：預先選擇銷售單
  try{
    const preSo = window.__ERP_PREFILL_SHIP_SO_ID__;
    if(preSo){
      const soSel = document.getElementById("ship_so_id");
      if(soSel){
        soSel.value = String(preSo || "");
        onSelectShipSO();
      }
      delete window.__ERP_PREFILL_SHIP_SO_ID__;
    }
  }catch(_e){}
  bindAutoSearchToolbar_([
    ["ship_search_keyword", "input"],
    ["ship_search_status", "change"]
  ], () => renderShipments());
  await renderShipments();
}

function shipIsAutoAlloc_(){
  return !!document.getElementById("ship_auto_alloc")?.checked;
}

function shipUpdateAllocModeUI_(){
  const auto = shipIsAutoAlloc_();
  const pickBtn = document.getElementById("ship_pick_lot_btn");
  const lotDisp = document.getElementById("ship_lot_display");
  const lotId = document.getElementById("ship_lot_id");
  if(pickBtn){
    pickBtn.disabled = !!shipReadOnlyDraft || auto;
    pickBtn.title =
      shipReadOnlyDraft ? "此出貨單已結束（POSTED/CANCELLED），不可再選擇 Lot" :
      auto ? "已勾選自動分配（依效期 FEFO），不需手動選擇 Lot" :
      "選擇要出貨的 Lot";
  }
  if(lotDisp){
    lotDisp.placeholder = auto ? "自動分配（依效期 FEFO）" : "請在下方按「選擇 Lot」帶入";
    lotDisp.style.background = auto ? "#f8fafc" : "";
  }
  if(auto){
    if(lotId) lotId.value = "";
    if(lotDisp) lotDisp.value = "";
  }
}

function shipParseYMD_(s){
  const raw = String(s || "").trim();
  if(!raw) return null;
  const m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if(!y || !mo || !d) return null;
  return { y, mo, d };
}

function shipExpirySortKey_(lot){
  const ymd = shipParseYMD_(lot?.expiry_date);
  if(!ymd) return "9999-12-31";
  const pad2 = (n)=>String(n).padStart(2,"0");
  return `${ymd.y}-${pad2(ymd.mo)}-${pad2(ymd.d)}`;
}

function shipIsLotEligibleForShip_(lot){
  if(!lot) return false;
  const whitelist = shipGetProductWhitelistForPicker_();
  const pid = String(lot?.product_id || "").trim();
  if(whitelist && !whitelist.has(pid)) return false;
  if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
  if(String(lot.status || "PENDING").toUpperCase() !== "APPROVED") return false;
  try{
    if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)) return false;
  }catch(_e){}
  const av = shipGetAvailable(lot.lot_id);
  return Number(av || 0) > 1e-9;
}

function shipAutoAllocateLots_(productId, qtyNeeded){
  const pid = String(productId || "").trim();
  let need = Number(qtyNeeded || 0);
  if(!pid || !(need > 0)) return { lines: [], shortage: need };

  const candidates = (shipLots || [])
    .filter(l => String(l?.product_id || "").trim() === pid)
    .filter(l => shipIsLotEligibleForShip_(l));

  candidates.sort((a,b)=>{
    const ea = shipExpirySortKey_(a);
    const eb = shipExpirySortKey_(b);
    if(ea !== eb) return ea.localeCompare(eb);
    const ca = String(a?.created_at || "");
    const cb = String(b?.created_at || "");
    if(ca !== cb) return ca.localeCompare(cb);
    return String(a?.lot_id || "").localeCompare(String(b?.lot_id || ""));
  });

  const lines = [];
  for(const lot of candidates){
    if(!(need > 1e-9)) break;
    const av = Number(shipGetAvailable(lot.lot_id) || 0);
    if(!(av > 1e-9)) continue;
    const take = Math.min(av, need);
    lines.push({ lot, qty: take });
    need -= take;
  }
  return { lines, shortage: need };
}

async function loadShipMasterData(){
  const [lots, avail, customersRaw, salesOrders, products, warehouses, importReceipts, goodsReceipts, importDocs] = await Promise.all([
    getAll("lot"),
    loadInventoryMovementAvailableMap_().catch(() => ({ map:{}, failed:true })),
    getAll("customer"),
    getAll("sales_order").catch(() => []),
    getAll("product").catch(() => []),
    getAll("warehouse").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  shipLots = lots || [];
  shipAvailableByLotId_ = avail?.map || {};
  shipCustomers = (customersRaw || []).filter(c => c.status === "ACTIVE");
  shipSalesOrders = salesOrders || [];
  shipSalesItems = [];
  shipSalesItemsBySoId_ = {};
  shipSalesItemsLoadingBySoId_ = {};
  shipProducts = products || [];
  shipWarehouses = (warehouses || []).filter(w => String(w.status || "ACTIVE").toUpperCase() === "ACTIVE");

  shipImportReceiptIdToDocId = {};
  (importReceipts || []).forEach(r => {
    if(r && r.import_receipt_id){
      shipImportReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
    }
  });
  shipGoodsReceiptIdToPoId = {};
  (goodsReceipts || []).forEach(r => {
    if(r && r.gr_id){
      shipGoodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
    }
  });
  shipImportDocIdToImportNo = {};
  (importDocs || []).forEach(d => {
    if(d && d.import_doc_id){
      shipImportDocIdToImportNo[d.import_doc_id] = d.import_no || "";
    }
  });

  initShipDropdowns();
}

async function shipLoadSalesItemsBySo_(soId){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return [];
  if(Array.isArray(shipSalesItemsBySoId_?.[id])) return shipSalesItemsBySoId_[id];
  if(shipSalesItemsLoadingBySoId_?.[id]) return await shipSalesItemsLoadingBySoId_[id];

  const p = (async ()=>{
    try{
      const r = await callAPI({ action: "list_sales_order_item_by_so", so_id: id }, { method: "GET" });
      const rows = (r && r.data) ? r.data : [];
      shipSalesItemsBySoId_[id] = Array.isArray(rows) ? rows : [];
      return shipSalesItemsBySoId_[id];
    }catch(_e){
      // fallback：舊版後端未支援時才退回全表
      const all = await getAll("sales_order_item").catch(() => []);
      const rows = (all || []).filter(it => String(it.so_id || "").trim().toUpperCase() === id);
      shipSalesItemsBySoId_[id] = rows;
      return rows;
    }finally{
      try{ delete shipSalesItemsLoadingBySoId_[id]; }catch(_e2){}
    }
  })();
  shipSalesItemsLoadingBySoId_[id] = p;
  return await p;
}

async function shipRefreshSoItemDropdown_(soId){
  const id = String(soId || "").trim().toUpperCase();
  const soiSel = document.getElementById("ship_so_item_id");
  if(!soiSel) return;
  if(!id){
    soiSel.innerHTML = `<option value="">（不指定銷售品項）</option>`;
    try{ shipUpdateAllocModeUI_(); }catch(_e){}
    return;
  }

  const items = await shipLoadSalesItemsBySo_(id);
  shipSalesItems = Array.isArray(items) ? items : [];

  soiSel.innerHTML =
    `<option value="">（不指定銷售品項）</option>` +
    (shipSalesItems || []).map(it => {
      const ordered = Number(it.order_qty || 0);
      const shipped = Number(it.shipped_qty || 0);
      const remain = Math.max(0, ordered - shipped);
      const p = shipFindProduct_(it.product_id);
      const name = String(p?.product_name || it.product_id || "").trim();
      const spec = String(p?.spec || "").trim();
      const prodText = spec ? `${name}（${spec}）` : name;
      return `<option value="${it.so_item_id}" data-product="${it.product_id}" data-unit="${it.unit}" data-remain="${remain}">${it.so_item_id} - ${prodText}（剩餘 ${remain}）</option>`;
    }).join("");
  try{ shipUpdateAllocModeUI_(); }catch(_e2){}
}

function shipWarehouseLabelById_(warehouseId){
  const id = String(warehouseId || "").trim().toUpperCase();
  if(!id) return "";
  const w = (shipWarehouses || []).find(x => String(x.warehouse_id || "").toUpperCase() === id) || null;
  if(!w) return id;
  const name = String(w.warehouse_name || "").trim();
  const cat = String(w.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  const namePart = name || id;
  return catLabel ? `${namePart}-${catLabel}` : namePart;
}

function shipWarehouseLabelByLot_(lot){
  return shipWarehouseLabelById_(lot?.warehouse_id || "");
}

function shipGetAvailable(lotId){
  const id = String(lotId || "");
  if(!id) return 0;
  const hit = shipAvailableByLotId_?.[id];
  if(hit != null) return Number(hit || 0);
  const lot = (shipLots || []).find(l => String(l.lot_id || "") === id) || null;
  return Number(lot?.qty || 0);
}

function formatShipLotOptionLabel_(lot, available){
  const lotId = String(lot?.lot_id || "");
  const productText = formatShipProductDisplay_(lot?.product_id || "") || "";
  const prodPart = productText ? ` ${productText}` : "";
  return `${lotId}${prodPart} 可用:${available}`;
}

function formatShipLotSourceText_(lot){
  const sourceType = String(lot?.source_type || "").toUpperCase();
  const sourceId = String(lot?.source_id || "");
  if(sourceType === "PURCHASE"){
    const poId = shipGoodsReceiptIdToPoId[sourceId] || "";
    return poId ? `採購單:${poId}（收貨:${sourceId}）` : `採購:${sourceId}`;
  }
  if(sourceType === "IMPORT"){
    const docId = shipImportReceiptIdToDocId[sourceId] || "";
    const impNo = docId ? (shipImportDocIdToImportNo[docId] || "") : "";
    if(impNo || docId){
      return `報單:${impNo || "—"}（ID:${docId || "—"} / 收貨:${sourceId}）`;
    }
    return `進口:${sourceId}`;
  }
  if(sourceType === "PROCESS") return `加工:${sourceId}`;
  return sourceType ? `${sourceType}:${sourceId}` : sourceId;
}

/** 有選銷售單／品項時：限制 Lot 產品；未選則 null 表示不限制 */
function shipGetProductWhitelistForPicker_(){
  const soId = String(document.getElementById("ship_so_id")?.value || "").trim();
  const soItemId = String(document.getElementById("ship_so_item_id")?.value || "").trim();
  const soItems = (shipSalesItems || []);
  if(soItemId){
    const soi = soItems.find(x => String(x.so_item_id || "").trim() === soItemId) || null;
    const pid = String(soi?.product_id || "").trim();
    return pid ? new Set([pid]) : null;
  }
  if(soId){
    const pids = new Set();
    soItems.filter(x => String(x.so_id || "").trim() === soId).forEach(x=>{
      const pid = String(x?.product_id || "").trim();
      if(pid) pids.add(pid);
    });
    return pids.size ? pids : null;
  }
  return null;
}

function getShipEligibleLots_(){
  return (shipLots || []).filter(l => shipIsLotEligibleForShip_(l));
}

/** 手動選 Lot：顯示白名單內全部（含不可選與原因）；FEFO：僅可出貨批次 */
function getShipLotsForPicker_(){
  if(shipIsAutoAlloc_()) return getShipEligibleLots_();
  const showInel = !!document.getElementById("ship_show_ineligible_lots")?.checked;
  if(!showInel) return getShipEligibleLots_();
  const productWhitelist = shipGetProductWhitelistForPicker_();
  return (shipLots || []).filter(l => {
    if(productWhitelist && !productWhitelist.has(String(l?.product_id || "").trim())) return false;
    return true;
  });
}

/** 空字串 = 可出貨；否則為不可選原因（給手動模式列示） */
function shipIneligibleReasonForShip_(lot){
  if(!lot) return "無 Lot 資料";
  const whitelist = shipGetProductWhitelistForPicker_();
  const pid = String(lot?.product_id || "").trim();
  if(whitelist && !whitelist.has(pid)) return "非銷售單指定品項";
  if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE"){
    return "庫存非使用中（非 ACTIVE）";
  }
  const qa = String(lot.status || "PENDING").toUpperCase();
  if(qa === "REJECTED") return "QA已退回";
  if(qa !== "APPROVED") return "待QA（須先放行）";
  try{
    if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)) return "已過期";
  }catch(_e){}
  const av = shipGetAvailable(lot.lot_id);
  if(!(Number(av || 0) > 1e-9)) return "可用量為 0";
  return "";
}

function renderShipLotPicker_(lots){
  const tbody = document.getElementById("shipLotPickBody");
  if(!tbody) return;
  const kw = (document.getElementById("ship_lot_picker_keyword")?.value || "").trim().toLowerCase();
  const viewMode = document.getElementById("ship_lot_picker_viewmode")?.value || "flat";
  const source = Array.isArray(lots) ? lots : [];
  const list = source.filter(l => {
    if(!kw) return true;
    const lotId = String(l.lot_id || "").toLowerCase();
    const pname = String(formatShipProductDisplay_(l.product_id || "") || "").toLowerCase();
    const src = String(formatShipLotSourceText_(l) || "").toLowerCase();
    const wh = String(shipWarehouseLabelByLot_(l) || "").toLowerCase();
    return lotId.includes(kw) || pname.includes(kw) || src.includes(kw) || wh.includes(kw);
  });

  // 排序：可出貨在上；同類內依效期 ASC、Lot ID ASC
  function shipSortLotsForPicker_(arr){
    const a = Array.isArray(arr) ? arr.slice() : [];
    a.sort((x, y) => {
      const rx = shipIneligibleReasonForShip_(x);
      const ry = shipIneligibleReasonForShip_(y);
      const okx = !rx;
      const oky = !ry;
      if(okx !== oky) return okx ? -1 : 1;
      const ex = shipExpirySortKey_(x);
      const ey = shipExpirySortKey_(y);
      if(ex !== ey) return ex.localeCompare(ey);
      return String(x?.lot_id || "").localeCompare(String(y?.lot_id || ""));
    });
    return a;
  }
  tbody.innerHTML = "";
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;">目前無符合的 Lot（請調整銷售單／品項或關鍵字）</td></tr>`;
    return;
  }

  function renderLotRow_(l){
    const av = shipGetAvailable(l.lot_id);
    const lotId = String(l.lot_id || "");
    const productText = formatShipProductDisplay_(l.product_id || "");
    const whText = shipWarehouseLabelByLot_(l) || (l.warehouse_id ? String(l.warehouse_id) : "");
    const expiry = String(l.expiry_date || "") || "—";
    const safeId = lotId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const reason = shipIneligibleReasonForShip_(l);
    const ok = !reason;
    const hint = ok ? "可出貨" : reason;
    const rowStyle = ok ? "cursor:pointer;" : "cursor:default;opacity:0.72;background:#f8fafc;";
    const onRow = ok ? `onclick="pickShipLineLot('${safeId}')"` : "";
    const btnDisabled = ok ? "" : " disabled";
    tbody.innerHTML += `
      <tr style="${rowStyle}" ${onRow}>
        <td>${lotId}</td>
        <td>${productText}</td>
        <td>${whText || "—"}</td>
        <td>${av}</td>
        <td>${expiry}</td>
        <td style="font-size:12px;color:${ok ? "#166534" : "#92400e"};max-width:200px;">${hint}</td>
        <td><button type="button" class="btn-secondary"${btnDisabled} ${ok ? `onclick="event.stopPropagation();pickShipLineLot('${safeId}')"` : ""}>帶入</button></td>
      </tr>
    `;
  }
  if(viewMode === "group_source"){
    const groups = {};
    list.forEach(l => {
      const key = formatShipLotSourceText_(l) || "未分類來源";
      if(!groups[key]) groups[key] = [];
      groups[key].push(l);
    });
    Object.keys(groups).sort().forEach(k => {
      tbody.innerHTML += `
        <tr style="background:#f8fafc;">
          <td colspan="7" style="font-weight:600;color:#334155;padding:8px 10px;">來源：${k}（${groups[k].length}）</td>
        </tr>
      `;
      shipSortLotsForPicker_(groups[k]).forEach(renderLotRow_);
    });
  }else{
    shipSortLotsForPicker_(list).forEach(renderLotRow_);
  }
}

function openShipLotPicker(){
  if(shipReadOnlyDraft) return;
  const modal = document.getElementById("shipLotPickerModal");
  if(!modal) return;
  const titleEl = document.getElementById("ship_lot_picker_title");
  const showInel = document.getElementById("ship_show_ineligible_lots");
  if(showInel) showInel.checked = false; // 預設隱藏不可選 Lot
  if(titleEl){
    titleEl.textContent = shipIsAutoAlloc_()
      ? "選擇 Lot（FEFO：僅顯示可出貨批次）"
      : "選擇 Lot（手動：僅顯示可出貨批次）";
  }
  modal.style.display = "flex";
  const kw = document.getElementById("ship_lot_picker_keyword");
  if(kw){
    kw.value = "";
    kw.focus();
  }
  renderShipLotPicker_(getShipLotsForPicker_());
}

function closeShipLotPicker(){
  const modal = document.getElementById("shipLotPickerModal");
  if(modal) modal.style.display = "none";
}

function pickShipLineLot(lotId){
  const lot = (shipLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
  if(!shipIsLotEligibleForShip_(lot)){
    const r = shipIneligibleReasonForShip_(lot) || "不符合出貨條件";
    if(typeof showToast === "function") showToast("無法選擇此 Lot：" + r, "error");
    return;
  }
  const input = document.getElementById("ship_lot_id");
  const display = document.getElementById("ship_lot_display");
  if(!input) return;
  input.value = lotId || "";
  if(display){
    const av = lot ? shipGetAvailable(lot.lot_id) : "";
    const whText = lot ? (shipWarehouseLabelByLot_(lot) || "") : "";
    display.value = lot ? (formatShipLotOptionLabel_(lot, av) + (whText ? ` | ${whText}` : "")) : (lotId || "");
  }
  const uHid = document.getElementById("ship_line_unit");
  if(uHid) uHid.value = lot ? String(lot.unit || "").trim() : "";
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
  onSelectShipLot();
  closeShipLotPicker();
}

function setShipPickLotBtnState_(){
  const btn = document.getElementById("ship_pick_lot_btn");
  if(btn) btn.disabled = !!shipReadOnlyDraft || shipIsAutoAlloc_();
}

function initShipDropdowns(){
  const soSel = document.getElementById("ship_so_id");
  if(soSel){
    const open = shipSalesOrders.filter(so => ["OPEN","PARTIAL"].includes(so.status));
    soSel.innerHTML =
      `<option value="">（不指定銷售單）</option>` +
      open.map(so => `<option value="${so.so_id}">${so.so_id} - ${so.customer_id}</option>`).join("");
  }

  const cSel = document.getElementById("ship_customer_id");
  if(cSel){
    cSel.innerHTML =
      `<option value="">請選擇客戶</option>` +
      shipCustomers.map(c => {
        const name = String(c.customer_name || "").trim();
        const label = name || c.customer_id;
        return `<option value="${c.customer_id}">${label}</option>`;
      }).join("");
  }

  const soiSel = document.getElementById("ship_so_item_id");
  if(soiSel){
    soiSel.innerHTML = `<option value="">（不指定銷售品項）</option>`;
  }
}

function resetShipForm(){
  shipEditing = false;
  shipReadOnlyDraft = false;
  shipDraft = [];
  shipLoadedStatus_ = "OPEN";
  renderShipDraft();

  const idEl = document.getElementById("ship_id");
  if(idEl){
    idEl.value = generateId("SHIP");
    idEl.disabled = false;
  }

  const dateEl = document.getElementById("ship_date");
  if(dateEl) dateEl.value = nowIso16().slice(0, 10);

  const rm = document.getElementById("ship_remark");
  if(rm) rm.value = "";

  const soSel = document.getElementById("ship_so_id");
  if(soSel) soSel.value = "";

  const cSel = document.getElementById("ship_customer_id");
  if(cSel) cSel.value = "";

  onSelectShipSO();
  clearShipItemEntry();
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
  setShipPickLotBtnState_();
  updateShipStatusHint_();
  setShipButtons_();
}

function clearShipItemEntry(){
  shipSelectedLineId_ = "";
  const a = document.getElementById("ship_so_item_id");
  const b = document.getElementById("ship_lot_id");
  const bDisp = document.getElementById("ship_lot_display");
  const d = document.getElementById("ship_qty");
  const f = document.getElementById("ship_item_remark");
  if(a) a.value = "";
  if(b) b.value = "";
  if(bDisp) bDisp.value = "";
  if(d) d.value = "";
  const uHid = document.getElementById("ship_line_unit");
  if(uHid) uHid.value = "";
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
  if(f) f.value = "";
}

function isShipDraftLineRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 明細列表「狀態」欄：對齊銷售／投料（草稿 vs 已過帳） */
function formatShipLineStatus_(it){
  if(isShipDraftLineRow_(it)) return "草稿";
  return "已過帳";
}

function selectShipDraftRow_(draftId){
  if(shipReadOnlyDraft) return;
  const id = String(draftId || "");
  const it = shipDraft.find(x => x.draft_id === id);
  if(!it) return;
  shipSelectedLineId_ = id;
  const soSel = document.getElementById("ship_so_id");
  if(soSel) soSel.value = it.so_id || "";
  onSelectShipSO();
  const soiSel = document.getElementById("ship_so_item_id");
  if(soiSel) soiSel.value = it.so_item_id || "";
  pickShipLineLot(it.lot_id);
  const qEl = document.getElementById("ship_qty");
  if(qEl) qEl.value = String(it.ship_qty ?? "");
  const rm = document.getElementById("ship_item_remark");
  if(rm) rm.value = String(it.remark || "");
  showToast("已帶入明細（僅改備註可用「更新本筆備註」；改數量／Lot 請用「編輯」）");
}

function selectShipSavedRow_(shipmentItemId){
  if(!shipReadOnlyDraft) return;
  const id = String(shipmentItemId || "");
  const it = shipDraft.find(x => x.draft_id === id);
  if(!it) return;
  shipSelectedLineId_ = id;
  const rm = document.getElementById("ship_item_remark");
  if(rm) rm.value = String(it.remark || "");
  showToast("已帶入備註（可修改後按「更新本筆備註」寫回）");
}

function beginEditShipDraft_(draftId){
  if(shipReadOnlyDraft) return;
  const id = String(draftId || "");
  const it = shipDraft.find(x => x.draft_id === id);
  if(!it || !isShipDraftLineRow_(it)) return;
  shipDraft = shipDraft.filter(x => x.draft_id !== id);
  shipSelectedLineId_ = "";
  const soSel = document.getElementById("ship_so_id");
  if(soSel) soSel.value = it.so_id || "";
  onSelectShipSO();
  const soiSel = document.getElementById("ship_so_item_id");
  if(soiSel) soiSel.value = it.so_item_id || "";
  pickShipLineLot(it.lot_id);
  const qEl = document.getElementById("ship_qty");
  if(qEl) qEl.value = String(it.ship_qty ?? "");
  const rm = document.getElementById("ship_item_remark");
  if(rm) rm.value = String(it.remark || "");
  renderShipDraft();
}

async function updateSelectedShipItemRemark(triggerEl){
  const selId = String(shipSelectedLineId_ || "").trim();
  if(!selId) return showToast("請先點選一筆明細列", "error");
  const remark = (document.getElementById("ship_item_remark")?.value || "").trim();

  if(shipReadOnlyDraft){
    showSaveHint(triggerEl || document.getElementById("shipPostButtonGroup"));
    try{
      await updateRecord("shipment_item", "shipment_item_id", selId, {
        remark,
        updated_by: getCurrentUser(),
        updated_at: nowIso16()
      });
      const row = shipDraft.find(x => x.draft_id === selId);
      if(row) row.remark = remark;
      renderShipDraft();
      showToast("出貨明細備註已更新");
    }finally{
      hideSaveHint();
      setShipPickLotBtnState_();
    }
    return;
  }

  if(!isShipDraftLineRow_({ draft_id: selId })){
    return showToast("請點選草稿列（DRAFT-）", "error");
  }
  const row = shipDraft.find(x => x.draft_id === selId);
  if(!row) return showToast("找不到該筆草稿", "error");
  row.remark = remark;
  renderShipDraft();
  showToast("已更新草稿備註");
}

function clearShipLotEntryOnly_(){
  const hid = document.getElementById("ship_lot_id");
  const disp = document.getElementById("ship_lot_display");
  const qty = document.getElementById("ship_qty");
  const rm = document.getElementById("ship_item_remark");
  if(hid) hid.value = "";
  if(disp) disp.value = "";
  if(qty) qty.value = "";
  const uHid = document.getElementById("ship_line_unit");
  if(uHid) uHid.value = "";
  syncErpQtyUnitSuffix_("ship_line_unit", "ship_qty_unit_suffix");
  if(rm) rm.value = "";
}

function onSelectShipSO(){
  const soId = document.getElementById("ship_so_id")?.value || "";
  const cSel = document.getElementById("ship_customer_id");
  const soiSel = document.getElementById("ship_so_item_id");
  if(!soiSel) return;

  if(!soId){
    soiSel.innerHTML = `<option value="">（不指定銷售品項）</option>`;
    return;
  }

  const so = shipSalesOrders.find(x => x.so_id === soId);
  if(so && cSel){
    cSel.value = so.customer_id || "";
  }

  // 銷售品項改為按 SO 載入（非同步更新 dropdown）
  shipRefreshSoItemDropdown_(soId).catch(() => {
    soiSel.innerHTML = `<option value="">（不指定銷售品項）</option>`;
  });
}

function onSelectShipSOItem(){
  const soiSel = document.getElementById("ship_so_item_id");
  const opt = soiSel?.selectedOptions?.[0];
  if(!opt) return;
  // 此處不強制鎖 Lot，因為可能多批次出貨；但可用 remain 當提示
  try{ shipUpdateAllocModeUI_(); }catch(_e){}
}

function onSelectShipLot(){
  const lotId = document.getElementById("ship_lot_id")?.value || "";
  const lot = (shipLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
  if(!lot){
    return;
  }
}

async function addShipItemDraft(){
  if(shipReadOnlyDraft) return showToast("已載入出貨單，明細僅供檢視","error");
  const so_id = document.getElementById("ship_so_id")?.value || "";
  const so_item_id = document.getElementById("ship_so_item_id")?.value || "";
  const lot_id = document.getElementById("ship_lot_id")?.value || "";
  const qty = Number(document.getElementById("ship_qty")?.value || 0);
  const remark = (document.getElementById("ship_item_remark")?.value || "").trim();

  if(!qty || qty <= 0) return showToast("出貨數量需大於 0","error");
  const auto = shipIsAutoAlloc_();
  if(so_id){
    try{
      await shipLoadSalesItemsBySo_(so_id);
      const id = String(so_id || "").trim().toUpperCase();
      if(Array.isArray(shipSalesItemsBySoId_?.[id])) shipSalesItems = shipSalesItemsBySoId_[id];
    }catch(_e){}
  }
  const soi = so_item_id ? (shipSalesItems || []).find(x => x.so_item_id === so_item_id) : null;

  if(auto){
    if(!so_item_id || !soi) return showToast("自動分配需要先選擇 銷售品項", "error");
    const pid = String(soi.product_id || "").trim();
    if(!pid) return showToast("銷售品項缺少 product_id", "error");
    const remain = Math.max(0, Number(soi.order_qty||0) - Number(soi.shipped_qty||0));
    if(qty > remain) return showToast("出貨不可超過銷售單剩餘未出貨量","error");

    const alloc = shipAutoAllocateLots_(pid, qty);
    if(alloc.shortage > 1e-9){
      return showToast(`可用量不足，尚缺 ${Math.round(Number(alloc.shortage||0)*10000)/10000}`, "error");
    }
    if(!alloc.lines.length){
      return showToast("查無可用 Lot（需 ACTIVE + QA放行 + 可用量>0，且未過期）", "error");
    }

    for(const x of alloc.lines){
      const lot = x.lot;
      shipDraft.push({
        draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
        so_id,
        so_item_id,
        lot_id: lot.lot_id,
        product_id: lot.product_id,
        warehouse_id: String(lot.warehouse_id || "").trim().toUpperCase(),
        ship_qty: x.qty,
        unit: lot.unit || "",
        remark
      });
    }
    clearShipItemEntry();
    renderShipDraft();
    showToast(`已自動分配 ${alloc.lines.length} 筆 Lot（FEFO）`);
    return;
  }

  // 手動 override
  if(!lot_id) return showToast("請選擇 Lot","error");
  const lot = shipLots.find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");
  const av = shipGetAvailable(lot_id);
  if(qty > av) return showToast("出貨不可超過可用量","error");
  if(so_id && so_item_id && soi){
    const remain = Math.max(0, Number(soi.order_qty||0) - Number(soi.shipped_qty||0));
    if(qty > remain) return showToast("出貨不可超過銷售單剩餘未出貨量","error");
    if(lot.product_id !== soi.product_id) return showToast("Lot 產品與銷售品項不一致","error");
  }
  shipDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    so_id,
    so_item_id,
    lot_id,
    product_id: lot.product_id,
    warehouse_id: String(lot.warehouse_id || "").trim().toUpperCase(),
    ship_qty: qty,
    unit: lot.unit || "",
    remark
  });

  clearShipItemEntry();
  renderShipDraft();
}

function removeShipDraft(draftId){
  if(shipReadOnlyDraft) return;
  shipDraft = shipDraft.filter(x => x.draft_id !== draftId);
  renderShipDraft();
}

function renderShipDraft(){
  const tbody = document.getElementById("shipItemsBody");
  if(!tbody) return;
  tbody.innerHTML = "";

  shipDraft.forEach((it, idx) => {
    const lot = (shipLots || []).find(l => String(l?.lot_id || "") === String(it?.lot_id || "")) || null;
    const expiry = String(lot?.expiry_date || "") || "—";
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const isDraft = isShipDraftLineRow_(it);
    let rowClick = "";
    let actionBtn = "";
    if(shipReadOnlyDraft){
      rowClick = `onclick="selectShipSavedRow_('${safeId}')"`;
      actionBtn = "—";
    }else if(isDraft){
      rowClick = `onclick="selectShipDraftRow_('${safeId}')"`;
      actionBtn =
        `<button type="button" class="btn-secondary" onclick="event.stopPropagation(); beginEditShipDraft_('${safeId}')">編輯</button> ` +
        `<button type="button" class="btn-secondary" onclick="event.stopPropagation(); removeShipDraft('${safeId}')">刪除</button>`;
    }else{
      actionBtn = `<button type="button" class="btn-secondary" onclick="removeShipDraft('${safeId}')">刪除</button>`;
    }
    const u = String(it.unit || "").trim();
    const shipQtyCell = u ? `${it.ship_qty} ${u.replace(/</g, "")}` : String(it.ship_qty);
    tbody.innerHTML += `
      <tr style="${rowClick ? "cursor:pointer;" : ""}" ${rowClick}>
        <td>${idx+1}</td>
        <td>${it.lot_id}</td>
        <td>${formatShipProductDisplay_(it.product_id)}</td>
        <td>${shipWarehouseLabelById_(it.warehouse_id) || "—"}</td>
        <td>${shipQtyCell}</td>
        <td>${expiry}</td>
        <td>${formatShipLineStatus_(it)}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  });
}

function resetShipmentSearch(){
  const a = document.getElementById("ship_search_keyword");
  const b = document.getElementById("ship_search_status");
  if(a) a.value = "";
  if(b) b.value = "";
  renderShipments();
}

async function renderShipments(){
  const tbody = document.getElementById("shipTableBody");
  if(!tbody) return;

  setTbodyLoading_(tbody, 6);
  const qKw = (document.getElementById("ship_search_keyword")?.value || "").trim().toUpperCase();
  const qSt = (document.getElementById("ship_search_status")?.value || "").trim().toUpperCase();

  let list = [];
  try{
    const r = await callAPI({ action: "list_shipment_recent", days: 180, _ts: String(Date.now()) }, { method: "POST" });
    list = (r && r.data) ? r.data : [];
  }catch(_e){
    list = await getAll("shipment").catch(()=>[]);
  }
  const customerMap = {};
  (shipCustomers || []).forEach(c => { if(c && c.customer_id) customerMap[c.customer_id] = c; });
  const filtered = (list || []).filter(s => {
    const stOk = !qSt || String(s.status||"").toUpperCase() === qSt;
    if(!stOk) return false;
    if(!qKw) return true;
    const sid = String(s.shipment_id||"").toUpperCase();
    const cid = String(s.customer_id||"").toUpperCase();
    const soid = String(s.so_id||"").toUpperCase();
    const cn = String(customerMap[s.customer_id]?.customer_name || "").toUpperCase();
    return sid.includes(qKw) || cid.includes(qKw) || (cn && cn.includes(qKw)) || soid.includes(qKw);
  }).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));

  tbody.innerHTML = "";
  filtered.forEach(s => {
    const c = customerMap[s.customer_id] || null;
    const customerNameOnly = (c && c.customer_name) ? c.customer_name : (s.customer_id || "");
    const canCancel = String(s.status||"").toUpperCase() === "POSTED";
    const cancelBtn = canCancel
      ? `<button class="btn-secondary" onclick="loadShipment('${s.shipment_id}');setTimeout(()=>cancelShipment(),0)">作廢</button>`
      : "";
    tbody.innerHTML += `
      <tr>
        <td>${s.shipment_id || ""}</td>
        <td>${s.so_id || ""}</td>
        <td>${customerNameOnly}</td>
        <td>${termLabel(s.status)}</td>
        <td>${dateInputValue_(s.ship_date)}</td>
        <td>
          <button class="btn-edit" onclick="loadShipment('${s.shipment_id}')">Load</button>
          <button class="btn-secondary" onclick="openLogs('shipment','${s.shipment_id}','shipment')">Log</button>
          ${cancelBtn}
        </td>
      </tr>
    `;
  });
}

async function loadShipment(shipmentId){
  const id = String(shipmentId || "").trim().toUpperCase();
  if(!id) return;
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  await loadShipMasterData();

  const sh = await getOne("shipment","shipment_id",id).catch(()=>null);
  if(!sh) return showToast("找不到出貨單","error");

  let items = [];
  try{
    const r = await callAPI({ action: "list_shipment_item_by_shipment", shipment_id: id });
    items = (r && r.data) ? r.data : [];
  }catch(_e){
    // fallback：舊版後端尚未支援時，退回全表抓取（但只取該出貨單相關資料）
    const itemsAll = await getAll("shipment_item").catch(()=>[]);
    items = (itemsAll || []).filter(x => String(x.shipment_id || "").trim().toUpperCase() === id);
  }

  shipEditing = true;
  shipReadOnlyDraft = true;
  shipLoadedStatus_ = String(sh.status || "OPEN").toUpperCase();

  const idEl = document.getElementById("ship_id");
  if(idEl){
    idEl.value = sh.shipment_id || id;
    idEl.disabled = true;
  }
  document.getElementById("ship_so_id").value = sh.so_id || "";
  onSelectShipSO();
  document.getElementById("ship_customer_id").value = sh.customer_id || "";
  document.getElementById("ship_date").value = dateInputValue_(sh.ship_date);
  document.getElementById("ship_remark").value = sh.remark || "";

  clearShipLotEntryOnly_();
  shipSelectedLineId_ = "";
  shipDraft = items.map(it => ({
    draft_id: it.shipment_item_id,
    so_id: it.so_id || "",
    so_item_id: it.so_item_id || "",
    lot_id: it.lot_id,
    product_id: it.product_id,
    ship_qty: Number(it.ship_qty || 0),
    unit: it.unit || "",
    remark: it.remark || ""
  }));
  renderShipDraft();
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();

  showToast("已載入出貨單：" + id);
  setShipPickLotBtnState_();
  updateShipStatusHint_();
  setShipButtons_();
}

async function cancelShipment(triggerEl){
  const shipment_id = (document.getElementById("ship_id")?.value || "").trim().toUpperCase();
  if(!shipment_id) return showToast("請先載入出貨單","error");

  const sh = await getOne("shipment","shipment_id",shipment_id).catch(()=>null);
  if(!sh) return showToast("找不到出貨單","error");

  const st = String(sh.status || "").toUpperCase();
  if(st === "CANCELLED") return showToast("此出貨單已作廢","error");
  if(st !== "POSTED") return showToast("僅 POSTED 出貨單可作廢","error");

  const ok = confirm("確定要作廢此出貨單？系統將反沖庫存（ADJUST +）並回寫 SO 已出貨量。");
  if(!ok) return;

  showSaveHint(triggerEl || document.getElementById("shipPostButtonGroup"));
  try{
    await callAPI({
      action: "cancel_shipment_bundle",
      shipment_id: shipment_id,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    }, { method: "POST" });

    if(typeof invalidateCache === "function"){
      invalidateCache("shipment");
      invalidateCache("shipment_item");
      invalidateCache("inventory_movement");
      invalidateCache("lot");
      invalidateCache("sales_order_item");
      invalidateCache("sales_order");
    }

    showToast("作廢完成：已反沖庫存並回寫 SO");
    await loadShipMasterData();
    await renderShipments();
    await loadShipment(shipment_id);
  } finally {
    hideSaveHint();
  }
}

async function postShipment(triggerEl){
  const shipment_id = (document.getElementById("ship_id")?.value || "").trim().toUpperCase();
  document.getElementById("ship_id").value = shipment_id;

  const so_id = document.getElementById("ship_so_id")?.value || "";
  const customer_id = document.getElementById("ship_customer_id")?.value || "";
  const ship_date = document.getElementById("ship_date")?.value || "";
  const remark = (document.getElementById("ship_remark")?.value || "").trim();

  if(!shipment_id) return showToast("出貨單ID 必填","error");
  if(!customer_id) return showToast("請選擇客戶","error");
  if(!ship_date) return showToast("出貨日期必填","error");
  if(shipDraft.length === 0) return showToast("請至少新增 1 筆出貨明細","error");

  showSaveHint(triggerEl || document.getElementById("shipPostButtonGroup"));
  try {
  // refresh（避免用舊 lot/可用量 做前置檢查）
  await loadShipMasterData();

  const payloadItems = (shipDraft || []).map((it) => ({
    so_id: it.so_id || so_id || "",
    so_item_id: it.so_item_id || "",
    lot_id: it.lot_id,
    product_id: it.product_id,
    ship_qty: String(it.ship_qty),
    unit: it.unit,
    remark: it.remark || ""
  }));

  await callAPI({
    action: "post_shipment_bundle",
    shipment_id,
    so_id,
    customer_id,
    ship_date,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    items_json: JSON.stringify(payloadItems)
  }, { method: "POST" });

  // bundle 會更新：shipment/shipment_item/inventory_movement/sales_order_item/sales_order/lot.inventory_status
  if(typeof invalidateCache === "function"){
    invalidateCache("shipment");
    invalidateCache("shipment_item");
    invalidateCache("inventory_movement");
    invalidateCache("lot");
    invalidateCache("sales_order_item");
    invalidateCache("sales_order");
  }

  showToast("出貨已過帳（已扣庫）");
  resetShipForm();
  await loadShipMasterData();
  await renderShipments();
  } finally { hideSaveHint(); }
}

