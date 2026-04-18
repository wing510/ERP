/*********************************
 * Purchase Orders Module v2 (API 版)
 * STEP 1：PO 不產生庫存
 *********************************/

let poEditing = false;
let poItemsDraft = [];
let poProducts = [];
let poSuppliers = [];
let purchaseSort = { field:"", asc:true };
let poReadOnly = false;
let poSelectedDbItemId_ = "";
let poLoadedSnapshot_ = ""; // 用於判斷「是否有變更」

const PO_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30
};

function bindUppercaseIdInput(elementId){
  const el = document.getElementById(elementId);
  if(!el) return;
  if(el.dataset.uppercaseBound) return;
  el.dataset.uppercaseBound = "1";

  el.addEventListener("input", () => {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const upper = (el.value || "").toUpperCase();
    if(el.value !== upper){
      el.value = upper;
      if(start != null && end != null){
        el.setSelectionRange(start, end);
      }
    }
  });
}

async function purchaseInit(){
  bindUppercaseIdInput("po_id");
  await initPurchaseDropdowns();
  resetPOForm();
  syncPOItemUnitSuffix_();
  setPOReceiptState_("收貨狀態：未載入 — 請先載入採購單", "warn");
  // 主檔變更時，更新「更新」按鈕可用性
  ["po_supplier_id","po_order_date","po_expected_arrival_date","po_document_link","po_remark"].forEach(function(id){
    const el = document.getElementById(id);
    if(!el || el.dataset.poDirtyBound) return;
    el.dataset.poDirtyBound = "1";
    el.addEventListener("input", updatePOUpdateBtnState_);
    el.addEventListener("change", updatePOUpdateBtnState_);
  });
  bindAutoSearchToolbar_([
    ["search_po_keyword", "input"],
    ["search_po_status", "change"]
  ], () => searchPurchaseOrders());
  await renderPurchaseOrders();
}

function setPOReceiptState_(text, type = ""){
  const el = document.getElementById("poReceiptState");
  if(!el) return;
  el.textContent = text;
  el.style.color =
    type === "ok" ? "#166534" :
    type === "warn" ? "#92400e" :
    type === "error" ? "#991b1b" :
    "#64748b";
}

function updatePOFlowHint_(){
  const el = document.getElementById("poFlowHint");
  if(!el) return;
  if(poEditing && poReadOnly){
    el.textContent = "採購流程：已載入 — 已有收貨紀錄（僅可檢視）";
    return;
  }
  if(poEditing){
    el.textContent =
      "採購流程：已載入 — 狀態由系統依收貨明細自動維護（OPEN／PARTIAL／CLOSED）";
    return;
  }
  el.textContent = "採購流程：新單 — 填主檔與明細後按下方「建立」開單";
}

function setPOReadOnly_(readOnly){
  poReadOnly = !!readOnly;
  const createBtn = document.getElementById("po_create_btn");
  const updateBtn = document.getElementById("po_update_btn");
  const addBtn = document.getElementById("po_add_item_btn");
  const itemsSaveBtn = document.getElementById("po_items_save_btn");
  if(createBtn) createBtn.disabled = poReadOnly || poEditing;
  if(updateBtn) updateBtn.disabled = poReadOnly || !poEditing;
  if(addBtn) addBtn.disabled = poReadOnly;
  if(itemsSaveBtn) itemsSaveBtn.disabled = poReadOnly || !poEditing;
  if(itemsSaveBtn && (poReadOnly || !poEditing)){
    itemsSaveBtn.title = poReadOnly ? "已有收貨紀錄（僅可檢視）" : "請先載入採購單";
  }
  updatePOFlowHint_();
  updatePOUpdateBtnState_();
}

function formatPOProductDisplay_(productId, productName, productSpec){
  const id = String(productId || "").trim();
  const name = String(productName || id || "").trim();
  const spec = String(productSpec || "").trim();
  if(!name && !id) return "";
  // 對齊其他模組：產品名稱（規格）；不把 product_id 混在同一段顯示字串
  if(spec) return `${name}（${spec}）`;
  return name || id;
}

