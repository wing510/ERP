/*********************************
 * Movements Module（API 版）
 * - 實際扣庫/入庫都寫入 inventory_movement
 * - 後端會阻擋負庫存，且 OUT 類型只允許 APPROVED lot
 *********************************/

let mvLots = [];
let mvProducts = [];
let mvMovements = [];
/** 與 Lots 相同：後端全量彙總 lot_id -> sum(qty)，供下拉「可用」與扣庫上限（不依賴近 N 天 movements） */
let mvAvailByLotId_ = {};
let mvAvailMapOk_ = false;
let mvUsers = [];
let mvCustomers = [];
let mvWarehouses = [];
/** 與 Lots 相同：IR→報單、GR→PO，方便辨識來源 */
let mvImportReceiptIdToDocId = {};
let mvGoodsReceiptIdToPoId = {};
let mvImportDocIdToImportNo = {};

function escapeMvHtml_(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function escapeMvAttr_(s){
  return String(s ?? "").replace(/\\/g,"\\\\").replace(/"/g,"&quot;");
}

function mvRoleLabel_(role){
  const r = String(role || "").trim().toUpperCase();
  if(r === "ADMIN") return "管理員";
  if(r === "QA") return "品保";
  if(r === "OP") return "作業";
  if(r === "SALES") return "業務";
  return r || "未指定";
}

async function movementsInit(){
  await refreshMovementData();
  await initMovementLotDropdown();
  await mvInitWarehouseDropdown_();
  mvInitIssuedToDropdown_();
  bindAutoSearchToolbar_([
    ["mv_search_keyword", "input"],
    ["mv_filter_movement_type", "change"]
  ], () => renderMovementTable());
  renderMovementTable();
}

function resetMvListSearch(){
  const el = document.getElementById("mv_search_keyword");
  const mt = document.getElementById("mv_filter_movement_type");
  if(el) el.value = "";
  if(mt) mt.value = "";
  renderMovementTable();
}

function mvGetMovementSearchKw_(){
  return (document.getElementById("mv_search_keyword")?.value || "").trim().toLowerCase();
}

function mvMovementRowMatchesKeyword_(m, kw){
  if(!kw) return true;
  const lot = mvFindLot_(m.lot_id);
  const p = lot ? mvFindProduct_(lot.product_id) : mvFindProduct_(m.product_id);
  const pid = String(m.product_id || lot?.product_id || "").toLowerCase();
  const pname = String(p?.product_name || "").toLowerCase();
  const pspec = String(p?.spec || "").toLowerCase();
  const whText = String(mvWarehouseLabelById_(m.warehouse_id) || m.warehouse_id || "").toLowerCase();
  const mtCode = String(m.movement_type || "").toLowerCase();
  const mtLabel = String(typeof termLabel === "function" ? termLabel(m.movement_type) : "").toLowerCase();
  const hay = [
    m.lot_id,
    m.movement_id,
    m.movement_type,
    mtLabel,
    m.ref_type,
    m.ref_id,
    m.issued_to,
    m.remark,
    m.system_remark,
    m.unit,
    m.warehouse_id,
    whText,
    pid,
    pname,
    pspec,
    lot?.source_id,
    lot?.source_type,
    lot?.remark
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(kw);
}

function mvIsTransferMode_(){
  return !!String(document.getElementById("mv_transfer_wh")?.value || "").trim();
}

function mvFillTransferAllQty_(){
  // 轉倉修正用：一鍵帶入目前 Lot 的「全部可用量」
  if(!mvIsTransferMode_()){
    return showToast("請先選擇「轉倉到」才可使用『轉全部』", "error");
  }
  const lotId = String(document.getElementById("mv_lot")?.value || "").trim();
  if(!lotId) return showToast("請先選擇 Lot（可從下方列表點選）", "error");
  const qtyEl = document.getElementById("mv_qty");
  if(!qtyEl) return;
  const av = getMovementAvailableByLotId(lotId);
  qtyEl.value = String(Math.max(0, Number(av || 0)));
}

async function refreshMovementData(){
  const mvTb = document.getElementById("movementTableBody");
  if(mvTb) setTbodyLoading_(mvTb, 7);
  const [
    lots,
    products,
    warehouses,
    importReceipts,
    goodsReceipts,
    importDocs,
    users,
    customers,
    availPack,
    movements
  ] = await Promise.all([
    getAll("lot"),
    getAll("product").catch(() => []),
    getAll("warehouse").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => []),
    getAll("user").catch(() => []),
    getAll("customer").catch(() => []),
    typeof loadInventoryMovementAvailableMap_ === "function"
      ? loadInventoryMovementAvailableMap_().catch(() => ({ map: {}, failed: true }))
      : Promise.resolve({ map: {}, failed: true }),
    (async ()=>{
      // Movements 清單：優先只取近 N 天，避免 inventory_movement 全表下載造成卡頓
      try{
        const r = await callAPI({ action: "list_inventory_movement_recent", days: 90, _ts: String(Date.now()) }, { method: "POST" });
        const rows = typeof erpParseArrayDataResponse_ === "function" ? erpParseArrayDataResponse_(r) : [];
        if(Array.isArray(rows) && rows.length) return rows;
        return [];
      }catch(_e){
        return await getAll("inventory_movement").catch(() => []);
      }
    })()
  ]);
  mvLots = lots || [];
  mvProducts = products || [];
  mvWarehouses = (warehouses || []).filter(w => String(w.status || "ACTIVE").toUpperCase() === "ACTIVE");
  mvUsers = users || [];
  mvCustomers = customers || [];

  mvImportReceiptIdToDocId = {};
  (importReceipts || []).forEach(r => {
    if(r && r.import_receipt_id){
      mvImportReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
    }
  });
  mvGoodsReceiptIdToPoId = {};
  (goodsReceipts || []).forEach(r => {
    if(r && r.gr_id){
      mvGoodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
    }
  });
  mvImportDocIdToImportNo = {};
  (importDocs || []).forEach(d => {
    if(d && d.import_doc_id){
      mvImportDocIdToImportNo[d.import_doc_id] = d.import_no || "";
    }
  });

  mvAvailByLotId_ = (availPack && availPack.map) || {};
  mvAvailMapOk_ = !!(availPack && !availPack.failed);

  // Movements 列表：預設近 90 天清單（後端支援）；若 fallback 則可能是全量
  mvMovements = Array.isArray(movements) ? movements : [];
}

function mvMergeMovements_(rows){
  const add = Array.isArray(rows) ? rows : [];
  if(!add.length) return;
  mvMovements = Array.isArray(mvMovements) ? mvMovements : [];
  const seen = new Set(mvMovements.map(r => String(r?.movement_id || "")));
  add.forEach(r=>{
    const id = String(r?.movement_id || "");
    if(!id || seen.has(id)) return;
    mvMovements.unshift(r);
    seen.add(id);
  });
}

function mvWarehouseLabelById_(warehouseId){
  const id = String(warehouseId || "").trim().toUpperCase();
  if(!id) return "";
  const w = (mvWarehouses || []).find(x => String(x.warehouse_id || "").toUpperCase() === id) || null;
  if(!w) return id;
  const name = String(w.warehouse_name || "").trim();
  const cat = String(w.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  const namePart = name || id;
  return catLabel ? `${namePart}-${catLabel}` : namePart;
}

async function mvInitWarehouseDropdown_(){
  const sel = document.getElementById("mv_transfer_wh");
  if(!sel) return;
  const list = (mvWarehouses || []).slice();
  list.sort((a,b)=>String(a.warehouse_id||"").localeCompare(String(b.warehouse_id||"")));
  sel.innerHTML =
    `<option value="">（不轉倉）</option>` +
    list.map(w=>{
      const id = String(w.warehouse_id || "").trim().toUpperCase();
      const label = mvWarehouseLabelById_(id) || id;
      return `<option value="${escapeMvAttr_(id)}">${escapeMvHtml_(label)}</option>`;
    }).join("");
  sel.onchange = function(){ mvUpdateActionMode_(); };
  mvUpdateActionMode_();
}

function mvInitIssuedToDropdown_(){
  const sel = document.getElementById("mv_issued_to");
  if(!sel) return;
  const users = (mvUsers || []).filter(u => String(u.status || "").toUpperCase() === "ACTIVE");
  const customers = (mvCustomers || []).filter(c => String(c.status || "").toUpperCase() === "ACTIVE");
  users.sort((a,b)=>String(a.user_name||"").localeCompare(String(b.user_name||"")));
  customers.sort((a,b)=>String(a.customer_name||"").localeCompare(String(b.customer_name||"")));

  const userOpts = users.map(u => {
    const name = String(u.user_name || "").trim();
    const role = mvRoleLabel_(u.role);
    const label = name ? `${role}-${name}` : `U:${u.user_id}`;
    return `<option value="U:${u.user_id}">${escapeMvHtml_(label)}</option>`;
  }).join("");
  const custOpts = customers.map(c => {
    const name = String(c.customer_name || "").trim();
    const label = name || c.customer_id;
    return `<option value="C:${c.customer_id}">${escapeMvHtml_(label)}</option>`;
  }).join("");

  sel.innerHTML =
    `<option value="">（未指定）</option>` +
    (userOpts ? `<optgroup label="內部（Users）">${userOpts}</optgroup>` : "") +
    (custOpts ? `<optgroup label="對外（Customers）">${custOpts}</optgroup>` : "");
}

function mvFindLot_(lotId){
  const id = String(lotId || "").trim();
  if(!id) return null;
  return (mvLots || []).find(l => String(l.lot_id || "").trim() === id) || null;
}

function mvFindProduct_(productId){
  const id = String(productId || "").trim();
  if(!id) return null;
  return (mvProducts || []).find(p => String(p.product_id || "").trim() === id) || null;
}

function mvQaText_(qa){
  const s = String(qa || "PENDING").toUpperCase();
  if(s === "APPROVED") return "QA已放行";
  if(s === "REJECTED") return "QA已退回";
  return "待QA";
}

function mvFormatLotOptionText_(lot, available){
  const lotId = String(lot?.lot_id || "");
  const p = mvFindProduct_(lot?.product_id || "");
  const pname = p ? (p.product_name || lot?.product_id || "") : (lot?.product_id || "");
  const spec = p && String(p.spec || "").trim() ? String(p.spec).trim() : "";
  const prodText = spec ? `${pname}（${spec}）` : pname;
  const whText = mvWarehouseLabelById_(lot?.warehouse_id || "") || (lot?.warehouse_id || "");
  const qaText = mvQaText_(lot?.status || "PENDING");
  const avText = `可用：${Math.round(Number(available || 0) * 10000) / 10000}`;
  return [lotId, prodText, whText, qaText, avText].filter(Boolean).join("│");
}

/** 顯示「產品名稱（規格）」；無主檔時退回 product_id */
function mvFormatProductSpec_(lot, movement){
  const pid = (lot && lot.product_id) || (movement && movement.product_id) || "";
  if(!pid) return "—";
  const p = mvFindProduct_(pid);
  const name = p ? (p.product_name || pid) : pid;
  const spec = p && String(p.spec || "").trim() ? String(p.spec).trim() : "";
  if(spec) return `${name}（${spec}）`;
  return name;
}

/** 列表列排序：先時間（新→舊），再 Lot ID，最後 movement_id（避免不同 Lot 交錯造成視覺混亂） */
function mvCompareMovementRows_(a, b){
  const tb = (b.m.created_at || "");
  const ta = (a.m.created_at || "");
  if(tb !== ta) return tb.localeCompare(ta);
  const la = a.m.lot_id || "";
  const lb = b.m.lot_id || "";
  if(la !== lb) return la.localeCompare(lb);
  return (b.m.movement_id || "").localeCompare(a.m.movement_id || "");
}

function mvGetLotImportDocId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "IMPORT") return "";
  return mvImportReceiptIdToDocId[lot.source_id || ""] || "";
}

function mvGetLotPoId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "PURCHASE") return "";
  return mvGoodsReceiptIdToPoId[lot.source_id || ""] || "";
}

