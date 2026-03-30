/*********************************
 * 收貨入庫（統一：PO / 進口報單）v4
 * - 收貨單ID 自動產生（PO→GR、報單→IR）
 * - 選擇來源（PO 或 報單）→ 明細帶出，剩餘可收自動計算
 * - 填本次收貨數量 → 產生批次
 *********************************/

let rcvSourceType = "PO";
let rcvSourceId = "";
/** 明細行：{ item_no, product_id, order_qty, received_qty, remaining, unit, po_id?, po_item_id?, import_doc_id?, import_item_id? } */
let rcvLines = [];
let rcvProducts = [];

function formatRcvProductDisplay_(productId){
  const p = (rcvProducts || []).find(x => x.product_id === productId) || {};
  const name = p.product_name || productId || "";
  const spec = p.spec || "";
  return spec ? `${name}（${spec}）` : name;
}

/**
 * 從其他列表跳轉到「收貨入庫」時使用（預先選好來源與單號）
 * sourceType: "PO" | "IMPORT"
 */
function gotoReceive(sourceType, sourceId){
  try{
    window.__ERP_RCV_PREFILL__ = {
      sourceType: (sourceType === "IMPORT" ? "IMPORT" : "PO"),
      sourceId: String(sourceId || "")
    };
  }catch(_e){}
  if(typeof navigate === "function") navigate("receive");
}

function generateRcvId() {
  return rcvSourceType === "PO" ? generateId("GR") : generateId("IR");
}

