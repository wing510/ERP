/**
 * Sales Orders（API 版）
 * - 建單不扣庫；出貨由 Shipment 模組扣庫
 */

let soEditing = false;
let soItemsDraft = [];
let soProducts = [];
let soCustomers = [];
let soUsers = [];
/** 主檔狀態由系統維護（出貨 bundle 回寫），前端僅顯示與鎖定用 */
let soLoadedStatus_ = "OPEN";
/** 委外同款：由「編輯」帶回表單後，再按「新增品項」重新加入（新 draft_id）；已出貨量暫存於此 */
let soEditingShippedQtyHold = 0;
/** 點選已存檔列（so_item_id）供「更新本筆備註」 */
let soSelectedDbItemId_ = "";

async function hasSOShipments_(soId){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return false;
  // 只要有「未作廢」出貨單（不論 POSTED/OPEN），就視為已有出貨紀錄
  try{
    const r = await callAPI({ action: "list_shipment_by_so", so_id: id }, { method: "GET" });
    const ships = (r && r.data) ? r.data : [];
    return (ships || []).some(s => String(s?.status || "").toUpperCase() !== "CANCELLED");
  }catch(_e){
    const all = await getAll("shipment").catch(()=>[]);
    return (all || [])
      .filter(s => String(s?.so_id || "").trim().toUpperCase() === id)
      .some(s => String(s?.status || "").toUpperCase() !== "CANCELLED");
  }
}

function isSOFormLocked_(){
  if(!soEditing) return false;
  const st = String(soLoadedStatus_ || "OPEN").trim().toUpperCase();
  return st === "SHIPPED" || st === "CANCELLED";
}

function updateSOStatusHint_(){
  const el = document.getElementById("soStatusHint");
  const shipEl = document.getElementById("soShipState");
  if(!el) return;
  if(soEditing){
    const st = String(soLoadedStatus_ || "OPEN").trim().toUpperCase();
    const label = typeof termLabel === "function" ? termLabel(st) : st;
    if(shipEl){
      // 銷售狀態本身就有 OPEN/PARTIAL/SHIPPED，這裡用白話再提示一次「出貨面向」
      shipEl.textContent =
        st === "SHIPPED" ? "出貨狀態：已載入 — 已出畢（僅可檢視）" :
        st === "PARTIAL" ? "出貨狀態：已載入 — 部分出貨（可編輯）" :
        "出貨狀態：已載入 — 未出貨（可編輯）";
      shipEl.style.color = st === "SHIPPED" ? "#166534" : "#64748b";
    }
    if(isSOFormLocked_()){
      el.textContent = "銷售流程：已載入 — " + (label || st) + "（僅可檢視）";
      return;
    }
    el.textContent =
      "銷售流程：已載入 — " +
      (label || st) +
      " — 變更後按「更新」（主檔區或明細下方皆可，功能相同）";
    return;
  }
  el.textContent = "銷售流程：新單 — 填主檔與明細後按下方「建立」";
  if(shipEl){
    shipEl.textContent = "出貨狀態：未載入 — 請先載入銷售單";
    shipEl.style.color = "#92400e";
  }
}

function setSOButtons_(){
  const locked = isSOFormLocked_();
  const createBtn = document.getElementById("so_create_btn");
  const updateBtn = document.getElementById("so_update_btn");
  const cancelBtn = document.getElementById("so_cancel_btn");
  const addBtn = document.getElementById("so_add_item_btn");
  const itemsSaveBtn = document.getElementById("so_items_save_btn");
  if(createBtn) createBtn.disabled = locked || soEditing;
  if(updateBtn){
    updateBtn.disabled = locked || !soEditing;
    updateBtn.title =
      !soEditing ? "請先載入銷售單" :
      locked ? "此銷售單已結束（SHIPPED/CANCELLED），不可更新" :
      "更新此銷售單";
  }
  if(itemsSaveBtn){
    itemsSaveBtn.disabled = locked || !soEditing;
    // 明細區更新按鈕與主檔更新同一個行為，title 同步
    itemsSaveBtn.title =
      !soEditing ? "請先載入銷售單" :
      locked ? "此銷售單已結束（SHIPPED/CANCELLED），不可更新" :
      "更新此銷售單";
  }
  if(addBtn) addBtn.disabled = locked;
  if(cancelBtn){
    if(!soEditing){
      cancelBtn.disabled = true;
      cancelBtn.title = "請先載入銷售單";
    }else{
      const st = String(soLoadedStatus_ || "OPEN").toUpperCase();
      if(st === "CANCELLED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已作廢";
      }else if(st === "SHIPPED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已出畢（SHIPPED），不可作廢";
      }else{
        // 需等載入時的出貨檢查（loadSalesOrder 會補 title）；這裡先給預設
        cancelBtn.disabled = false;
        cancelBtn.title = "作廢此銷售單（需先無有效出貨單）";
      }
    }
  }
  updateSOStatusHint_();
}

