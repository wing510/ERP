/**
 * Merge 合批（API 版）
 * - movements: sources OUT, new lot IN
 * - lot_relation: MERGE (source -> new)
 */

let mergeLots = [];
let mergeMovements = [];
let mergeDraft = [];
let mergePickedProduct = "";
let mergePickedUnit = "";
let mergePickedType = "";
let mergePickedQA = "";

async function mergeInit(){
  await loadMergeCaches();
  resetMerge();
}

async function loadMergeCaches(){
  const [lots, movements] = await Promise.all([
    getAll("lot"),
    getAll("inventory_movement").catch(() => [])
  ]);
  mergeLots = lots || [];
  mergeMovements = movements || [];

  const sel = document.getElementById("merge_source_lot");
  if(sel){
    const lots = mergeLots.filter(l => (l.inventory_status || "ACTIVE") === "ACTIVE" && (l.status || "PENDING") === "APPROVED");
    sel.innerHTML =
      `<option value="">請選擇來源 Lot</option>` +
      lots.map(l => {
        const av = mergeGetAvailable(l.lot_id);
        return `<option value="${l.lot_id}" data-product="${l.product_id}" data-unit="${l.unit}" data-type="${l.type}" data-qa="${l.status}" data-av="${av}">${l.lot_id} (${l.product_id}) 可用:${av}</option>`;
      }).join("");
  }
}

function mergeGetAvailable(lotId){
  return mergeMovements.filter(m => m.lot_id === lotId).reduce((sum, m) => sum + Number(m.qty||0), 0);
}

function resetMerge(){
  mergeDraft = [];
  mergePickedProduct = "";
  mergePickedUnit = "";
  mergePickedType = "";
  mergePickedQA = "";
  renderMergeDraft();

  document.getElementById("merge_new_lot_id").value = generateId("LOT");
  document.getElementById("merge_product").value = "";
  document.getElementById("merge_unit").value = "";
  document.getElementById("merge_total").value = "";
  document.getElementById("merge_remark").value = "";

  const sel = document.getElementById("merge_source_lot");
  if(sel) sel.value = "";
  document.getElementById("merge_available").value = "";
  document.getElementById("merge_take_qty").value = "";
  document.getElementById("merge_take_unit").value = "";
  document.getElementById("merge_take_remark").value = "";
}

function onSelectMergeSource(){
  const sel = document.getElementById("merge_source_lot");
  const opt = sel?.selectedOptions?.[0];
  if(!opt) return;
  document.getElementById("merge_available").value = opt.getAttribute("data-av") || "";
  document.getElementById("merge_take_unit").value = opt.getAttribute("data-unit") || "";
}

function addMergeDraft(){
  const lotId = document.getElementById("merge_source_lot")?.value || "";
  const qty = Number(document.getElementById("merge_take_qty")?.value || 0);
  const unit = document.getElementById("merge_take_unit")?.value || "";
  const remark = (document.getElementById("merge_take_remark")?.value || "").trim();

  if(!lotId) return showToast("請選擇來源 Lot","error");
  if(!qty || qty <= 0) return showToast("取用數量需大於 0","error");
  if(!unit) return showToast("單位缺失","error");
  if(mergeDraft.some(x => x.lot_id === lotId)) return showToast("同一 Lot 不可重複加入","error");

  const lot = mergeLots.find(l => l.lot_id === lotId);
  if(!lot) return showToast("找不到 Lot","error");
  const av = mergeGetAvailable(lotId);
  if(qty > av) return showToast("取用不可超過可用量","error");

  // 強制同產品同單位
  if(!mergePickedProduct){
    mergePickedProduct = lot.product_id;
    mergePickedUnit = lot.unit;
    mergePickedType = lot.type;
    mergePickedQA = lot.status;
    document.getElementById("merge_product").value = mergePickedProduct;
    document.getElementById("merge_unit").value = mergePickedUnit;
  }else{
    if(lot.product_id !== mergePickedProduct) return showToast("合批必須同一產品","error");
    if(lot.unit !== mergePickedUnit) return showToast("合批必須同一單位","error");
  }

  mergeDraft.push({
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    lot_id: lotId,
    product_id: lot.product_id,
    qty,
    unit,
    remark
  });

  document.getElementById("merge_source_lot").value = "";
  document.getElementById("merge_available").value = "";
  document.getElementById("merge_take_qty").value = "";
  document.getElementById("merge_take_unit").value = "";
  document.getElementById("merge_take_remark").value = "";

  renderMergeDraft();
  updateMergeTotal();
}