/** 與 Lots 相同：依報單ID／採購單分組 */
function mvGetLotBusinessGroupKey_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  if(st === "IMPORT"){
    const doc = mvGetLotImportDocId_(lot);
    return doc ? `IMP_DOC:${doc}` : `IR:${lot.source_id || ""}`;
  }
  if(st === "PURCHASE"){
    const po = mvGetLotPoId_(lot);
    return po ? `PO:${po}` : `GR:${lot.source_id || ""}`;
  }
  return `${st}:${lot.source_id || ""}`;
}

function mvSourceTypeLabel_(sourceType){
  const t = String(sourceType || "").toUpperCase();
  if(t === "PURCHASE") return "採購入庫";
  if(t === "IMPORT") return "進口收貨";
  if(t === "PROCESS") return "加工產出";
  return t || "未知來源";
}

/** 與 Lots 批次管理群組標題同一套文案 */
function formatMvGroupHeaderFromLot_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  const sid = lot.source_id || "";
  if(st === "IMPORT"){
    const docId = mvGetLotImportDocId_(lot);
    const impNo = docId ? (mvImportDocIdToImportNo[docId] || "") : "";
    if(docId){
      const noPart = impNo ? impNo : "—";
      return `進口報單：報單號 ${noPart}｜報單ID ${docId}`;
    }
    return `進口：收貨單 ${sid}（尚未對應到報單，請檢查 import_receipt）`;
  }
  if(st === "PURCHASE"){
    const po = mvGetLotPoId_(lot);
    if(po) return `採購單：${po}`;
    return `採購：收貨單 ${sid}（尚未對應到 PO，請檢查 goods_receipt）`;
  }
  return `${mvSourceTypeLabel_(lot.source_type)}：${sid}`;
}

