/*********************************
 * Import Module v3（API 版）
 * 海外 Supplier → 報關 → Import Receipt（含報單資料） → Lot
 *********************************/

let importEditing = false;
let importItemsDraft = [];
let importSort = { field:"", asc:true };
/** 快取報單列表，點 Edit 時可少打一次 API */
let importDocumentsCache = null;
let importItemsReadOnly = false;
let importDocReadOnly = false;
let importProducts = [];
let importSelectedDbItemId_ = "";
let importSuppliers = [];
let importLoadedSnapshot_ = ""; // 用於判斷「是否有變更」
let importLoadedStatus_ = ""; // OPEN/CLOSED/CANCELLED（用於按鈕判斷）
let importLoading_ = false;

// `bindUppercaseInput` 已移至 `js/core/utils.js`

const IMPORT_LOCAL_DRAFT_KEY = "erp_import_unsaved_draft_v1";

function n2(v){
  const num = Number(v);
  return Number.isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getImportDocFormData_(){
  const read = (id) => document.getElementById(id)?.value ?? "";
  return {
    import_doc_id: String(read("import_doc_id") || "").trim().toUpperCase(),
    import_no: String(read("import_no") || "").trim().toUpperCase(),
    supplier_id: read("import_supplier_id") || "",
    import_date: read("import_import_date") || "",
    release_date: read("import_release_date") || "",
    inspection_no: String(read("import_inspection_no") || "").trim(),
    document_link: String(read("import_document_link") || "").trim(),
    status: "OPEN",
    remark: String(read("import_remark") || "").trim()
  };
}

function importBuildSnapshot_(){
  // 用穩定序列化比較「是否有變更」（不含 status，因為 status 由系統維護）
  const d = getImportDocFormData_();
  const doc = {
    import_doc_id: d.import_doc_id,
    import_no: d.import_no,
    supplier_id: d.supplier_id,
    import_date: d.import_date,
    release_date: d.release_date,
    inspection_no: d.inspection_no,
    document_link: d.document_link,
    remark: d.remark
  };
  const items = (importItemsDraft || []).map(it => ({
    item_no: it.item_no,
    product_id: it.product_id,
    hs_code: it.hs_code || "",
    lot_id: it.lot_id || it.invoice_no || "",
    origin_country: it.origin_country || "",
    declared_qty: Number(it.declared_qty || 0),
    declared_unit: it.declared_unit || "",
    remark: it.remark || ""
  })).sort((a,b)=>Number(a.item_no||0) - Number(b.item_no||0));
  return JSON.stringify({ doc, items });
}

function applyImportDocFormData_(data){
  const d = data || {};
  const set = (id, val) => {
    const el = document.getElementById(id);
    if(!el) return;
    el.value = val ?? "";
  };

  set("import_doc_id", d.import_doc_id || "");
  set("import_no", d.import_no || "");
  set("import_supplier_id", d.supplier_id || "");
  set("import_import_date", d.import_date || "");
  set("import_release_date", d.release_date || "");
  set("import_inspection_no", d.inspection_no || "");
  set("import_document_link", d.document_link || "");
  // 狀態由系統依收貨單自動維護；不顯示在表單
  set("import_remark", d.remark || "");
}

function saveImportLocalDraft_(){
  try{
    const draft = {
      saved_at: nowIso16(),
      doc: getImportDocFormData_(),
      items: importItemsDraft
    };
    localStorage.setItem(IMPORT_LOCAL_DRAFT_KEY, JSON.stringify(draft));
  }catch(_e){}
}

function clearImportLocalDraft_(){
  try{ localStorage.removeItem(IMPORT_LOCAL_DRAFT_KEY); }catch(_e){}
}

function restoreImportLocalDraft_(){
  try{
    const raw = localStorage.getItem(IMPORT_LOCAL_DRAFT_KEY);
    if(!raw) return false;
    const draft = JSON.parse(raw);
    if(!draft?.doc) return false;

    importEditing = false;
    applyImportDocFormData_(draft.doc);

    const idEl = document.getElementById("import_doc_id");
    if(idEl){
      idEl.disabled = false;
      idEl.value = String(idEl.value || "").trim().toUpperCase();
    }

    importItemsDraft = Array.isArray(draft.items) ? draft.items : [];
    renderImportItemsDraft();
    updateImportButtons_();
    updateImportFlowHint_();
    return true;
  }catch(_e){
    return false;
  }
}

function updateImportButtons_(){
  const createBtn = document.getElementById("import_create_btn");
  const updateBtn = document.getElementById("import_update_btn");
  const cancelBtn = document.getElementById("import_cancel_btn");
  const itemSaveBtn = document.getElementById("import_items_save_btn");
  if(!createBtn || !updateBtn) return;
  // 作廢按鈕：狀態由 setImportCancelBtnState_ 統一管理（避免被這裡覆蓋而「永遠不能按」）
  // 與其他模組一致：載入後且可編輯才可按「更新」（不強制要求先有變更）
  updateBtn.disabled = true;
  updateBtn.title = importEditing ? "檢查中…" : "請先載入報單";
  if(importDocReadOnly){
    createBtn.disabled = true;
    createBtn.title = "已有收貨紀錄（僅可檢視）";
    updateBtn.disabled = true;
    updateBtn.title = "已有收貨紀錄（僅可檢視）";
    if(itemSaveBtn){
      itemSaveBtn.disabled = true;
      itemSaveBtn.title = "已有收貨紀錄（僅可檢視）";
    }
    updateImportFlowHint_();
    if(cancelBtn){
      if(importLoading_){
        cancelBtn.disabled = true;
        cancelBtn.title = "檢查中…";
      }else{
        setImportCancelBtnState_({ editing: importEditing, status: importLoadedStatus_ || "OPEN", hasReceipt: true });
      }
    }
    return;
  }
  if(importEditing){
    createBtn.disabled = true;
    createBtn.title = "已載入報單（新建請清除）";
    const st = String(importLoadedStatus_ || "").toUpperCase();
    if(st === "CLOSED"){
      updateBtn.disabled = true;
      updateBtn.title = "此報單已結案（CLOSED），不可再修改";
    }else if(st === "CANCELLED"){
      updateBtn.disabled = true;
      updateBtn.title = "此報單已作廢（CANCELLED），不可再修改";
    }else{
      updateBtn.disabled = false;
      updateBtn.title = "更新此報單";
    }
    if(itemSaveBtn){
      itemSaveBtn.disabled = !!importItemsReadOnly;
      itemSaveBtn.title = importItemsReadOnly ? "明細不可修改" : "更新（寫入報單與明細）";
    }
  }else{
    createBtn.disabled = false;
    createBtn.title = "建立報單";
    updateBtn.disabled = true;
    updateBtn.title = "請先載入報單";
    if(itemSaveBtn){
      itemSaveBtn.disabled = true;
      itemSaveBtn.title = "請先載入報單";
    }
  }
  updateImportFlowHint_();
  if(cancelBtn){
    if(importLoading_){
      cancelBtn.disabled = true;
      cancelBtn.title = "檢查中…";
    }else{
      setImportCancelBtnState_({
        editing: importEditing,
        status: importLoadedStatus_ || "OPEN",
        hasReceipt: !!importDocReadOnly
      });
    }
  }
}

function setImportCancelBtnState_(opts){
  const cancelBtn = document.getElementById("import_cancel_btn");
  if(!cancelBtn) return;
  const editing = !!opts?.editing;
  const st = String(opts?.status || "").trim().toUpperCase();
  const hasReceipt = !!opts?.hasReceipt;
  if(!editing){
    cancelBtn.disabled = true;
    cancelBtn.title = "請先載入報單";
    return;
  }
  if(st === "CANCELLED"){
    cancelBtn.disabled = true;
    cancelBtn.title = "此報單已作廢";
    return;
  }
  if(hasReceipt){
    cancelBtn.disabled = true;
    cancelBtn.title = "此報單已有未作廢收貨單，請先作廢所有收貨單";
    return;
  }
  cancelBtn.disabled = false;
  cancelBtn.title = "作廢此報單（需先無有效收貨單）";
}

function bindImportDraftAutosave_(){
  const ids = [
    "import_doc_id","import_no","import_supplier_id","import_import_date","import_release_date",
    "import_inspection_no","import_document_link","import_remark"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    if(el.dataset.draftAutosaveBound) return;
    el.dataset.draftAutosaveBound = "1";
    el.addEventListener("change", () => { saveImportLocalDraft_(); updateImportButtons_(); });
    el.addEventListener("input", () => { saveImportLocalDraft_(); updateImportButtons_(); });
  });
}