async function receiveInit() {
  const dateEl = document.getElementById("rcv_receipt_date");
  if (dateEl) dateEl.value = nowIso16();
  const whEl = document.getElementById("rcv_warehouse");
  if (whEl) whEl.value = "MAIN";
  // 並行預取 product / PO / 報單，後續選來源時會走快取
  const [products] = await Promise.all([
    getAll("product").catch(() => []),
    getAll("purchase_order").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  rcvProducts = products || [];
  // 用 addEventListener 綁定，避免 inline onchange 找不到全域函數
  const srcType = document.getElementById("rcv_source_type");
  if (srcType) srcType.onchange = onRcvSourceTypeChange;
  const srcId = document.getElementById("rcv_source_id");
  if (srcId) srcId.onchange = onRcvSourceSelect;
  const postBtn = document.getElementById("rcv_post_btn");
  if (postBtn) postBtn.onclick = postReceipt;
  const resetBtn = document.getElementById("rcv_reset_btn");
  if (resetBtn) resetBtn.onclick = resetRcvForm;
  const logBtn = document.getElementById("rcv_log_btn");
  if (logBtn) logBtn.onclick = openRcvLog;
  const voidBtn = document.getElementById("rcv_void_btn");
  if (voidBtn && !voidBtn.dataset.bound) {
    voidBtn.dataset.bound = "1";
    voidBtn.onclick = voidPostedReceipt;
  }

  // 其他列表跳轉進來：自動選好來源與單號
  let prefill = null;
  try{ prefill = window.__ERP_RCV_PREFILL__ || null; }catch(_e){ prefill = null; }
  if(prefill && prefill.sourceId){
    const srcType = document.getElementById("rcv_source_type");
    if(srcType) srcType.value = (prefill.sourceType === "IMPORT" ? "IMPORT" : "PO");
    await onRcvSourceTypeChange();

    const srcId = document.getElementById("rcv_source_id");
    if(srcId) srcId.value = prefill.sourceId;
    await onRcvSourceSelect();

    try{ delete window.__ERP_RCV_PREFILL__; }catch(_e){}
  }else{
    await onRcvSourceTypeChange();
    resetRcvForm();
  }
}

async function onRcvSourceTypeChange() {
  rcvSourceType = document.getElementById("rcv_source_type")?.value || "PO";
  const label = document.getElementById("rcv_source_label");
  const sel = document.getElementById("rcv_source_id");
  const hint = document.getElementById("rcv_source_hint");
  if (!sel) return;

  label.textContent = rcvSourceType === "PO" ? "選擇 PO *" : "選擇報單 *";
  sel.innerHTML = '<option value="">載入中…</option>';
  rcvSourceId = "";
  rcvLines = [];
  renderRcvLines();
  document.getElementById("rcv_receipt_id").value = generateRcvId();
  if (hint) hint.textContent = rcvSourceType === "IMPORT" ? "請在下方選擇一張報單" : "請在下方選擇一張 PO";

  try {
    if (rcvSourceType === "PO") {
      const pos = await getAll("purchase_order");
      const openPOs = (pos || []).filter((p) => (p.status || "").toUpperCase() !== "CLOSED");
      sel.innerHTML =
        '<option value="">請選擇 PO</option>' +
        openPOs.map((p) => `<option value="${p.po_id}">${p.po_id} - ${p.supplier_id || ""}</option>`).join("");
      if (openPOs.length === 0) sel.innerHTML = '<option value="">尚無未結案 PO</option>';
    } else {
      const docs = await getAll("import_document");
      const list = (docs || []).filter((d) => (d.status || "").toUpperCase() !== "CANCELLED");
      sel.innerHTML =
        '<option value="">請選擇報單</option>' +
        list.map((d) => `<option value="${d.import_doc_id}">${d.import_doc_id} - ${d.import_no || ""}</option>`).join("");
      if (list.length === 0) sel.innerHTML = '<option value="">尚無報單，請先至「進口報單」建立</option>';
    }
  } catch (e) {
    sel.innerHTML = '<option value="">載入失敗</option>';
    console.error(e);
  }
  await refreshRcvVoidReceiptOptions();
}

async function onRcvSourceSelect() {
  rcvSourceId = document.getElementById("rcv_source_id")?.value || "";
  rcvLines = [];
  const tbody = document.getElementById("rcvLinesBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rcvSourceId) {
    document.getElementById("rcv_receipt_id").value = generateRcvId();
    await refreshRcvVoidReceiptOptions();
    return;
  }

  if (rcvSourceType === "PO") {
    const allItems = await getAll("purchase_order_item");
    const items = (allItems || []).filter((it) => it.po_id === rcvSourceId);
    rcvLines = items.map((it) => {
      const orderQty = Number(it.order_qty || 0);
      const received = Number(it.received_qty || 0);
      const remaining = Math.max(0, orderQty - received);
      return {
        item_no: it.po_item_id || "",
        product_id: it.product_id || "",
        order_qty: orderQty,
        received_qty: received,
        remaining,
        unit: it.unit || "",
        po_id: rcvSourceId,
        po_item_id: it.po_item_id,
      };
    });
  } else {
    const [importItems, importReceipts, receiptItems] = await Promise.all([
      getAll("import_item"),
      getAll("import_receipt"),
      getAll("import_receipt_item"),
    ]);
    const items = (importItems || []).filter((it) => it.import_doc_id === rcvSourceId);
    const receiptIds = (importReceipts || [])
      .filter(
        (r) =>
          r.import_doc_id === rcvSourceId && String(r.status || "").toUpperCase() !== "CANCELLED"
      )
      .map((r) => r.import_receipt_id);
    const receivedByItemId = {};
    (receiptItems || []).forEach((iri) => {
      if (receiptIds.includes(iri.import_receipt_id)) {
        const k = iri.import_item_id || iri.product_id;
        receivedByItemId[k] = (receivedByItemId[k] || 0) + Number(iri.received_qty || 0);
      }
    });
    rcvLines = items.map((it, idx) => {
      const orderQty = Number(it.declared_qty || 0);
      const received = receivedByItemId[it.import_item_id] || 0;
      const remaining = Math.max(0, orderQty - received);
      return {
        item_no: it.item_no != null ? it.item_no : idx + 1,
        product_id: it.product_id || "",
        order_qty: orderQty,
        received_qty: received,
        remaining,
        unit: it.declared_unit || it.unit || "",
        import_doc_id: rcvSourceId,
        import_item_id: it.import_item_id,
      };
    });
  }

  renderRcvLines();
  document.getElementById("rcv_receipt_id").value = generateRcvId();
  await refreshRcvVoidReceiptOptions();
}

function rcvSumMovementQtyForLot_(movements, lotId) {
  return (movements || [])
    .filter((m) => m.lot_id === lotId)
    .reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

async function refreshRcvVoidReceiptOptions() {
  const sel = document.getElementById("rcv_void_receipt_id");
  if (!sel) return;
  if (!rcvSourceId) {
    sel.innerHTML = '<option value="">請先選擇 PO／報單</option>';
    return;
  }
  try {
    if (rcvSourceType === "PO") {
      const all = await getAll("goods_receipt").catch(() => []);
      const rows = (all || []).filter(
        (r) => r.po_id === rcvSourceId && String(r.status || "").toUpperCase() !== "CANCELLED"
      );
      rows.sort((a, b) => String(b.receipt_date || "").localeCompare(String(a.receipt_date || "")));
      sel.innerHTML =
        '<option value="">請選擇要作廢的採購收貨單（GR）</option>' +
        rows.map((r) => `<option value="${r.gr_id}">${r.gr_id} — ${r.receipt_date || ""}</option>`).join("");
    } else {
      const all = await getAll("import_receipt").catch(() => []);
      const rows = (all || []).filter(
        (r) =>
          r.import_doc_id === rcvSourceId && String(r.status || "").toUpperCase() !== "CANCELLED"
      );
      rows.sort((a, b) => String(b.receipt_date || "").localeCompare(String(a.receipt_date || "")));
      sel.innerHTML =
        '<option value="">請選擇要作廢的進口收貨單（IR）</option>' +
        rows
          .map((r) => `<option value="${r.import_receipt_id}">${r.import_receipt_id} — ${r.receipt_date || ""}</option>`)
          .join("");
    }
  } catch (e) {
    sel.innerHTML = '<option value="">載入收貨單列表失敗</option>';
    console.error(e);
  }
}

function renderRcvLines() {
  const tbody = document.getElementById("rcvLinesBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  rcvLines.forEach((row, idx) => {
    const orderLabel = rcvSourceType === "PO" ? "訂購數量" : "申報數量";
    const canReceive = Number(row.remaining || 0) > 0;
    const maxVal = canReceive ? row.remaining : 0;
    const placeholder = canReceive ? "0" : "剩餘=0";
    const disabledAttr = canReceive ? "" : 'disabled value="0"';
    tbody.innerHTML += `
      <tr>
        <td>${row.item_no}</td>
        <td>${formatRcvProductDisplay_(row.product_id)}</td>
        <td>${row.order_qty}</td>
        <td>${row.received_qty}</td>
        <td>${row.remaining}</td>
        <td><input type="number" id="rcv_qty_${idx}" min="0" max="${maxVal}" step="0.01" placeholder="${placeholder}" ${disabledAttr} style="width:100px;"></td>
        <td><input type="date" id="rcv_mfg_${idx}" style="width:120px;padding:4px 6px;"></td>
        <td><input type="date" id="rcv_exp_${idx}" style="width:120px;padding:4px 6px;"></td>
        <td>${row.unit}</td>
      </tr>
    `;
  });
}

function getRcvInputQtys() {
  return rcvLines.map((_, idx) => {
    const el = document.getElementById(`rcv_qty_${idx}`);
    return Math.max(0, Number(el?.value || 0));
  });
}

function getRcvLotDates() {
  return rcvLines.map((_, idx) => {
    const mfg = (document.getElementById(`rcv_mfg_${idx}`)?.value || "").trim();
    const exp = (document.getElementById(`rcv_exp_${idx}`)?.value || "").trim();
    return { manufacture_date: mfg, expiry_date: exp };
  });
}

function resetRcvForm() {
  rcvLines = [];
  renderRcvLines();
  document.getElementById("rcv_receipt_id").value = generateRcvId();
  const dateEl = document.getElementById("rcv_receipt_date");
  if (dateEl) dateEl.value = nowIso16();
  const whEl = document.getElementById("rcv_warehouse");
  if (whEl) whEl.value = "MAIN";
  const rmEl = document.getElementById("rcv_remark");
  if (rmEl) rmEl.value = "";
  const sel = document.getElementById("rcv_source_id");
  if (sel) sel.value = "";
  rcvSourceId = "";
  refreshRcvVoidReceiptOptions().catch(() => {});
}

function openRcvLog() {
  const id = document.getElementById("rcv_receipt_id")?.value || "";
  const type = rcvSourceType === "PO" ? "goods_receipt" : "import_receipt";
  if (typeof openLogs === "function") openLogs(type, id, "inbound");
}

async function postReceipt() {
  const receiptId = (document.getElementById("rcv_receipt_id")?.value || "").trim().toUpperCase();
  const receiptDate = document.getElementById("rcv_receipt_date")?.value || "";
  const warehouse = (document.getElementById("rcv_warehouse")?.value || "").trim();
  const remark = (document.getElementById("rcv_remark")?.value || "").trim();

  if (!receiptId) return showToast("收貨單ID 必填", "error");
  if (!rcvSourceId) return showToast("請選擇 " + (rcvSourceType === "PO" ? "PO" : "報單"), "error");
  if (!receiptDate) return showToast("收貨日期 必填", "error");

  const qtys = getRcvInputQtys();
  const lotDates = getRcvLotDates();
  const hasQty = qtys.some((q) => q > 0);
  if (!hasQty) return showToast("請至少輸入一筆本次收貨數量", "error");

  for(let i = 0; i < qtys.length; i++){
    if((qtys[i] || 0) <= 0) continue;
    const d = lotDates[i] || {};
    const mfg = d.manufacture_date || "";
    const exp = d.expiry_date || "";
    if(mfg && exp && exp < mfg){
      return showToast(`第 ${i + 1} 筆：有效期不可早於製造日`, "error");
    }
  }

  showSaveHint();
  try {
  if (rcvSourceType === "PO") {
    await postGoodsReceiptUnified(receiptId, receiptDate, warehouse, remark, qtys, lotDates);
  } else {
    await postImportReceiptUnified(receiptId, receiptDate, warehouse, remark, qtys, lotDates);
  }
  } finally { hideSaveHint(); }
}

async function postGoodsReceiptUnified(gr_id, receipt_date, warehouse, remark, qtys, lotDates) {
  const po_id = rcvSourceId;
  const allItems = await getAll("purchase_order_item");
  const currentItems = (allItems || []).filter((it) => it.po_id === po_id);
  const itemMap = new Map(currentItems.map((it) => [it.po_item_id, it]));

  const gr = {
    gr_id,
    po_id,
    receipt_date,
    warehouse,
    status: "OPEN",
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
  };
  await createRecord("goods_receipt", gr);

  let created = 0;
  for (let idx = 0; idx < rcvLines.length; idx++) {
    const qty = qtys[idx] || 0;
    if (qty <= 0) continue;
    const row = rcvLines[idx];
    const it = itemMap.get(row.po_item_id);
    if (!it) continue;
    const ordered = Number(it.order_qty || 0);
    const received = Number(it.received_qty || 0);
    const remain = Math.max(0, ordered - received);
    if (qty > remain) {
      showToast(`品項 ${row.po_item_id} 超過剩餘可收`, "error");
      continue;
    }

    const p = (rcvProducts || []).find((x) => x.product_id === row.product_id);
    const lotType = p?.type || "RM";
    const lot_id = generateId("LOT");
    const dates = lotDates?.[idx] || {};

    await createRecord("lot", {
      lot_id,
      product_id: row.product_id,
      source_type: "PURCHASE",
      source_id: gr_id,
      qty: String(qty),
      unit: row.unit,
      type: lotType,
      status: "",
      inventory_status: "ACTIVE",
      received_date: receipt_date,
      manufacture_date: dates.manufacture_date || "",
      expiry_date: dates.expiry_date || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      remark: `PO:${po_id} / ITEM:${row.po_item_id}`,
    });

    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id,
      product_id: row.product_id,
      qty: String(qty),
      unit: row.unit,
      ref_type: "GOODS_RECEIPT",
      ref_id: gr_id,
      remark: `PO IN: ${po_id}`,
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
    });

    await createRecord("goods_receipt_item", {
      gr_item_id: `GRI-${gr_id}-${String(created + 1).padStart(3, "0")}`,
      gr_id,
      po_id,
      po_item_id: row.po_item_id,
      product_id: row.product_id,
      received_qty: String(qty),
      unit: row.unit,
      lot_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
    });

    await updateRecord("purchase_order_item", "po_item_id", row.po_item_id, {
      received_qty: String(received + qty),
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });
    created++;
  }

  const updatedItems = (await getAll("purchase_order_item")).filter((it) => it.po_id === po_id);
  const allClosed = updatedItems.every((it) => Number(it.received_qty || 0) >= Number(it.order_qty || 0));
  const anyReceived = updatedItems.some((it) => Number(it.received_qty || 0) > 0);
  const nextStatus = allClosed ? "CLOSED" : anyReceived ? "PARTIAL" : "OPEN";
  await updateRecord("purchase_order", "po_id", po_id, {
    status: nextStatus,
    updated_by: getCurrentUser(),
    updated_at: nowIso16(),
  });

  const poMsg = created === 0
    ? "本次沒有可收數量（本次收貨數量未填或超過可收量），未產生 Lot。"
    : `收貨完成：已產生 ${created} 個 Lot（PENDING）`;
  showToast(poMsg);
  resetRcvForm();
  await onRcvSourceTypeChange();
}