function mvGroupKeyForMovement_(m){
  const lot = mvFindLot_(m.lot_id);
  if(!lot) return `__NO_LOT__:${m.lot_id || ""}`;
  return mvGetLotBusinessGroupKey_(lot);
}

function getMovementAvailableByLotId(lotId){
  const lid = typeof invNormalizeId_ === "function" ? invNormalizeId_(lotId) : String(lotId || "").trim().toUpperCase();
  if(!lid) return 0;
  if(mvAvailMapOk_ && mvAvailByLotId_ && Object.prototype.hasOwnProperty.call(mvAvailByLotId_, lid)){
    return Number(mvAvailByLotId_[lid] || 0);
  }
  const rawKey = String(lotId || "").trim();
  if(mvAvailMapOk_ && rawKey && mvAvailByLotId_ && Object.prototype.hasOwnProperty.call(mvAvailByLotId_, rawKey)){
    return Number(mvAvailByLotId_[rawKey] || 0);
  }
  return invAvailableByLotId_(lotId, mvLots, mvMovements);
}

/** 僅 APPROVED + 庫存 ACTIVE 可手動扣庫（與下拉預設清單一致） */
function mvCanManualOut_(lot){
  if(!lot) return false;
  if((lot.status || "PENDING") !== "APPROVED") return false;
  if((lot.inventory_status || "ACTIVE") !== "ACTIVE") return false;
  // 過期 Lot 不可手動扣庫
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)) return false;
  return true;
}