async function persistImportItems(import_doc_id, draftItems){
  const docId = String(import_doc_id || "").trim();
  if(!docId) throw new Error("import_doc_id required");

  const list = Array.isArray(draftItems) ? draftItems : [];
  if(list.length === 0) return { created: 0 };

  // 先刪除該報單既有明細，避免重複（以 import_item_id 為主鍵）
  const allItems = await getAll("import_item").catch(()=>[]);
  const exists = (allItems || []).filter(it => it.import_doc_id === docId);
  for(const it of exists){
    if(it?.import_item_id){
      await deleteRecord("import_item", "import_item_id", it.import_item_id);
    }
  }

  // 重新建立明細（由 draft index 決定序號）
  for(let idx=0; idx<list.length; idx++){
    const it = list[idx] || {};
    const import_item_id = `IMPI-${docId}-${String(idx+1).padStart(3,"0")}`;

    const item = {
      import_item_id,
      import_doc_id: docId,
      product_id: it.product_id,
      item_no: String(idx + 1),
      description: "",
      hs_code: it.hs_code || "",
      declared_qty: String(it.declared_qty),
      declared_unit: it.declared_unit || "",
      declared_price: String(it.declared_price ?? 0),
      declared_amount: Number(it.declared_amount || 0).toFixed(2),
      origin_country: it.origin_country || "",
      invoice_no: it.lot_id || it.invoice_no || "",
      net_weight: "",
      gross_weight: "",
      package_qty: "",
      package_unit: "",
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    };

    await createRecord("import_item", item);
  }

  return { created: list.length };
}

