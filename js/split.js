/**
 * Split 拆批（API 版）
 * - movements: source OUT, new lots IN
 * - lot_relation: SPLIT (source -> new)
 */

let splitLots = [];
/** lot_id -> 可用量（來自後端彙總 API，避免全表 inventory_movement） */
let splitAvailByLotId_ = {};
let splitMovementLoadFailed_ = false;
let splitDraft = [];
let splitPosting_ = false;

async function splitInit(){
  await loadSplitCaches();
  resetSplit();
  setSplitButtons_();
}

async function loadSplitCaches(){
  const [lots, availPack] = await Promise.all([
    getAll("lot"),
    typeof loadInventoryMovementAvailableMap_ === "function"
      ? loadInventoryMovementAvailableMap_()
      : Promise.resolve({ map: {}, failed: true })
  ]);
  splitLots = lots || [];
  splitAvailByLotId_ = (availPack && availPack.map) || {};
  splitMovementLoadFailed_ = !!(availPack && availPack.failed);

  const sel = document.getElementById("split_source_lot");
  if(sel){
    const lots = splitLots.filter(l => (l.inventory_status || "ACTIVE") === "ACTIVE" && (l.status || "PENDING") === "APPROVED");
    sel.innerHTML =
      `<option value="">請選擇來源 Lot</option>` +
      lots.map(l => {
        const av = splitGetAvailable(l.lot_id);
        return `<option value="${l.lot_id}" data-product="${l.product_id}" data-unit="${l.unit}" data-av="${av}">${l.lot_id} 可用:${av}</option>`;
      }).join("");
  }
}

function splitGetAvailable(lotId){
  const id = String(lotId || "");
  if (!id) return 0;
  const hit = splitAvailByLotId_[id];
  if (hit != null) return Number(hit || 0);
  if (splitMovementLoadFailed_) {
    const lot = (splitLots || []).find(l => String(l.lot_id || "") === id);
    return Number(lot?.qty || 0);
  }
  return 0;
}

function onSelectSplitSource(){
  const sel = document.getElementById("split_source_lot");
  const opt = sel?.selectedOptions?.[0];
  const hasLot = !!(opt && String(opt.value || "").trim());
  if(!hasLot){
    document.getElementById("split_product").value = "";
    document.getElementById("split_unit").value = "";
    document.getElementById("split_available").value = "";
    document.getElementById("split_new_unit").value = "";
    syncErpQtyUnitSuffix_("split_new_unit", "split_new_unit_suffix");
    document.getElementById("split_new_lot_id").value = generateId("LOT");
    setSplitButtons_();
    return;
  }
  document.getElementById("split_product").value = opt.getAttribute("data-product") || "";
  document.getElementById("split_unit").value = opt.getAttribute("data-unit") || "";
  document.getElementById("split_available").value = opt.getAttribute("data-av") || "";

  document.getElementById("split_new_unit").value = opt.getAttribute("data-unit") || "";
  syncErpQtyUnitSuffix_("split_new_unit", "split_new_unit_suffix");
  document.getElementById("split_new_lot_id").value = generateId("LOT");
  setSplitButtons_();
}

function resetSplit(){
  splitDraft = [];
  renderSplitDraft();

  const sel = document.getElementById("split_source_lot");
  if(sel) sel.value = "";
  document.getElementById("split_product").value = "";
  document.getElementById("split_unit").value = "";
  document.getElementById("split_available").value = "";

  document.getElementById("split_new_lot_id").value = generateId("LOT");
  document.getElementById("split_new_qty").value = "";
  document.getElementById("split_new_unit").value = "";
  syncErpQtyUnitSuffix_("split_new_unit", "split_new_unit_suffix");
  document.getElementById("split_new_remark").value = "";
  setSplitButtons_();
}