async function postImportReceiptUnified(import_receipt_id, receipt_date, warehouse, remark, qtys, lotDates) {
  const import_doc_id = rcvSourceId;
  const doc = await getOne("import_document", "import_doc_id", import_doc_id).catch(() => null);
  if (!doc) return showToast("找不到此報單", "error");
  const docNo = doc.import_no || "";

  const receipt = {
    import_receipt_id,
    import_doc_id,
    receipt_date,
    warehouse,
    status: "OPEN",
    remark,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: "",
  };
  await createRecord("import_receipt", receipt);

  let created = 0;
  for (let idx = 0; idx < rcvLines.length; idx++) {
    const qty = qtys[idx] || 0;
    if (qty <= 0) continue;
    const row = rcvLines[idx];
    if (qty > row.remaining) {
      showToast(`品項 ${row.product_id} 超過剩餘可收`, "error");
      continue;
    }

    const p = (rcvProducts || []).find((x) => x.product_id === row.product_id);
    const lotType = p?.type || "RM";
    const lot_id = generateId("LOT");
    const dates = lotDates?.[idx] || {};

    await createRecord("lot", {
      lot_id,
      product_id: row.product_id,
      source_type: "IMPORT",
      source_id: import_receipt_id,
      qty: String(qty),
      unit: row.unit,
      type: lotType,
      status: "",
      inventory_status: "ACTIVE",
      received_date: receipt_date,
      manufacture_date: dates.manufacture_date || "",
      expiry_date: dates.expiry_date || "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
      remark: `Import: ${import_doc_id}${docNo ? " / " + docNo : ""}`.trim(),
    });

    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "IN",
      lot_id,
      product_id: row.product_id,
      qty: String(qty),
      unit: row.unit,
      ref_type: "IMPORT_RECEIPT",
      ref_id: import_receipt_id,
      remark: `Import IN: ${import_doc_id}`,
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
    });

    await createRecord("import_receipt_item", {
      import_receipt_item_id: `IRI-${import_receipt_id}-${String(created + 1).padStart(3, "0")}`,
      import_receipt_id,
      import_item_id: row.import_item_id || "",
      product_id: row.product_id,
      received_qty: String(qty),
      unit: row.unit,
      lot_id,
      remark: "",
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: "",
    });
    created++;
  }

  const irMsg = created === 0
    ? "本次沒有可收數量（本次收貨數量未填或超過可收量），未產生 Lot。"
    : `進口收貨完成：已產生 ${created} 個 Lot（PENDING）`;
  showToast(irMsg);
  resetRcvForm();
  await onRcvSourceTypeChange();
}

