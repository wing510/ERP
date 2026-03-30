/**
 * Sales Orders（API 版）
 * - 建單不扣庫；出貨由 Shipment 模組扣庫
 */

let soEditing = false;
let soItemsDraft = [];
let soProducts = [];
let soCustomers = [];
/** 委外同款：由「編輯」帶回表單後，再按「新增品項」重新加入（新 draft_id）；已出貨量暫存於此 */
let soEditingShippedQtyHold = 0;
/** 點選已存檔列（so_item_id）供「更新本筆備註」 */
let soSelectedDbItemId_ = "";

function isSOFormLocked_(){
  if(!soEditing) return false;
  const st = (document.getElementById("so_status")?.value || "OPEN").trim().toUpperCase();
  return st === "SHIPPED" || st === "CANCELLED";
}

function onSOStatusChange_(){
  setSOButtons_();
}

function updateSOStatusHint_(){
  const el = document.getElementById("soStatusHint");
  if(!el) return;
  if(soEditing){
    const st = (document.getElementById("so_status")?.value || "OPEN").trim().toUpperCase();
    const label = typeof termLabel === "function" ? termLabel(st) : st;
    if(isSOFormLocked_()){
      el.textContent = "銷售狀態：已載入 — " + (label || st) + "（已結束，僅可檢視）";
      return;
    }
    el.textContent =
      "銷售狀態：已載入 — " +
      (label || st) +
      " — 變更後按「更新」（主檔區或明細下方皆可，功能相同）";
    return;
  }
  el.textContent = "銷售狀態：新單（未載入）— 填主檔與明細後按明細下方「建立」";
}

function setSOButtons_(){
  const locked = isSOFormLocked_();
  const createBtn = document.getElementById("so_create_btn");
  const updateBtn = document.getElementById("so_update_btn");
  const addBtn = document.getElementById("so_add_item_btn");
  const itemsSaveBtn = document.getElementById("so_items_save_btn");
  if(createBtn) createBtn.disabled = locked || soEditing;
  if(updateBtn) updateBtn.disabled = locked || !soEditing;
  if(itemsSaveBtn) itemsSaveBtn.disabled = locked || !soEditing;
  if(addBtn) addBtn.disabled = locked;
  updateSOStatusHint_();
}

function formatSOProductDisplay_(productId, productName, productSpec){
  const id = String(productId || "").trim();
  const name = String(productName || id || "").trim();
  const spec = String(productSpec || "").trim();
  if(!name && !id) return "";
  if(spec) return `${name} (${id} / ${spec})`;
  return id ? `${name} (${id})` : name;
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
  const [productsRaw, customersRaw] = await Promise.all([
    getAll("product"),
    getAll("customer")
  ]);
  soProducts = (productsRaw || []).filter(p => p.status === "ACTIVE");
  soCustomers = (customersRaw || []).filter(c => c.status === "ACTIVE");

  const cSel = document.getElementById("so_customer_id");
  if(cSel){
    cSel.innerHTML =
      `<option value="">請選擇客戶</option>` +
      soCustomers.map(c => `<option value="${c.customer_id}">${c.customer_id} - ${c.customer_name}</option>`).join("");
  }

  const pSel = document.getElementById("so_item_product_id");
  if(pSel){
    pSel.innerHTML =
      `<option value="">請選擇產品</option>` +
      soProducts.map(p => `<option value="${p.product_id}" data-unit="${p.unit}" data-spec="${(p.spec || "").replace(/"/g, "&quot;")}">${p.product_id} - ${p.product_name}${p.spec ? " / " + p.spec : ""}</option>`).join("");
  }
}