/** 依目前選擇的 Lot：啟用／停用扣庫數量 */
function mvUpdateMvQtyState_(){
  const sel = document.getElementById("mv_lot");
  const qtyEl = document.getElementById("mv_qty");
  if(!qtyEl) return;
  const lotId = sel?.value || "";
  if(!lotId){
    qtyEl.disabled = false;
    mvUpdateActionMode_();
    return;
  }
  const lot = mvFindLot_(lotId);
  const isTransfer = mvIsTransferMode_();
  let ok = false;
  if(isTransfer){
    if(lot){
      const invOk = String(lot.inventory_status || "ACTIVE").toUpperCase() === "ACTIVE";
      const st = String(lot.status || "PENDING").toUpperCase();
      ok = invOk && st !== "REJECTED";
    }
  }else{
    ok = mvCanManualOut_(lot);
  }
  qtyEl.disabled = !ok;
  if(!ok) qtyEl.value = "";
  mvUpdateActionMode_();
}

function mvUpdateActionMode_(){
  const toWh = String(document.getElementById("mv_transfer_wh")?.value || "").trim();
  const createBtn = document.getElementById("mv_create_btn");
  const transferBtn = document.getElementById("mv_transfer_btn");
  const purposeEl = document.getElementById("mv_purpose");
  const issuedToEl = document.getElementById("mv_issued_to");
  const transferAllBtn = document.getElementById("mv_transfer_all_btn");
  const lotId = String(document.getElementById("mv_lot")?.value || "").trim();
  const qty = Number(document.getElementById("mv_qty")?.value || 0);

  const isTransfer = !!toWh;
  if(createBtn){
    createBtn.disabled = isTransfer;
    createBtn.title = isTransfer
      ? "目前為轉倉模式，請用「轉倉」"
      : (!lotId ? "請先選擇 Lot" : (!(qty > 0) ? "請先輸入數量（>0）" : "確認扣庫"));
  }
  if(transferBtn){
    transferBtn.disabled = !isTransfer;
    transferBtn.title = !isTransfer
      ? "目前為手動扣庫模式，請用「確認扣庫」"
      : (!lotId ? "請先選擇 Lot" : (!(qty > 0) ? "請先輸入數量（>0）" : "轉倉"));
  }
  if(purposeEl) purposeEl.disabled = isTransfer;
  if(issuedToEl) issuedToEl.disabled = isTransfer;
  if(transferAllBtn){
    transferAllBtn.disabled = !isTransfer || !lotId;
    transferAllBtn.title = !isTransfer ? "僅轉倉模式可用" : (!lotId ? "請先選擇 Lot" : "一鍵帶入全部可用量");
  }
  // 模式切換時，Lot 下拉也要跟著切換（扣庫 vs 轉倉）
  initMovementLotDropdown().catch(()=>{});
  // 同時重畫列表（游標/禁止狀態會依模式改變）
  try{ renderMovementTable(); }catch(_e){}
}