async function voidPostedReceipt() {
  const receiptId = (document.getElementById("rcv_void_receipt_id")?.value || "").trim();
  if (!receiptId) return showToast("請選擇要作廢的收貨單", "error");
  if (!rcvSourceId) return showToast("請先選擇 PO 或進口報單", "error");

  if (rcvSourceType === "PO") {
    await cancelGoodsReceiptUnified(receiptId);
  } else {
    await cancelImportReceiptUnified(receiptId);
  }
}

/**
 * 作廢採購收貨：ADJUST 沖銷原 IN、Lot→VOID／QA REJECTED、goods_receipt→CANCELLED、回退 PO 已收。
 * 僅當各 Lot 之 movements 加總仍 ≥ 該筆入庫量（未被下游扣用）時允許。
 */
async function cancelGoodsReceiptUnified(gr_id) {
  const gr = await getOne("goods_receipt", "gr_id", gr_id).catch(() => null);
  if (!gr) return showToast("找不到收貨單", "error");
  if (String(gr.status || "").toUpperCase() === "CANCELLED") return showToast("此收貨單已作廢", "error");
  if (String(gr.po_id || "") !== String(rcvSourceId)) return showToast("收貨單與目前選擇的 PO 不符", "error");

  const itemsAll = await getAll("goods_receipt_item").catch(() => []);
  const items = (itemsAll || []).filter((x) => x.gr_id === gr_id);
  if (items.length === 0) return showToast("無收貨明細，無法作廢", "error");

  const movements = await getAll("inventory_movement").catch(() => []);
  const dupCancel = (movements || []).some(
    (m) => String(m.ref_type || "") === "GOODS_RECEIPT_CANCEL" && String(m.ref_id || "") === gr_id
  );
  if (dupCancel) return showToast("此收貨單已有作廢沖銷記錄", "error");

  const plan = [];
  for (const it of items) {
    const lotId = it.lot_id || "";
    const inMv = (movements || []).find(
      (m) =>
        m.lot_id === lotId &&
        String(m.movement_type || "").toUpperCase() === "IN" &&
        String(m.ref_type || "").toUpperCase() === "GOODS_RECEIPT" &&
        String(m.ref_id || "") === gr_id
    );
    if (!inMv) {
      return showToast(`批號 ${lotId}：找不到對應之採購入庫異動（IN），無法作廢`, "error");
    }
    const inQty = Math.abs(Number(inMv.qty || 0));
    const net = rcvSumMovementQtyForLot_(movements, lotId);
    if (net + 1e-9 < inQty) {
      return showToast(
        `批號 ${lotId}：可用量不足（已有出庫／加工／調整等），無法作廢整張收貨單`,
        "error"
      );
    }
    plan.push({ it, inMv, lotId, inQty });
  }

  const ok = confirm(
    `確定作廢採購收貨單 ${gr_id}？\n\n將以庫存調整（ADJUST）沖銷入庫、Lot 標為不可用（VOID），並回退 PO 已收數量。`
  );
  if (!ok) return;

  showSaveHint();
  try {
    for (const { inMv, lotId, inQty } of plan) {
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "ADJUST",
        lot_id: lotId,
        product_id: inMv.product_id || "",
        qty: String(-Math.abs(inQty)),
        unit: inMv.unit || "",
        ref_type: "GOODS_RECEIPT_CANCEL",
        ref_id: gr_id,
        remark: `REVERSAL(IN) of ${inMv.movement_id || ""}`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });
    }
    for (const { it } of plan) {
      await updateRecord("lot", "lot_id", it.lot_id, {
        inventory_status: "VOID",
        status: "REJECTED",
        updated_by: getCurrentUser(),
        updated_at: nowIso16(),
      });
    }
    for (const it of items) {
      const poi = await getOne("purchase_order_item", "po_item_id", it.po_item_id).catch(() => null);
      if (!poi) continue;
      const dec = Number(it.received_qty || 0);
      const next = Math.max(0, Number(poi.received_qty || 0) - dec);
      await updateRecord("purchase_order_item", "po_item_id", it.po_item_id, {
        received_qty: String(next),
        updated_by: getCurrentUser(),
        updated_at: nowIso16(),
      });
    }

    const po_id = gr.po_id;
    const updatedItems = (await getAll("purchase_order_item").catch(() => [])).filter(
      (row) => row.po_id === po_id
    );
    const allClosed = updatedItems.every(
      (row) => Number(row.received_qty || 0) >= Number(row.order_qty || 0)
    );
    const anyReceived = updatedItems.some((row) => Number(row.received_qty || 0) > 0);
    const nextPoStatus = allClosed ? "CLOSED" : anyReceived ? "PARTIAL" : "OPEN";
    await updateRecord("purchase_order", "po_id", po_id, {
      status: nextPoStatus,
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });

    await updateRecord("goods_receipt", "gr_id", gr_id, {
      status: "CANCELLED",
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });

    showToast("作廢完成：已沖銷入庫、Lot 已標示 VOID，並回退 PO 已收");
    await refreshRcvVoidReceiptOptions();
    await onRcvSourceSelect();
  } finally {
    hideSaveHint();
  }
}