function resetSOForm(){
  soEditing = false;
  soItemsDraft = [];
  renderSOItemsDraft();

  const idEl = document.getElementById("so_id");
  if(idEl){
    idEl.value = generateId("SO");
    idEl.disabled = false;
  }

  const d = document.getElementById("so_order_date");
  if(d) d.value = nowIso16().slice(0, 10);

  const c = document.getElementById("so_customer_id");
  if(c) c.value = "";

  const st = document.getElementById("so_status");
  if(st) st.value = "OPEN";

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

async function updateSelectedSOItemRemark(){
  if(!soEditing) return showToast("請先載入銷售單", "error");
  if(isSOFormLocked_()){
    return showToast("此銷售單已結束（SHIPPED/CANCELLED），不可再修改。", "error");
  }
  const sid = String(soSelectedDbItemId_ || "").trim();
  if(!sid || sid.startsWith("DRAFT-")){
    return showToast("請先點選一筆已存檔的明細列（非草稿列）", "error");
  }
  const remark = (document.getElementById("so_item_remark")?.value || "").trim();

  showSaveHint(document.getElementById("soItemsCommitGroup"));
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
  const product_name = (opt && opt.text && opt.text.split(" - ")[1]) ? opt.text.split(" - ")[1].trim() : product_id;
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

async function createSalesOrder(){
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  document.getElementById("so_id").value = so_id;
  const customer_id = document.getElementById("so_customer_id")?.value || "";
  const order_date = document.getElementById("so_order_date")?.value || "";
  const status = document.getElementById("so_status")?.value || "OPEN";
  const remark = (document.getElementById("so_remark")?.value || "").trim();

  if(!so_id) return showToast("銷售單ID 必填","error");
  if(!customer_id) return showToast("請選擇客戶","error");
  if(!order_date) return showToast("下單日期必填","error");
  if(soItemsDraft.length === 0) return showToast("請至少新增 1 筆品項","error");

  showSaveHint(document.getElementById("soItemsCommitGroup"));
  try {
  const exists = await getOne("sales_order","so_id",so_id).catch(()=>null);
  if(exists) return showToast("銷售單ID 已存在","error");

  await createRecord("sales_order", {
    so_id,
    customer_id,
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
  clearSOItemEntry();
  const idEl = document.getElementById("so_id");
  idEl.value = so.so_id;
  idEl.disabled = true;

  document.getElementById("so_customer_id").value = so.customer_id || "";
  document.getElementById("so_order_date").value = dateInputValue_(so.order_date);
  document.getElementById("so_status").value = so.status || "OPEN";
  document.getElementById("so_remark").value = so.remark || "";

  const items = (await getAll("sales_order_item")).filter(it => it.so_id === soId);
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
  const stLoaded = String(so.status || "").toUpperCase();
  if(stLoaded === "SHIPPED" || stLoaded === "CANCELLED"){
    showToast("此銷售單已結束，不可再修改。", "error");
  }
  setSOButtons_();
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
}

async function updateSalesOrder(){
  if(isSOFormLocked_()){
    return showToast("此銷售單已結束（SHIPPED/CANCELLED），不可再修改。", "error");
  }
  if(!soEditing) return showToast("請先載入銷售單再更新","error");
  const so_id = (document.getElementById("so_id")?.value || "").trim().toUpperCase();
  const customer_id = document.getElementById("so_customer_id")?.value || "";
  const order_date = document.getElementById("so_order_date")?.value || "";
  const status = document.getElementById("so_status")?.value || "OPEN";
  const remark = (document.getElementById("so_remark")?.value || "").trim();

  if(!customer_id) return showToast("請選擇客戶","error");
  if(!order_date) return showToast("下單日期必填","error");

   // SHIPPED / CANCELLED 的銷售單不允許再修改
  const header = await getOne("sales_order","so_id",so_id).catch(()=>null);
  const st = String(header?.status || "").toUpperCase();
  if(st === "SHIPPED" || st === "CANCELLED"){
    return showToast("此銷售單已結束 (SHIPPED/CANCELLED)，不可再修改。", "error");
  }

  showSaveHint(document.getElementById("soItemsCommitGroup"));
  try {
  // 若已有出貨紀錄，禁止重建明細（保持追溯一致）
  const shipments = await getAll("shipment_item").catch(()=>[]);
  const hasShip = shipments.some(s => s.so_id === so_id);

  await updateRecord("sales_order","so_id",so_id,{
    customer_id,
    order_date,
    status,
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  });

  if(hasShip){
    showToast("此銷售單已有出貨紀錄，已更新主檔但不允許重建明細。", "error");
    await renderSalesOrders();
    return;
  }

  // 刪除後重建明細（尚未出貨才允許）
  const items = (await getAll("sales_order_item")).filter(it => it.so_id === so_id);
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
  const qKw = (document.getElementById("so_search_keyword")?.value || "").trim().toUpperCase();
  const qSt = (document.getElementById("so_search_status")?.value || "").trim().toUpperCase();
  const list = await getAll("sales_order").catch(()=>[]);
  const filtered = (list || []).filter(so => {
    const stOk = !qSt || String(so.status || "").toUpperCase() === qSt;
    if(!stOk) return false;
    if(!qKw) return true;
    const sid = String(so.so_id || "").toUpperCase();
    const cid = String(so.customer_id || "").toUpperCase();
    return sid.includes(qKw) || cid.includes(qKw);
  });
  const sorted = [...filtered].sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  tbody.innerHTML = "";
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px;">尚無銷售單。請先至「產品」「客戶」建立主檔，再於銷售單填妥主檔與明細後按明細下方「建立」。</td></tr>';
    return;
  }
  sorted.forEach(so => {
    tbody.innerHTML += `
      <tr>
        <td>${so.so_id || ""}</td>
        <td>${so.customer_id || ""}</td>
        <td>${termLabel(so.status)}</td>
        <td>${so.created_at || ""}</td>
        <td>
          <button class="btn-edit" onclick="loadSalesOrder('${so.so_id}')">載入</button>
          <button type="button" class="btn-secondary" onclick="openLogs('sales_order','${so.so_id}','sales')">Log</button>
        </td>
      </tr>
    `;
  });
}