function formatSOProductDisplay_(productId, productName, productSpec){
  const id = String(productId || "").trim();
  const name = String(productName || id || "").trim();
  const spec = String(productSpec || "").trim();
  if(!name && !id) return "";
  // 對齊其他模組規則：產品名稱（規格）；不把 product_id 混在同一段字串裡
  if(spec) return `${name}（${spec}）`;
  return name || id;
}

function soFindProduct_(productId){
  const id = String(productId || "").trim();
  if(!id) return null;
  return (soProducts || []).find(p => String(p.product_id || "").trim() === id) || null;
}

function money2(n){
  const num = Number(n);
  if(Number.isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
}

async function salesInit(){
  await initSalesDropdowns();
  resetSOForm();
  bindAutoSearchToolbar_([
    ["so_search_keyword", "input"],
    ["so_search_status", "change"]
  ], () => renderSalesOrders());
  await renderSalesOrders();
}

async function initSalesDropdowns(){
  const [productsRaw, customersRaw, usersRaw] = await Promise.all([
    getAll("product"),
    getAll("customer"),
    getAll("user").catch(() => [])
  ]);
  soProducts = (productsRaw || []).filter(p => p.status === "ACTIVE");
  soCustomers = (customersRaw || []).filter(c => c.status === "ACTIVE");
  soUsers = usersRaw || [];

  const cSel = document.getElementById("so_customer_id");
  if(cSel){
    cSel.innerHTML =
      `<option value="">請選擇客戶</option>` +
      soCustomers.map(c => {
        const name = String(c.customer_name || "").trim();
        const label = name || c.customer_id;
        return `<option value="${c.customer_id}">${label}</option>`;
      }).join("");
  }

  const pSel = document.getElementById("so_item_product_id");
  if(pSel){
    pSel.innerHTML =
      `<option value="">請選擇產品</option>` +
      soProducts.map(p => {
        const name = String(p.product_name || "").trim();
        const spec = String(p.spec || "").trim();
        const label = formatSOProductDisplay_(p.product_id, name || p.product_id, spec);
        const safeSpec = String(p.spec || "").replace(/"/g, "&quot;");
        return `<option value="${p.product_id}" data-unit="${p.unit}" data-spec="${safeSpec}">${label}</option>`;
      }).join("");
  }

  const spSel = document.getElementById("so_salesperson_id");
  if(spSel){
    const salesUsers = (soUsers || [])
      .filter(u => String(u.status || "").toUpperCase() === "ACTIVE")
      .filter(u => String(u.role || "").toUpperCase() === "SALES");
    salesUsers.sort((a,b)=>String(a.user_id||"").localeCompare(String(b.user_id||"")));
    spSel.innerHTML =
      `<option value="">（未指定）</option>` +
      salesUsers.map(u => {
        const name = String(u.user_name || "").trim();
        const label = name || u.user_id;
        return `<option value="${u.user_id}">${label}</option>`;
      }).join("");
  }
}

function resetSOForm(){
  soEditing = false;
  soItemsDraft = [];
  renderSOItemsDraft();
  soLoadedStatus_ = "OPEN";

  const idEl = document.getElementById("so_id");
  if(idEl){
    idEl.value = generateId("SO");
    idEl.disabled = false;
  }

  const d = document.getElementById("so_order_date");
  if(d) d.value = nowIso16().slice(0, 10);

  const c = document.getElementById("so_customer_id");
  if(c) c.value = "";

  const sp = document.getElementById("so_salesperson_id");
  if(sp) sp.value = "";

  const rm = document.getElementById("so_remark");
  if(rm) rm.value = "";

  clearSOItemEntry();
  setSOButtons_();
}

function clearSOItemEntry(){
  soEditingShippedQtyHold = 0;
  soSelectedDbItemId_ = "";
  const a = document.getElementById("so_item_product_id");
  const b = document.getElementById("so_item_order_qty");
  const c = document.getElementById("so_item_unit");
  const d = document.getElementById("so_item_unit_price");
  const e = document.getElementById("so_item_amount");
  const f = document.getElementById("so_item_remark");
  if(a) a.value = "";
  if(b) b.value = "";
  if(c) c.value = "";
  if(d) d.value = "";
  if(e) e.value = "0.00";
  if(f) f.value = "";
}

function isSOItemDraftRow_(it){
  return String(it?.draft_id || "").startsWith("DRAFT-");
}

/** 明細列表「狀態」欄：對齊投料表（草稿／已送加工）概念 */
function formatSOItemLineStatus_(it){
  if(isSOItemDraftRow_(it)) return "草稿";
  const oq = Number(it.order_qty || 0);
  const sq = Number(it.shipped_qty || 0);
  if(oq <= 0) return "已存檔";
  if(sq <= 0) return "未出貨";
  if(sq + 1e-9 >= oq) return "已出畢";
  return "部分出貨";
}

function selectSOItemDbRow_(soItemId){
  const id = String(soItemId || "");
  const it = soItemsDraft.find(x => x.draft_id === id);
  if(!it) return;
  soSelectedDbItemId_ = id;
  const sel = document.getElementById("so_item_product_id");
  if(sel) sel.value = it.product_id || "";
  onSelectSOProduct();
  const qtyEl = document.getElementById("so_item_order_qty");
  if(qtyEl) qtyEl.value = String(it.order_qty ?? "");
  const priceEl = document.getElementById("so_item_unit_price");
  if(priceEl) priceEl.value = String(it.unit_price ?? "");
  calcSOAmount();
  const rm = document.getElementById("so_item_remark");
  if(rm) rm.value = String(it.remark || "");
  showToast("已帶入明細（僅改備註可用「更新本筆備註」；改數量／產品請用「編輯」）");
}

async function updateSelectedSOItemRemark(triggerEl){
  if(!soEditing) return showToast("請先載入銷售單", "error");
  if(isSOFormLocked_()){
    return showToast("此銷售單已結束（SHIPPED/CANCELLED），不可再修改。", "error");
  }
  const sid = String(soSelectedDbItemId_ || "").trim();
  if(!sid || sid.startsWith("DRAFT-")){
    return showToast("請先點選一筆已存檔的明細列（非草稿列）", "error");
  }
  const remark = (document.getElementById("so_item_remark")?.value || "").trim();

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try{
    await updateRecord("sales_order_item", "so_item_id", sid, {
      remark,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    const row = soItemsDraft.find(x => x.draft_id === sid);
    if(row) row.remark = remark;
    renderSOItemsDraft();
    showToast("銷售品項備註已更新");
  }finally{
    hideSaveHint();
    setSOButtons_();
  }
}

function beginEditSOItemDraft_(draftId){
  if(isSOFormLocked_()){
    return showToast("此銷售單已結束（SHIPPED/CANCELLED），不可再修改。", "error");
  }
  const id = String(draftId || "");
  const it = soItemsDraft.find(x => x.draft_id === id);
  if(!it) return;

  soSelectedDbItemId_ = "";
  soEditingShippedQtyHold = Number(it.shipped_qty || 0);
  soItemsDraft = soItemsDraft.filter(x => x.draft_id !== id);

  const sel = document.getElementById("so_item_product_id");
  if(sel) sel.value = it.product_id || "";
  onSelectSOProduct();
  const qtyEl = document.getElementById("so_item_order_qty");
  if(qtyEl) qtyEl.value = String(it.order_qty ?? "");
  const priceEl = document.getElementById("so_item_unit_price");
  if(priceEl) priceEl.value = String(it.unit_price ?? "");
  calcSOAmount();
  const rm = document.getElementById("so_item_remark");
  if(rm) rm.value = String(it.remark || "");

  renderSOItemsDraft();
}

function onSelectSOProduct(){
  const sel = document.getElementById("so_item_product_id");
  const opt = sel?.selectedOptions?.[0];
  if(!opt) return;
  document.getElementById("so_item_unit").value = opt.getAttribute("data-unit") || "";
}

function calcSOAmount(){
  const qty = Number(document.getElementById("so_item_order_qty")?.value || 0);
  const price = Number(document.getElementById("so_item_unit_price")?.value || 0);
  const amount = money2(qty * price).toFixed(2);
  const el = document.getElementById("so_item_amount");
  if(el) el.value = amount;
}

function addSOItemDraft(){
  if(isSOFormLocked_()){
    return showToast("此銷售單已結束（SHIPPED/CANCELLED），不可再修改。", "error");
  }
  const sel = document.getElementById("so_item_product_id");
  const product_id = sel?.value || "";
  const order_qty = Number(document.getElementById("so_item_order_qty")?.value || 0);
  const unit = document.getElementById("so_item_unit")?.value || "";
  const unit_price = Number(document.getElementById("so_item_unit_price")?.value || 0);
  const amount = money2(order_qty * unit_price);
  const remark = (document.getElementById("so_item_remark")?.value || "").trim();

  if(!product_id) return showToast("請選擇產品","error");
  if(!order_qty || order_qty <= 0) return showToast("訂購數量需大於 0","error");
  if(!unit) return showToast("產品單位缺失","error");

  const holdShip = Number(soEditingShippedQtyHold || 0);
  if(holdShip > 0 && order_qty + 1e-9 < holdShip){
    return showToast(`訂購數量不可小於已出貨量（${holdShip}）`, "error");
  }

  const opt = sel?.selectedOptions?.[0];
  const p = soFindProduct_(product_id);
  const product_name = String(p?.product_name || product_id || "").trim();
  const product_spec = opt?.getAttribute("data-spec") || "";

  const draft_id = "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000);
  soItemsDraft.push({
    draft_id,
    product_id,
    product_name,
    product_spec,
    order_qty,
    shipped_qty: holdShip,
    unit,
    unit_price: money2(unit_price),
    amount,
    remark
  });

  clearSOItemEntry();
  renderSOItemsDraft();
}

function removeSOItemDraft(draftId){
  if(isSOFormLocked_()){
    return showToast("此銷售單已結束（SHIPPED/CANCELLED），不可再修改。", "error");
  }
  soItemsDraft = soItemsDraft.filter(x => x.draft_id !== draftId);
  renderSOItemsDraft();
}

function renderSOItemsDraft(){
  const tbody = document.getElementById("soItemsBody");
  if(!tbody) return;

  tbody.innerHTML = "";
  const locked = isSOFormLocked_();
  soItemsDraft.forEach((it, idx) => {
    const p = soProducts.find(x => x.product_id === it.product_id) || {};
    const display = formatSOProductDisplay_(
      it.product_id,
      it.product_name || p.product_name || it.product_id,
      it.product_spec || p.spec || ""
    );
    const safeId = String(it.draft_id || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const rowClick = locked
      ? ""
      : isSOItemDraftRow_(it)
        ? `onclick="beginEditSOItemDraft_('${safeId}')"`
        : `onclick="selectSOItemDbRow_('${safeId}')"`;
    const opHtml = locked
      ? "—"
      : `<button type="button" class="btn-secondary" onclick="event.stopPropagation(); beginEditSOItemDraft_('${safeId}')">編輯</button> ` +
        `<button type="button" class="btn-secondary" onclick="event.stopPropagation(); removeSOItemDraft('${safeId}')">刪除</button>`;
    tbody.innerHTML += `
      <tr style="${locked ? "" : "cursor:pointer;"}" ${rowClick}>
        <td>${idx+1}</td>
        <td title="${String(display).replace(/"/g, "&quot;")}">${display}</td>
        <td>${it.order_qty}</td>
        <td>${it.shipped_qty}</td>
        <td>${it.unit}</td>
        <td>${it.unit_price}</td>
        <td>${it.amount.toFixed(2)}</td>
        <td>${formatSOItemLineStatus_(it)}</td>
        <td>${opHtml}</td>
      </tr>
    `;
  });
}

async function createSalesOrder(triggerEl){
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  document.getElementById("so_id").value = so_id;
  const customer_id = document.getElementById("so_customer_id")?.value || "";
  const salesperson_id = document.getElementById("so_salesperson_id")?.value || "";
  const order_date = document.getElementById("so_order_date")?.value || "";
  const status = "OPEN"; // 狀態由系統依出貨自動維護
  const remark = (document.getElementById("so_remark")?.value || "").trim();

  if(!so_id) return showToast("銷售單ID 必填","error");
  if(!customer_id) return showToast("請選擇客戶","error");
  if(!order_date) return showToast("下單日期必填","error");
  if(soItemsDraft.length === 0) return showToast("請至少新增 1 筆品項","error");

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try {
  const exists = await getOne("sales_order","so_id",so_id).catch(()=>null);
  if(exists) return showToast("銷售單ID 已存在","error");

  await createRecord("sales_order", {
    so_id,
    customer_id,
    salesperson_id,
    order_date,
    status,
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  });

  for(let idx=0; idx<soItemsDraft.length; idx++){
    const it = soItemsDraft[idx];
    const so_item_id = `SOI-${so_id}-${String(idx+1).padStart(3,"0")}`;
    await createRecord("sales_order_item", {
      so_item_id,
      so_id,
      product_id: it.product_id,
      order_qty: String(it.order_qty),
      shipped_qty: "0",
      unit: it.unit,
      unit_price: String(it.unit_price),
      amount: it.amount.toFixed(2),
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    });
  }

  await renderSalesOrders();
  resetSOForm();
  showToast("銷售單建立成功");
  } finally {
    hideSaveHint();
    setSOButtons_();
  }
}

async function loadSalesOrder(soId){
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  const so = await getOne("sales_order","so_id",soId);
  if(!so) return;

  soEditing = true;
  soLoadedStatus_ = String(so.status || "OPEN").toUpperCase();
  clearSOItemEntry();
  const idEl = document.getElementById("so_id");
  idEl.value = so.so_id;
  idEl.disabled = true;

  document.getElementById("so_customer_id").value = so.customer_id || "";
  const sp = document.getElementById("so_salesperson_id");
  if(sp) sp.value = so.salesperson_id || "";
  document.getElementById("so_order_date").value = dateInputValue_(so.order_date);
  document.getElementById("so_remark").value = so.remark || "";

  let items = [];
  try{
    const r = await callAPI({ action: "list_sales_order_item_by_so", so_id: soId }, { method: "GET" });
    items = (r && r.data) ? r.data : [];
  }catch(_e){
    items = (await getAll("sales_order_item")).filter(it => it.so_id === soId);
  }
  soItemsDraft = items.map(it => ({
    draft_id: it.so_item_id,
    product_id: it.product_id,
    product_name: (soProducts.find(p => p.product_id === it.product_id) || {}).product_name || "",
    product_spec: (soProducts.find(p => p.product_id === it.product_id) || {}).spec || "",
    order_qty: Number(it.order_qty || 0),
    shipped_qty: Number(it.shipped_qty || 0),
    unit: it.unit || "",
    unit_price: Number(it.unit_price || 0),
    amount: Number(it.amount || 0),
    remark: it.remark || ""
  }));
  renderSOItemsDraft();
  const stLoaded = String(soLoadedStatus_ || "").toUpperCase();
  if(stLoaded === "SHIPPED" || stLoaded === "CANCELLED"){
    showToast("此銷售單已結束，不可再修改。", "error");
  }
  // 作廢按鈕狀態（對齊 PO/進口）：若已有未作廢出貨單，禁止作廢
  try{
    const cancelBtn = document.getElementById("so_cancel_btn");
    if(cancelBtn){
      if(stLoaded === "CANCELLED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已作廢";
      }else if(stLoaded === "SHIPPED"){
        cancelBtn.disabled = true;
        cancelBtn.title = "此銷售單已出畢（SHIPPED），不可作廢";
      }else{
        const hasShip = await hasSOShipments_(soId);
        if(hasShip){
          cancelBtn.disabled = true;
          cancelBtn.title = "此銷售單已有未作廢出貨單，請先作廢所有出貨單";
        }else{
          cancelBtn.disabled = false;
          cancelBtn.title = "作廢此銷售單（需先無有效出貨單）";
        }
      }
    }
  }catch(_e){}
  setSOButtons_();
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
}

async function cancelSalesOrder(triggerEl){
  if(!soEditing) return showToast("請先載入一張銷售單再作廢","error");
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  if(!so_id) return showToast("銷售單ID 缺失","error");

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try{
    const header = await getOne("sales_order","so_id",so_id).catch(()=>null);
    if(!header) return showToast("找不到銷售單","error");
    const st = String(header.status || "").toUpperCase();
    if(st === "CANCELLED") return showToast("此銷售單已作廢","error");
    if(st === "SHIPPED") return showToast("此銷售單已出畢（SHIPPED），不可作廢","error");

    const hasShip = await hasSOShipments_(so_id);
    if(hasShip){
      return showToast("此銷售單已有未作廢出貨單，請先至「出貨管理」作廢所有出貨單後再作廢銷售單。","error");
    }

    const note = prompt("作廢原因（可留空）") ?? "";
    if(!confirm(`確定作廢此銷售單？\n- SO：${so_id}\n\n限制：需先作廢所有出貨單。`)) return;

    await callAPI(
      {
        action: "cancel_sales_order_bundle",
        so_id,
        cancel_note: String(note || "").trim(),
        updated_by: getCurrentUser()
      },
      { method: "POST" }
    );

    soLoadedStatus_ = "CANCELLED";
    if(typeof invalidateCache === "function") invalidateCache("sales_order");
    await renderSalesOrders();
    await loadSalesOrder(so_id);
    showToast("銷售單已作廢（CANCELLED）");
  } finally {
    hideSaveHint();
    setSOButtons_();
  }
}

async function updateSalesOrder(triggerEl){
  if(isSOFormLocked_()){
    return showToast("此銷售單已結束（SHIPPED/CANCELLED），不可再修改。", "error");
  }
  if(!soEditing) return showToast("請先載入銷售單再更新","error");
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  const customer_id = document.getElementById("so_customer_id")?.value || "";
  const salesperson_id = document.getElementById("so_salesperson_id")?.value || "";
  const order_date = document.getElementById("so_order_date")?.value || "";
  const remark = (document.getElementById("so_remark")?.value || "").trim();

  if(!customer_id) return showToast("請選擇客戶","error");
  if(!order_date) return showToast("下單日期必填","error");

   // SHIPPED / CANCELLED 的銷售單不允許再修改
  const header = await getOne("sales_order","so_id",so_id).catch(()=>null);
  const st = String(header?.status || "").toUpperCase();
  if(st === "SHIPPED" || st === "CANCELLED"){
    return showToast("此銷售單已結束 (SHIPPED/CANCELLED)，不可再修改。", "error");
  }

  showSaveHint(triggerEl || document.getElementById("soItemsCommitGroup"));
  try {
  // 若已有出貨紀錄，禁止重建明細（保持追溯一致）
  let hasShip = false;
  try{
    let relatedShipmentIds = [];
    try{
      const rShips = await callAPI({ action: "list_shipment_by_so", so_id: so_id }, { method: "GET" });
      const ships = (rShips && rShips.data) ? rShips.data : [];
      relatedShipmentIds = (ships || []).map(s => String(s.shipment_id || "").trim()).filter(Boolean);
    }catch(_e0){
      // fallback：先用近期出貨（避免全表 shipment），最後才全表
      try{
        const rr = await callAPI({ action: "list_shipment_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
        const recent = (rr && rr.data) ? rr.data : [];
        relatedShipmentIds = (recent || [])
          .filter(s => String(s.so_id || "").toUpperCase() === so_id)
          .map(s => String(s.shipment_id || "").trim())
          .filter(Boolean);
      }catch(_eRecent){
        const allShips = await getAll("shipment").catch(()=>[]);
        relatedShipmentIds = (allShips || [])
          .filter(s => String(s.so_id || "").toUpperCase() === so_id)
          .map(s => String(s.shipment_id || "").trim())
          .filter(Boolean);
      }
    }

    if(relatedShipmentIds.length){
      // 優先一次打包查詢（避免逐單多次 API）
      let anyItems = null;
      try{
        const r = await callAPI({
          action: "list_shipment_item_by_shipments",
          shipment_ids_json: JSON.stringify(relatedShipmentIds)
        }, { method: "POST" });
        const rows = (r && r.data) ? r.data : [];
        anyItems = Array.isArray(rows) ? (rows.length > 0) : false;
      }catch(_ePack){
        anyItems = null;
      }

      if(anyItems === true){
        hasShip = true;
      }else if(anyItems === false){
        hasShip = false;
      }else{
        // fallback：逐單查 shipment_item（避免全表下載）
        const rItems = await Promise.all(relatedShipmentIds.map(async (sid) => {
          try{
            const r = await callAPI({ action: "list_shipment_item_by_shipment", shipment_id: sid });
            return (r && r.data) ? r.data : [];
          }catch(_e){
            return null;
          }
        }));

        hasShip = rItems.some(arr => Array.isArray(arr) && arr.length > 0);
        if(!hasShip && rItems.every(arr => arr === null)){
          const shipments = await getAll("shipment_item").catch(()=>[]);
          hasShip = shipments.some(s => s.so_id === so_id);
        }
      }
    }
  }catch(_e2){
    // 最後兜底：避免直接全表 shipment_item
    try{
      const rShips = await callAPI({ action: "list_shipment_by_so", so_id: so_id }, { method: "GET" });
      const ships = (rShips && rShips.data) ? rShips.data : [];
      const ids = (ships || []).map(s => String(s.shipment_id || "").trim()).filter(Boolean);
      if(ids.length){
        const r = await callAPI({ action: "list_shipment_item_by_shipments", shipment_ids_json: JSON.stringify(ids) }, { method: "POST" });
        const rows = (r && r.data) ? r.data : [];
        hasShip = Array.isArray(rows) && rows.length > 0;
      }else{
        hasShip = false;
      }
    }catch(_e3){
      const shipments = await getAll("shipment_item").catch(()=>[]);
      hasShip = shipments.some(s => s.so_id === so_id);
    }
  }

  await updateRecord("sales_order","so_id",so_id,{
    customer_id,
    salesperson_id,
    order_date,
    // 狀態由系統依出貨單自動維護；此處維持原值
    status: header?.status || "OPEN",
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  });
  soLoadedStatus_ = String(header?.status || "OPEN").toUpperCase();

  if(hasShip){
    showToast("此銷售單已有出貨紀錄，已更新主檔但不允許重建明細。", "error");
    await renderSalesOrders();
    return;
  }

  // 刪除後重建明細（尚未出貨才允許）
  let items = [];
  try{
    const r = await callAPI({ action: "list_sales_order_item_by_so", so_id: so_id }, { method: "GET" });
    items = (r && r.data) ? r.data : [];
  }catch(_e){
    items = (await getAll("sales_order_item")).filter(it => it.so_id === so_id);
  }
  for(const it of items){
    await deleteRecord("sales_order_item","so_item_id",it.so_item_id);
  }
  for(let idx=0; idx<soItemsDraft.length; idx++){
    const it = soItemsDraft[idx];
    const so_item_id = `SOI-${so_id}-${String(idx+1).padStart(3,"0")}`;
    await createRecord("sales_order_item", {
      so_item_id,
      so_id,
      product_id: it.product_id,
      order_qty: String(it.order_qty),
      shipped_qty: "0",
      unit: it.unit,
      unit_price: String(it.unit_price),
      amount: money2(it.amount).toFixed(2),
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    });
  }

  await renderSalesOrders();
  showToast("銷售單更新成功");
  } finally {
    hideSaveHint();
    setSOButtons_();
  }
}

function resetSalesSearch(){
  const a = document.getElementById("so_search_keyword");
  const b = document.getElementById("so_search_status");
  if(a) a.value = "";
  if(b) b.value = "";
  renderSalesOrders();
}

async function renderSalesOrders(){
  const tbody = document.getElementById("soTableBody");
  if(!tbody) return;
  setTbodyLoading_(tbody, 6);
  const qKw = (document.getElementById("so_search_keyword")?.value || "").trim().toUpperCase();
  const qSt = (document.getElementById("so_search_status")?.value || "").trim().toUpperCase();
  let list = [];
  try{
    const r = await callAPI({ action: "list_sales_order_recent", days: 365, _ts: String(Date.now()) }, { method: "POST" });
    list = (r && r.data) ? r.data : [];
  }catch(_e){
    list = await getAll("sales_order").catch(()=>[]);
  }
  const userMap = {};
  (soUsers || []).forEach(u => { if(u && u.user_id) userMap[u.user_id] = u; });
  const customerMap = {};
  (soCustomers || []).forEach(c => { if(c && c.customer_id) customerMap[c.customer_id] = c; });

  const filtered = (list || []).filter(so => {
    const stOk = !qSt || String(so.status || "").toUpperCase() === qSt;
    if(!stOk) return false;
    if(!qKw) return true;
    const sid = String(so.so_id || "").toUpperCase();
    const cid = String(so.customer_id || "").toUpperCase();
    const spid = String(so.salesperson_id || "").toUpperCase();
    const spUser = userMap[so.salesperson_id] || null;
    const spName = String(spUser?.user_name || "").toUpperCase();
    const cn = String(customerMap[so.customer_id]?.customer_name || "").toUpperCase();
    return sid.includes(qKw) || cid.includes(qKw) || (cn && cn.includes(qKw)) || spid.includes(qKw) || (spName && spName.includes(qKw));
  });
  const sorted = [...filtered].sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  tbody.innerHTML = "";
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px;">尚無銷售單。請先至「產品」「客戶」建立主檔，再於銷售單填妥主檔與明細後按明細下方「建立」。</td></tr>';
    return;
  }
  sorted.forEach(so => {
    const sp = userMap[so.salesperson_id] || null;
    const spLabel = so.salesperson_id
      ? (String(sp?.user_name || "").trim() || "—")
      : "";
    const c = customerMap[so.customer_id] || null;
    const customerNameOnly = (c && c.customer_name) ? c.customer_name : (so.customer_id || "");
    tbody.innerHTML += `
      <tr>
        <td>${so.so_id || ""}</td>
        <td>${customerNameOnly}</td>
        <td>${spLabel}</td>
        <td>${termLabel(so.status)}</td>
        <td>${so.created_at || ""}</td>
        <td>
          <button class="btn-edit" onclick="loadSalesOrder('${so.so_id}')">Edit</button>
          <button type="button" class="btn-secondary" onclick="gotoShippingFromSO_('${so.so_id}')">出貨</button>
          <button type="button" class="btn-secondary" onclick="openLogs('sales_order','${so.so_id}','sales')">Log</button>
        </td>
      </tr>
    `;
  });
}

function gotoShippingFromSO_(soId){
  const id = String(soId || "").trim().toUpperCase();
  if(!id) return;
  try{ window.__ERP_PREFILL_SHIP_SO_ID__ = id; }catch(_e){}
  if(typeof navigate === "function"){
    navigate("shipping");
  }else{
    showToast("無法切換到出貨頁面（navigate 未定義）", "error");
  }
}