/** 點列表列：帶入上方「選擇 Lot」（已退回等不可扣庫者不帶入） */
function mvSelectLotFromRow(el){
  const lotId = el && el.getAttribute ? el.getAttribute("data-mv-lot-id") : "";
  if(!lotId) return;
  const lot = mvFindLot_(lotId);
  if(!lot){
    if(typeof showToast === "function") showToast("找不到 Lot 主檔", "error");
    return;
  }
  const isTransfer = mvIsTransferMode_();
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)){
    if(typeof showToast === "function") showToast("此批次已過期（VOID），不可操作。", "error");
    return;
  }
  if(isTransfer){
    if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE"){
      if(typeof showToast === "function") showToast("僅庫存狀態為 ACTIVE 的批次可轉倉。", "error");
      return;
    }
    if((lot.status || "PENDING") === "REJECTED"){
      if(typeof showToast === "function") showToast("此批次已退回（REJECTED），不建議轉倉；請改用報廢或其他處置。", "error");
      return;
    }
  }else{
    if((lot.status || "PENDING") === "REJECTED"){
      if(typeof showToast === "function"){
        showToast("此批次已退回（REJECTED），不可手動扣庫。", "error");
      }
      return;
    }
    if(!mvCanManualOut_(lot)){
      if(typeof showToast === "function"){
        showToast("僅 QA已放行 且庫存為使用中（ACTIVE）的批次可手動扣庫。", "error");
      }
      return;
    }
  }

  const sel = document.getElementById("mv_lot");
  if(!sel) return;
  let found = false;
  for(let i = 0; i < sel.options.length; i++){
    if(sel.options[i].value === lotId){ found = true; break; }
  }
  if(!found){
    const opt = document.createElement("option");
    opt.value = lotId;
    const av = getMovementAvailableByLotId(lotId);
    opt.textContent = mvFormatLotOptionText_(lot, av) + "（由下方列表點選）";
    sel.appendChild(opt);
  }
  sel.value = lotId;
  mvUpdateMvQtyState_();
  if(typeof showToast === "function"){
    showToast("已帶入 Lot：" + lotId);
  }
  try{
    sel.focus();
    sel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }catch(_e){}
}

