/*********************************
 * Movements Module（API 版）
 * - 實際扣庫/入庫都寫入 inventory_movement
 * - 後端會阻擋負庫存，且 OUT 類型只允許 APPROVED lot
 *********************************/

let mvLots = [];
let mvProducts = [];
let mvMovements = [];
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

async function movementsInit(){
  await refreshMovementData();
  await initMovementLotDropdown();
  renderMovementTable();
}

async function refreshMovementData(){
  const [lots, products, importReceipts, goodsReceipts, importDocs] = await Promise.all([
    getAll("lot"),
    getAll("product").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  mvLots = lots || [];
  mvProducts = products || [];

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

  try{
    const movements = await getAll("inventory_movement");
    mvMovements = movements || [];
  }catch(_e){
    if(typeof showToast === "function"){
      showToast("讀取庫存異動失敗，暫沿用上次資料。", "error");
    }
    if(!Array.isArray(mvMovements)) mvMovements = [];
  }
}

function mvFindLot_(lotId){
  return (mvLots || []).find(l => (l.lot_id || "") === lotId) || null;
}

function mvFindProduct_(productId){
  return (mvProducts || []).find(p => (p.product_id || "") === productId) || null;
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

/** 列表列排序：先 Lot ID，再時間（新→舊），最後 movement_id */
function mvCompareMovementRows_(a, b){
  const la = a.m.lot_id || "";
  const lb = b.m.lot_id || "";
  if(la !== lb) return la.localeCompare(lb);
  const tb = (b.m.created_at || "");
  const ta = (a.m.created_at || "");
  if(tb !== ta) return tb.localeCompare(ta);
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
  return mvMovements
    .filter(m => m.lot_id === lotId)
    .reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

/** 僅 APPROVED + 庫存 ACTIVE 可手動扣庫（與下拉預設清單一致） */
function mvCanManualOut_(lot){
  if(!lot) return false;
  if((lot.status || "PENDING") !== "APPROVED") return false;
  if((lot.inventory_status || "ACTIVE") !== "ACTIVE") return false;
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
    return;
  }
  const lot = mvFindLot_(lotId);
  const ok = mvCanManualOut_(lot);
  qtyEl.disabled = !ok;
  if(!ok) qtyEl.value = "";
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
  if((lot.status || "PENDING") === "REJECTED"){
    if(typeof showToast === "function"){
      showToast("此批次已退回（REJECTED），不可手動扣庫。", "error");
    }
    return;
  }
  if(!mvCanManualOut_(lot)){
    if(typeof showToast === "function"){
      showToast("僅 QA 已放行（APPROVED）且庫存為使用中（ACTIVE）的批次可手動扣庫。", "error");
    }
    return;
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
    opt.textContent = `${lotId} (${lot.product_id || ""})（由下方列表點選）`;
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

  // 只顯示「庫存 ACTIVE 且 QA APPROVED」的 lot
  const lots = (mvLots || []).filter(l =>
    (l.inventory_status || "ACTIVE") === "ACTIVE" &&
    (l.status || "PENDING") === "APPROVED"
  );

  sel.innerHTML =
    `<option value="">請選擇 Lot</option>` +
    lots.map(l => {
      const qa = l.status || "PENDING";
      const available = getMovementAvailableByLotId(l.lot_id);
      return `<option value="${l.lot_id}">${l.lot_id} (${l.product_id}) QA:${termLabel(qa)} 可用:${available}</option>`;
    }).join("");
  sel.onchange = function(){ mvUpdateMvQtyState_(); };
  mvUpdateMvQtyState_();
}

async function createMovement(){
  const lot_id = document.getElementById("mv_lot")?.value || "";
  const qty = Number(document.getElementById("mv_qty")?.value || 0);

  if(!lot_id) return showToast("請選擇 Lot","error");
  if(!qty || qty <= 0) return showToast("數量需大於 0","error");

  const lot = (mvLots || []).find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  // 僅允許 QA APPROVED 的批次做 Manual OUT
  if((lot.status || "PENDING") !== "APPROVED"){
    return showToast("僅 APPROVED 批次可手動扣庫", "error");
  }

  const available = getMovementAvailableByLotId(lot_id);
  if(qty > available){
    return showToast("扣庫數量不可超過可用量", "error");
  }

  showSaveHint();
  try {
  // 這個頁面先提供最常用的「扣庫」：OUT（存負數）
  const movement = {
    movement_id: generateId("MV"),
    movement_type: "OUT",
    lot_id,
    product_id: lot.product_id,
    qty: String(-Math.abs(qty)),
    unit: lot.unit || "",
    ref_type: "MANUAL",
    ref_id: "",
    remark: "Manual OUT",
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
  };

  await createRecord("inventory_movement", movement);

  await refreshMovementData();
  await initMovementLotDropdown();
  renderMovementTable();
  showToast("異動已建立");
  } finally { hideSaveHint(); }
}

function renderMovementTable(){
  const tbody = document.getElementById("movementTableBody");
  if(!tbody) return;

  tbody.innerHTML = "";

  const raw = [...(mvMovements || [])];
  const enriched = raw.map(m => {
    const lot = mvFindLot_(m.lot_id);
    const key = mvGroupKeyForMovement_(m);
    return { m, lot, key };
  });

  const countByKey = {};
  enriched.forEach(x => {
    countByKey[x.key] = (countByKey[x.key] || 0) + 1;
  });

  const groupKeys = [...new Set(enriched.map(x => x.key))].sort((a, b) => a.localeCompare(b));

  function renderDataRow(m, lot){
    const productSpec = mvFormatProductSpec_(lot, m);
    const refHint = [m.ref_type, m.ref_id].filter(Boolean).join(" ");
    const canClick = mvCanManualOut_(lot);
    const titleLot = canClick
      ? escapeMvAttr_(`${m.lot_id || ""}${refHint ? "｜參考：" + refHint : ""}｜點列可帶入 Lot`)
      : escapeMvAttr_(
          `${m.lot_id || ""}${refHint ? "｜參考：" + refHint : ""}｜不可手動扣庫` +
          (lot && (lot.status || "") === "REJECTED" ? "（已退回 REJECTED）" : "（須為 APPROVED 且庫存 ACTIVE）")
        );
    const rowCursor = canClick ? "pointer" : "not-allowed";
    const rowOp = canClick ? "1" : "0.75";
    const lotIdRaw = m.lot_id || "";
    const lidAttr = escapeMvAttr_(lotIdRaw);
    const lidCell = escapeMvHtml_(lotIdRaw);
    const clickAttr = canClick ? `onclick="mvSelectLotFromRow(this)"` : "";
    tbody.innerHTML += `
      <tr data-mv-lot-id="${lidAttr}" ${clickAttr} style="border-bottom:1px solid #eee;cursor:${rowCursor};opacity:${rowOp};" title="${titleLot}">
        <td>${lidCell}</td>
        <td>${escapeMvHtml_(productSpec)}</td>
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
        <td colspan="6" style="font-weight:600;color:#334155;padding:10px 12px;">
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
          <td colspan="6" style="font-weight:600;color:#475569;padding:8px 12px;font-size:13px;">
            收貨單ID：${escapeMvHtml_(label)}（共 ${subCnt} 筆）
          </td>
        </tr>
      `;
      sub.forEach(({ m, lot }) => renderDataRow(m, lot));
    });
  });
}