function removeMergeDraft(draftId){
  mergeDraft = mergeDraft.filter(x => x.draft_id !== draftId);
  renderMergeDraft();
  updateMergeTotal();
  if(mergeDraft.length === 0){
    mergePickedProduct = "";
    mergePickedUnit = "";
    mergePickedType = "";
    mergePickedQA = "";
    document.getElementById("merge_product").value = "";
    document.getElementById("merge_unit").value = "";
    document.getElementById("merge_total").value = "";
  }
}

function renderMergeDraft(){
  const tbody = document.getElementById("mergeBody");
  if(!tbody) return;
  tbody.innerHTML = "";
  mergeDraft.forEach((it, idx) => {
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${it.lot_id}</td>
        <td>${it.product_id}</td>
        <td>${it.qty}</td>
        <td>${it.unit}</td>
        <td>${it.remark || ""}</td>
        <td><button class="btn-secondary" onclick="removeMergeDraft('${it.draft_id}')">刪除</button></td>
      </tr>
    `;
  });
}

function updateMergeTotal(){
  const total = mergeDraft.reduce((sum, x) => sum + Number(x.qty||0), 0);
  document.getElementById("merge_total").value = total ? total.toFixed(2) : "";
}

async function postMerge(triggerEl){
  const newLotId = (document.getElementById("merge_new_lot_id")?.value || "").trim().toUpperCase();
  document.getElementById("merge_new_lot_id").value = newLotId;
  const remark = (document.getElementById("merge_remark")?.value || "").trim();

  if(!newLotId) return showToast("新 Lot ID 必填","error");
  if(mergeDraft.length < 2) return showToast("合批至少需要 2 個來源 Lot","error");
  if(!mergePickedProduct || !mergePickedUnit) return showToast("合批產品/單位缺失","error");

  await loadMergeCaches();

  // check duplicate id
  const exists = mergeLots.some(l => l.lot_id === newLotId);
  if(exists) return showToast("新 Lot ID 已存在","error");

  // validate availability again
  for(const it of mergeDraft){
    const av = mergeGetAvailable(it.lot_id);
    if(it.qty > av) return showToast("取用超過可用量：" + it.lot_id, "error");
  }

  const refId = generateId("MERGE");
  const total = mergeDraft.reduce((sum, x) => sum + Number(x.qty||0), 0);

  showSaveHint(triggerEl || document.getElementById("mergePostButtonGroup"));
  try {
  const firstSrcLot = (mergeLots || []).find(l => l.lot_id === (mergeDraft?.[0]?.lot_id || "")) || null;
  const whId = String(firstSrcLot?.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN";

  // create new lot (QA status default: APPROVED only if all sources approved; currently sources are APPROVED)
  await createRecord("lot", {
    lot_id: newLotId,
    product_id: mergePickedProduct,
    warehouse_id: whId,
    source_type: "MERGE",
    source_id: refId,
    qty: String(total),
    unit: mergePickedUnit,
    type: mergePickedType || "WIP",
    status: mergePickedQA || "APPROVED",
    inventory_status: "ACTIVE",
    received_date: nowIso16(),
    manufacture_date: "",
    expiry_date: "",
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
    remark: remark || "",
    system_remark: `Merge lots -> ${refId}`
  });

  // IN to new
  await createRecord("inventory_movement", {
    movement_id: generateId("MV"),
    movement_type: "IN",
    lot_id: newLotId,
    product_id: mergePickedProduct,
    warehouse_id: whId,
    qty: String(Math.abs(total)),
    unit: mergePickedUnit,
    ref_type: "MERGE",
    ref_id: refId,
    remark: "",
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
    system_remark: `Merge IN: ${refId}`,
  });

  // OUT from sources + relations
  for(let idx=0; idx<mergeDraft.length; idx++){
    const it = mergeDraft[idx];
    const srcLot = (mergeLots || []).find(l => l.lot_id === it.lot_id) || null;

    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "OUT",
      lot_id: it.lot_id,
      product_id: it.product_id,
      warehouse_id: String(srcLot?.warehouse_id || "MAIN").trim().toUpperCase() || "MAIN",
      qty: String(-Math.abs(it.qty)),
      unit: it.unit,
      ref_type: "MERGE",
      ref_id: refId,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      system_remark: `Merge OUT: ${refId}`,
    });

    await createRecord("lot_relation", {
      relation_id: `REL-${refId}-${String(idx+1).padStart(3,"0")}`,
      relation_type: "MERGE",
      from_lot_id: it.lot_id,
      to_lot_id: newLotId,
      qty: String(it.qty),
      unit: it.unit,
      ref_type: "MERGE",
      ref_id: refId,
      created_by: getCurrentUser(),
      created_at: nowIso16()
    });
  }

  showToast("合批完成");
  await loadMergeCaches();
  resetMerge();
  } finally {
    hideSaveHint();
  }
}

// =====================
// Merge Module (Multi-Source Manufacturing)
// =====================

function mergeInit() {
    populateMergeLots();
    renderMergeHistory();
}

// =====================
// 填入可合批次
// =====================

window.populateMergeLots = function () {

    const container = document.getElementById("mergeLotsContainer");
    if (!container) return;

    container.innerHTML = "";

    window.DB.lots.forEach((l, index) => {

        if (l.status === "APPROVED" && l.available > 0) {

            const div = document.createElement("div");

            div.innerHTML = `
                <label>
                    <input type="checkbox" value="${index}">
                    ${l.lot_id} (可用:${l.available})
                </label>
            `;

            container.appendChild(div);
        }
    });
};

// =====================
// 執行合批
// =====================

window.createMerge = function () {

    const checkboxes = document.querySelectorAll("#mergeLotsContainer input:checked");

    if (checkboxes.length < 2) {
        alert("至少選擇兩個批次");
        return;
    }

    let totalQty = 0;
    let sourceLots = [];

    checkboxes.forEach(cb => {

        const lot = window.DB.lots[cb.value];

        totalQty += lot.available;
        sourceLots.push(lot.lot_id);

        lot.available = 0;
        lot.status = "CLOSED";
    });

    const newLotId = "MERGE-" + Date.now();

    window.DB.lots.push({
        lot_id: newLotId,
        product_id: null,
        product_name: "Merged Lot",
        type: "MERGED",
        total: totalQty,
        available: totalQty,
        status: "APPROVED",
        parent_lots: sourceLots
    });

    if (!window.DB.merges) window.DB.merges = [];

    window.DB.merges.push({
        sources: sourceLots,
        new_lot: newLotId,
        qty: totalQty,
        date: new Date().toLocaleString()
    });

    populateMergeLots();
    renderMergeHistory();
};

// =====================
// 顯示 Merge 歷史
// =====================

function renderMergeHistory() {

    const tbody = document.getElementById("mergeTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!window.DB.merges) return;

    window.DB.merges.forEach(m => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${m.sources.join(", ")}</td>
            <td>${m.new_lot}</td>
            <td>${m.qty}</td>
            <td>${m.date}</td>
        `;

        tbody.appendChild(tr);
    });
}