function setImportReceiptState_(text, type = ""){
  const el = document.getElementById("importReceiptState");
  if(!el) return;
  el.textContent = text;
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function updateImportFlowHint_(){
  const el = document.getElementById("importFlowHint");
  if(!el) return;
  if(importEditing && importDocReadOnly){
    el.textContent = "報單流程：已載入 — 已有收貨紀錄（僅可檢視）";
    return;
  }
  if(importEditing){
    el.textContent = "報單流程：已載入";
    return;
  }
  el.textContent = "報單流程：新單 — 填主檔與明細後按下方「建立」寫入";
}

function setImportItemsReadOnly_(readOnly){
  importItemsReadOnly = !!readOnly;
  const addBtn = document.getElementById("import_add_item_btn");
  if(addBtn) addBtn.disabled = importItemsReadOnly;
  updateImportButtons_();
}

function setImportDocReadOnly_(readOnly){
  importDocReadOnly = !!readOnly;
  updateImportButtons_();
}

function formatImportProductDisplay_(productId, productName, productSpec){
  const id = String(productId || "").trim();
  const name = String(productName || id || "").trim();
  const spec = String(productSpec || "").trim();
  if(!name && !id) return "";
  // 對齊其他模組：產品名稱（規格）；不把 product_id 混在同一段顯示字串
  if(spec) return `${name}（${spec}）`;
  return name || id;
}

function normalizeImportItemProductMeta_(it, product){
  const id = String(it?.product_id || "").trim();
  const p = product || {};
  const pn = String(it?.product_name || "").trim();
  const ps = String(it?.product_spec || "").trim();
  const name = (!pn || pn === id) ? String(p.product_name || id || "").trim() : pn;
  const spec = (!ps) ? String(p.spec || "").trim() : ps;
  return { name, spec };
}

async function hasImportReceipts_(importDocId){
  const docId = String(importDocId || "").trim();
  if(!docId) return false;
  const [allReceipts, allReceiptItems] = await Promise.all([
    getAll("import_receipt").catch(() => []),
    getAll("import_receipt_item").catch(() => [])
  ]);
  const receiptIds = (allReceipts || [])
    .filter(
      r =>
        r.import_doc_id === docId && String(r.status || "").toUpperCase() !== "CANCELLED"
    )
    .map(r => r.import_receipt_id);
  if(receiptIds.length === 0) return false;
  return (allReceiptItems || []).some(x => receiptIds.includes(x.import_receipt_id));
}

async function importInit(){
  bindUppercaseInput("import_doc_id");
  bindUppercaseInput("import_no");

  // 並行請求（只等最慢的那次）：供應商、產品、報單一次取完，避免 3 次排隊等
  const [suppliers, products, docList] = await Promise.all([
    getAll("supplier"),
    getAll("product"),
    getAll("import_document")
  ]).catch(() => [[], [], []]);

  initImportDropdownsWithData_(suppliers, products);
  bindImportDraftAutosave_();

  // 重新打開頁面時一律空白表單，不自動帶入上次草稿（避免誤以為是「最後一筆」）
  resetImportForm();
  syncImportItemUnitSuffix_();
  setImportReceiptState_("收貨狀態：未載入 — 請先載入報單", "warn");
  importDocumentsCache = docList;
  renderImportDocuments(docList);

  bindAutoSearchToolbar_([
    ["search_import_keyword", "input"],
    ["search_import_status", "change"]
  ], () => searchImportDocuments());
}

function buildImportDocPayload_(){

  const import_doc_id = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  const import_no = (document.getElementById("import_no")?.value || "").trim().toUpperCase();
  const supplier_id = document.getElementById("import_supplier_id")?.value || "";
  const import_date = document.getElementById("import_import_date")?.value || "";
  const release_date = document.getElementById("import_release_date")?.value || "";
  const inspection_no = (document.getElementById("import_inspection_no")?.value || "").trim();
  const document_link = (document.getElementById("import_document_link")?.value || "").trim();
  const status = "OPEN"; // 狀態由系統依收貨單自動維護
  const remark = (document.getElementById("import_remark")?.value || "").trim();

  if(!import_doc_id) throw new Error("報單ID 必填");
  if(!import_no) throw new Error("報單號 必填");
  if(!supplier_id) throw new Error("供應商 必填");
  if(!release_date) throw new Error("放行日 必填");
  if(importItemsDraft.length === 0) throw new Error("請至少新增 1 筆品項");

  const items = importItemsDraft.map((it, idx)=>({
    import_item_id: `IMPI-${import_doc_id}-${String(idx+1).padStart(3,"0")}`,
    import_doc_id,
    // 項次以「目前列表順序」重新編號，避免刪除後再新增造成重複
    item_no: String(idx + 1),
    product_id: it.product_id,
    hs_code: it.hs_code || "",
    declared_qty: String(it.declared_qty),
    declared_unit: it.declared_unit || "",
    origin_country: it.origin_country || "",
    invoice_no: it.lot_id || it.invoice_no || "",
    remark: it.remark || "",
    created_at: nowIso16()
  }));

  const doc = {
    import_doc_id,
    import_no,
    supplier_id,
    import_date,
    release_date,
    inspection_no,
    document_link,
    status,
    remark
  };

  return { doc, items };
}

async function saveImportDocument(triggerEl){
  if(importDocReadOnly){
    showToast("此報單已有進口收貨紀錄，整張報單不可修改。","error");
    return;
  }
  showSaveHint(triggerEl || document.getElementById("importItemsCommitGroup"));
  try{
    const { doc, items } = buildImportDocPayload_();

    const header = await getOne("import_document","import_doc_id",doc.import_doc_id).catch(()=>null);
    const currentStatus = String(header?.status || "").toUpperCase();
    if(importEditing && (currentStatus === "CLOSED" || currentStatus === "CANCELLED")){
      showToast("此報單已結束（CLOSED/CANCELLED），不可再修改。", "error");
      return;
    }

    // 若已存在進口收貨紀錄，禁止修改明細（避免破壞追溯）
    if (importEditing) {
      try {
        const allReceipts = await getAll("import_receipt").catch(() => []);
        const allReceiptItems = await getAll("import_receipt_item").catch(() => []);
        const relatedReceipts = (allReceipts || []).filter(
          r =>
            r.import_doc_id === doc.import_doc_id &&
            String(r.status || "").toUpperCase() !== "CANCELLED"
        );
        if (relatedReceipts.length) {
          const receiptIds = relatedReceipts.map(r => r.import_receipt_id);
          const relatedItems = (allReceiptItems || []).filter(x => receiptIds.includes(x.import_receipt_id));
          if (relatedItems.length) {
            showToast("此報單已有進口收貨紀錄，請勿直接修改明細。若需調整，請改用沖銷/補單方式。", "error");
            return;
          }
        }
      } catch (_e) {
        // 若檢查失敗，不阻擋儲存，但仍嘗試繼續（後端仍有防呆）
      }
    }

    const wasNew = !importEditing;
    // 一鍵寫入（主檔+明細），用 POST 避免 URL 過長
    const res = await callAPI({
      action: "save_import_document",
      // 狀態由系統自動維護：更新時保留原狀態；新建時固定 OPEN
      ...({ ...doc, status: (header?.status || doc.status || "OPEN") }),
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
      items_json: JSON.stringify(items)
    }, { method: "POST" });

    // 成功後：視為已寫入，鎖住 ID，並清掉本機草稿
    importEditing = true;
    const idEl = document.getElementById("import_doc_id");
    if(idEl) idEl.disabled = true;
    clearImportLocalDraft_();
    saveImportLocalDraft_();

    // save_import_document 走 callAPI，需手動清掉快取，避免列表仍顯示舊資料
    if (typeof invalidateCache === "function") {
      invalidateCache("import_document");
      invalidateCache("import_item");
    }

    await renderImportDocuments();
    // 成功後：更新狀態快照
    importLoadedStatus_ = String((header?.status || doc.status || "OPEN") || "OPEN").toUpperCase();
    importLoadedSnapshot_ = importBuildSnapshot_();
    updateImportButtons_();
    const n = res.items_created ?? items.length;
    showToast(wasNew ? `報單已建立（明細 ${n} 筆）` : `報單已更新（明細 ${n} 筆）`);
  }catch(err){
    if (typeof showToast === "function" && !err?.erpApiToastShown) {
      showToast(err?.erpUserMessage || err?.message || "更新失敗", "error");
    }
    throw err;
  }finally{
    updateImportButtons_();
    hideSaveHint();
  }
}

async function initImportDropdowns(){
  const [suppliers, products] = await Promise.all([getAll("supplier"), getAll("product")]);
  initImportDropdownsWithData_(suppliers, products);
}

function initImportDropdownsWithData_(suppliers, products){
  const supplierSelect = document.getElementById("import_supplier_id");
  const productSelect = document.getElementById("import_item_product_id");
  const supList = (suppliers || []).filter(s => (s.status || "ACTIVE") === "ACTIVE");
  const prodList = (products || []).filter(p => (p.status || "ACTIVE") === "ACTIVE");
  importProducts = prodList;
  importSuppliers = supList;

  if(supplierSelect){
    supplierSelect.innerHTML =
      `<option value="">請選擇供應商</option>` +
      supList.map(s=>{
        const name = String(s.supplier_name || "").trim();
        const label = name || s.supplier_id;
        return `<option value="${s.supplier_id}">${label}</option>`;
      }).join("");
  }
  if(productSelect){
    productSelect.innerHTML =
      `<option value="">請選擇產品</option>` +
      prodList.map(p=>{
        const name = String(p.product_name || "").trim();
        const spec = String(p.spec || "").trim();
        const label = spec ? `${name}（${spec}）` : (name || (p.product_id || ""));
        return `<option value="${p.product_id}" data-unit="${p.unit || ""}" data-spec="${(p.spec || "").replace(/"/g, "&quot;")}">${label}</option>`;
      }).join("");
  }
}

function syncImportItemUnitSuffix_(){
  syncErpQtyUnitSuffix_("import_item_declared_unit", "import_item_unit_suffix");
}

function onSelectImportItemProduct(){
  const productSelect = document.getElementById("import_item_product_id");
  const unitEl = document.getElementById("import_item_declared_unit");
  if(!productSelect || !unitEl) return;
  const opt = productSelect.selectedOptions?.[0];
  if(!opt || !String(productSelect.value || "").trim()){
    unitEl.value = "";
    syncImportItemUnitSuffix_();
    return;
  }
  unitEl.value = opt.getAttribute("data-unit") || "";
  syncImportItemUnitSuffix_();
}

function isImportItemDraftRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 簡版：草稿／已存檔（與出貨明細「草稿／已過帳」同層級概念） */
function formatImportItemLineStatus_(it){
  return isImportItemDraftRow_(it) ? "草稿" : "已存檔";
}

function selectImportItemDbRow_(importItemId){
  if(importItemsReadOnly) return;
  const id = String(importItemId || "");
  const it = importItemsDraft.find(x => x.draft_id === id);
  if(!it) return;
  importSelectedDbItemId_ = id;
  const productSelect = document.getElementById("import_item_product_id");
  if(productSelect) productSelect.value = it.product_id || "";
  onSelectImportItemProduct();
  const hs = document.getElementById("import_item_hs_code");
  if(hs) hs.value = String(it.hs_code || "");
  const lot = document.getElementById("import_item_lot_id");
  if(lot) lot.value = String(it.lot_id || "");
  syncSelectWithLegacy_("import_item_origin_country", it.origin_country || "");
  const dq = document.getElementById("import_item_declared_qty");
  if(dq) dq.value = String(it.declared_qty ?? "");
  const du = document.getElementById("import_item_declared_unit");
  if(du) du.value = String(it.declared_unit || "");
  syncImportItemUnitSuffix_();
  const rm = document.getElementById("import_item_remark");
  if(rm) rm.value = String(it.remark || "");
  showToast("已帶入明細（僅改備註請按「更新本筆備註」）");
}

async function updateSelectedImportItemRemark(triggerEl){
  if(!importEditing) return showToast("請先載入報單", "error");
  if(importItemsReadOnly){
    return showToast("此報單已有進口收貨紀錄，明細不可修改。", "error");
  }
  const iid = String(importSelectedDbItemId_ || "").trim();
  if(!iid || iid.startsWith("DRAFT-")){
    return showToast("請先點選一筆已存檔的明細列（非草稿列）", "error");
  }
  const remark = (document.getElementById("import_item_remark")?.value || "").trim();

  showSaveHint(triggerEl || document.getElementById("importItemsCommitGroup"));
  try{
    await updateRecord("import_item", "import_item_id", iid, {
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    const row = importItemsDraft.find(x => x.draft_id === iid);
    if(row) row.remark = remark;
    renderImportItemsDraft();
    if(typeof invalidateCache === "function") invalidateCache("import_item");
    showToast("報單品項備註已更新");
  }finally{
    hideSaveHint();
    updateImportButtons_();
  }
}

function renderImportItemsDraft(){
  const tbody = document.getElementById("importItemsBody");
  if(!tbody) return;
  tbody.innerHTML = "";

  // 項次自動產生（1,2,3...）；順序：產品名稱、稅則號列、批號、原產地、數量（含單位）、狀態、操作
  importItemsDraft.forEach((it, idx) => {
    const p = importProducts.find(x => x.product_id === it.product_id) || {};
    const meta = normalizeImportItemProductMeta_(it, p);
    const productDisplay = formatImportProductDisplay_(
      it.product_id,
      meta.name,
      meta.spec
    );
    const lotId = it.lot_id || it.invoice_no || "";
    const itemNo = idx + 1;
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const rowClick =
      importItemsReadOnly || isImportItemDraftRow_(it) ? "" : `onclick="selectImportItemDbRow_('${safeId}')"`;
    const iu = String(it.declared_unit || "").trim();
    const qtyUnitCell = iu
      ? `${it.declared_qty} ${iu.replace(/</g, "")}`
      : String(it.declared_qty);
    tbody.innerHTML += `
      <tr style="${rowClick ? "cursor:pointer;" : ""}" ${rowClick}>
        <td>${itemNo}</td>
        <td title="${String(productDisplay).replace(/"/g, "&quot;")}">${productDisplay}</td>
        <td>${it.hs_code || ""}</td>
        <td>${lotId}</td>
        <td>${it.origin_country || ""}</td>
        <td>${qtyUnitCell}</td>
        <td>${formatImportItemLineStatus_(it)}</td>
        <td><button class="btn-secondary" ${importItemsReadOnly ? "disabled" : ""} onclick="event.stopPropagation(); removeImportItemDraft('${safeId}')">刪除</button></td>
      </tr>
    `;
  });
  updateImportButtons_();
}

function addImportItemDraft(){
  if(importItemsReadOnly){
    return showToast("此報單已有進口收貨紀錄，明細不可修改。請改用沖銷/補單方式。","error");
  }
  const productSelect = document.getElementById("import_item_product_id");
  const product_id = productSelect?.value || "";
  // 下拉選單文字本來就不是 "id - name"；用主檔資料避免解析錯誤導致只存到代碼
  const p = importProducts.find(x => x.product_id === product_id) || {};
  const product_name = String(p.product_name || "").trim() || product_id;
  const product_spec = String(p.spec || "").trim();
  const hs_code = (document.getElementById("import_item_hs_code")?.value || "").trim();
  const lot_id = (document.getElementById("import_item_lot_id")?.value || "").trim();
  const origin_country = (document.getElementById("import_item_origin_country")?.value || "").trim();
  const declared_qty = Number(document.getElementById("import_item_declared_qty")?.value || 0);
  const declared_unit = document.getElementById("import_item_declared_unit")?.value || "";
  const remark = (document.getElementById("import_item_remark")?.value || "").trim();

  if(!product_id) return showToast("請選擇產品","error");
  if(!lot_id) return showToast("批號（Inv No）必填，請依文件發票號填寫","error");
  if(!declared_qty || declared_qty <= 0) return showToast("數量需大於 0","error");
  if(!declared_unit) return showToast("找不到產品單位，請先確認產品主檔","error");

  importItemsDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    product_id,
    product_name,
    product_spec,
    hs_code,
    lot_id,
    declared_qty,
    declared_unit,
    origin_country,
    remark
  });

  // 清空輸入（順序：產品、稅則號列、批號、原產地、數量、備註）
  document.getElementById("import_item_product_id").value = "";
  document.getElementById("import_item_hs_code").value = "";
  document.getElementById("import_item_lot_id").value = "";
  syncSelectWithLegacy_("import_item_origin_country", "");
  document.getElementById("import_item_declared_qty").value = "";
  document.getElementById("import_item_declared_unit").value = "";
  syncImportItemUnitSuffix_();
  document.getElementById("import_item_remark").value = "";
  importSelectedDbItemId_ = "";

  renderImportItemsDraft();
  saveImportLocalDraft_();
  updateImportButtons_();
}

function removeImportItemDraft(draftId){
  if(importItemsReadOnly){
    return showToast("此報單已有進口收貨紀錄，明細不可修改。請改用沖銷/補單方式。","error");
  }
  if(String(importSelectedDbItemId_) === String(draftId)) importSelectedDbItemId_ = "";
  importItemsDraft = importItemsDraft.filter(it => it.draft_id !== draftId);
  renderImportItemsDraft();
  saveImportLocalDraft_();
  updateImportButtons_();
}

function resetImportForm(clearLocalDraft = false){
  importEditing = false;
  setImportDocReadOnly_(false);
  setImportItemsReadOnly_(false);
  importSelectedDbItemId_ = "";
  importItemsDraft = [];
  renderImportItemsDraft();

  const idEl = document.getElementById("import_doc_id");
  if(idEl){
    idEl.value = generateId("IMP");
    idEl.disabled = false;
  }

  document.getElementById("import_no").value = "";
  document.getElementById("import_supplier_id").value = "";
  document.getElementById("import_import_date").value = "";
  document.getElementById("import_release_date").value = "";
  const inspEl = document.getElementById("import_inspection_no");
  const linkEl = document.getElementById("import_document_link");
  if(inspEl) inspEl.value = "";
  if(linkEl) linkEl.value = "";
  // import_status 已移除
  document.getElementById("import_remark").value = "";

  updateImportButtons_();
  setImportCancelBtnState_({ editing: false });

  if(clearLocalDraft){
    clearImportLocalDraft_();
  }else{
    saveImportLocalDraft_();
  }
  setImportReceiptState_("收貨狀態：未載入 — 請先載入報單", "warn");
  importLoadedSnapshot_ = importBuildSnapshot_();
  importLoadedStatus_ = "";

  const impProd = document.getElementById("import_item_product_id");
  if(impProd) impProd.value = "";
  const impHs = document.getElementById("import_item_hs_code");
  if(impHs) impHs.value = "";
  const impLot = document.getElementById("import_item_lot_id");
  if(impLot) impLot.value = "";
  syncSelectWithLegacy_("import_item_origin_country", "");
  const impQty = document.getElementById("import_item_declared_qty");
  if(impQty) impQty.value = "";
  const impUnit = document.getElementById("import_item_declared_unit");
  if(impUnit) impUnit.value = "";
  syncImportItemUnitSuffix_();
  const impRm = document.getElementById("import_item_remark");
  if(impRm) impRm.value = "";
}

async function createImportDocument(triggerEl){
  // 保留舊函式名稱，改走一鍵儲存（更直覺）
  await saveImportDocument(triggerEl);
}

async function updateImportDocument(triggerEl){
  // 保留舊函式名稱，改走一鍵儲存（更直覺）
  await saveImportDocument(triggerEl);
}

async function cancelImportDocument(triggerEl){
  if(!importEditing) return showToast("請先載入一張報單再作廢","error");
  const import_doc_id = (document.getElementById("import_doc_id")?.value || "").trim().toUpperCase();
  if(!import_doc_id) return showToast("報單ID 缺失","error");

  showSaveHint(triggerEl || document.getElementById("importItemsCommitGroup"));
  try{
    const header = await getOne("import_document","import_doc_id",import_doc_id).catch(()=>null);
    if(!header) return showToast("找不到報單","error");
    const st = String(header.status || "").toUpperCase();
    if(st === "CANCELLED") return showToast("此報單已作廢","error");

    const hasReceipt = await hasImportReceipts_(import_doc_id);
    if(hasReceipt){
      return showToast("此報單已有未作廢收貨紀錄，請先至「收貨入庫」作廢所有收貨單後再作廢報單。","error");
    }

    const note = prompt("作廢原因（可留空）") ?? "";
    if(!confirm(`確定作廢此報單？\n- 報單ID：${import_doc_id}\n\n限制：需先作廢所有收貨單。`)) return;

    await callAPI(
      {
        action: "cancel_import_document_bundle",
        import_doc_id,
        cancel_note: String(note || "").trim(),
        updated_by: getCurrentUser()
      },
      { method: "POST" }
    );

    if(typeof invalidateCache === "function") invalidateCache("import_document");
    await renderImportDocuments();
    await loadImportDocument(import_doc_id);
    showToast("報單已作廢（CANCELLED）");
  } finally {
    hideSaveHint();
  }
}

async function loadImportDocument(importDocId){
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  importLoading_ = true;
  updateImportButtons_();
  setImportReceiptState_("收貨狀態：檢查中…", "warn");
  // 若有快取且含此報單，直接使用，只再拉明細（少打 1 次 list_import_document）
  let doc = importDocumentsCache && importDocumentsCache.find(d => d.import_doc_id === importDocId);
  if(!doc){
    doc = await getOne("import_document","import_doc_id",importDocId);
  }
  if(!doc) return showToast("找不到報單","error");

  importEditing = true;
  importSelectedDbItemId_ = "";
  clearImportLocalDraft_();
  updateImportButtons_();

  const idEl = document.getElementById("import_doc_id");
  idEl.value = doc.import_doc_id;
  idEl.disabled = true;

  document.getElementById("import_no").value = doc.import_no || "";
  document.getElementById("import_supplier_id").value = doc.supplier_id || "";
  document.getElementById("import_import_date").value = doc.import_date || "";
  document.getElementById("import_release_date").value = doc.release_date || "";
  const inspEl = document.getElementById("import_inspection_no");
  const linkEl = document.getElementById("import_document_link");
  if(inspEl) inspEl.value = doc.inspection_no || "";
  if(linkEl) linkEl.value = doc.document_link || "";
  // import_status 已移除
  document.getElementById("import_remark").value = doc.remark || "";

  // 只拉明細（報單主檔已用快取或 getOne）；產品名稱由產品主檔解析
  const [allItems, products] = await Promise.all([getAll("import_item"), getAll("product").catch(() => [])]);
  const items = (allItems || []).filter(it => it.import_doc_id === importDocId);
  const prodList = Array.isArray(products) ? products : [];
  importProducts = prodList.filter(p => (p.status || "ACTIVE") === "ACTIVE");
  importItemsDraft = items.map((it, idx) => {
    const p = prodList.find(x => x.product_id === it.product_id);
    const product_name = (p && p.product_name) ? p.product_name : (it.product_name || it.product_id || "");
    const product_spec = (p && p.spec) ? p.spec : (it.product_spec || "");
    return {
    draft_id: it.import_item_id,
    item_no: it.item_no != null ? it.item_no : (idx + 1),
    product_id: it.product_id,
    product_name,
    product_spec,
    hs_code: it.hs_code || "",
    lot_id: it.invoice_no || it.lot_id || "",
    declared_qty: Number(it.declared_qty || 0),
    declared_unit: it.declared_unit || "",
    origin_country: it.origin_country || "",
    remark: it.remark || ""
  };
  });

  const locked = await hasImportReceipts_(importDocId);
  setImportDocReadOnly_(locked);
  setImportItemsReadOnly_(locked);
  setImportCancelBtnState_({ editing: true, status: doc.status || "OPEN", hasReceipt: locked });
  importLoadedSnapshot_ = importBuildSnapshot_();
  importLoadedStatus_ = String(doc.status || "OPEN").toUpperCase();
  // 若舊資料/舊流程未同步狀態，載入時自動修正：有收貨→CLOSED；無收貨→OPEN（不改 CANCELLED）
  try{
    const ds = String(doc.status || "").toUpperCase();
    if(ds !== "CANCELLED"){
      const desired = locked ? "CLOSED" : "OPEN";
      if(ds !== desired){
        await updateRecord("import_document","import_doc_id",importDocId,{
          status: desired,
          updated_by: getCurrentUser(),
          updated_at: nowIso16()
        });
        doc.status = desired;
        importLoadedStatus_ = desired;
      }
    }
  }catch(_e){}
  setImportReceiptState_(
    locked ? "收貨狀態：已載入 — 已收貨（僅可檢視）" : "收貨狀態：已載入 — 未收貨（可編輯）",
    locked ? "error" : "ok"
  );
  if(locked){
    showToast("此報單已有進口收貨紀錄，明細不可修改。若需調整，請改用沖銷/補單方式。","error");
  }

  renderImportItemsDraft();
  updateImportFlowHint_();
  saveImportLocalDraft_();
  importLoading_ = false;
  updateImportButtons_();
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
}

function resetImportReceiptForm(){
  const idEl = document.getElementById("import_receipt_id");
  if(idEl) idEl.value = generateId("IR");

  const dateEl = document.getElementById("import_receipt_date");
  if(dateEl) dateEl.value = nowIso16();

  const wh = document.getElementById("import_receipt_warehouse");
  if(wh) wh.value = "MAIN";

  const st = document.getElementById("import_receipt_status");
  if(st) st.value = "OPEN";

  const rm = document.getElementById("import_receipt_remark");
  if(rm) rm.value = "";
}

async function createImportReceiptAndLots(){
  const import_doc_id = (document.getElementById("import_doc_id")?.value || "").trim();
  if(!import_doc_id) return showToast("請先載入或建立一張報單","error");
  if(importItemsDraft.length === 0) return showToast("請至少新增 1 筆報單品項","error");

  const doc = await getOne("import_document","import_doc_id",import_doc_id).catch(()=>null);
  if(!doc) return showToast("找不到此報單主檔，請先至明細區按「建立」寫入報單","error");
  if(String(doc.status || "").toUpperCase() === "CANCELLED"){
    return showToast("此報單已作廢（CANCELLED），不能建立收貨單","error");
  }
  const docNo = doc?.import_no || "";

  // 保底：若報單明細尚未寫入（或有人誤刪），先同步一份到 import_item
  const allItems = await getAll("import_item").catch(()=>[]);
  const savedItems = (allItems || []).filter(it => it.import_doc_id === import_doc_id);
  if(savedItems.length === 0){
    await persistImportItems(import_doc_id, importItemsDraft);
  }

  const import_receipt_id = (document.getElementById("import_receipt_id")?.value || "").trim().toUpperCase();
  document.getElementById("import_receipt_id").value = import_receipt_id;

  const receipt_date = document.getElementById("import_receipt_date")?.value || "";
  const warehouse = (document.getElementById("import_receipt_warehouse")?.value || "").trim();
  const status = document.getElementById("import_receipt_status")?.value || "OPEN";
  const remark = (document.getElementById("import_receipt_remark")?.value || "").trim();

  if(!import_receipt_id) return showToast("收貨單ID 必填","error");
  if(!receipt_date) return showToast("收貨日期 必填","error");

  // 建立收貨單
  const receipt = {
    import_receipt_id,
    import_doc_id,
    receipt_date,
    warehouse,
    status,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };
  await createRecord("import_receipt", receipt);

  // 逐品項建立 lot（初始 PENDING）
  const products = await getAll("product");

  for(let idx=0; idx<importItemsDraft.length; idx++){
    const it = importItemsDraft[idx];
    const import_item_id = `IMPI-${import_doc_id}-${String(idx+1).padStart(3,"0")}`;

    const p = products.find(x => x.product_id === it.product_id);
    const lot_type = p?.type || "RM";

    const lot_id = generateId("LOT");

    const lot = {
      lot_id,
      product_id: it.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      source_type: "IMPORT",
      source_id: import_receipt_id,
      qty: String(it.declared_qty),
      unit: it.declared_unit,
      type: lot_type,
      status: "", // 交由 service.js 自動補 PENDING
      manufacture_date: "",
      expiry_date: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      remark: "",
      system_remark: `Import: ${import_doc_id}${docNo ? " / " + docNo : ""}`.trim()
    };

    await createRecord("lot", lot);

    // 寫入庫存帳本（IN）
    const mv = {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id,
      product_id: it.product_id,
      warehouse_id: String(warehouse || "").trim().toUpperCase() || "MAIN",
      qty: String(Math.abs(Number(it.declared_qty || 0))),
      unit: it.declared_unit,
      ref_type: "IMPORT_RECEIPT",
      ref_id: import_receipt_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `Import IN: ${import_doc_id}`,
    };
    await createRecord("inventory_movement", mv);

    const receiptItem = {
      import_receipt_item_id: `IRI-${import_receipt_id}-${String(idx+1).padStart(3,"0")}`,
      import_receipt_id,
      import_item_id,
      product_id: it.product_id,
      received_qty: String(it.declared_qty),
      unit: it.declared_unit,
      lot_id,
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    };

    await createRecord("import_receipt_item", receiptItem);
  }

  // 狀態同步：只要有未作廢收貨單 → 報單狀態寫回 CLOSED
  await updateRecord("import_document","import_doc_id",import_doc_id,{
    status: "CLOSED",
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  });

  showToast("收貨單建立成功，已產生批次（PENDING）");
  resetImportReceiptForm();
}

async function renderImportDocuments(list=null){
  const tbody = document.getElementById("importTableBody");
  if(!tbody) return;

  let listResolved = list;
  if(!listResolved){
    setTbodyLoading_(tbody, 8);
    listResolved = await getAll("import_document");
    importDocumentsCache = listResolved;
  } else {
    importDocumentsCache = listResolved;
  }

  const listToShow = Array.isArray(listResolved) ? listResolved : [];
  const supMap = {};
  (importSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });
  tbody.innerHTML = "";
  if (!listToShow.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:24px;">尚無進口報單。請先至「產品」「供應商」建立主檔，再在上方建立報單。</td></tr>';
    return;
  }
  listToShow.forEach(doc => {
    const s = supMap[doc.supplier_id] || null;
    const supplierNameOnly = (s && s.supplier_name) ? s.supplier_name : (doc.supplier_id || "");
    const btn = `
      <button class="btn-edit" onclick="loadImportDocument('${doc.import_doc_id}')">Load</button>
      <button class="btn-secondary" onclick="gotoReceive('IMPORT','${doc.import_doc_id}')">收貨</button>
    `;
    const docLink = doc.document_link || "";
    const linkCell = docLink ? `<a href="${docLink}" target="_blank" rel="noopener">文件</a>` : "";
    tbody.innerHTML += `
      <tr>
        <td>${doc.import_doc_id || ""}</td>
        <td>${doc.import_no || ""}</td>
        <td>${doc.import_date || ""}</td>
        <td>${doc.release_date || ""}</td>
        <td>${supplierNameOnly}</td>
        <td>${termLabelZhOnly(doc.status)}</td>
        <td>${linkCell}</td>
        <td>${btn}</td>
      </tr>
    `;
  });
}