async function initMovementLotDropdown(){
  const sel = document.getElementById("mv_lot");
  if(!sel) return;
  const prevSelected = String(sel.value || "").trim();

  const isTransfer = mvIsTransferMode_();
  // 扣庫模式：只顯示 ACTIVE + APPROVED
  // 轉倉模式：顯示 ACTIVE + (PENDING/APPROVED)，仍排除 REJECTED
  const lots = (mvLots || []).filter(l => {
    if(String(l.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
    if(typeof invIsExpired_ === "function" && invIsExpired_(l.expiry_date)) return false;
    const st = String(l.status || "PENDING").toUpperCase();
    if(isTransfer) return st !== "REJECTED";
    return st === "APPROVED";
  });

  sel.innerHTML =
    `<option value="">請選擇 Lot</option>` +
    lots.map(l => {
      const available = getMovementAvailableByLotId(l.lot_id);
      const text = mvFormatLotOptionText_(l, available);
      return `<option value="${l.lot_id}">${escapeMvHtml_(text)}</option>`;
    }).join("");

  // 保留先前已選的 Lot（避免模式切換/重畫下拉時跳回「請選擇 Lot」）
  if(prevSelected){
    let found = false;
    for(let i = 0; i < sel.options.length; i++){
      if(String(sel.options[i].value || "").trim() === prevSelected){ found = true; break; }
    }
    if(!found){
      const lot = mvFindLot_(prevSelected);
      const opt = document.createElement("option");
      opt.value = prevSelected;
      const av = lot ? getMovementAvailableByLotId(prevSelected) : 0;
      opt.textContent = (lot ? mvFormatLotOptionText_(lot, av) : prevSelected) + "（由下方列表點選）";
      sel.appendChild(opt);
    }
    sel.value = prevSelected;
  }
  sel.onchange = function(){ mvUpdateMvQtyState_(); };
  mvUpdateMvQtyState_();
}

async function createMovement(triggerEl){
  const lot_id = document.getElementById("mv_lot")?.value || "";
  const qty = Number(document.getElementById("mv_qty")?.value || 0);
  const purpose = (document.getElementById("mv_purpose")?.value || "INTERNAL_USE").trim().toUpperCase();
  const userRemark = (document.getElementById("mv_remark")?.value || "").trim();
  const issuedTo = (document.getElementById("mv_issued_to")?.value || "").trim();

  if(!lot_id) return showToast("請選擇 Lot","error");
  if(!qty || qty <= 0) return showToast("數量需大於 0","error");

  const lot = (mvLots || []).find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  // 僅允許 QA APPROVED 的批次做 Manual OUT
  if((lot.status || "PENDING") !== "APPROVED"){
    return showToast("僅 APPROVED 批次可手動扣庫", "error");
  }
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)){
    return showToast("此批次已過期（VOID），不可手動扣庫。", "error");
  }

  const available = getMovementAvailableByLotId(lot_id);
  if(qty > available){
    return showToast("扣庫數量不可超過可用量", "error");
  }

  showSaveHint(triggerEl);
  try {
  // 這個頁面先提供最常用的「扣庫」：OUT（存負數）
  const purposeLabel = (typeof termLabel === "function" ? termLabel(purpose) : "") || purpose;
  const systemRemark = purposeLabel ? `Manual OUT: ${purposeLabel}` : "Manual OUT";
  const movement = {
    movement_id: generateId("MV"),
    movement_type: "OUT",
    lot_id,
    product_id: lot.product_id,
    warehouse_id: String(lot.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
    qty: String(-Math.abs(qty)),
    unit: lot.unit || "",
    ref_type: purpose || "MANUAL",
    ref_id: "",
    issued_to: issuedTo,
    remark: userRemark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
    system_remark: systemRemark,
  };

  await createRecord("inventory_movement", movement);
  try{ localStorage.setItem("erp_inventory_dirty_at", String(Date.now())); }catch(_e){}

  await refreshMovementData();
  await initMovementLotDropdown();
  mvInitIssuedToDropdown_();
  renderMovementTable();
  showToast("異動已建立");
  const qtyEl = document.getElementById("mv_qty");
  if(qtyEl) qtyEl.value = "";
  const rmEl = document.getElementById("mv_remark");
  if(rmEl) rmEl.value = "";
  const itEl = document.getElementById("mv_issued_to");
  if(itEl) itEl.value = "";
  } finally { hideSaveHint(); }
}

async function transferMovement(triggerEl){
  const lot_id = document.getElementById("mv_lot")?.value || "";
  const qty = Number(document.getElementById("mv_qty")?.value || 0);
  const toWh = String(document.getElementById("mv_transfer_wh")?.value || "").trim().toUpperCase();
  const userRemark = (document.getElementById("mv_remark")?.value || "").trim();

  if(!lot_id) return showToast("請選擇 Lot","error");
  if(!qty || qty <= 0) return showToast("數量需大於 0","error");
  if(!toWh) return showToast("請選擇 轉倉到 哪個倉別","error");

  const lot = (mvLots || []).find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE"){
    return showToast("僅庫存狀態為 ACTIVE 的批次可轉倉", "error");
  }
  if(typeof invIsExpired_ === "function" && invIsExpired_(lot.expiry_date)){
    return showToast("此批次已過期（VOID），不可轉倉。", "error");
  }

  const fromWh = String(lot.warehouse_id || "").trim().toUpperCase();
  if(fromWh && fromWh === toWh){
    return showToast("目標倉別不可與目前倉別相同", "error");
  }

  const available = getMovementAvailableByLotId(lot_id);
  if(qty > available){
    return showToast("轉倉數量不可超過可用量", "error");
  }
  // QA gate（你確認的新規則）：
  // - 待QA：僅允許「全部轉」（qty == available）
  // - 部分轉：必須 QA 放行（APPROVED）
  const qa = String(lot.status || "PENDING").toUpperCase();
  if(qa !== "APPROVED"){
    const isAll = Math.abs(Number(qty || 0) - Number(available || 0)) <= 1e-9;
    if(!isAll){
      return showToast("部分轉倉需先 QA 放行（APPROVED）。待QA僅允許全部轉倉。", "error");
    }
  }

  const newLotId = generateId("LOT");
  const now = nowIso16();
  const today = String(now || "").slice(0, 10);
  const fromWhLabel = mvWarehouseLabelById_(fromWh) || (fromWh || "—");
  const toWhLabel = mvWarehouseLabelById_(toWh) || toWh;

  showSaveHint(triggerEl);
  try{
    // 轉倉後仍歸屬原來源（採購/進口/加工等），避免在 Lots/Movements 分組中「脫離原單」
    const srcType = String(lot.source_type || "").trim().toUpperCase();
    const srcId = String(lot.source_id || "").trim();

    await createRecord("lot", {
      lot_id: newLotId,
      product_id: lot.product_id || "",
      warehouse_id: toWh,
      source_type: srcType || lot.source_type || "",
      source_id: srcId || lot.source_id || "",
      qty: String(qty),
      unit: lot.unit || "",
      type: lot.type || "",
      status: lot.status || "PENDING",
      inventory_status: "ACTIVE",
      received_date: lot.received_date || today,
      manufacture_date: lot.manufacture_date || "",
      expiry_date: lot.expiry_date || "",
      remark: "",
      created_by: getCurrentUser(),
      created_at: now,
      updated_by: "",
      updated_at: "",
      system_remark: `轉倉自 ${lot_id}（${fromWhLabel} → ${toWhLabel}）`
    });

    const outMovement = {
      movement_id: generateId("MV"),
      movement_type: "OUT",
      lot_id: lot_id,
      product_id: lot.product_id,
      warehouse_id: fromWh || "",
      qty: String(-Math.abs(qty)),
      unit: lot.unit || "",
      ref_type: "TRANSFER",
      ref_id: newLotId,
      issued_to: "",
      remark: userRemark,
      created_by: getCurrentUser(),
      created_at: now,
      updated_by: "",
      updated_at: "",
      system_remark: `轉倉 OUT：${lot_id} → ${newLotId}（${fromWhLabel} → ${toWhLabel}）`
    };
    await createRecord("inventory_movement", outMovement);

    const inMovement = {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id: newLotId,
      product_id: lot.product_id,
      warehouse_id: toWh,
      qty: String(Math.abs(qty)),
      unit: lot.unit || "",
      ref_type: "TRANSFER",
      ref_id: lot_id,
      issued_to: "",
      remark: "",
      created_by: getCurrentUser(),
      created_at: now,
      updated_by: "",
      updated_at: "",
      system_remark: `轉倉 IN：${newLotId} ← ${lot_id}（${fromWhLabel} → ${toWhLabel}）`
    };
    await createRecord("inventory_movement", inMovement);

    // 轉倉後：強制讓其他頁面下次刷新時拿到最新可用量（避免快取造成兩邊都像有量）
    try{
      if(typeof invalidateCache === "function"){
        invalidateCache("inventory_movement");
        invalidateCache("lot");
      }
      try{
        localStorage.setItem("erp_inventory_dirty_at", String(Date.now()));
      }catch(_e){}
    }catch(_e){}

    // 立即反映在畫面（先合併到記憶體，避免後端 recent/快取延遲）
    mvMergeMovements_([outMovement, inMovement]);
    renderMovementTable();

    await refreshMovementData();
    // refresh 可能回傳不含最新列（recent 篩選/延遲），再合併一次確保看得到
    mvMergeMovements_([outMovement, inMovement]);
    await initMovementLotDropdown();
    await mvInitWarehouseDropdown_();
    mvInitIssuedToDropdown_();
    renderMovementTable();

    const qtyEl = document.getElementById("mv_qty");
    if(qtyEl) qtyEl.value = "";
    const rmEl = document.getElementById("mv_remark");
    if(rmEl) rmEl.value = "";
    const whEl = document.getElementById("mv_transfer_wh");
    if(whEl) whEl.value = "";
    const allBtn = document.getElementById("mv_transfer_all_btn");
    if(allBtn){
      allBtn.disabled = true;
      allBtn.title = "請先選擇 Lot（轉倉模式）";
    }
    showToast(`已轉倉並產生新 Lot：${newLotId}`);
  }finally{
    hideSaveHint();
  }
}