function addSplitDraft(){
  const source = document.getElementById("split_source_lot")?.value || "";
  const newLotId = (document.getElementById("split_new_lot_id")?.value || "").trim().toUpperCase();
  document.getElementById("split_new_lot_id").value = newLotId;
  const qty = Number(document.getElementById("split_new_qty")?.value || 0);
  const unit = document.getElementById("split_new_unit")?.value || "";
  const remark = (document.getElementById("split_new_remark")?.value || "").trim();

  if(!source) return showToast("請先選擇來源 Lot","error");
  if(!newLotId) return showToast("新 Lot ID 必填","error");
  if(!qty || qty <= 0) return showToast("數量需大於 0","error");
  if(!unit) return showToast("單位缺失","error");
  if(splitDraft.some(x => x.new_lot_id === newLotId)) return showToast("新 Lot ID 重複","error");

  splitDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    source_lot_id: source,
    new_lot_id: newLotId,
    qty,
    unit,
    remark
  });

  document.getElementById("split_new_lot_id").value = generateId("LOT");
  document.getElementById("split_new_qty").value = "";
  document.getElementById("split_new_remark").value = "";

  renderSplitDraft();
  setSplitButtons_();
}

function removeSplitDraft(draftId){
  splitDraft = splitDraft.filter(x => x.draft_id !== draftId);
  renderSplitDraft();
  setSplitButtons_();
}

