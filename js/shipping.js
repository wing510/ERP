/**
 * Shipment（API 版）
 * - 過帳時：shipment + shipment_item + inventory_movement(SHIP_OUT)
 * - 回寫 sales_order_item.shipped_qty 與 sales_order.status
 */

let shipDraft = [];
let shipLots = [];
let shipMovements = [];
let shipCustomers = [];
let shipSalesOrders = [];
let shipSalesItems = [];
let shipProducts = [];
let shipWarehouses = [];
let shipEditing = false;
let shipReadOnlyDraft = false;
let shipGoodsReceiptIdToPoId = {};
let shipImportReceiptIdToDocId = {};
let shipImportDocIdToImportNo = {};
/** 點選明細列：草稿為 DRAFT-*；已載入出貨單為 shipment_item_id */
let shipSelectedLineId_ = "";

function updateShipStatusHint_(){
  const el = document.getElementById("shipStatusHint");
  if(!el) return;
  if(shipEditing && shipReadOnlyDraft){
    const st = (document.getElementById("ship_status")?.value || "").trim().toUpperCase();
    el.textContent = "出貨狀態：已載入 — " + (termLabel(st) || st) + "（明細僅檢視）";
  }else{
    el.textContent = "出貨狀態：新單 — 填主檔與明細後按下方「建立並過帳出貨」扣庫";
  }
}

function formatShipProductDisplay_(productId){
  const p = (shipProducts || []).find(x => x.product_id === productId) || {};
  const name = p.product_name || productId || "";
  const spec = p.spec || "";
  return spec ? `${name}（${spec}）` : name;
}

async function shippingInit(){
  await loadShipMasterData();
  const lotKw = document.getElementById("ship_lot_picker_keyword");
  if(lotKw && !lotKw.dataset.bound){
    lotKw.dataset.bound = "1";
    lotKw.addEventListener("input", () => renderShipLotPicker_(getShipEligibleLots_()));
  }
  const lotView = document.getElementById("ship_lot_picker_viewmode");
  if(lotView && !lotView.dataset.bound){
    lotView.dataset.bound = "1";
    lotView.addEventListener("change", () => renderShipLotPicker_(getShipEligibleLots_()));
  }
  resetShipForm();
  bindAutoSearchToolbar_([
    ["ship_search_keyword", "input"],
    ["ship_search_status", "change"]
  ], () => renderShipments());
  await renderShipments();
}