async function sortImportDocuments(field){
  const list = await getAll("import_document");
  const sorted = applySorting(list, field, importSort);
  renderImportDocuments(sorted);
}

async function searchImportDocuments(){
  setTbodyLoading_("importTableBody", 8);
  const kw = (document.getElementById("search_import_keyword")?.value || "").trim().toLowerCase();
  const status = document.getElementById("search_import_status")?.value || "";

  const list = await getAll("import_document");
  const supMap = {};
  (importSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });
  const result = list.filter(d => {
    const s = supMap[d.supplier_id] || null;
    const supName = String(s?.supplier_name || "").toLowerCase();
    const matchKw = !kw ||
      (d.import_doc_id || "").toLowerCase().includes(kw) ||
      (d.import_no || "").toLowerCase().includes(kw) ||
      (d.declaration_no || "").toLowerCase().includes(kw) ||
      (d.supplier_id || "").toLowerCase().includes(kw) ||
      (supName && supName.includes(kw));
    return matchKw && (!status || d.status === status);
  });
  renderImportDocuments(result);
}

async function resetImportSearch(){
  const a = document.getElementById("search_import_keyword");
  const b = document.getElementById("search_import_status");
  if(a) a.value = "";
  if(b) b.value = "";
  await renderImportDocuments();
}