function poBuildSnapshot_(){
  const po_id = (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  const supplier_id = (document.getElementById("po_supplier_id")?.value || "").trim();
  const order_date = document.getElementById("po_order_date")?.value || "";
  const expected_arrival_date = document.getElementById("po_expected_arrival_date")?.value || "";
  const document_link = (document.getElementById("po_document_link")?.value || "").trim();
  const remark = (document.getElementById("po_remark")?.value || "").trim();
  const header = { po_id, supplier_id, order_date, expected_arrival_date, document_link, remark };
  const items = (poItemsDraft || []).map(it => ({
    product_id: it.product_id,
    order_qty: Number(it.order_qty || 0),
    unit: it.unit || "",
    remark: it.remark || ""
  }));
  // 以顯示順序做穩定比較
  return JSON.stringify({ header, items });
}

function updatePOUpdateBtnState_(){
  const updateBtn = document.getElementById("po_update_btn");
  if(!updateBtn) return;
  if(!poEditing){
    updateBtn.disabled = true;
    updateBtn.title = "請先載入採購單";
    // 明細區的更新按鈕也同步提示
    const itemsSaveBtn = document.getElementById("po_items_save_btn");
    if(itemsSaveBtn){
      itemsSaveBtn.disabled = true;
      itemsSaveBtn.title = "請先載入採購單";
    }
    return;
  }
  if(poReadOnly){
    updateBtn.disabled = true;
    updateBtn.title = "已有收貨紀錄（僅可檢視）";
    const itemsSaveBtn = document.getElementById("po_items_save_btn");
    if(itemsSaveBtn){
      itemsSaveBtn.disabled = true;
      itemsSaveBtn.title = "已有收貨紀錄（僅可檢視）";
    }
    return;
  }
  const cur = poBuildSnapshot_();
  const dirty = !!cur && cur !== poLoadedSnapshot_;
  updateBtn.disabled = !dirty;
  updateBtn.title = dirty ? "更新此採購單" : "沒有變更，不需要更新";
  const itemsSaveBtn = document.getElementById("po_items_save_btn");
  if(itemsSaveBtn){
    itemsSaveBtn.disabled = !dirty;
    itemsSaveBtn.title = dirty ? "更新此採購單" : "沒有變更，不需要更新";
  }
}

async function hasPOReceipts_(poId){
  const id = String(poId || "").trim();
  if(!id) return false;
  const [items, grs] = await Promise.all([
    getAll("goods_receipt_item").catch(()=>[]),
    getAll("goods_receipt").catch(()=>[])
  ]);
  const cancelledGr = new Set(
    (grs || [])
      .filter(
        g =>
          String(g.po_id || "") === id && String(g.status || "").toUpperCase() === "CANCELLED"
      )
      .map(g => g.gr_id)
  );
  return (items || []).some(
    r => r.po_id === id && r.gr_id && !cancelledGr.has(r.gr_id)
  );
}

async function initPurchaseDropdowns(){
  const supplierSelect = document.getElementById("po_supplier_id");
  const productSelect = document.getElementById("po_item_product_id");

  const [suppliersRaw, productsRaw] = await Promise.all([
    getAll("supplier"),
    getAll("product")
  ]);
  const suppliers = (suppliersRaw || [])
    .filter(s => s.status === "ACTIVE")
    .filter(s => {
      const flows = String(s.supplier_flow || "").toUpperCase();
      // 未填 flow 視為可用（避免舊資料突然消失）
      return !flows || flows.split(",").map(x=>x.trim()).includes("PO");
    });
  const products = (productsRaw || []).filter(p => p.status === "ACTIVE");
  poProducts = products;
  poSuppliers = suppliers;

  if(supplierSelect){
    supplierSelect.innerHTML =
      `<option value="">請選擇</option>` +
      suppliers.map(s=>{
        const name = String(s.supplier_name || "").trim();
        const label = name || s.supplier_id;
        return `<option value="${s.supplier_id}">${label}</option>`;
      }).join("");
  }

  if(productSelect){
    productSelect.innerHTML =
      `<option value="">請選擇</option>` +
      products.map(p=>{
        const name = String(p.product_name || "").trim();
        const spec = String(p.spec || "").trim();
        const label = spec ? `${name}（${spec}）` : (name || (p.product_id || ""));
        return `<option value="${p.product_id}" data-unit="${p.unit}" data-spec="${(p.spec || "").replace(/"/g, "&quot;")}">${label}</option>`;
      }).join("");
  }
}

function syncPOItemUnitSuffix_(){
  syncErpQtyUnitSuffix_("po_item_unit", "po_item_unit_suffix");
}

function onSelectPOItemProduct(){
  const productSelect = document.getElementById("po_item_product_id");
  const unitEl = document.getElementById("po_item_unit");
  if(!productSelect || !unitEl) return;
  const opt = productSelect.selectedOptions?.[0];
  if(!opt || !String(productSelect.value || "").trim()){
    unitEl.value = "";
    syncPOItemUnitSuffix_();
    return;
  }
  unitEl.value = opt.getAttribute("data-unit") || "";
  syncPOItemUnitSuffix_();
}

function isPOItemDraftRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 與銷售明細對齊：草稿＋依已收／訂購量 */
function formatPOItemLineStatus_(it){
  if(isPOItemDraftRow_(it)) return "草稿";
  const oq = Number(it.order_qty || 0);
  const rq = Number(it.received_qty || 0);
  if(oq <= 0) return "已存檔";
  if(rq <= 0) return "未收貨";
  if(rq + 1e-9 >= oq) return "已收畢";
  return "部分收貨";
}

function selectPOItemDbRow_(poItemId){
  const id = String(poItemId || "");
  const it = poItemsDraft.find(x => x.draft_id === id);
  if(!it) return;
  poSelectedDbItemId_ = id;
  const productSelect = document.getElementById("po_item_product_id");
  if(productSelect) productSelect.value = it.product_id || "";
  onSelectPOItemProduct();
  const qtyEl = document.getElementById("po_item_order_qty");
  if(qtyEl) qtyEl.value = String(it.order_qty ?? "");
  const rmEl = document.getElementById("po_item_remark");
  if(rmEl) rmEl.value = String(it.remark || "");
  showToast("已帶入明細（僅改備註請按「更新本筆備註」）");
}

async function updateSelectedPOItemRemark(triggerEl){
  if(!poEditing) return showToast("請先載入一張採購單", "error");
  if(poReadOnly) return showToast("此採購單已有收貨紀錄，整張採購單不可修改。", "error");
  const pid = String(poSelectedDbItemId_ || "").trim();
  if(!pid || pid.startsWith("DRAFT-")){
    return showToast("請先點選一筆已存檔的明細列（非草稿列）", "error");
  }
  const remark = (document.getElementById("po_item_remark")?.value || "").trim();

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try{
    await updateRecord("purchase_order_item", "po_item_id", pid, {
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    const row = poItemsDraft.find(x => x.draft_id === pid);
    if(row) row.remark = remark;
    renderPOItemsDraft();
    showToast("採購品項備註已更新");
  }finally{
    hideSaveHint();
    setPOReadOnly_(poReadOnly);
  }
}

function addPOItemDraft(){
  if(poReadOnly){
    return showToast("此採購單已有收貨紀錄，整張採購單不可修改。", "error");
  }
  const productSelect = document.getElementById("po_item_product_id");
  const productId = productSelect?.value || "";
  const qty = Number(document.getElementById("po_item_order_qty")?.value || 0);
  const unit = document.getElementById("po_item_unit")?.value || "";
  const remark = (document.getElementById("po_item_remark")?.value || "").trim();

  if(!productId) return showToast("請選擇產品","error");
  if(!qty || qty <= 0) return showToast("訂購數量需大於 0","error");
  if(!unit) return showToast("找不到產品單位，請先確認產品主檔","error");

  const draftId = "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000);
  const pRow = poProducts.find(x => x.product_id === productId) || {};
  const productName = String(pRow.product_name || "").trim() || productId;
  const productSpec = String(pRow.spec || "").trim();

  poItemsDraft.push({
    draft_id: draftId,
    product_id: productId,
    product_name: productName,
    product_spec: productSpec,
    order_qty: qty,
    received_qty: 0,
    unit,
    remark
  });

  // 清空明細輸入
  poSelectedDbItemId_ = "";
  document.getElementById("po_item_product_id").value = "";
  document.getElementById("po_item_order_qty").value = "";
  document.getElementById("po_item_unit").value = "";
  syncPOItemUnitSuffix_();
  document.getElementById("po_item_remark").value = "";

  renderPOItemsDraft();
  updatePOUpdateBtnState_();
}

function removePOItemDraft(draftId){
  if(poReadOnly){
    return showToast("此採購單已有收貨紀錄，整張採購單不可修改。", "error");
  }
  if(String(poSelectedDbItemId_) === String(draftId)) poSelectedDbItemId_ = "";
  poItemsDraft = poItemsDraft.filter(it => it.draft_id !== draftId);
  renderPOItemsDraft();
  updatePOUpdateBtnState_();
}

function renderPOItemsDraft(){
  const tbody = document.getElementById("poItemsBody");
  if(!tbody) return;

  tbody.innerHTML = "";
  poItemsDraft.forEach((it, idx) => {
    const p = poProducts.find(x => x.product_id === it.product_id) || {};
    const display = formatPOProductDisplay_(
      it.product_id,
      it.product_name || p.product_name || it.product_id,
      it.product_spec || p.spec || ""
    );
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const rowClick =
      poReadOnly || isPOItemDraftRow_(it) ? "" : `onclick="selectPOItemDbRow_('${safeId}')"`;
    const u = String(it.unit || "").trim();
    const qtyUnitHtml = u ? `${it.order_qty} ${u.replace(/</g, "")}` : String(it.order_qty);
    tbody.innerHTML += `
      <tr style="${rowClick ? "cursor:pointer;" : ""}" ${rowClick}>
        <td>${idx+1}</td>
        <td title="${String(display).replace(/"/g, "&quot;")}">${display}</td>
        <td>${qtyUnitHtml}</td>
        <td>${formatPOItemLineStatus_(it)}</td>
        <td><button class="btn-secondary" ${poReadOnly ? "disabled" : ""} onclick="event.stopPropagation(); removePOItemDraft('${safeId}')">刪除</button></td>
      </tr>
    `;
  });
  updatePOUpdateBtnState_();
}

function resetPOForm(){
  poEditing = false;
  setPOReadOnly_(false);
  poSelectedDbItemId_ = "";
  poItemsDraft = [];
  renderPOItemsDraft();

  const poIdEl = document.getElementById("po_id");
  if(poIdEl){
    poIdEl.value = generateId("PO");
    poIdEl.disabled = false;
  }

  const supplierEl = document.getElementById("po_supplier_id");
  if(supplierEl) supplierEl.value = "";

  const orderDateEl = document.getElementById("po_order_date");
  // 下單日期：改為 date（不含時間）
  if(orderDateEl){
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    orderDateEl.value = `${yyyy}-${mm}-${dd}`;
  }

  const expectedEl = document.getElementById("po_expected_arrival_date");
  if(expectedEl) expectedEl.value = "";

  // po_status 已移除（狀態由系統維護）

  const remarkEl = document.getElementById("po_remark");
  if(remarkEl) remarkEl.value = "";
  const docLinkEl = document.getElementById("po_document_link");
  if(docLinkEl) docLinkEl.value = "";
  setPOReceiptState_("收貨狀態：未載入 — 請先載入採購單", "warn");
  updatePOFlowHint_();
  const cancelBtn = document.getElementById("po_cancel_btn");
  if(cancelBtn){
    cancelBtn.disabled = true;
    cancelBtn.title = "請先載入採購單";
  }
  poLoadedSnapshot_ = poBuildSnapshot_();
  updatePOUpdateBtnState_();
}

async function createPurchaseOrder(triggerEl){
  if(poReadOnly) return showToast("此採購單已有收貨紀錄，整張採購單不可修改。", "error");
  const poIdEl = document.getElementById("po_id");
  const po_id = (poIdEl?.value || "").trim().toUpperCase();
  if(poIdEl) poIdEl.value = po_id;

  const supplier_id = (document.getElementById("po_supplier_id")?.value || "").trim();
  const order_date = document.getElementById("po_order_date")?.value || "";
  const expected_arrival_date = document.getElementById("po_expected_arrival_date")?.value || "";
  const status = "OPEN"; // 狀態由系統依收貨單自動維護
  const document_link = (document.getElementById("po_document_link")?.value || "").trim();
  const remark = (document.getElementById("po_remark")?.value || "").trim();

  if(!po_id) return showToast("採購單號必填","error");
  if(po_id.length > PO_RULES.idMax) return showToast("採購單號過長（最多 30 字元）","error");
  if(!PO_RULES.idRegex.test(po_id)) return showToast("採購單號只能使用 A-Z 0-9 _ -","error");
  if(!supplier_id) return showToast("請選擇供應商","error");
  if(!order_date) return showToast("請填寫下單日期","error");
  if(poItemsDraft.length === 0) return showToast("請至少新增 1 筆品項","error");

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try {
  // 檢查 PO 是否已存在
  const existing = await getOne("purchase_order", "po_id", po_id).catch(()=>null);
  if(existing) return showToast("採購單號已存在","error");

  const header = {
    po_id,
    supplier_id,
    order_date,
    expected_arrival_date,
    status,
    document_link,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };

  await createRecord("purchase_order", header);

  // 寫入明細
  for (let idx = 0; idx < poItemsDraft.length; idx++) {
    const it = poItemsDraft[idx];
    const po_item_id = `POI-${po_id}-${String(idx+1).padStart(3,"0")}`;

    const item = {
      po_item_id,
      po_id,
      product_id: it.product_id,
      order_qty: String(it.order_qty),
      received_qty: "0",
      unit: it.unit,
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    };

    await createRecord("purchase_order_item", item);
  }

  await renderPurchaseOrders();
  resetPOForm();
  showToast("採購單建立成功");
  } finally { hideSaveHint(); }
}

async function loadPurchaseOrder(poId){
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  setPOReceiptState_("收貨狀態：檢查中…", "warn");
  const header = await getOne("purchase_order", "po_id", poId);
  if(!header) return showToast("找不到採購單","error");

  poEditing = true;
  poSelectedDbItemId_ = "";

  const poIdEl = document.getElementById("po_id");
  poIdEl.value = header.po_id;
  poIdEl.disabled = true;

  document.getElementById("po_supplier_id").value = header.supplier_id || "";
  document.getElementById("po_order_date").value = header.order_date || "";
  document.getElementById("po_expected_arrival_date").value = header.expected_arrival_date || "";
  // po_status 已移除（狀態由系統維護）
  document.getElementById("po_remark").value = header.remark || "";

  // 載入明細（產品名稱由 poProducts 在 render 時解析）
  const allItems = await getAll("purchase_order_item");
  const items = allItems.filter(it => it.po_id === poId);
  poItemsDraft = items.map(it => ({
    draft_id: it.po_item_id,
    product_id: it.product_id,
    product_name: (poProducts.find(p => p.product_id === it.product_id) || {}).product_name || "",
    product_spec: (poProducts.find(p => p.product_id === it.product_id) || {}).spec || "",
    order_qty: Number(it.order_qty || 0),
    received_qty: Number(it.received_qty || 0),
    unit: it.unit || "",
    remark: it.remark || ""
  }));

  const locked = await hasPOReceipts_(poId);
  setPOReadOnly_(locked);
  const cancelBtn = document.getElementById("po_cancel_btn");
  if(cancelBtn){
    const hs = String(header.status || "").toUpperCase();
    if(hs === "CANCELLED"){
      cancelBtn.disabled = true;
      cancelBtn.title = "此採購單已作廢";
    }else if(locked){
      cancelBtn.disabled = true;
      cancelBtn.title = "此採購單已有未作廢收貨單，請先作廢所有收貨單";
    }else{
      cancelBtn.disabled = false;
      cancelBtn.title = "作廢此採購單（需先無有效收貨單）";
    }
  }
  setPOReceiptState_(
    locked ? "收貨狀態：已載入 — 已收貨（僅可檢視）" : "收貨狀態：已載入 — 未收貨（可編輯）",
    locked ? "error" : "ok"
  );
  if(locked){
    showToast("此採購單已有收貨紀錄，整張採購單不可修改。", "error");
  }

  renderPOItemsDraft();
  poLoadedSnapshot_ = poBuildSnapshot_();
  updatePOUpdateBtnState_();
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
}

async function updatePurchaseOrder(triggerEl){
  if(poReadOnly) return showToast("此採購單已有收貨紀錄，整張採購單不可修改。", "error");
  if(!poEditing) return showToast("請先載入一張採購單再更新","error");

  const po_id = (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  const supplier_id = (document.getElementById("po_supplier_id")?.value || "").trim();
  const order_date = document.getElementById("po_order_date")?.value || "";
  const expected_arrival_date = document.getElementById("po_expected_arrival_date")?.value || "";
  const document_link = (document.getElementById("po_document_link")?.value || "").trim();
  const remark = (document.getElementById("po_remark")?.value || "").trim();

  if(!po_id) return showToast("採購單號必填","error");
  if(!supplier_id) return showToast("請選擇供應商","error");
  if(!order_date) return showToast("請填寫下單日期","error");
  if(poItemsDraft.length === 0) return showToast("請至少保留 1 筆品項","error");

  // 狀態為 CLOSED/CANCELLED 的採購單不允許再修改
  const header = await getOne("purchase_order","po_id",po_id).catch(()=>null);
  if(header){
    const hs = String(header.status || "").toUpperCase();
    if(hs === "CLOSED") return showToast("此採購單已結案 (CLOSED)，不可再修改。", "error");
    if(hs === "CANCELLED") return showToast("此採購單已取消 (CANCELLED)，不可再修改。", "error");
  }

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try {
  const newData = {
    supplier_id,
    order_date,
    expected_arrival_date,
    // 狀態由系統依收貨單自動維護；此處維持原值
    status: header?.status || "OPEN",
    document_link,
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  };

  await updateRecord("purchase_order", "po_id", po_id, newData);

  // 明細更新策略（完整版保護）：若仍有有效（未作廢）收貨紀錄，禁止重建明細（避免破壞追溯）
  const hasReceipt = await hasPOReceipts_(po_id);

  if(hasReceipt){
    showToast("此採購單已有收貨紀錄，已更新主檔但不允許重建明細。", "error");
    await renderPurchaseOrders();
    return;
  }

  // 若尚未收貨：允許刪除舊明細後重建（維持操作簡單）
  const allItems = await getAll("purchase_order_item");
  const items = allItems.filter(it => it.po_id === po_id);
  for(const it of items){
    await deleteRecord("purchase_order_item", "po_item_id", it.po_item_id);
  }

  for (let idx = 0; idx < poItemsDraft.length; idx++) {
    const it = poItemsDraft[idx];
    const po_item_id = `POI-${po_id}-${String(idx+1).padStart(3,"0")}`;

    const item = {
      po_item_id,
      po_id,
      product_id: it.product_id,
      order_qty: String(it.order_qty),
      received_qty: "0",
      unit: it.unit,
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    };
    await createRecord("purchase_order_item", item);
  }

  await renderPurchaseOrders();
  showToast("採購單更新成功");
  poLoadedSnapshot_ = poBuildSnapshot_();
  updatePOUpdateBtnState_();
  } finally { hideSaveHint(); }
}

async function renderPurchaseOrders(list=null){
  const tbody = document.getElementById("poTableBody");
  if(!tbody) return;

  let listResolved = list;
  if(listResolved == null){
    setTbodyLoading_(tbody, 7);
    listResolved = await getAll("purchase_order");
  }

  tbody.innerHTML = "";
  if (!listResolved.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">尚無採購單。請先至「產品」「供應商」建立主檔，再在此建立採購單。</td></tr>';
    return;
  }
  const supMap = {};
  (poSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });

  listResolved.forEach(po => {
    const sid = po.supplier_id || "";
    const s = supMap[sid] || null;
    const supplierNameOnly = (s && s.supplier_name) ? s.supplier_name : sid;
    const btn = `
      <button class="btn-edit" onclick="loadPurchaseOrder('${po.po_id}')">Load</button>
      <button class="btn-secondary" onclick="gotoReceive('PO','${po.po_id}')">收貨</button>
    `;
    const docLink = String(po.document_link || "").trim();
    const linkCell = docLink
      ? `<a href="${docLink.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">連結</a>`
      : "";
    tbody.innerHTML += `
      <tr>
        <td>${po.po_id}</td>
        <td>${supplierNameOnly}</td>
        <td>${po.order_date || ""}</td>
        <td>${po.expected_arrival_date || ""}</td>
        <td>${termLabelZhOnly(po.status)}</td>
        <td>${linkCell}</td>
        <td>${btn}</td>
      </tr>
    `;
  });
}

async function sortPurchaseOrders(field){
  setTbodyLoading_("poTableBody", 7);
  const list = await getAll("purchase_order");
  const sorted = applySorting(list, field, purchaseSort);
  renderPurchaseOrders(sorted);
}

async function searchPurchaseOrders(){
  setTbodyLoading_("poTableBody", 7);
  const kw = (document.getElementById("search_po_keyword")?.value || "").trim().toLowerCase();
  const status = document.getElementById("search_po_status")?.value || "";

  const list = await getAll("purchase_order");
  const supMap = {};
  (poSuppliers || []).forEach(s => { if(s && s.supplier_id) supMap[s.supplier_id] = s; });
  const result = list.filter(po => {
    const s = supMap[po.supplier_id] || null;
    const supName = String(s?.supplier_name || "").toLowerCase();
    const matchKw = !kw ||
      (po.po_id || "").toLowerCase().includes(kw) ||
      (po.supplier_id || "").toLowerCase().includes(kw) ||
      (supName && supName.includes(kw));
    return matchKw && (!status || po.status === status);
  });
  renderPurchaseOrders(result);
}

async function cancelPurchaseOrder(triggerEl){
  if(!poEditing) return showToast("請先載入一張採購單再作廢","error");
  const po_id = (document.getElementById("po_id")?.value || "").trim().toUpperCase();
  if(!po_id) return showToast("採購單號缺失","error");

  showSaveHint(triggerEl || document.getElementById("poItemsCommitGroup"));
  try{
    const header = await getOne("purchase_order","po_id",po_id).catch(()=>null);
    if(!header) return showToast("找不到採購單","error");
    const st = String(header.status || "").toUpperCase();
    if(st === "CANCELLED") return showToast("此採購單已作廢","error");

    const hasReceipt = await hasPOReceipts_(po_id);
    if(hasReceipt){
      return showToast("此採購單已有未作廢收貨紀錄，請先至「收貨入庫」作廢所有收貨單後再作廢採購單。","error");
    }

    const note = prompt("作廢原因（可留空）") ?? "";
    if(!confirm(`確定作廢此採購單？\n- PO：${po_id}\n\n限制：需先作廢所有收貨單。`)) return;

    await callAPI(
      {
        action: "cancel_purchase_order_bundle",
        po_id,
        cancel_note: String(note || "").trim(),
        updated_by: getCurrentUser()
      },
      { method: "POST" }
    );

    if(typeof invalidateCache === "function") invalidateCache("purchase_order");
    await renderPurchaseOrders();
    await loadPurchaseOrder(po_id);
    showToast("採購單已作廢（CANCELLED）");
  } finally {
    hideSaveHint();
  }
}

async function resetPurchaseSearch(){
  const a = document.getElementById("search_po_keyword");
  const b = document.getElementById("search_po_status");
  if(a) a.value = "";
  if(b) b.value = "";
  await renderPurchaseOrders();
}