async function loadShipMasterData(){
  const [lots, movements, customersRaw, salesOrders, salesItems, products, warehouses, importReceipts, goodsReceipts, importDocs] = await Promise.all([
    getAll("lot"),
    getAll("inventory_movement").catch(() => []),
    getAll("customer"),
    getAll("sales_order").catch(() => []),
    getAll("sales_order_item").catch(() => []),
    getAll("product").catch(() => []),
    getAll("warehouse").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  shipLots = lots || [];
  shipMovements = movements || [];
  shipCustomers = (customersRaw || []).filter(c => c.status === "ACTIVE");
  shipSalesOrders = salesOrders || [];
  shipSalesItems = salesItems || [];
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
  return shipMovements
    .filter(m => m.lot_id === lotId)
    .reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

function formatShipLotOptionLabel_(lot, available){
  const lotId = String(lot?.lot_id || "");
  const productId = String(lot?.product_id || "");
  return `${lotId} (${productId}) 可用:${available}`;
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

function getShipEligibleLots_(){
  return (shipLots || []).filter(l => {
    if((l.inventory_status || "ACTIVE") !== "ACTIVE") return false;
    if((l.status || "PENDING") !== "APPROVED") return false;
    const av = shipGetAvailable(l.lot_id);
    return Number(av) > 0;
  });
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
  tbody.innerHTML = "";
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">目前無可選 Lot</td></tr>`;
    return;
  }

  function renderLotRow_(l){
    const av = shipGetAvailable(l.lot_id);
    const lotId = String(l.lot_id || "");
    const productText = formatShipProductDisplay_(l.product_id || "");
    const whText = shipWarehouseLabelByLot_(l) || (l.warehouse_id ? String(l.warehouse_id) : "");
    const createdAt = String(l.created_at || "");
    const safeId = lotId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    tbody.innerHTML += `
      <tr style="cursor:pointer;" onclick="pickShipLineLot('${safeId}')">
        <td>${lotId}</td>
        <td>${productText}</td>
        <td>${whText || "—"}</td>
        <td>${av}</td>
        <td>${createdAt}</td>
        <td><button type="button" class="btn-secondary">帶入</button></td>
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
          <td colspan="6" style="font-weight:600;color:#334155;padding:8px 10px;">來源：${k}（${groups[k].length}）</td>
        </tr>
      `;
      groups[k].forEach(renderLotRow_);
    });
  }else{
    list.forEach(renderLotRow_);
  }
}

function openShipLotPicker(){
  if(shipReadOnlyDraft) return;
  const modal = document.getElementById("shipLotPickerModal");
  if(!modal) return;
  modal.style.display = "flex";
  const kw = document.getElementById("ship_lot_picker_keyword");
  if(kw){
    kw.value = "";
    kw.focus();
  }
  renderShipLotPicker_(getShipEligibleLots_());
}

function closeShipLotPicker(){
  const modal = document.getElementById("shipLotPickerModal");
  if(modal) modal.style.display = "none";
}

function pickShipLineLot(lotId){
  const input = document.getElementById("ship_lot_id");
  const display = document.getElementById("ship_lot_display");
  if(!input) return;
  input.value = lotId || "";
  if(display){
    const lot = (shipLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
    const av = lot ? shipGetAvailable(lot.lot_id) : "";
    const whText = lot ? (shipWarehouseLabelByLot_(lot) || "") : "";
    display.value = lot ? (formatShipLotOptionLabel_(lot, av) + (whText ? ` | ${whText}` : "")) : (lotId || "");
  }
  onSelectShipLot();
  closeShipLotPicker();
}

function setShipPickLotBtnState_(){
  const btn = document.getElementById("ship_pick_lot_btn");
  if(btn) btn.disabled = !!shipReadOnlyDraft;
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
  renderShipDraft();

  const idEl = document.getElementById("ship_id");
  if(idEl){
    idEl.value = generateId("SHIP");
    idEl.disabled = false;
  }

  const dateEl = document.getElementById("ship_date");
  if(dateEl) dateEl.value = nowIso16().slice(0, 10);

  const st = document.getElementById("ship_status");
  if(st) st.value = "OPEN";

  const rm = document.getElementById("ship_remark");
  if(rm) rm.value = "";

  const soSel = document.getElementById("ship_so_id");
  if(soSel) soSel.value = "";

  const cSel = document.getElementById("ship_customer_id");
  if(cSel) cSel.value = "";

  onSelectShipSO();
  clearShipItemEntry();
  setShipPickLotBtnState_();
  updateShipStatusHint_();
}

function clearShipItemEntry(){
  shipSelectedLineId_ = "";
  const a = document.getElementById("ship_so_item_id");
  const b = document.getElementById("ship_lot_id");
  const bDisp = document.getElementById("ship_lot_display");
  const c = document.getElementById("ship_available");
  const d = document.getElementById("ship_qty");
  const e = document.getElementById("ship_unit");
  const f = document.getElementById("ship_item_remark");
  if(a) a.value = "";
  if(b) b.value = "";
  if(bDisp) bDisp.value = "";
  if(c) c.value = "";
  if(d) d.value = "";
  if(e) e.value = "";
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
  const av = document.getElementById("ship_available");
  const qty = document.getElementById("ship_qty");
  const u = document.getElementById("ship_unit");
  const rm = document.getElementById("ship_item_remark");
  if(hid) hid.value = "";
  if(disp) disp.value = "";
  if(av) av.value = "";
  if(qty) qty.value = "";
  if(u) u.value = "";
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

  const items = shipSalesItems.filter(it => it.so_id === soId);
  soiSel.innerHTML =
    `<option value="">（不指定銷售品項）</option>` +
    items.map(it => {
      const ordered = Number(it.order_qty || 0);
      const shipped = Number(it.shipped_qty || 0);
      const remain = Math.max(0, ordered - shipped);
      return `<option value="${it.so_item_id}" data-product="${it.product_id}" data-unit="${it.unit}" data-remain="${remain}">${it.so_item_id} - ${it.product_id}（剩餘 ${remain}）</option>`;
    }).join("");
}

function onSelectShipSOItem(){
  const soiSel = document.getElementById("ship_so_item_id");
  const opt = soiSel?.selectedOptions?.[0];
  if(!opt) return;
  // 此處不強制鎖 Lot，因為可能多批次出貨；但可用 remain 當提示
}

function onSelectShipLot(){
  const lotId = document.getElementById("ship_lot_id")?.value || "";
  const lot = (shipLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
  const avEl = document.getElementById("ship_available");
  const uEl = document.getElementById("ship_unit");
  if(!lot){
    if(avEl) avEl.value = "";
    if(uEl) uEl.value = "";
    return;
  }
  if(avEl) avEl.value = String(shipGetAvailable(lotId));
  if(uEl) uEl.value = lot.unit || "";
}

function addShipItemDraft(){
  if(shipReadOnlyDraft) return showToast("已載入出貨單，明細僅供檢視","error");
  const so_id = document.getElementById("ship_so_id")?.value || "";
  const so_item_id = document.getElementById("ship_so_item_id")?.value || "";
  const lot_id = document.getElementById("ship_lot_id")?.value || "";
  const qty = Number(document.getElementById("ship_qty")?.value || 0);
  const unit = document.getElementById("ship_unit")?.value || "";
  const remark = (document.getElementById("ship_item_remark")?.value || "").trim();

  if(!lot_id) return showToast("請選擇 Lot","error");
  if(!qty || qty <= 0) return showToast("出貨數量需大於 0","error");
  if(!unit) return showToast("Lot 單位缺失","error");

  const lot = shipLots.find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  const av = shipGetAvailable(lot_id);
  if(qty > av) return showToast("出貨不可超過可用量","error");

  if(so_id && so_item_id){
    const soi = shipSalesItems.find(x => x.so_item_id === so_item_id);
    if(soi){
      const remain = Math.max(0, Number(soi.order_qty||0) - Number(soi.shipped_qty||0));
      if(qty > remain) return showToast("出貨不可超過銷售單剩餘未出貨量","error");
      if(lot.product_id !== soi.product_id) return showToast("Lot 產品與銷售品項不一致","error");
    }
  }

  shipDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    so_id,
    so_item_id,
    lot_id,
    product_id: lot.product_id,
    warehouse_id: String(lot.warehouse_id || "").trim().toUpperCase(),
    ship_qty: qty,
    unit,
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
    tbody.innerHTML += `
      <tr style="${rowClick ? "cursor:pointer;" : ""}" ${rowClick}>
        <td>${idx+1}</td>
        <td>${it.lot_id}</td>
        <td>${formatShipProductDisplay_(it.product_id)}</td>
        <td>${shipWarehouseLabelById_(it.warehouse_id) || "—"}</td>
        <td>${it.ship_qty}</td>
        <td>${it.unit}</td>
        <td>${it.so_item_id || ""}</td>
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

  const qKw = (document.getElementById("ship_search_keyword")?.value || "").trim().toUpperCase();
  const qSt = (document.getElementById("ship_search_status")?.value || "").trim().toUpperCase();

  const list = await getAll("shipment").catch(()=>[]);
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
          <button class="btn-edit" onclick="loadShipment('${s.shipment_id}')">載入</button>
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

  const itemsAll = await getAll("shipment_item").catch(()=>[]);
  const items = (itemsAll || []).filter(x => x.shipment_id === id);

  shipEditing = true;
  shipReadOnlyDraft = true;

  const idEl = document.getElementById("ship_id");
  if(idEl){
    idEl.value = sh.shipment_id || id;
    idEl.disabled = true;
  }
  document.getElementById("ship_so_id").value = sh.so_id || "";
  onSelectShipSO();
  document.getElementById("ship_customer_id").value = sh.customer_id || "";
  document.getElementById("ship_date").value = dateInputValue_(sh.ship_date);
  document.getElementById("ship_status").value = sh.status || "OPEN";
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
    await loadShipMasterData();

  const itemsAll = await getAll("shipment_item").catch(()=>[]);
  const items = (itemsAll || []).filter(x => x.shipment_id === shipment_id);
  if(items.length === 0) return showToast("找不到出貨明細，無法作廢","error");

  // 1) 反沖庫存：ADJUST +qty
  for(const it of items){
    const lot = (shipLots || []).find(l => String(l.lot_id||"") === String(it.lot_id||"")) || null;
    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "ADJUST",
      lot_id: it.lot_id,
      product_id: it.product_id,
      warehouse_id: String(lot?.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
      qty: String(Math.abs(Number(it.ship_qty || 0))),
      unit: it.unit || "",
      ref_type: "SHIPMENT_CANCEL",
      ref_id: shipment_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `Cancel Shipment: ${shipment_id}`,
    });
  }

  // 2) 更新出貨單狀態
  await updateRecord("shipment","shipment_id",shipment_id,{
    status: "CANCELLED",
    remark: (sh.remark || "").trim() ? `${sh.remark} | CANCELLED` : "CANCELLED"
  });

  // 3) 回寫 SO 已出貨量與 SO 狀態
  const soItemAll = await getAll("sales_order_item").catch(()=>[]);
  const byId = {};
  (soItemAll || []).forEach(x => { byId[x.so_item_id] = x; });

  const touchedSO = new Set();
  for(const it of items){
    const so_item_id = String(it.so_item_id || "");
    const so_id = String(it.so_id || "");
    if(so_id) touchedSO.add(so_id);
    if(!so_item_id) continue;
    const row = byId[so_item_id];
    if(!row) continue;

    const next = Math.max(0, Number(row.shipped_qty || 0) - Number(it.ship_qty || 0));
    await updateRecord("sales_order_item","so_item_id",so_item_id,{
      shipped_qty: String(next),
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
  }

  for(const so_id of touchedSO){
    const items2 = (await getAll("sales_order_item")).filter(x => x.so_id === so_id);
    const allShipped = items2.length > 0 && items2.every(x => Number(x.shipped_qty||0) >= Number(x.order_qty||0));
    const anyShipped = items2.some(x => Number(x.shipped_qty||0) > 0);
    const next = allShipped ? "SHIPPED" : (anyShipped ? "PARTIAL" : "OPEN");
    await updateRecord("sales_order","so_id",so_id,{
      status: next,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
  }

    showToast("作廢完成：已反沖庫存並回寫 SO");
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
  const status = document.getElementById("ship_status")?.value || "OPEN";
  const remark = (document.getElementById("ship_remark")?.value || "").trim();

  if(!shipment_id) return showToast("出貨單ID 必填","error");
  if(!customer_id) return showToast("請選擇客戶","error");
  if(!ship_date) return showToast("出貨日期必填","error");
  if(shipDraft.length === 0) return showToast("請至少新增 1 筆出貨明細","error");

  showSaveHint(triggerEl || document.getElementById("shipPostButtonGroup"));
  try {
  // refresh
  await loadShipMasterData();

  await createRecord("shipment", {
    shipment_id,
    so_id,
    customer_id,
    ship_date,
    status: "POSTED",
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16()
  });

  // write items + movements + update SO shipped_qty
  for(let idx=0; idx<shipDraft.length; idx++){
    const it = shipDraft[idx];
    const lot = (shipLots || []).find(l => String(l.lot_id||"") === String(it.lot_id||"")) || null;

    await createRecord("shipment_item", {
      shipment_item_id: `SHI-${shipment_id}-${String(idx+1).padStart(3,"0")}`,
      shipment_id,
      so_id: it.so_id || so_id || "",
      so_item_id: it.so_item_id || "",
      lot_id: it.lot_id,
      product_id: it.product_id,
      ship_qty: String(it.ship_qty),
      unit: it.unit,
      remark: it.remark || "",
      created_by: getCurrentUser(),
      created_at: nowIso16()
    });

    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "SHIP_OUT",
      lot_id: it.lot_id,
      product_id: it.product_id,
      warehouse_id: String(lot?.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
      qty: String(-Math.abs(it.ship_qty)),
      unit: it.unit,
      ref_type: "SHIPMENT",
      ref_id: shipment_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `Ship OUT: ${shipment_id}`,
    });

    if(it.so_item_id){
      const soi = shipSalesItems.find(x => x.so_item_id === it.so_item_id);
      if(soi){
        const newShipped = Number(soi.shipped_qty || 0) + Number(it.ship_qty || 0);
        await updateRecord("sales_order_item","so_item_id",it.so_item_id,{
          shipped_qty: String(newShipped),
          updated_by: getCurrentUser(),
          updated_at: nowIso16()
        });
      }
    }
  }

  // update SO status
  if(so_id){
    const items = (await getAll("sales_order_item")).filter(x => x.so_id === so_id);
    const allShipped = items.length > 0 && items.every(x => Number(x.shipped_qty||0) >= Number(x.order_qty||0));
    const anyShipped = items.some(x => Number(x.shipped_qty||0) > 0);
    const next = allShipped ? "SHIPPED" : (anyShipped ? "PARTIAL" : "OPEN");
    await updateRecord("sales_order","so_id",so_id,{
      status: next,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
  }

  showToast("出貨已過帳（已扣庫）");
  resetShipForm();
  await renderShipments();
  } finally { hideSaveHint(); }
}