/**
 * 作廢進口收貨：同上，但不涉及 PO（進口已收由 import_receipt_item 匯總）。
 */
async function cancelImportReceiptUnified(import_receipt_id) {
  const ir = await getOne("import_receipt", "import_receipt_id", import_receipt_id).catch(() => null);
  if (!ir) return showToast("找不到進口收貨單", "error");
  if (String(ir.status || "").toUpperCase() === "CANCELLED") return showToast("此收貨單已作廢", "error");
  if (String(ir.import_doc_id || "") !== String(rcvSourceId)) {
    return showToast("收貨單與目前選擇的報單不符", "error");
  }

  const itemsAll = await getAll("import_receipt_item").catch(() => []);
  const items = (itemsAll || []).filter((x) => x.import_receipt_id === import_receipt_id);
  if (items.length === 0) return showToast("無收貨明細，無法作廢", "error");

  const movements = await getAll("inventory_movement").catch(() => []);
  const dupCancel = (movements || []).some(
    (m) => String(m.ref_type || "") === "IMPORT_RECEIPT_CANCEL" && String(m.ref_id || "") === import_receipt_id
  );
  if (dupCancel) return showToast("此收貨單已有作廢沖銷記錄", "error");

  const plan = [];
  for (const it of items) {
    const lotId = it.lot_id || "";
    const inMv = (movements || []).find(
      (m) =>
        m.lot_id === lotId &&
        String(m.movement_type || "").toUpperCase() === "IN" &&
        String(m.ref_type || "").toUpperCase() === "IMPORT_RECEIPT" &&
        String(m.ref_id || "") === import_receipt_id
    );
    if (!inMv) {
      return showToast(`批號 ${lotId}：找不到對應之進口入庫異動（IN），無法作廢`, "error");
    }
    const inQty = Math.abs(Number(inMv.qty || 0));
    const net = rcvSumMovementQtyForLot_(movements, lotId);
    if (net + 1e-9 < inQty) {
      return showToast(
        `批號 ${lotId}：可用量不足（已有出庫／加工／調整等），無法作廢整張收貨單`,
        "error"
      );
    }
    plan.push({ it, inMv, lotId, inQty });
  }

  const ok = confirm(
    `確定作廢進口收貨單 ${import_receipt_id}？\n\n將以庫存調整（ADJUST）沖銷入庫，並將 Lot 標為不可用（VOID）。`
  );
  if (!ok) return;

  showSaveHint();
  try {
    for (const { inMv, lotId, inQty } of plan) {
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "ADJUST",
        lot_id: lotId,
        product_id: inMv.product_id || "",
        qty: String(-Math.abs(inQty)),
        unit: inMv.unit || "",
        ref_type: "IMPORT_RECEIPT_CANCEL",
        ref_id: import_receipt_id,
        remark: `REVERSAL(IN) of ${inMv.movement_id || ""}`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });
    }
    for (const { it } of plan) {
      await updateRecord("lot", "lot_id", it.lot_id, {
        inventory_status: "VOID",
        status: "REJECTED",
        updated_by: getCurrentUser(),
        updated_at: nowIso16(),
      });
    }

    await updateRecord("import_receipt", "import_receipt_id", import_receipt_id, {
      status: "CANCELLED",
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
    });

    showToast("作廢完成：已沖銷入庫、Lot 已標示 VOID");
    await refreshRcvVoidReceiptOptions();
    await onRcvSourceSelect();
  } finally {
    hideSaveHint();
  }
}
