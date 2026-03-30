/*********************************
 * Lots Module（API 版）
 * - QA：PENDING → APPROVED / REJECTED
 * - 庫存：以 inventory_movement 加總計算（不再直接改 lot.available）
 *********************************/

let lotsCache = [];
let movementsCache = [];
/** 產品主檔完整列，供列表「產品(規格)」與搜尋規格 */
let productsCache = [];
/** product_id -> product_name，供列表與 Modal 顯示 */
let productNameMap = {};
let movementLoadFailed = false;
/** import_receipt_id -> import_doc_id */
let importReceiptIdToDocId = {};
/** gr_id -> po_id */
let goodsReceiptIdToPoId = {};
/** import_doc_id -> import_no（報單號） */
let importDocIdToImportNo = {};

function escapeLotsHtml_(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function lotsInit(){
  await loadLotsAndMovements();
  bindAutoSearchToolbar_([
    ["search_lots_keyword", "input"],
    ["search_inventory_status", "change"],
    ["search_inspection_status", "change"]
  ], () => renderLots());
  await renderLots();
}

async function refreshLotsData(){
  showSaveHint();
  try{
    await loadLotsAndMovements();
    await renderLots();
    if(!movementLoadFailed){
      showToast("Lots 資料已更新");
    }
  }finally{
    hideSaveHint();
  }
}

async function loadLotsAndMovements(){
  const [lots, products, importReceipts, goodsReceipts, importDocs] = await Promise.all([
    getAll("lot"),
    getAll("product").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  lotsCache = lots || [];
  productsCache = products || [];
  productNameMap = {};
  (products || []).forEach(p => {
    if (p && p.product_id) productNameMap[p.product_id] = p.product_name || p.product_id;
  });

  importReceiptIdToDocId = {};
  (importReceipts || []).forEach(r => {
    if(r && r.import_receipt_id){
      importReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
    }
  });
  goodsReceiptIdToPoId = {};
  (goodsReceipts || []).forEach(r => {
    if(r && r.gr_id){
      goodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
    }
  });
  importDocIdToImportNo = {};
  (importDocs || []).forEach(d => {
    if(d && d.import_doc_id){
      importDocIdToImportNo[d.import_doc_id] = d.import_no || "";
    }
  });

  try{
    const movements = await getAll("inventory_movement");
    movementsCache = movements || [];
    movementLoadFailed = false;
  }catch(_e){
    movementLoadFailed = true;
    // 讀取異動失敗時顯示「--」，避免誤判為 0
    if(typeof showToast === "function"){
      showToast("讀取庫存異動失敗，可用量顯示 --。請重新整理頁面或稍後再試。", "error");
    }
    movementsCache = [];
  }
}

function getLotsAvailableByLotId(lotId){
  const rows = (movementsCache || []).filter(m => m.lot_id === lotId);
  if(!rows.length){
    const lot = (lotsCache || []).find(l => l.lot_id === lotId);
    return Number(lot?.qty || 0);
  }
  return rows.reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

/** 與後端 desiredInventoryStatusForLot_ 一致，避免試算表 inventory_status 未同步仍顯示 ACTIVE */
function parseLotYMD_(s){
  const m = String(s || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if(!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if(!y || isNaN(mo) || !d) return null;
  return { y, mo, d };
}

function isLotExpiredClient_(expiryDateStr){
  const raw = String(expiryDateStr || "").trim();
  if(!raw) return false;
  const ymd = parseLotYMD_(raw);
  const now = new Date();
  if(ymd){
    const expiryEnd = new Date(ymd.y, ymd.mo, ymd.d, 23, 59, 59, 999);
    return now.getTime() > expiryEnd.getTime();
  }
  const d = new Date(raw);
  if(isNaN(d.getTime())) return false;
  return now.getTime() > d.getTime();
}

function getLotInventoryStatusDerived_(lot){
  if(movementLoadFailed) return lot.inventory_status || "ACTIVE";
  // 若批次已被明確標記為 VOID（例如作廢回收的產出批次），一律視為不可用
  if(String(lot.inventory_status || "").toUpperCase() === "VOID") return "VOID";
  const av = getLotsAvailableByLotId(lot.lot_id);
  if(isLotExpiredClient_(lot.expiry_date)) return "VOID";
  if(Number(av || 0) <= 1e-9) return "CLOSED";
  return "ACTIVE";
}

function closeLotsQaConfirm(){
  const el = document.getElementById("lotsQaConfirmModal");
  if(el){ el.style.display = "none"; delete el.dataset.lotId; delete el.dataset.action; }
}

function getLotById(lotId){
  return (lotsCache || []).find(l => (l.lot_id || "") === lotId) || null;
}

/** 列表顯示「產品名稱（規格）」；無主檔時退回 product_id */
function lotsFormatProductSpec_(lot){
  const pid = lot.product_id || "";
  if(!pid) return "—";
  const p = (productsCache || []).find(x => (x.product_id || "") === pid);
  const name = p ? (p.product_name || pid) : pid;
  const spec = p && String(p.spec || "").trim() ? String(p.spec).trim() : "";
  if(spec) return `${name}（${spec}）`;
  return name;
}

function showQaApproveConfirm(lotId){
  const lot = getLotById(lotId);
  if(!lot){ showToast("找不到此批次","error"); return; }
  const productName = productNameMap[lot.product_id] || lot.product_id || "";
  const modal = document.getElementById("lotsQaConfirmModal");
  const title = document.getElementById("qaConfirmTitle");
  const batch = document.getElementById("qaConfirmBatchInfo");
  const impact = document.getElementById("qaConfirmImpact");
  const primary = document.getElementById("qaConfirmPrimary");
  if(!modal || !title || !batch || !impact || !primary) return;
  title.textContent = "確定放行此批次？";
  batch.innerHTML = "批號：<strong>" + String(lot.lot_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</strong><br>產品：" + String(productName || lot.product_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "<br>數量：" + (lot.qty != null ? lot.qty : "") + (lot.unit ? " " + lot.unit : "");
  impact.innerHTML = "√ 可以出貨<br>√ 可以進行加工<br>√ 可以銷售";
  primary.textContent = "確認放行";
  primary.onclick = function(){ closeLotsQaConfirm(); doApproveLot(lotId); };
  modal.dataset.lotId = lotId;
  modal.dataset.action = "approve";
  modal.style.display = "flex";
}

function showQaRejectConfirm(lotId){
  const lot = getLotById(lotId);
  if(!lot){ showToast("找不到此批次","error"); return; }
  const productName = productNameMap[lot.product_id] || lot.product_id || "";
  const modal = document.getElementById("lotsQaConfirmModal");
  const title = document.getElementById("qaConfirmTitle");
  const batch = document.getElementById("qaConfirmBatchInfo");
  const impact = document.getElementById("qaConfirmImpact");
  const primary = document.getElementById("qaConfirmPrimary");
  if(!modal || !title || !batch || !impact || !primary) return;
  title.textContent = "確定退回此批次？";
  batch.innerHTML = "批號：<strong>" + String(lot.lot_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</strong><br>產品：" + String(productName || lot.product_id || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "<br>數量：" + (lot.qty != null ? lot.qty : "") + (lot.unit ? " " + lot.unit : "");
  impact.textContent = "此批次將不可用於出貨、加工、銷售。";
  primary.textContent = "確認退回";
  primary.onclick = function(){ closeLotsQaConfirm(); doRejectLot(lotId); };
  modal.dataset.lotId = lotId;
  modal.dataset.action = "reject";
  modal.style.display = "flex";
}

async function doApproveLot(lotId){
  const note = prompt("QA 放行備註（可留空）") ?? "";
  showSaveHint();
  try {
  await updateRecord("lot","lot_id",lotId,{
    status: "APPROVED",
    updated_by: getCurrentUser(),
    updated_at: nowIso16(),
    ...(note ? { remark: note } : {})
  });
  await loadLotsAndMovements();
  await renderLots();
  showToast("已放行（APPROVED）");
  } finally { hideSaveHint(); }
}

async function doRejectLot(lotId){
  const note = prompt("QA 退回備註（可留空）") ?? "";
  showSaveHint();
  try {
  await updateRecord("lot","lot_id",lotId,{
    status: "REJECTED",
    updated_by: getCurrentUser(),
    updated_at: nowIso16(),
    ...(note ? { remark: note } : {})
  });
  await loadLotsAndMovements();
  await renderLots();
  showToast("已退回（REJECTED）");
  } finally { hideSaveHint(); }
}

function approveLot(lotId){ showQaApproveConfirm(lotId); }
function rejectLot(lotId){ showQaRejectConfirm(lotId); }

async function editLotDates(lotId){
  const lot = getLotById(lotId);
  if(!lot){
    return showToast("找不到此批次","error");
  }
  showLotDateModal(lot);
}

function showLotDateModal(lot){
  const modal = document.getElementById("lotsDateModal");
  const info = document.getElementById("lotDateBatchInfo");
  const mfgEl = document.getElementById("lotDateManufacture");
  const expEl = document.getElementById("lotDateExpiry");
  if(!modal || !info || !mfgEl || !expEl) return;
  modal.dataset.lotId = lot.lot_id || "";
  info.innerHTML = "批號：<strong>" + escapeLotsHtml_(lot.lot_id || "") + "</strong><br>產品：" + escapeLotsHtml_(productNameMap[lot.product_id] || lot.product_id || "");
  mfgEl.value = String(lot.manufacture_date || "");
  expEl.value = String(lot.expiry_date || "");
  modal.style.display = "flex";
}

function closeLotDateModal(){
  const modal = document.getElementById("lotsDateModal");
  if(!modal) return;
  modal.style.display = "none";
  delete modal.dataset.lotId;
}

async function saveLotDatesFromModal(){
  const modal = document.getElementById("lotsDateModal");
  const mfgEl = document.getElementById("lotDateManufacture");
  const expEl = document.getElementById("lotDateExpiry");
  if(!modal || !mfgEl || !expEl) return;
  const lotId = String(modal.dataset.lotId || "");
  if(!lotId) return;
  const mfgVal = String(mfgEl.value || "").trim();
  const expVal = String(expEl.value || "").trim();
  if(mfgVal && expVal && expVal < mfgVal){
    return showToast("有效期不可早於製造日", "error");
  }

  showSaveHint();
  try{
    await updateRecord("lot", "lot_id", lotId, {
      manufacture_date: mfgVal,
      expiry_date: expVal,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    closeLotDateModal();
    await loadLotsAndMovements();
    await renderLots();
    showToast("批次日期已更新");
  } finally { hideSaveHint(); }
}

function sourceTypeLabel_(sourceType){
  const t = String(sourceType || "").toUpperCase();
  if(t === "PURCHASE") return "採購入庫";
  if(t === "IMPORT") return "進口收貨";
  if(t === "PROCESS") return "加工產出";
  return t || "未知來源";
}

function lotInventoryStatusLabel_(status){
  const s = String(status || "").toUpperCase();
  if(s === "ACTIVE") return "可使用";
  if(s === "CLOSED") return "無庫存";
  if(s === "VOID") return "已過期";
  return termLabel(s || "");
}

function lotInventoryStatusBadge_(status){
  const s = String(status || "").toUpperCase();
  const label = lotInventoryStatusLabel_(s);
  const cls =
    s === "ACTIVE" ? "lots-status-light lots-status-light-active" :
    s === "CLOSED" ? "lots-status-light lots-status-light-closed" :
    s === "VOID" ? "lots-status-light lots-status-light-void" :
    "lots-status-light";
  return `<span class="${cls}">${escapeLotsHtml_(label)}</span>`;
}

function lotQaStatusLabel_(status){
  const s = String(status || "").toUpperCase();
  if(s === "PENDING") return "待QA";
  if(s === "APPROVED") return "合格放行";
  if(s === "REJECTED") return "QA退回";
  return termLabel(s || "");
}

function getLotImportDocId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "IMPORT") return "";
  const ir = lot.source_id || "";
  return importReceiptIdToDocId[ir] || "";
}

function getLotPoId_(lot){
  if(String(lot.source_type || "").toUpperCase() !== "PURCHASE") return "";
  const gr = lot.source_id || "";
  return goodsReceiptIdToPoId[gr] || "";
}

/** 同一張報單／採購單集中：以業務主檔為群組鍵 */
function getLotBusinessGroupKey_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  if(st === "IMPORT"){
    const doc = getLotImportDocId_(lot);
    return doc ? `IMP_DOC:${doc}` : `IR:${lot.source_id || ""}`;
  }
  if(st === "PURCHASE"){
    const po = getLotPoId_(lot);
    return po ? `PO:${po}` : `GR:${lot.source_id || ""}`;
  }
  return `${st}:${lot.source_id || ""}`;
}

function formatLotGroupHeader_(lot){
  const st = String(lot.source_type || "").toUpperCase();
  const sid = lot.source_id || "";
  if(st === "IMPORT"){
    const docId = getLotImportDocId_(lot);
    const impNo = docId ? (importDocIdToImportNo[docId] || "") : "";
    if(docId){
      const noPart = impNo ? `${impNo}` : "—";
      return `進口報單：報單號 ${noPart}｜報單ID ${docId}`;
    }
    return `進口：收貨單 ${sid}（尚未對應到報單，請檢查 import_receipt）`;
  }
  if(st === "PURCHASE"){
    const po = getLotPoId_(lot);
    if(po){
      return `採購單：${po}`;
    }
    return `採購：收貨單 ${sid}（尚未對應到 PO，請檢查 goods_receipt）`;
  }
  return `${sourceTypeLabel_(lot.source_type)}：${sid}`;
}

async function renderLots(){
  const container = document.getElementById("lotsTableBody");
  if (!container) return;

  const qKw = (document.getElementById("search_lots_keyword")?.value || "").trim().toLowerCase();
  const qInv = document.getElementById("search_inventory_status")?.value || "";
  const qQa = document.getElementById("search_inspection_status")?.value || "";

  container.innerHTML = "";

  const list = (lotsCache || []).filter(l => {
    if(qKw){
      const docId = getLotImportDocId_(l);
      const poId = getLotPoId_(l);
      const impNo = docId ? String(importDocIdToImportNo[docId] || "").toLowerCase() : "";
      const pid = (l.product_id || "").toLowerCase();
      const pname = (productNameMap[l.product_id] || "").toLowerCase();
      const pObj = (productsCache || []).find(x => (x.product_id || "") === l.product_id);
      const pspec = pObj ? String(pObj.spec || "").toLowerCase() : "";
      const ptype = pObj ? String(pObj.type || "").toLowerCase() : "";
      const hay = [
        l.lot_id,
        l.remark,
        pid,
        pname,
        pspec,
        ptype,
        l.source_id,
        l.source_type,
        docId,
        poId,
        impNo
      ].filter(Boolean).join(" ").toLowerCase();
      if(!hay.includes(qKw)) return false;
    }
    if(qInv && getLotInventoryStatusDerived_(l) !== qInv) return false;
    if(qQa && (l.status || "PENDING") !== qQa) return false;
    return true;
  });

  const sorted = [...list].sort((a,b)=>{
    const ak = getLotBusinessGroupKey_(a);
    const bk = getLotBusinessGroupKey_(b);
    if(ak !== bk) return ak.localeCompare(bk);
    const aIr = String(a.source_id || "");
    const bIr = String(b.source_id || "");
    if(aIr !== bIr) return aIr.localeCompare(bIr);
    return String(a.lot_id || "").localeCompare(String(b.lot_id || ""));
  });

  const byBiz = {};
  sorted.forEach(lot => {
    const k = getLotBusinessGroupKey_(lot);
    if(!byBiz[k]) byBiz[k] = [];
    byBiz[k].push(lot);
  });
  const bizKeyOrder = [];
  sorted.forEach(lot => {
    const k = getLotBusinessGroupKey_(lot);
    if(!bizKeyOrder.includes(k)) bizKeyOrder.push(k);
  });

  bizKeyOrder.forEach(bk => {
    const bucket = byBiz[bk];
    const count = bucket.length;
    const headerLot = bucket[0];
    const headerText = formatLotGroupHeader_(headerLot);
    container.innerHTML += `
      <tr style="background:#f8fafc;">
        <td colspan="10" style="font-weight:600;color:#334155;padding:10px 12px;">
          ${escapeLotsHtml_(headerText)}（共 ${count} 批）
        </td>
      </tr>
    `;

    const byReceipt = {};
    bucket.forEach(lot => {
      const rid = lot.source_id ? String(lot.source_id) : "__EMPTY__";
      if(!byReceipt[rid]) byReceipt[rid] = [];
      byReceipt[rid].push(lot);
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
      container.innerHTML += `
        <tr style="background:#f1f5f9;">
          <td colspan="10" style="font-weight:600;color:#475569;padding:8px 12px;font-size:13px;">
            收貨單ID：${escapeLotsHtml_(label)}（共 ${subCnt} 批）
          </td>
        </tr>
      `;

      sub.forEach(lot => {
        const available = movementLoadFailed ? "--" : getLotsAvailableByLotId(lot.lot_id);
        const invStatus = getLotInventoryStatusDerived_(lot);
        const qaStatus = lot.status || "PENDING";

        const safeLotId = (lot.lot_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const allowQa = String(invStatus || "").toUpperCase() === "ACTIVE";
        const action =
          (qaStatus === "PENDING" && allowQa)
            ? `<button class="btn-secondary" onclick="approveLot('${safeLotId}')">QA 放行</button>
               <button class="btn-secondary" onclick="rejectLot('${safeLotId}')">QA 退回</button>
               <button class="btn-secondary" onclick="editLotDates('${safeLotId}')">補登日期</button>`
            : `<button class="btn-secondary" onclick="openLogs('lot','${safeLotId}','inventory')">查看 Log</button>
               <button class="btn-secondary" onclick="window.__pendingTraceLotId='${safeLotId}';if(typeof navigate==='function')navigate('trace')">查看追溯</button>
               <button class="btn-secondary" onclick="editLotDates('${safeLotId}')">補登日期</button>`;

        const productDisplay = lotsFormatProductSpec_(lot);
        const pidAttr = escapeLotsHtml_(lot.product_id || "");

        container.innerHTML += `
      <tr>
        <td>${escapeLotsHtml_(lot.lot_id || "")}</td>
        <td title="${pidAttr}">${escapeLotsHtml_(productDisplay)}</td>
        <td>${escapeLotsHtml_(lot.type || "")}</td>
        <td>${escapeLotsHtml_(lot.qty != null ? String(lot.qty) : "")}</td>
        <td>${escapeLotsHtml_(String(available))}</td>
        <td>${escapeLotsHtml_(lot.manufacture_date || "")}</td>
        <td>${escapeLotsHtml_(lot.expiry_date || "")}</td>
        <td>${lotInventoryStatusBadge_(invStatus)}</td>
        <td>${lotQaStatusLabel_(qaStatus)}</td>
        <td>${action}</td>
      </tr>
    `;
      });
    });
  });
}

function resetLotsSearch(){
  const kw = document.getElementById("search_lots_keyword");
  const inv = document.getElementById("search_inventory_status");
  const qa = document.getElementById("search_inspection_status");
  if(kw) kw.value = "";
  if(inv) inv.value = "";
  if(qa) qa.value = "";
  renderLots();
}