function renderSplitDraft(){
  const tbody = document.getElementById("splitBody");
  if(!tbody) return;
  tbody.innerHTML = "";
  splitDraft.forEach((it, idx) => {
    const su = String(it.unit || "").trim();
    const sqCell = su ? `${it.qty} ${su.replace(/</g, "")}` : String(it.qty);
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${it.new_lot_id}</td>
        <td>${sqCell}</td>
        <td>${it.remark || ""}</td>
        <td><button class="btn-secondary" onclick="removeSplitDraft('${it.draft_id}')">刪除</button></td>
      </tr>
    `;
  });
  setSplitButtons_();
}

function setSplitButtons_(){
  const addBtn = document.getElementById("split_add_btn");
  const postBtn = document.getElementById("split_post_btn");
  const hasSource = !!(document.getElementById("split_source_lot")?.value || "");
  const hasLines = (splitDraft || []).length > 0;
  if(addBtn){
    addBtn.disabled = splitPosting_;
    addBtn.title = splitPosting_ ? "過帳中…" : "新增拆出批次";
  }
  if(postBtn){
    const can = !splitPosting_ && hasSource && hasLines;
    postBtn.disabled = !can;
    postBtn.title =
      splitPosting_ ? "過帳中…" :
      (!hasSource ? "請先選擇來源 Lot" :
      (!hasLines ? "請至少新增 1 筆新批次" :
      "確認拆批（過帳）"));
  }
}

async function postSplit(triggerEl){
  const source = document.getElementById("split_source_lot")?.value || "";
  if(!source) return showToast("請選擇來源 Lot","error");
  if(splitDraft.length === 0) return showToast("請至少新增 1 筆新批次","error");

  await loadSplitCaches();
  const srcLot = splitLots.find(l => l.lot_id === source);
  if(!srcLot) return showToast("找不到來源 Lot","error");
  const av = splitGetAvailable(source);
  const total = splitDraft.reduce((sum, x) => sum + Number(x.qty||0), 0);
  if(total > av) return showToast("拆出總量不可超過可用量","error");

  const refId = generateId("SPLIT");

  showSaveHint(triggerEl || document.getElementById("splitPostButtonGroup"));
  splitPosting_ = true;
  setSplitButtons_();
  try {
  // source OUT
  await createRecord("inventory_movement", {
    movement_id: generateId("MV"),
    movement_type: "OUT",
    lot_id: source,
    product_id: srcLot.product_id,
    warehouse_id: String(srcLot.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
    qty: String(-Math.abs(total)),
    unit: srcLot.unit,
    ref_type: "SPLIT",
    ref_id: refId,
    remark: "",
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
    system_remark: `Split OUT: ${refId}`,
  });

  // create new lots + IN + relations
  for(let idx=0; idx<splitDraft.length; idx++){
    const it = splitDraft[idx];

    await createRecord("lot", {
      lot_id: it.new_lot_id,
      product_id: srcLot.product_id,
      warehouse_id: String(srcLot.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
      source_type: "SPLIT",
      source_id: refId,
      qty: String(it.qty),
      unit: it.unit,
      type: srcLot.type,
      status: srcLot.status, // 沿用 QA 狀態
      inventory_status: "ACTIVE",
      received_date: nowIso16(),
      manufacture_date: srcLot.manufacture_date || "",
      expiry_date: srcLot.expiry_date || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      remark: it.remark || "",
      system_remark: `Split from ${source}`
    });

    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id: it.new_lot_id,
      product_id: srcLot.product_id,
      warehouse_id: String(srcLot.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
      qty: String(Math.abs(it.qty)),
      unit: it.unit,
      ref_type: "SPLIT",
      ref_id: refId,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `Split IN: ${refId}`,
    });

    await createRecord("lot_relation", {
      relation_id: `REL-${refId}-${String(idx+1).padStart(3,"0")}`,
      relation_type: "SPLIT",
      from_lot_id: source,
      to_lot_id: it.new_lot_id,
      qty: String(it.qty),
      unit: it.unit,
      ref_type: "SPLIT",
      ref_id: refId,
      created_by: getCurrentUser(),
      created_at: nowIso16()
    });
  }

  showToast("拆批完成");
  await loadSplitCaches();
  resetSplit();
  } finally {
    hideSaveHint();
    splitPosting_ = false;
    setSplitButtons_();
  }
}

// =====================
// Split Module (Manufacturing Core)
// =====================

function splitInit() {
    populateSplitLotDropdown();
    renderSplitHistory();
}

// =====================
// 填入可拆批次
// =====================

window.populateSplitLotDropdown = function () {

    const dropdown = document.getElementById("sp_lot");
    if (!dropdown) return;

    dropdown.innerHTML = "";

    window.DB.lots.forEach((l, index) => {

        if (l.status === "APPROVED" && l.available > 0) {

            const option = document.createElement("option");
            option.value = index;
            option.textContent = `${l.lot_id} (可用:${l.available})`;
            dropdown.appendChild(option);
        }
    });
};

// =====================
// 執行拆批
// =====================

window.createSplit = function () {

    const lotIndex = document.getElementById("sp_lot").value;
    const qty = parseInt(document.getElementById("sp_qty").value);

    if (lotIndex === "" || isNaN(qty) || qty <= 0) {
        alert("請輸入正確數量");
        return;
    }

    const sourceLot = window.DB.lots[lotIndex];

    if (qty > sourceLot.available) {
        alert("庫存不足");
        return;
    }

    // 扣來源批次
    sourceLot.available -= qty;

    // 若扣完自動關閉
    if (sourceLot.available === 0) {
        sourceLot.status = "CLOSED";
    }

    // 建立新批次
    const newLotId = sourceLot.lot_id + "-S" + (Math.floor(Math.random() * 1000));

    window.DB.lots.push({
        lot_id: newLotId,
        product_id: sourceLot.product_id,
        product_name: sourceLot.product_name,
        type: sourceLot.type,
        total: qty,
        available: qty,
        status: "APPROVED",
        parent_lot: sourceLot.lot_id
    });

    // 記錄 Split 歷史
    if (!window.DB.splits) window.DB.splits = [];

    window.DB.splits.push({
        source: sourceLot.lot_id,
        new_lot: newLotId,
        qty: qty,
        date: new Date().toLocaleString()
    });

    renderSplitHistory();
    populateSplitLotDropdown();
};

// =====================
// 顯示 Split 歷史
// =====================

function renderSplitHistory() {

    const tbody = document.getElementById("splitTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!window.DB.splits) return;

    window.DB.splits.forEach(s => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${s.source}</td>
            <td>${s.new_lot}</td>
            <td>${s.qty}</td>
            <td>${s.date}</td>
        `;

        tbody.appendChild(tr);
    });
}