function renderMovementTable(){
  const tbody = document.getElementById("movementTableBody");
  if(!tbody) return;

  tbody.innerHTML = "";

  const kw = mvGetMovementSearchKw_();
  const qMt = (document.getElementById("mv_filter_movement_type")?.value || "").trim().toUpperCase();
  const raw = [...(mvMovements || [])];
  const rawFiltered = raw.filter(m => {
    if(qMt && String(m.movement_type || "").toUpperCase() !== qMt) return false;
    return mvMovementRowMatchesKeyword_(m, kw);
  });

  if(!rawFiltered.length){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">${
      kw || qMt ? "沒有符合條件的異動紀錄。" : "尚無庫存異動紀錄。"
    }</td></tr>`;
    return;
  }

  const enriched = rawFiltered.map(m => {
    const lot = mvFindLot_(m.lot_id);
    const key = mvGroupKeyForMovement_(m);
    return { m, lot, key };
  });

  const countByKey = {};
  enriched.forEach(x => {
    countByKey[x.key] = (countByKey[x.key] || 0) + 1;
  });

  // 分組排序：依該分組「最新異動時間」新→舊（避免不同分組穿插造成視覺混亂）
  const latestAtByKey = {};
  enriched.forEach(x => {
    const k = x.key;
    const t = String(x.m?.created_at || "");
    if(!t) return;
    const prev = String(latestAtByKey[k] || "");
    if(!prev || t > prev) latestAtByKey[k] = t;
  });
  const groupKeys = [...new Set(enriched.map(x => x.key))].sort((a, b) => {
    const ta = String(latestAtByKey[a] || "");
    const tb = String(latestAtByKey[b] || "");
    if(ta !== tb) return tb.localeCompare(ta); // 新→舊
    return a.localeCompare(b);
  });

  function renderDataRow(m, lot){
    const productSpec = mvFormatProductSpec_(lot, m);
    const refHint = [m.ref_type, m.ref_id, m.issued_to].filter(Boolean).join(" ");
    const isTransfer = mvIsTransferMode_();
    const canClick = (function(){
      if(!lot) return false;
      if(isTransfer){
        if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
        const st = String(lot.status || "PENDING").toUpperCase();
        return st !== "REJECTED";
      }
      return mvCanManualOut_(lot);
    })();
    const titleLot = (function(){
      const base = `${m.lot_id || ""}${refHint ? "｜參考：" + refHint : ""}`;
      if(canClick) return escapeMvAttr_(`${base}｜點列可帶入 Lot`);
      if(isTransfer){
        if(!lot) return escapeMvAttr_(`${base}｜找不到 Lot 主檔`);
        if(String(lot.inventory_status || "ACTIVE").toUpperCase() !== "ACTIVE") return escapeMvAttr_(`${base}｜不可轉倉（須為庫存 ACTIVE）`);
        if(String(lot.status || "PENDING").toUpperCase() === "REJECTED") return escapeMvAttr_(`${base}｜不可轉倉（已退回 REJECTED）`);
        return escapeMvAttr_(`${base}｜不可轉倉`);
      }
      return escapeMvAttr_(
        `${base}｜不可手動扣庫` +
        (lot && String(lot.status || "").toUpperCase() === "REJECTED" ? "（已退回 REJECTED）" : "（須為 APPROVED 且庫存 ACTIVE）")
      );
    })();
    const rowCursor = canClick ? "pointer" : "not-allowed";
    const rowOp = canClick ? "1" : "0.75";
    const lotIdRaw = m.lot_id || "";
    const lidAttr = escapeMvAttr_(lotIdRaw);
    const lidCell = escapeMvHtml_(lotIdRaw);
    const clickAttr = canClick ? `onclick="mvSelectLotFromRow(this)"` : "";
    const whText = mvWarehouseLabelById_(m.warehouse_id) || (m.warehouse_id ? String(m.warehouse_id) : "");
    tbody.innerHTML += `
      <tr data-mv-lot-id="${lidAttr}" ${clickAttr} style="border-bottom:1px solid #eee;cursor:${rowCursor};opacity:${rowOp};" title="${titleLot}">
        <td>${lidCell}</td>
        <td>${escapeMvHtml_(productSpec)}</td>
        <td>${escapeMvHtml_(whText || "—")}</td>
        <td>${termLabel(m.movement_type)}</td>
        <td>${escapeMvHtml_(String(m.qty ?? ""))}</td>
        <td>${escapeMvHtml_(m.unit || "")}</td>
        <td>${escapeMvHtml_(m.created_at || "")}</td>
      </tr>
    `;
  }

  groupKeys.forEach(key => {
    const bucket = enriched.filter(x => x.key === key);
    bucket.sort(mvCompareMovementRows_);

    const cnt = countByKey[key] || 0;
    const first = bucket[0];
    let headerL1;
    if(key.startsWith("__NO_LOT__:")){
      headerL1 = `無 Lot 主檔：${escapeMvHtml_(first.m.lot_id || "—")}`;
    }else{
      headerL1 = escapeMvHtml_(formatMvGroupHeaderFromLot_(first.lot));
    }
    tbody.innerHTML += `
      <tr style="background:#f8fafc;">
        <td colspan="7" style="font-weight:600;color:#334155;padding:10px 12px;">
          ${headerL1}（共 ${cnt} 筆異動）
        </td>
      </tr>
    `;

    if(key.startsWith("__NO_LOT__:")){
      bucket.forEach(({ m, lot }) => renderDataRow(m, lot));
      return;
    }

    const byReceipt = {};
    bucket.forEach(x => {
      const rid = x.lot && x.lot.source_id ? String(x.lot.source_id) : "__EMPTY__";
      if(!byReceipt[rid]) byReceipt[rid] = [];
      byReceipt[rid].push(x);
    });
    const rkeys = Object.keys(byReceipt).sort((a, b) => {
      if(a === "__EMPTY__") return 1;
      if(b === "__EMPTY__") return -1;
      return a.localeCompare(b);
    });

    rkeys.forEach(rk => {
      const sub = byReceipt[rk];
      const subCnt = sub.length;
      const label = rk === "__EMPTY__" ? "—" : rk;
      tbody.innerHTML += `
        <tr style="background:#f1f5f9;">
          <td colspan="7" style="font-weight:600;color:#475569;padding:8px 12px;font-size:13px;">
            收貨單ID：${escapeMvHtml_(label)}（共 ${subCnt} 筆）
          </td>
        </tr>
      `;
      sub.forEach(({ m, lot }) => renderDataRow(m, lot));
    });
  });
}