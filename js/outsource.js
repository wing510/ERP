/**
 * Outsource / Process Orders（API 版）
 * - 分階段：建立(OPEN) → 送加工(PROCESS_OUT) → 回收(PROCESS_IN) → 完成(POSTED)
 * - 支援分批回收；取消加工單可回沖 movements
 */

let procInputs = [];
let procOutputs = [];
let procLots = [];
let procMovements = [];
let procProducts = [];
let procSuppliers = [];
let procEditing = false;
let procImportReceiptIdToDocId = {};
let procGoodsReceiptIdToPoId = {};
let procImportDocIdToImportNo = {};
let procLoadedInputsForHint = [];
let procLoadedOutputsForHint = [];
let procRelInputsByOutputLotId = {};
let procAvailableByLotId = {};
let procReceiveInFlight = false;
let procIssueInFlight = false;
let procEditingInputDraftId = "";
let procEditingOutputDraftId = "";
let procSelectedDbInputId = "";
let procSelectedDbOutputId = "";
// 注意：不在前端鎖住投料新增；改以 Lot Picker 條件（可用量>0）避免誤選無庫存 Lot。

// 逐筆操作：列內「儲存中…」提示（避免誤以為沒按到）
const procRowBusy = {
  input: {},  // { [process_input_id]: "儲存中…" }
  output: {}  // { [process_output_id]: "儲存中…" }
};

function setProcRowBusy_(kind, id, text){
  const k = String(kind || "");
  const key = String(id || "");
  if(!key) return;
  if(k !== "input" && k !== "output") return;
  if(text){
    procRowBusy[k][key] = String(text);
  }else{
    delete procRowBusy[k][key];
  }
  if(k === "input") renderProcInputs();
  if(k === "output") renderProcOutputs();
}

function parseIsoNoTzAsLocalKey_(s){
  // 現有系統多用 nowIso16() → YYYY-MM-DDTHH:mm
  // 這裡用字串比大小即可（同格式時等同時間排序）
  return String(s || "");
}

function disableButtonsByOnclick_(onclickText, disabled){
  const sel = `button[onclick="${onclickText}"]`;
  document.querySelectorAll(sel).forEach(btn => { btn.disabled = !!disabled; });
}

function setProcActionInlineHint_(onclickText, text){
  const sel = `button[onclick="${onclickText}"]`;
  document.querySelectorAll(sel).forEach(btn => {
    const group = btn.closest(".button-group");
    if(!group) return;
    const hintSel = `[data-proc-hint-for="${onclickText.replace(/"/g, '\\"')}"]`;
    const old = group.querySelector(hintSel);
    if(old) old.remove();
    if(text){
      const span = document.createElement("span");
      span.className = "save-hint-inline";
      span.setAttribute("data-proc-hint-for", onclickText);
      span.textContent = String(text);
      group.appendChild(span);
    }
  });
}

function invalidateProcCaches_(){
  // 確保作廢/回沖/送加工/回收後，Lot 清單與可用量立刻反映最新
  try{
    invalidateCache("lot");
    invalidateCache("inventory_movement");
    invalidateCache("process_order_input");
    invalidateCache("process_order_output");
    invalidateCache("lot_relation");
    invalidateCache("process_order");
  }catch(_e){}
}

function formatProcSupplierDisplay_(supplierId){
  const id = String(supplierId || "");
  if(!id) return "";
  const s = (procSuppliers || []).find(x => String(x.supplier_id || "") === id) || {};
  const name = String(s.supplier_name || "").trim();
  return name ? `${id} - ${name}` : id;
}

function setProcStatusHint_(text){
  const el = document.getElementById("procStatusHint");
  if(!el) return;
  el.textContent = text || "加工狀態：未載入加工單";
  // 比照 import：warn 用棕色，其餘用灰色（避免過度搶眼）
  const t = String(text || "");
  const isWarn = t.includes("未載入") || t.includes("載入中") || t.includes("未送加工") || t.includes("待回收") || t.includes("部分回收");
  const isError = t.includes("已取消");
  el.style.color = isError ? "#991b1b" : (isWarn ? "#92400e" : "#64748b");
}

function deriveProcStatusHint_(po, inputs, outputs){
  if(!po) return "加工狀態：未載入加工單";
  const status = String(po.status || "").trim().toUpperCase();
  if(status === "CANCELLED") return "加工狀態：已取消";

  const inCount = Array.isArray(inputs) ? inputs.length : 0;
  // 已作廢回收不應計入「已回收批數」
  const outCount = Array.isArray(outputs)
    ? outputs.filter(x => String(x.status || "").toUpperCase() !== "CANCELLED").length
    : 0;

  if(inCount === 0){
    return "加工狀態：未送加工（尚未扣庫）";
  }
  if(outCount === 0){
    return "加工狀態：已送加工（待回收）";
  }
  if(status === "POSTED"){
    return "加工狀態：加工已回收（已結案）";
  }
  // OPEN + outputs>0 → 部分回收
  return `加工狀態：部分回收（已回收 ${outCount} 批）`;
}

function formatProcProductDisplay_(productId){
  const p = (procProducts || []).find(x => x.product_id === productId) || {};
  const name = p.product_name || productId || "";
  const spec = p.spec || "";
  return spec ? `${name}（${spec}）` : name;
}

function escapeHtml_(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderProcLoadedInputsTable_(inputs){
  const tbody = document.getElementById("procLoadedInputsTbody");
  if(!tbody) return;
  const rows = Array.isArray(inputs) ? inputs : [];
  tbody.innerHTML = "";
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">(無)</td></tr>`;
    return;
  }
  rows.forEach((x, idx) => {
    const inId = String(x.process_input_id || "");
    const lotId = String(x.lot_id || "");
    const productId = String(x.product_id || "");
    const qty = (x.issue_qty != null ? x.issue_qty : "");
    const unit = String(x.unit || "");
    const safeInId = inId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${escapeHtml_(lotId)}</td>
        <td>${escapeHtml_(formatProcProductDisplay_(productId))}</td>
        <td>${escapeHtml_(qty)}</td>
        <td>${escapeHtml_(unit)}</td>
        <td>
          <button class="btn-secondary" ${inId ? "" : "disabled"} onclick="${inId ? `voidProcessInput('${safeInId}')` : "return false;"}">回沖本筆投料</button>
        </td>
      </tr>
    `;
  });
}

async function voidProcessInput(processInputId){
  clearProcBlockNotice_();
  const inId = String(processInputId || "").trim();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!procId) return showToast("請先載入加工單","error");
  if(!inId) return showToast("找不到投料明細ID","error");

  setProcRowBusy_("input", inId, "儲存中…");
  showSaveHint();
  try{
    const po = await getOne("process_order","process_order_id",procId).catch(()=>null);
    if(!po) return showToast("找不到加工單","error");
    if((po.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此加工單已取消，不能回沖投料。", "error");
    }

    const inputsAll = await getAll("process_order_input").catch(()=>[]);
    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const mvAll = await getAll("inventory_movement").catch(()=>[]);
    const shipItems = await getAll("shipment_item").catch(()=>[]);

    const input = (inputsAll || []).find(x => String(x.process_input_id || "") === inId);
    if(!input) return showToast("找不到此投料明細","error");
    if(String(input.process_order_id || "").toUpperCase() !== procId){
      return showToast("投料明細不屬於目前加工單","error");
    }

    const outputs = (outputsAll || []).filter(x => String(x.process_order_id || "").toUpperCase() === procId);
    const activeOutputs = outputs.filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");
    if(activeOutputs.length > 0){
      showProcBlockNotice_("回沖投料被阻擋", ["此加工單已有回收紀錄（未作廢），不可回沖投料（會造成已回收卻未投料的矛盾）。請先逐筆作廢回收，或整單取消。"]);
      return showToast("回沖失敗：已有回收紀錄（未作廢）。", "error");
    }

    const lotId = String(input.lot_id || "");
    if(!lotId) return showToast("此投料明細缺少 Lot ID，無法回沖", "error");

    const srcMv = (mvAll || []).filter(m =>
      String(m.ref_type || "") === "PROCESS_ORDER" &&
      String(m.ref_id || "").toUpperCase() === procId &&
      String(m.movement_type || "").toUpperCase() === "PROCESS_OUT" &&
      String(m.lot_id || "") === lotId
    );
    if(srcMv.length === 0){
      showProcBlockNotice_("回沖投料被阻擋", [`找不到此投料 Lot ${lotId} 的送加工扣庫異動（PROCESS_OUT），無法回沖。`]);
      return showToast("回沖失敗：缺少送加工異動。", "error");
    }

    if(!confirm(`確定回沖本筆投料？\n- 投料ID：${inId}\n- 投料Lot：${lotId}\n- 數量：${input.issue_qty} ${input.unit || ""}\n\n注意：若該 Lot 已被下游使用，系統會阻擋。`)){
      return;
    }

    // 下游使用檢查：送加工後，此 lot 是否有其他單據異動/出貨
    const issueAt = parseIsoNoTzAsLocalKey_(srcMv.map(m => m.created_at).sort()[0] || "");
    const blockReasons = [];
    (shipItems || []).forEach(s => {
      if(String(s.lot_id || "") === lotId){
        blockReasons.push(`投料 Lot ${lotId} 已被出貨使用（出貨單：${s.shipment_id || ""}），不可回沖投料。`);
      }
    });
    (mvAll || []).forEach(m => {
      if(String(m.lot_id || "") !== lotId) return;
      const createdAt = parseIsoNoTzAsLocalKey_(m.created_at);
      if(!(createdAt && issueAt && createdAt > issueAt)) return;
      const sameOrder = String(m.ref_type || "") === "PROCESS_ORDER" && String(m.ref_id || "").toUpperCase() === procId;
      const isReversal = String(m.remark || "").includes("REVERSAL");
      if(!sameOrder && !isReversal){
        blockReasons.push(`投料 Lot ${lotId} 在送加工後已有下游庫存異動：${m.movement_type || "UNKNOWN"}（ref:${m.ref_type || ""}:${m.ref_id || ""}）。`);
      }
    });
    const uniq = Array.from(new Set(blockReasons));
    if(uniq.length){
      showProcBlockNotice_("回沖投料被阻擋", uniq);
      return showToast("回沖失敗：投料 Lot 已有下游使用紀錄，請先展開明細。", "error");
    }

    // 回沖此 lot 的 PROCESS_OUT（可能不只一筆，保守全回沖；並用 remark 防重複）
    for(const m of srcMv){
      const already = (mvAll || []).some(x => String(x.remark || "").includes(`REVERSAL(PROCESS_OUT) of ${m.movement_id || ""}`));
      if(already) continue;
      const qty = Number(m.qty || 0);
      if(!qty) continue;
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "ADJUST",
        lot_id: m.lot_id || "",
        product_id: m.product_id || "",
        qty: String(-qty),
        unit: m.unit || "",
        ref_type: "PROCESS_ORDER",
        ref_id: procId,
        remark: `REVERSAL(PROCESS_OUT) of ${m.movement_id || ""} (${procId})`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });
    }

    await deleteRecord("process_order_input","process_input_id",inId);

    setProcRowBusy_("input", inId, "");
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(procId);
    showToast("已回沖本筆投料（扣庫已回沖）");
  } finally {
    setProcRowBusy_("input", inId, "");
    hideSaveHint();
  }
}

function renderProcLoadedOutputsTable_(outputs){
  const tbody = document.getElementById("procLoadedOutputsTbody");
  if(!tbody) return;
  const rows = Array.isArray(outputs) ? outputs : [];
  tbody.innerHTML = "";
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;">(無)</td></tr>`;
    return;
  }
  rows.forEach((x, idx) => {
    const outId = String(x.process_output_id || "");
    const lotId = String(x.lot_id || "");
    const productId = String(x.product_id || "");
    const qty = (x.receive_qty != null ? x.receive_qty : "");
    const unit = String(x.unit || "");
    const status = String(x.status || "");
    const canVoid = !!outId && String(status).toUpperCase() !== "CANCELLED";
    const safeOutId = outId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    tbody.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td>${escapeHtml_(lotId)}</td>
        <td>${escapeHtml_(formatProcProductDisplay_(productId))}</td>
        <td>${escapeHtml_(qty)}</td>
        <td>${escapeHtml_(unit)}</td>
        <td>${escapeHtml_(termLabel(status))}</td>
        <td>
          <button class="btn-secondary" ${canVoid ? "" : "disabled"} onclick="${canVoid ? `voidProcessOutput('${safeOutId}')` : "return false;"}">作廢本筆回收</button>
        </td>
      </tr>
    `;
  });
}

async function voidProcessOutput(processOutputId){
  clearProcBlockNotice_();
  const outId = String(processOutputId || "").trim();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!procId) return showToast("請先載入加工單","error");
  if(!outId) return showToast("找不到回收明細ID","error");

  setProcRowBusy_("output", outId, "儲存中…");
  showSaveHint();
  try{
    const po = await getOne("process_order","process_order_id",procId).catch(()=>null);
    if(!po) return showToast("找不到加工單","error");
    if((po.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此加工單已取消，不能作廢回收。", "error");
    }

    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const out = (outputsAll || []).find(x => String(x.process_output_id || "") === outId);
    if(!out) return showToast("找不到此回收明細","error");
    if(String(out.process_order_id || "").toUpperCase() !== procId){
      return showToast("回收明細不屬於目前加工單","error");
    }
    if(String(out.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此筆回收已作廢", "error");
    }

    const lotId = String(out.lot_id || "");
    const qty = Number(out.receive_qty || 0);
    if(!lotId) return showToast("此筆回收缺少 Lot ID，無法作廢", "error");
    if(!(qty > 0)) return showToast("此筆回收數量異常，無法作廢", "error");

    if(!confirm(`確定作廢本筆回收？\n- 回收ID：${outId}\n- 產出Lot：${lotId}\n- 數量：${out.receive_qty} ${out.unit || ""}\n\n注意：若此產出Lot已被下游使用，系統會阻擋。`)){
      return;
    }

    // 下游使用檢查（只檢查此產出 lot）
    const mvAll = await getAll("inventory_movement").catch(()=>[]);
    const relAll = await getAll("lot_relation").catch(()=>[]);
    const shipItems = await getAll("shipment_item").catch(()=>[]);
    const blockReasons = [];
    (mvAll || []).forEach(m => {
      if(String(m.lot_id || "") !== lotId) return;
      const sameOrder = String(m.ref_type || "") === "PROCESS_ORDER" && String(m.ref_id || "").toUpperCase() === procId;
      const isReversal = String(m.remark || "").includes("REVERSAL");
      if(!sameOrder && !isReversal){
        const mt = m.movement_type || "UNKNOWN";
        const rt = m.ref_type || "";
        const rid = m.ref_id || "";
        blockReasons.push(`產出 Lot ${lotId} 已被下游使用：庫存異動 ${mt}${rt || rid ? `（ref:${rt}:${rid}）` : ""}。`);
      }
    });
    (relAll || []).forEach(r => {
      const from = String(r.from_lot_id || "");
      if(from !== lotId) return;
      const sameOrder = String(r.ref_type || "") === "PROCESS_ORDER" && String(r.ref_id || "").toUpperCase() === procId;
      if(!sameOrder){
        blockReasons.push(`產出 Lot ${lotId} 已被後續追溯關聯使用（lot_relation）。`);
      }
    });
    (shipItems || []).forEach(s => {
      if(String(s.lot_id || "") === lotId){
        blockReasons.push(`產出 Lot ${lotId} 已被出貨使用（出貨單：${s.shipment_id || ""}）。`);
      }
    });
    const uniqReasons = Array.from(new Set(blockReasons));
    if(uniqReasons.length){
      showProcBlockNotice_("作廢回收被阻擋", uniqReasons);
      return showToast("作廢失敗：有下游使用紀錄，請先展開明細。", "error");
    }

    // 回沖 PROCESS_IN：用 ADJUST 避免 lot gating 規則卡住
    await createRecord("inventory_movement", {
      movement_id: generateId("MV"),
      movement_type: "ADJUST",
      lot_id: lotId,
      product_id: out.product_id || "",
      qty: String(-Math.abs(qty)),
      unit: out.unit || "",
      ref_type: "PROCESS_ORDER",
      ref_id: procId,
        remark: `REVERSAL(PROCESS_IN) of ${outId} (${procId})`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });

    await updateRecord("process_order_output","process_output_id",outId,{
      status: "CANCELLED",
      remark: ((out.remark || "").trim() ? (out.remark + " | ") : "") + "回收已作廢"
    });

    // 將此產出 lot 標記為作廢（避免後續誤用；可用量也會因回沖歸零）
    const lotsAll = await getAll("lot").catch(()=>[]);
    const lot = (lotsAll || []).find(l => String(l.lot_id || "") === lotId);
    if(lot){
      await updateRecord("lot","lot_id",lotId,{
        inventory_status: "VOID",
        updated_by: getCurrentUser(),
        updated_at: nowIso16(),
        remark: ((lot.remark || "").trim() ? (lot.remark + " | ") : "") + "回收作廢"
      });
    }

    // 重新計算加工單狀態：若作廢後回收不足，從 POSTED 回到 OPEN
    const inputsAll = await getAll("process_order_input").catch(()=>[]);
    const outputsAll2 = await getAll("process_order_output").catch(()=>[]);
    const inputs = (inputsAll || []).filter(x => String(x.process_order_id || "").toUpperCase() === procId);
    const outputs = (outputsAll2 || []).filter(x => String(x.process_order_id || "").toUpperCase() === procId);
    const activeOutputs = outputs.filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");

    let nextStatus = String(po.status || "").toUpperCase() || "OPEN";
    try{
      const baseUnits = new Set();
      let canConvert = true;
      function getProductBaseUnit_(product){
        const p = product || {};
        const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : null;
        return normalizeUnit(cfg?.base_unit || p.unit || "");
      }
      function convertRowsToBaseTotal_(rows, qtyField){
        return (rows || []).reduce((sum, r) => {
          const productId = String(r.product_id || "");
          const product = (procProducts || []).find(p => String(p.product_id || "") === productId);
          const q = num(r[qtyField]);
          const u = String(r.unit || "");
          if(!product){ canConvert = false; return sum; }
          const converted = convertToBase(product, q, u);
          const baseUnit = getProductBaseUnit_(product);
          if(baseUnit) baseUnits.add(baseUnit);
          if(converted == null){ canConvert = false; return sum; }
          return sum + converted;
        }, 0);
      }
      const issuedBase = convertRowsToBaseTotal_(inputs, "issue_qty");
      const receivedBase = convertRowsToBaseTotal_(activeOutputs, "receive_qty");
      if(!canConvert || baseUnits.size !== 1){
        nextStatus = inputs.length ? "OPEN" : "OPEN";
      }else{
        nextStatus = (receivedBase + 1e-9 >= issuedBase) ? "POSTED" : "OPEN";
      }
    }catch(_e){
      nextStatus = inputs.length ? "OPEN" : "OPEN";
    }

    await updateRecord("process_order","process_order_id",procId,{
      status: nextStatus,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });

    clearProcOutputEditor_();
    updateLossHint();
    setProcRowBusy_("output", outId, "");
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(procId);
    showToast("已作廢本筆回收並回沖庫存");
  } finally {
    setProcRowBusy_("output", outId, "");
    hideSaveHint();
  }
}

function formatProcLotOptionLabel_(lot, available){
  const lotId = String(lot?.lot_id || "");
  const productId = String(lot?.product_id || "");
  return `${lotId} (${productId}) 可用:${available}`;
}

function formatProcSourceText_(lot){
  const sourceType = String(lot?.source_type || "").toUpperCase();
  const sourceId = String(lot?.source_id || "");
  if(sourceType === "PURCHASE"){
    const poId = procGoodsReceiptIdToPoId[sourceId] || "";
    return poId ? `採購單:${poId}（收貨:${sourceId}）` : `採購:${sourceId}`;
  }
  if(sourceType === "IMPORT"){
    const docId = procImportReceiptIdToDocId[sourceId] || "";
    const impNo = docId ? (procImportDocIdToImportNo[docId] || "") : "";
    if(impNo || docId){
      return `報單:${impNo || "—"}（ID:${docId || "—"} / 收貨:${sourceId}）`;
    }
    return `進口:${sourceId}`;
  }
  if(sourceType === "PROCESS") return `加工:${sourceId}`;
  return sourceType ? `${sourceType}:${sourceId}` : sourceId;
}

function renderProcLotPicker_(lots){
  const tbody = document.getElementById("procLotPickBody");
  if(!tbody) return;
  const kw = (document.getElementById("proc_lot_picker_keyword")?.value || "").trim().toLowerCase();
  const viewMode = document.getElementById("proc_lot_picker_viewmode")?.value || "flat";
  const source = Array.isArray(lots) ? lots : [];
  const list = source.filter(l => {
    if(!kw) return true;
    const lotId = String(l.lot_id || "").toLowerCase();
    const pname = String(formatProcProductDisplay_(l.product_id || "") || "").toLowerCase();
    const src = String(formatProcSourceText_(l) || "").toLowerCase();
    return lotId.includes(kw) || pname.includes(kw) || src.includes(kw);
  });
  tbody.innerHTML = "";
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64748b;">目前無可選 Lot</td></tr>`;
    return;
  }

  function renderLotRow_(l){
    const av = procGetAvailable(l.lot_id);
    const lotId = String(l.lot_id || "");
    const productText = formatProcProductDisplay_(l.product_id || "");
    const createdAt = String(l.created_at || "");
    tbody.innerHTML += `
      <tr style="cursor:pointer;" onclick="pickProcInputLot('${lotId.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')">
        <td>${lotId}</td>
        <td>${productText}</td>
        <td>${av}</td>
        <td>${createdAt}</td>
        <td><button type="button" class="btn-secondary">帶入</button></td>
      </tr>
    `;
  }
  if(viewMode === "group_source"){
    const groups = {};
    list.forEach(l => {
      const key = formatProcSourceText_(l) || "未分類來源";
      if(!groups[key]) groups[key] = [];
      groups[key].push(l);
    });
    Object.keys(groups).sort().forEach(k => {
      tbody.innerHTML += `
        <tr style="background:#f8fafc;">
          <td colspan="5" style="font-weight:600;color:#334155;padding:8px 10px;">來源：${k}（${groups[k].length}）</td>
        </tr>
      `;
      groups[k].forEach(renderLotRow_);
    });
  }else{
    list.forEach(renderLotRow_);
  }
}

function getProcEligibleLots_(){
  return (procLots || []).filter(l => {
    if((l.inventory_status || "ACTIVE") !== "ACTIVE") return false;
    if((l.status || "PENDING") !== "APPROVED") return false;
    // 已送加工扣完/無庫存（可用量<=0）不應出現在可選清單
    const av = procGetAvailable(l.lot_id);
    return Number(av) > 0;
  });
}

function openProcLotPicker(){
  const modal = document.getElementById("procLotPickerModal");
  if(!modal) return;
  modal.style.display = "flex";
  const kw = document.getElementById("proc_lot_picker_keyword");
  if(kw){
    kw.value = "";
    kw.focus();
  }
  renderProcLotPicker_(getProcEligibleLots_());
}

function closeProcLotPicker(){
  const modal = document.getElementById("procLotPickerModal");
  if(modal) modal.style.display = "none";
}

function num(v){
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function isDraftRow_(row){
  return !!(row && row._mode === "DRAFT");
}

function isDbRow_(row){
  return !!(row && row._mode === "DB");
}

function normUnit_(u){
  return String(u || "").trim().toUpperCase();
}

function uniqueUnits_(rows, unitField){
  const s = new Set();
  (rows || []).forEach(r => {
    const u = normUnit_(r?.[unitField]);
    if(u) s.add(u);
  });
  return Array.from(s);
}

function clearProcBlockNotice_(){
  const box = document.getElementById("procBlockNotice");
  const list = document.getElementById("procBlockReasonList");
  if(list) list.innerHTML = "";
  if(box) box.style.display = "none";
}

function showProcBlockNotice_(title, reasons){
  const box = document.getElementById("procBlockNotice");
  const titleEl = document.getElementById("procBlockTitle");
  const list = document.getElementById("procBlockReasonList");
  const details = document.getElementById("procBlockDetails");
  if(!box || !titleEl || !list) return;
  const rows = (Array.isArray(reasons) ? reasons : []).filter(Boolean);
  if(rows.length === 0){
    clearProcBlockNotice_();
    return;
  }
  titleEl.textContent = title || "操作被阻擋";
  list.innerHTML = rows.map(r => `<li>${String(r).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</li>`).join("");
  box.style.display = "block";
  if(details) details.open = true;
}

async function outsourceInit(){
  await loadProcMasterData();
  const lotKw = document.getElementById("proc_lot_picker_keyword");
  if(lotKw && !lotKw.dataset.bound){
    lotKw.dataset.bound = "1";
    lotKw.addEventListener("input", () => renderProcLotPicker_(getProcEligibleLots_()));
  }
  const lotView = document.getElementById("proc_lot_picker_viewmode");
  if(lotView && !lotView.dataset.bound){
    lotView.dataset.bound = "1";
    lotView.addEventListener("change", () => renderProcLotPicker_(getProcEligibleLots_()));
  }
  // 預估損耗：確保輸入回收數量就即時更新（避免某些情境下全域監聽沒打到）
  const outQtyEl = document.getElementById("proc_output_qty");
  if(outQtyEl && !outQtyEl.dataset.boundLoss){
    outQtyEl.dataset.boundLoss = "1";
    outQtyEl.addEventListener("input", updateLossHint);
    outQtyEl.addEventListener("change", updateLossHint);
  }
  const outProdEl = document.getElementById("proc_output_product");
  if(outProdEl && !outProdEl.dataset.boundLoss){
    outProdEl.dataset.boundLoss = "1";
    outProdEl.addEventListener("change", updateLossHint);
  }
  resetProcessForm();
  await renderProcessOrders();
}

async function loadProcMasterData(){
  const [products, suppliersRaw, lots, movements, importReceipts, goodsReceipts, importDocs] = await Promise.all([
    getAll("product"),
    getAll("supplier"),
    getAll("lot"),
    getAll("inventory_movement").catch(() => []),
    getAll("import_receipt").catch(() => []),
    getAll("goods_receipt").catch(() => []),
    getAll("import_document").catch(() => [])
  ]);
  procProducts = products || [];
  procSuppliers = (suppliersRaw || []).filter(s => s.status === "ACTIVE");
  procLots = lots || [];
  procMovements = movements || [];
  procAvailableByLotId = {};
  (procMovements || []).forEach(m => {
    const lotId = String(m?.lot_id || "");
    if(!lotId) return;
    procAvailableByLotId[lotId] = (procAvailableByLotId[lotId] || 0) + Number(m.qty || 0);
  });
  procImportReceiptIdToDocId = {};
  (importReceipts || []).forEach(r => {
    if(r && r.import_receipt_id){
      procImportReceiptIdToDocId[r.import_receipt_id] = r.import_doc_id || "";
    }
  });
  procGoodsReceiptIdToPoId = {};
  (goodsReceipts || []).forEach(r => {
    if(r && r.gr_id){
      procGoodsReceiptIdToPoId[r.gr_id] = r.po_id || "";
    }
  });
  procImportDocIdToImportNo = {};
  (importDocs || []).forEach(d => {
    if(d && d.import_doc_id){
      procImportDocIdToImportNo[d.import_doc_id] = d.import_no || "";
    }
  });

  initProcDropdowns();
}

function procGetAvailable(lotId){
  const id = String(lotId || "");
  if(!id) return 0;
  const hit = procAvailableByLotId?.[id];
  if(hit != null) return Number(hit || 0);
  // fallback（理論上不會用到）
  return (procMovements || [])
    .filter(m => String(m.lot_id || "") === id)
    .reduce((sum, m) => sum + Number(m.qty || 0), 0);
}

function initProcDropdowns(){
  const supplierSel = document.getElementById("proc_supplier_id");
  if(supplierSel){
    supplierSel.innerHTML =
      `<option value="">請選擇加工廠</option>` +
      procSuppliers.map(s => `<option value="${s.supplier_id}">${s.supplier_id} - ${s.supplier_name}</option>`).join("");
  }

  renderProcLotPicker_(getProcEligibleLots_());

  const outSel = document.getElementById("proc_output_product");
  if(outSel){
    const activeProducts = (procProducts || []).filter(p => p.status === "ACTIVE");
    outSel.innerHTML =
      `<option value="">請選擇產出產品</option>` +
      activeProducts.map(p => `<option value="${p.product_id}" data-unit="${p.unit || ""}">${p.product_id} - ${p.product_name}</option>`).join("");
  }
}

function resetProcessForm(){
  clearProcBlockNotice_();
  procEditing = false;
  procInputs = [];
  procOutputs = [];
  procSelectedDbInputId = "";
  procSelectedDbOutputId = "";
  setProcStatusHint_("加工狀態：未載入加工單");
  renderProcInputs();
  renderProcOutputs();

  const idEl = document.getElementById("proc_id");
  if(idEl){
    idEl.value = generateId("PROC");
    idEl.disabled = false;
  }
  const planned = document.getElementById("proc_planned_date");
  if(planned) planned.value = "";
  const remark = document.getElementById("proc_remark");
  if(remark) remark.value = "";

  const supplier = document.getElementById("proc_supplier_id");
  if(supplier){
    supplier.value = "";
    supplier.disabled = false;
  }
  const type = document.getElementById("proc_type");
  if(type){
    type.value = "PROCESS";
    type.disabled = false;
  }
  const srcType = document.getElementById("proc_source_type");
  if(srcType){
    srcType.value = "";
    srcType.disabled = false;
  }

  const inLot = document.getElementById("proc_input_lot");
  if(inLot) inLot.value = "";
  const inLotDisplay = document.getElementById("proc_input_lot_display");
  if(inLotDisplay) inLotDisplay.value = "";
  const inAv = document.getElementById("proc_input_available");
  if(inAv) inAv.value = "";
  const inQty = document.getElementById("proc_input_qty");
  if(inQty) inQty.value = "";
  const inUnit = document.getElementById("proc_input_unit");
  if(inUnit) inUnit.value = "";
  const inRm = document.getElementById("proc_input_remark");
  if(inRm) inRm.value = "";

  const outP = document.getElementById("proc_output_product");
  if(outP) outP.value = "";
  const outQty = document.getElementById("proc_output_qty");
  if(outQty) outQty.value = "";
  const outUnit = document.getElementById("proc_output_unit");
  if(outUnit) outUnit.value = "";
  const outRm = document.getElementById("proc_output_remark");
  if(outRm) outRm.value = "";
  const allowLoss = document.getElementById("proc_close_allow_loss");
  if(allowLoss) allowLoss.checked = false;
  updateLossHint();

  const s1 = document.getElementById("procLoadedSummary");
  const s2 = document.getElementById("procLoadedInputs");
  const s3 = document.getElementById("procLoadedOutputs");
  const s4 = document.getElementById("procLoadedRelations");
  if(s1) s1.textContent = "";
  if(s2) s2.textContent = "";
  if(s3) s3.textContent = "";
  if(s4) s4.textContent = "";
}

function onSelectProcInputLot(){
  const lotId = document.getElementById("proc_input_lot")?.value || "";
  const lot = (procLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
  if(!lot){
    document.getElementById("proc_input_unit").value = "";
    document.getElementById("proc_input_available").value = "";
    return;
  }
  document.getElementById("proc_input_unit").value = lot.unit || "";
  document.getElementById("proc_input_available").value = String(procGetAvailable(lotId));
}

function pickProcInputLot(lotId){
  const input = document.getElementById("proc_input_lot");
  const display = document.getElementById("proc_input_lot_display");
  if(!input) return;
  input.value = lotId || "";
  if(display){
    const lot = (procLots || []).find(l => String(l.lot_id || "") === String(lotId || ""));
    const av = lot ? procGetAvailable(lot.lot_id) : "";
    display.value = lot ? formatProcLotOptionLabel_(lot, av) : (lotId || "");
  }
  onSelectProcInputLot();
  closeProcLotPicker();
}

function onSelectProcOutputProduct(){
  const sel = document.getElementById("proc_output_product");
  const opt = sel?.selectedOptions?.[0];
  if(!opt) return;
  document.getElementById("proc_output_unit").value = opt.getAttribute("data-unit") || "";
}

function beginEditProcInputDraft_(draftId){
  const it = (procInputs || []).find(x => x._mode === "DRAFT" && x.draft_id === draftId);
  if(!it) return;
  procEditingInputDraftId = draftId;
  pickProcInputLot(it.lot_id);
  const inQty = document.getElementById("proc_input_qty");
  if(inQty) inQty.value = String(it.issue_qty ?? "");
  const inRm = document.getElementById("proc_input_remark");
  if(inRm) inRm.value = String(it.remark || "");
  procInputs = procInputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  renderProcInputs();
  updateLossHint();
}

function beginEditProcOutputDraft_(draftId){
  const it = (procOutputs || []).find(x => x._mode === "DRAFT" && x.draft_id === draftId);
  if(!it) return;
  procEditingOutputDraftId = draftId;
  const sel = document.getElementById("proc_output_product");
  const qtyEl = document.getElementById("proc_output_qty");
  if(sel) sel.value = it.product_id || "";
  onSelectProcOutputProduct();
  if(qtyEl) qtyEl.value = String(it.receive_qty ?? "");
  const outRm = document.getElementById("proc_output_remark");
  if(outRm) outRm.value = String(it.remark || "");
  procOutputs = procOutputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  renderProcOutputs();
  updateLossHint();
}

function addProcOutputDraft(){
  const outProduct = document.getElementById("proc_output_product")?.value || "";
  const outQty = num(document.getElementById("proc_output_qty")?.value || 0);
  const outUnit = document.getElementById("proc_output_unit")?.value || "";
  const outRemark = (document.getElementById("proc_output_remark")?.value || "").trim();
  if(!outProduct) return showToast("請選擇產出產品","error");
  if(!outQty || outQty <= 0) return showToast("回收數量需大於 0","error");
  if(!outUnit) return showToast("產出單位缺失","error");

  procOutputs.push({
    _mode: "DRAFT",
    draft_id: "OUTDRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    product_id: outProduct,
    receive_qty: outQty,
    unit: outUnit,
    remark: outRemark
  });

  const outP = document.getElementById("proc_output_product");
  const outQtyEl = document.getElementById("proc_output_qty");
  const outUnitEl = document.getElementById("proc_output_unit");
  if(outP) outP.value = "";
  if(outQtyEl) outQtyEl.value = "";
  if(outUnitEl) outUnitEl.value = "";
  const outRmEl = document.getElementById("proc_output_remark");
  if(outRmEl) outRmEl.value = "";
  procEditingOutputDraftId = "";
  renderProcOutputs();
  updateLossHint();
}

function removeProcOutputDraft(draftId){
  procOutputs = procOutputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  if(procEditingOutputDraftId === draftId) procEditingOutputDraftId = "";
  renderProcOutputs();
  updateLossHint();
}

async function updateSelectedProcInputRemark(){
  clearProcBlockNotice_();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  const inId = String(procSelectedDbInputId || "").trim();
  if(!procId) return showToast("請先載入加工單","error");
  if(!inId) return showToast("請先在投料列表點選一筆（已送出）","error");
  const remark = (document.getElementById("proc_input_remark")?.value || "").trim();

  setProcRowBusy_("input", inId, "儲存中…");
  setProcActionInlineHint_("updateSelectedProcInputRemark()", "儲存中，請稍等…");
  try{
    await updateRecord("process_order_input","process_input_id",inId,{ remark });
    invalidateProcCaches_();
    await loadProcMasterData();
    await loadProcessOrder(procId);
    showToast("投料備註已更新");
  } finally {
    setProcActionInlineHint_("updateSelectedProcInputRemark()", "");
    setProcRowBusy_("input", inId, "");
  }
}

async function updateSelectedProcOutputRemark(){
  clearProcBlockNotice_();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  const outId = String(procSelectedDbOutputId || "").trim();
  if(!procId) return showToast("請先載入加工單","error");
  if(!outId) return showToast("請先在回收列表點選一筆（已回收）","error");
  const remark = (document.getElementById("proc_output_remark")?.value || "").trim();

  setProcRowBusy_("output", outId, "儲存中…");
  setProcActionInlineHint_("updateSelectedProcOutputRemark()", "儲存中，請稍等…");
  try{
    // 更新回收明細備註
    await updateRecord("process_order_output","process_output_id",outId,{ remark });

    // 同步更新該產出 lot 的備註（避免兩邊不同步）
    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const out = (outputsAll || []).find(x => String(x.process_output_id || "") === outId);
    const lotId = String(out?.lot_id || "");
    if(lotId){
      await updateRecord("lot","lot_id",lotId,{
        remark,
        updated_by: getCurrentUser(),
        updated_at: nowIso16()
      });
    }

    invalidateProcCaches_();
    await loadProcMasterData();
    await loadProcessOrder(procId);
    showToast("回收備註已更新");
  } finally {
    setProcActionInlineHint_("updateSelectedProcOutputRemark()", "");
    setProcRowBusy_("output", outId, "");
  }
}

function renderProcOutputs(){
  const tbody = document.getElementById("procOutputBody");
  if(!tbody) return;
  tbody.innerHTML = "";
  procOutputs.forEach((it, idx) => {
    const isDraft = isDraftRow_(it);
    const isDb = isDbRow_(it);
    let statusText = isDraft
      ? "草稿"
      : (isDb ? termLabel(it.status || "PENDING") : "");
    // 追溯顯示：回收列補一行「投料來源」
    const traceLots = isDb ? (procRelInputsByOutputLotId?.[String(it.lot_id || "")] || []) : [];
    const traceText = traceLots.length ? `投料：${traceLots.slice(0,3).join(", ")}${traceLots.length > 3 ? "…" : ""}` : "";
    let actionHtml = "";
    if(isDraft){
      actionHtml =
        `<button class="btn-secondary" onclick="event.stopPropagation(); beginEditProcOutputDraft_('${it.draft_id}')">編輯</button> ` +
        `<button class="btn-secondary" onclick="event.stopPropagation(); removeProcOutputDraft('${it.draft_id}')">刪除</button>`;
    }else if(isDb){
      const st = String(it.status || "").toUpperCase();
      const disabled = st === "CANCELLED";
      const outId = String(it.process_output_id || "");
      const busyText = procRowBusy.output[outId] || "";
      const isBusy = !!busyText;
      const safeOutId = outId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      actionHtml =
        `<button class="btn-secondary" ${(disabled || isBusy) ? "disabled" : ""} onclick="event.stopPropagation(); ${(disabled || isBusy) ? "return false;" : `voidProcessOutput('${safeOutId}')`}">作廢回收</button>` +
        (busyText ? ` <span style="font-size:12px;color:#64748b;">${busyText}</span>` : "");
    }
    const rowOnclick = isDraft
      ? `beginEditProcOutputDraft_('${it.draft_id}')`
      : (isDb ? `selectProcOutputDbRow_('${String(it.process_output_id || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')` : "");
    tbody.innerHTML += `
      <tr style="cursor:pointer;" onclick="${rowOnclick}">
        <td>${idx+1}</td>
        <td>${formatProcProductDisplay_(it.product_id)}</td>
        <td>${it.receive_qty}</td>
        <td>${it.unit}</td>
        <td>
          ${statusText}
          ${traceText ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${traceText}</div>` : ""}
        </td>
        <td>${actionHtml}</td>
      </tr>
    `;
  });
}

function selectProcOutputDbRow_(processOutputId){
  const id = String(processOutputId || "");
  const row = (procOutputs || []).find(x => x._mode === "DB" && String(x.process_output_id || "") === id);
  if(!row) return;
  procSelectedDbOutputId = id;
  const sel = document.getElementById("proc_output_product");
  const qtyEl = document.getElementById("proc_output_qty");
  const rmEl = document.getElementById("proc_output_remark");
  if(sel) sel.value = row.product_id || "";
  onSelectProcOutputProduct();
  if(qtyEl) qtyEl.value = String(row.receive_qty ?? "");
  if(rmEl) rmEl.value = String(row.remark || "");
  showToast("已帶入回收明細（僅供查看；作廢請用右側按鈕）");
}

function addProcInputDraft(){
  const lot_id = document.getElementById("proc_input_lot")?.value || "";
  const qty = num(document.getElementById("proc_input_qty")?.value || 0);
  const unit = document.getElementById("proc_input_unit")?.value || "";
  const remark = (document.getElementById("proc_input_remark")?.value || "").trim();

  if(!lot_id) return showToast("請選擇 Lot","error");
  if(!qty || qty <= 0) return showToast("投料數量需大於 0","error");
  if(!unit) return showToast("Lot 單位缺失","error");

  const lot = procLots.find(l => l.lot_id === lot_id);
  if(!lot) return showToast("找不到 Lot","error");

  const available = procGetAvailable(lot_id);
  if(qty > available) return showToast("投料不可超過可用量","error");

  procInputs.push({
    _mode: "DRAFT",
    draft_id: "DRAFT-" + Date.now() + "-" + Math.floor(Math.random()*1000),
    lot_id,
    product_id: lot.product_id,
    issue_qty: qty,
    unit,
    remark
  });

  document.getElementById("proc_input_lot").value = "";
  const lotDisplay = document.getElementById("proc_input_lot_display");
  if(lotDisplay) lotDisplay.value = "";
  document.getElementById("proc_input_available").value = "";
  document.getElementById("proc_input_qty").value = "";
  document.getElementById("proc_input_unit").value = "";
  document.getElementById("proc_input_remark").value = "";
  procEditingInputDraftId = "";

  renderProcInputs();
  updateLossHint();
}

function removeProcInputDraft(draftId){
  procInputs = procInputs.filter(x => !(x._mode === "DRAFT" && x.draft_id === draftId));
  if(procEditingInputDraftId === draftId) procEditingInputDraftId = "";
  renderProcInputs();
  updateLossHint();
}

function renderProcInputs(){
  const tbody = document.getElementById("procInputBody");
  if(!tbody) return;
  tbody.innerHTML = "";

  procInputs.forEach((it, idx) => {
    const isDraft = isDraftRow_(it);
    const isDb = isDbRow_(it);
    const statusText = isDraft ? "草稿" : (isDb ? "已送加工" : "");
    let actionHtml = "";
    if(isDraft){
      actionHtml =
        `<button class="btn-secondary" onclick="event.stopPropagation(); beginEditProcInputDraft_('${it.draft_id}')">編輯</button> ` +
        `<button class="btn-secondary" onclick="event.stopPropagation(); removeProcInputDraft('${it.draft_id}')">刪除</button>`;
    }else if(isDb){
      const inId = String(it.process_input_id || "");
      const busyText = procRowBusy.input[inId] || "";
      const isBusy = !!busyText;
      const safeInId = inId.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      actionHtml =
        `<button class="btn-secondary" ${(inId && !isBusy) ? "" : "disabled"} onclick="event.stopPropagation(); ${(inId && !isBusy) ? `voidProcessInput('${safeInId}')` : "return false;"}">回沖投料</button>` +
        (busyText ? ` <span style="font-size:12px;color:#64748b;">${busyText}</span>` : "");
    }
    const rowOnclick = isDraft
      ? `beginEditProcInputDraft_('${it.draft_id}')`
      : (isDb ? `selectProcInputDbRow_('${String(it.process_input_id || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')` : "");
    tbody.innerHTML += `
      <tr style="cursor:pointer;" onclick="${rowOnclick}">
        <td>${idx+1}</td>
        <td>${it.lot_id}</td>
        <td>${formatProcProductDisplay_(it.product_id)}</td>
        <td>${it.issue_qty}</td>
        <td>${it.unit}</td>
        <td>${statusText}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  });
}

function selectProcInputDbRow_(processInputId){
  const id = String(processInputId || "");
  const row = (procInputs || []).find(x => x._mode === "DB" && String(x.process_input_id || "") === id);
  if(!row) return;
  procSelectedDbInputId = id;
  pickProcInputLot(row.lot_id);
  const qtyEl = document.getElementById("proc_input_qty");
  const rmEl = document.getElementById("proc_input_remark");
  if(qtyEl) qtyEl.value = String(row.issue_qty ?? "");
  if(rmEl) rmEl.value = String(row.remark || "");
  showToast("已帶入投料明細（僅供查看；回沖請用右側按鈕）");
}

function updateLossHint(){
  const hint = document.getElementById("proc_loss_hint");
  if(!hint) return;
  const draftOutputsOnly = (procOutputs || []).filter(it => it && it._mode === "DRAFT");
  const draftOut = draftOutputsOnly.reduce((sum, it) => sum + num(it.receive_qty), 0);
  const editingOut = num(document.getElementById("proc_output_qty")?.value || 0);
  const outQty = draftOut + editingOut;
  const inputsForCalc = procInputs.length ? procInputs : (procLoadedInputsForHint || []);
  const outputsForCalcExisting = (procLoadedOutputsForHint || []).filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");
  if(inputsForCalc.length === 0){
    hint.value = outQty > 0 ? "尚無投料，無法計算" : "";
    return;
  }
  if(outQty <= 0){
    hint.value = "";
    return;
  }

  const baseUnits = new Set();
  let canConvert = true;

  function toBase_(productId, qty, unit){
    const pid = String(productId || "");
    const p = (procProducts || []).find(x => String(x.product_id || "") === pid);
    if(!p) return null;
    const converted = convertToBase(p, qty, unit);
    // convertToBase 的基準單位來源：uom_config / 舊 @UOM / product.unit
    const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : null;
    const base = normalizeUnit(cfg?.base_unit || p.unit || "");
    if(base) baseUnits.add(base);
    return converted;
  }

  const inBaseTotal = inputsForCalc.reduce((sum, it) => {
    const q = it.issue_qty != null ? it.issue_qty : (it.qty != null ? it.qty : it.issue_qty);
    const v = toBase_(it.product_id, num(q), it.unit);
    if(v == null) canConvert = false;
    return sum + (v || 0);
  }, 0);

  // 回收：已存在（資料庫）+ 已新增草稿 + 目前正在編輯的那筆（若有選產品）
  const { outProduct, outQty: editingQty, outUnit } = getProcOutputForm_();
  const outputsAll = [
    ...(outputsForCalcExisting || []).map(x => ({ product_id: x.product_id, qty: x.receive_qty, unit: x.unit })),
    ...draftOutputsOnly.map(x => ({ product_id: x.product_id, qty: x.receive_qty, unit: x.unit })),
    ...(outProduct && editingQty > 0 ? [{ product_id: outProduct, qty: editingQty, unit: outUnit }] : [])
  ];
  const outBaseTotal = outputsAll.reduce((sum, it) => {
    const v = toBase_(it.product_id, num(it.qty), it.unit);
    if(v == null) canConvert = false;
    return sum + (v || 0);
  }, 0);

  if(!canConvert || baseUnits.size !== 1){
    hint.value = baseUnits.size > 1
      ? "多基準單位，無法計算"
      : "單位不一致，無法計算";
    return;
  }

  const baseUnit = Array.from(baseUnits)[0] || "";
  const loss = inBaseTotal - outBaseTotal;
  const rounded = (Math.round(loss * 10000) / 10000);
  const text = String(rounded).replace(/\.0+$/,"").replace(/(\.\d*[1-9])0+$/,"$1");
  hint.value = `${text} ${baseUnit}（換算後）`;
}

function getProcHeaderForm_(){
  const process_order_id = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  document.getElementById("proc_id").value = process_order_id;
  const process_type = document.getElementById("proc_type")?.value || "";
  const source_type = document.getElementById("proc_source_type")?.value || "";
  const supplier_id = document.getElementById("proc_supplier_id")?.value || "";
  const planned_date = document.getElementById("proc_planned_date")?.value || "";
  const remark = (document.getElementById("proc_remark")?.value || "").trim();
  return { process_order_id, process_type, source_type, supplier_id, planned_date, remark };
}

function getProcOutputForm_(){
  const outProduct = document.getElementById("proc_output_product")?.value || "";
  const outQty = num(document.getElementById("proc_output_qty")?.value || 0);
  const outUnit = document.getElementById("proc_output_unit")?.value || "";
  return { outProduct, outQty, outUnit };
}

function clearProcOutputEditor_(){
  const outSelEl = document.getElementById("proc_output_product");
  const outQtyEl = document.getElementById("proc_output_qty");
  const outUnitEl = document.getElementById("proc_output_unit");
  const outRmEl = document.getElementById("proc_output_remark");
  if(outSelEl) outSelEl.value = "";
  if(outQtyEl) outQtyEl.value = "";
  if(outUnitEl) outUnitEl.value = "";
  if(outRmEl) outRmEl.value = "";
  procSelectedDbOutputId = "";
}

async function createProcessOrderOnly(){
  clearProcBlockNotice_();
  if(procEditing){
    return showToast("目前為「已載入加工單」模式。若要建立新加工單，請先按「清除」。","error");
  }
  const { process_order_id, process_type, source_type, supplier_id, planned_date, remark } = getProcHeaderForm_();
  if(!process_order_id) return showToast("加工單ID 必填","error");
  if(!process_type) return showToast("請選擇加工類型","error");
  if(!supplier_id) return showToast("請選擇加工廠","error");

  showSaveHint();
  try {
    const existed = await getOne("process_order","process_order_id",process_order_id).catch(()=>null);
    if(existed) return showToast("加工單ID 已存在，請改用載入後操作。","error");

    await createRecord("process_order", {
      process_order_id,
      process_type,
      ...(source_type ? { source_type } : {}),
      supplier_id,
      planned_date,
      status: "OPEN",
      remark,
      created_by: getCurrentUser(),
      created_at: nowIso16(),
      updated_by: "",
      updated_at: ""
    });
    await renderProcessOrders();
    await loadProcessOrder(process_order_id);
    showToast("加工單已建立（OPEN）");
  } finally { hideSaveHint(); }
}

async function issueProcessOrder(){
  if(procIssueInFlight){
    return showToast("送加工處理中，請稍候…","error");
  }
  clearProcBlockNotice_();
  const { process_order_id } = getProcHeaderForm_();
  if(!process_order_id) return showToast("請先建立或載入加工單","error");
  const draftInputs = (procInputs || []).filter(x => x && x._mode === "DRAFT");
  if(draftInputs.length === 0) return showToast("請至少新增 1 筆投料","error");

  procIssueInFlight = true;
  setProcStatusHint_("加工狀態：送加工處理中...");
  setProcActionInlineHint_("issueProcessOrder()", "儲存中，請稍等…");
  disableButtonsByOnclick_("issueProcessOrder()", true);
  try {
    const po = await getOne("process_order","process_order_id",process_order_id).catch(()=>null);
    if(!po) return showToast("找不到加工單，請先建立。","error");
    if((po.status || "").toUpperCase() === "CANCELLED") return showToast("此加工單已取消，不能送加工。","error");
    if((po.status || "").toUpperCase() === "POSTED") return showToast("此加工單已完成，不能再次送加工。","error");

    const existedInputsAll = await getAll("process_order_input").catch(()=>[]);
    const existedInputs = (existedInputsAll || []).filter(x => x.process_order_id === process_order_id);
    const existedCount = existedInputs.length;

    // 分批投料：允許在同一張加工單「追加送加工」，但只會扣本次草稿投料
    // 前置檢查：確保投料單位可換算到同一基準單位（避免後續回收比較混亂）
    const convertBlockReasons = [];
    const baseUnits = new Set();
    function getProductBaseUnit_(product){
      const p = product || {};
      const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : null;
      return normalizeUnit(cfg?.base_unit || p.unit || "");
    }
    function validateRowsConvertible_(rows, qtyField, tag){
      (rows || []).forEach(r => {
        const productId = String(r.product_id || "");
        const product = (procProducts || []).find(p => String(p.product_id || "") === productId);
        const q = num(r[qtyField]);
        const u = String(r.unit || "");
        if(!product){
          convertBlockReasons.push(`${tag}產品不存在：${productId || "（空白）"}`);
          return;
        }
        const baseUnit = getProductBaseUnit_(product);
        if(baseUnit) baseUnits.add(baseUnit);
        const converted = convertToBase(product, q, u);
        if(converted == null){
          convertBlockReasons.push(`${tag}${productId} 單位 ${u || "（空白）"} 無法轉為基準單位，請至產品主檔設定。`);
        }
      });
    }
    // 既有投料 + 本次投料都要可換算、且基準單位一致
    validateRowsConvertible_(existedInputs, "issue_qty", "既有投料 ");
    validateRowsConvertible_(draftInputs, "issue_qty", "本次投料 ");
    if(baseUnits.size > 1){
      convertBlockReasons.push(`本加工單涉及多種基準單位（${Array.from(baseUnits).join(", ")}），目前不支援跨基準單位合併投料比較。`);
    }
    if(convertBlockReasons.length){
      showProcBlockNotice_("送加工被阻擋", Array.from(new Set(convertBlockReasons)));
      return showToast("單位換算檢查未通過，請展開下方明細。", "error");
    }

    // 重新抓最新 movements/lots，避免多人操作造成超扣
    procLots = await getAll("lot");
    procMovements = await getAll("inventory_movement").catch(()=>[]);
    for(const it of draftInputs){
      const lot = procLots.find(l => l.lot_id === it.lot_id);
      if(!lot) return showToast("找不到投料 Lot：" + it.lot_id, "error");
      if((lot.status || "PENDING") !== "APPROVED") return showToast("投料 Lot 必須 APPROVED：" + it.lot_id, "error");
      const av = procGetAvailable(it.lot_id);
      if(it.issue_qty > av) return showToast("投料超過可用量：" + it.lot_id, "error");
    }

    for(let idx=0; idx<draftInputs.length; idx++){
      const it = draftInputs[idx];
      const seq = existedCount + idx + 1;
      const inputId = `PIN-${process_order_id}-${String(seq).padStart(3,"0")}`;
      await createRecord("process_order_input", {
        process_input_id: inputId,
        process_order_id,
        lot_id: it.lot_id,
        product_id: it.product_id,
        issue_qty: String(it.issue_qty),
        unit: it.unit,
        remark: it.remark || "",
        created_by: getCurrentUser(),
        created_at: nowIso16()
      });
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "PROCESS_OUT",
        lot_id: it.lot_id,
        product_id: it.product_id,
        qty: String(-Math.abs(it.issue_qty)),
        unit: it.unit,
        ref_type: "PROCESS_ORDER",
        ref_id: process_order_id,
        remark: `Process OUT: ${process_order_id} (${inputId})`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });
    }

    invalidateProcCaches_();
    await updateRecord("process_order","process_order_id",process_order_id,{
      status: "OPEN",
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    setProcStatusHint_(existedCount > 0 ? "加工狀態：已追加送加工（待回收）" : "加工狀態：已送加工（待回收）");
    procInputs = [];
    renderProcInputs();
    updateLossHint();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(process_order_id);
    showToast(existedCount > 0 ? "追加送加工完成（已補扣庫）" : "送加工完成（已扣庫）");
  } finally {
    setProcActionInlineHint_("issueProcessOrder()", "");
    procIssueInFlight = false;
    disableButtonsByOnclick_("issueProcessOrder()", false);
  }
}

async function retractProcessIssue(){
  clearProcBlockNotice_();
  const procId = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!procId) return showToast("請先載入加工單","error");
  if(!confirm("確定撤回「送加工（扣庫）」？\n系統會回沖投料扣庫，並刪除本加工單的投料明細。\n\n限制：若已有任何回收（未作廢）或投料 Lot 已被下游使用，會被阻擋。")) return;

  showSaveHint();
  try{
    const po = await getOne("process_order","process_order_id",procId).catch(()=>null);
    if(!po) return showToast("找不到加工單","error");
    if((po.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此加工單已取消，不能撤回送加工。", "error");
    }

    const inputsAll = await getAll("process_order_input").catch(()=>[]);
    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const inputs = (inputsAll || []).filter(x => String(x.process_order_id || "").toUpperCase() === procId);
    const outputs = (outputsAll || []).filter(x => String(x.process_order_id || "").toUpperCase() === procId);
    const activeOutputs = outputs.filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");

    if(activeOutputs.length > 0){
      showProcBlockNotice_("撤回送加工被阻擋", ["此加工單已有回收紀錄（未作廢），不可撤回送加工。請改用「作廢本筆回收」逐筆回沖，或整單取消。"]);
      return showToast("撤回失敗：已有回收紀錄（未作廢）。", "error");
    }
    if(inputs.length === 0){
      return showToast("此加工單尚未送加工（無投料明細），不需撤回。","error");
    }

    const mvAll = await getAll("inventory_movement").catch(()=>[]);
    const shipItems = await getAll("shipment_item").catch(()=>[]);

    // 找出本加工單的 PROCESS_OUT movements（送加工扣庫）
    const srcMv = (mvAll || []).filter(m =>
      String(m.ref_type || "") === "PROCESS_ORDER" &&
      String(m.ref_id || "").toUpperCase() === procId &&
      String(m.movement_type || "").toUpperCase() === "PROCESS_OUT"
    );
    if(srcMv.length === 0){
      showProcBlockNotice_("撤回送加工被阻擋", ["找不到本加工單的送加工扣庫異動（PROCESS_OUT），無法撤回。"]);
      return showToast("撤回失敗：缺少送加工異動。", "error");
    }
    const alreadyReversed = (mvAll || []).some(m =>
      String(m.ref_type || "") === "PROCESS_ORDER" &&
      String(m.ref_id || "").toUpperCase() === procId &&
      String(m.remark || "").includes("REVERSAL(PROCESS_OUT)")
    );
    if(alreadyReversed){
      return showToast("此加工單已撤回過送加工（已有回沖紀錄），避免重複回沖。","error");
    }

    // 下游使用檢查：投料 lot 在送加工後是否又被其他單據使用
    const issueAtByLot = {};
    srcMv.forEach(m => {
      const lotId = String(m.lot_id || "");
      if(!lotId) return;
      const t = parseIsoNoTzAsLocalKey_(m.created_at);
      if(!issueAtByLot[lotId] || t < issueAtByLot[lotId]) issueAtByLot[lotId] = t;
    });
    const inputLotIds = Array.from(new Set(inputs.map(x => String(x.lot_id || "")).filter(Boolean)));
    const blockReasons = [];

    // shipment_item 只要用到投料 lot，就視為下游使用（不看時間，因為出貨一定是後續動作）
    (shipItems || []).forEach(s => {
      const lotId = String(s.lot_id || "");
      if(inputLotIds.includes(lotId)){
        blockReasons.push(`投料 Lot ${lotId} 已被出貨使用（出貨單：${s.shipment_id || ""}），不可撤回送加工。`);
      }
    });

    (mvAll || []).forEach(m => {
      const lotId = String(m.lot_id || "");
      if(!inputLotIds.includes(lotId)) return;
      const issuedAt = issueAtByLot[lotId];
      if(!issuedAt) return;
      const createdAt = parseIsoNoTzAsLocalKey_(m.created_at);
      // 只看「送加工之後」的異動
      if(!(createdAt && createdAt > issuedAt)) return;
      const sameOrder = String(m.ref_type || "") === "PROCESS_ORDER" && String(m.ref_id || "").toUpperCase() === procId;
      const isReversal = String(m.remark || "").includes("REVERSAL");
      if(!sameOrder && !isReversal){
        blockReasons.push(`投料 Lot ${lotId} 在送加工後已有下游庫存異動：${m.movement_type || "UNKNOWN"}（ref:${m.ref_type || ""}:${m.ref_id || ""}）。`);
      }
    });

    const uniq = Array.from(new Set(blockReasons));
    if(uniq.length){
      showProcBlockNotice_("撤回送加工被阻擋", uniq);
      return showToast("撤回失敗：投料 Lot 已有下游使用紀錄，請先展開明細。", "error");
    }

    // 回沖 PROCESS_OUT：用 ADJUST 避免 lot gating
    for(const m of srcMv){
      const qty = Number(m.qty || 0);
      if(!qty) continue;
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "ADJUST",
        lot_id: m.lot_id || "",
        product_id: m.product_id || "",
        qty: String(-qty),
        unit: m.unit || "",
        ref_type: "PROCESS_ORDER",
        ref_id: procId,
        remark: `REVERSAL(PROCESS_OUT) of ${m.movement_id || ""} (${procId})`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });
    }

    // 刪除投料明細（讓狀態提示回到「未送加工」）
    for(const it of inputs){
      if(it && it.process_input_id){
        await deleteRecord("process_order_input","process_input_id",it.process_input_id);
      }
    }

    await updateRecord("process_order","process_order_id",procId,{
      status: "OPEN",
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });

    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(procId);
    showToast("已撤回送加工（投料扣庫已回沖）");
  } finally {
    hideSaveHint();
  }
}

async function receiveProcessOutput(){
  if(procReceiveInFlight){
    return showToast("回收處理中，請稍候…","error");
  }
  clearProcBlockNotice_();
  const { process_order_id } = getProcHeaderForm_();
  const { outProduct, outQty, outUnit } = getProcOutputForm_();
  if(!process_order_id) return showToast("請先建立或載入加工單","error");
  const pendingOutputs = (procOutputs || []).filter(x => x && x._mode === "DRAFT");
  if(pendingOutputs.length === 0){
    if(!outProduct) return showToast("請選擇產出產品","error");
    if(!outQty || outQty <= 0) return showToast("回收數量需大於 0","error");
    if(!outUnit) return showToast("產出單位缺失","error");
    pendingOutputs.push({
      draft_id: "OUTDRAFT-ONESHOT",
      _mode: "DRAFT",
      product_id: outProduct,
      receive_qty: outQty,
      unit: outUnit,
      remark: (document.getElementById("proc_output_remark")?.value || "").trim()
    });
  }

  procReceiveInFlight = true;
  setProcStatusHint_("加工狀態：回收處理中...");
  setProcActionInlineHint_("receiveProcessOutput()", "儲存中，請稍等…");
  document.querySelectorAll('button[onclick="receiveProcessOutput()"]').forEach(btn => {
    btn.disabled = true;
  });
  try {
    const po = await getOne("process_order","process_order_id",process_order_id).catch(()=>null);
    if(!po) return showToast("找不到加工單，請先建立。","error");
    if((po.status || "").toUpperCase() === "CANCELLED") return showToast("此加工單已取消，不能回收。","error");
    if((po.status || "").toUpperCase() === "POSTED") return showToast("此加工單已完成，不能再回收。","error");

    const inputsAll = await getAll("process_order_input").catch(()=>[]);
    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const inputs = (inputsAll || []).filter(x => x.process_order_id === process_order_id);
  const outputs = (outputsAll || []).filter(x => x.process_order_id === process_order_id);
  // 作廢回收（CANCELLED）不應計入「既有回收總量」
  const activeOutputs = (outputs || []).filter(x => String(x.status || "").toUpperCase() !== "CANCELLED");
    if(inputs.length === 0){
      return showToast("請先送加工（建立投料與扣庫）", "error");
    }

    const convertBlockReasons = [];
    const baseUnits = new Set();

    function getProductBaseUnit_(product){
      const p = product || {};
      const cfg = typeof getProductUomConfig === "function" ? getProductUomConfig(p) : null;
      return normalizeUnit(cfg?.base_unit || p.unit || "");
    }

    function convertRowsToBaseTotal_(rows, qtyField, tag){
      return (rows || []).reduce((sum, r) => {
        const productId = String(r.product_id || "");
        const product = (procProducts || []).find(p => String(p.product_id || "") === productId);
        const q = num(r[qtyField]);
        const u = String(r.unit || "");
        if(!product){
          convertBlockReasons.push(`${tag}產品不存在：${productId || "（空白）"}`);
          return sum;
        }
        const converted = convertToBase(product, q, u);
        const baseUnit = getProductBaseUnit_(product);
        if(baseUnit) baseUnits.add(baseUnit);
        if(converted == null){
          convertBlockReasons.push(`${tag}${productId} 單位 ${u || "（空白）"} 無法轉為基準單位，請至產品主檔設定。`);
          return sum;
        }
        return sum + converted;
      }, 0);
    }

    const issuedTotalBase = convertRowsToBaseTotal_(inputs, "issue_qty", "投料 ");
  const receivedTotalBase = convertRowsToBaseTotal_(activeOutputs, "receive_qty", "既有回收 ");
    const newReceiveTotalBase = convertRowsToBaseTotal_(pendingOutputs, "receive_qty", "本次回收 ");

    if(baseUnits.size > 1){
      convertBlockReasons.push(`本加工單涉及多種基準單位（${Array.from(baseUnits).join(", ")}），目前不支援跨基準單位合計比較。`);
    }
    if(convertBlockReasons.length){
      showProcBlockNotice_("回收加工品被阻擋", Array.from(new Set(convertBlockReasons)));
      return showToast("單位換算檢查未通過，請展開下方明細。", "error");
    }

    if(receivedTotalBase + newReceiveTotalBase > issuedTotalBase + 1e-9){
      return showToast("回收總量（換算後）不可超過已送加工總量", "error");
    }
    const baseUnit = Array.from(baseUnits)[0] || "";
    let runningReceivedBase = receivedTotalBase;
    const createdLots = [];
    for(let i=0; i<pendingOutputs.length; i++){
      const out = pendingOutputs[i];
      const outSeq = outputs.length + i + 1;
      const outLotId = generateId("LOT");
      const outLotType = procProducts.find(p => p.product_id === out.product_id)?.type || "WIP";
      const outProduct = (procProducts || []).find(p => String(p.product_id || "") === String(out.product_id || ""));
      const outBaseQty = outProduct ? convertToBase(outProduct, num(out.receive_qty), String(out.unit || "")) : null;
      if(outBaseQty == null){
        return showToast("回收單位換算失敗（無法計算損耗），請確認產品主檔多單位換算設定。","error");
      }
      runningReceivedBase += outBaseQty;
      const lossAfter = issuedTotalBase - runningReceivedBase;
      await createRecord("lot", {
        lot_id: outLotId,
        product_id: out.product_id,
        source_type: "PROCESS",
        source_id: process_order_id,
        qty: String(out.receive_qty),
        unit: out.unit,
        type: outLotType,
        status: "PENDING",
        inventory_status: "ACTIVE",
        received_date: nowIso16(),
        manufacture_date: "",
        expiry_date: "",
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
        remark: out.remark || `Process OUT lot from ${process_order_id}`
      });
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        movement_type: "PROCESS_IN",
        lot_id: outLotId,
        product_id: out.product_id,
        qty: String(Math.abs(out.receive_qty)),
        unit: out.unit,
        ref_type: "PROCESS_ORDER",
        ref_id: process_order_id,
        remark: `Process IN: ${process_order_id}`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });
      await createRecord("process_order_output", {
        process_output_id: `POUT-${process_order_id}-${String(outSeq).padStart(3,"0")}`,
        process_order_id,
        lot_id: outLotId,
        product_id: out.product_id,
        receive_qty: String(out.receive_qty),
        unit: out.unit,
        loss_base_qty_after: String(Math.round(lossAfter * 10000) / 10000),
        loss_base_unit: baseUnit,
        status: "PENDING",
        remark: out.remark || "",
        created_by: getCurrentUser(),
        created_at: nowIso16()
      });
      for(let idx=0; idx<inputs.length; idx++){
        const it = inputs[idx];
        await createRecord("lot_relation", {
          relation_id: `REL-${process_order_id}-${String(outSeq).padStart(3,"0")}-${String(idx+1).padStart(3,"0")}`,
          relation_type: "INPUT",
          from_lot_id: it.lot_id,
          to_lot_id: outLotId,
          qty: String(it.issue_qty),
          unit: it.unit,
          ref_type: "PROCESS_ORDER",
          ref_id: process_order_id,
          created_by: getCurrentUser(),
          created_at: nowIso16()
        });
      }
      createdLots.push(outLotId);
    }

    const nextTotalBase = receivedTotalBase + newReceiveTotalBase;
    const allowLossClose = !!document.getElementById("proc_close_allow_loss")?.checked;
    const nextStatus = allowLossClose
      ? "POSTED"
      : (nextTotalBase + 1e-9 >= issuedTotalBase ? "POSTED" : "OPEN");
    await updateRecord("process_order","process_order_id",process_order_id,{
      status: nextStatus,
      updated_by: getCurrentUser(),
      updated_at: nowIso16()
    });
    setProcStatusHint_(nextStatus === "POSTED" ? "加工狀態：加工已回收（已結案）" : "加工狀態：部分回收");

    const outQtyEl = document.getElementById("proc_output_qty");
    const outSelEl = document.getElementById("proc_output_product");
    const outUnitEl = document.getElementById("proc_output_unit");
    const outRmEl = document.getElementById("proc_output_remark");
    if(outQtyEl) outQtyEl.value = "";
    if(outSelEl) outSelEl.value = "";
    if(outUnitEl) outUnitEl.value = "";
    if(outRmEl) outRmEl.value = "";
    procOutputs = [];
    renderProcOutputs();
    updateLossHint();
    invalidateProcCaches_();
    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(process_order_id);
    const lotText = createdLots.join(", ");
    showToast(nextStatus === "POSTED" ? `回收完成並結案：${lotText}` : `回收完成（PARTIAL）：${lotText}`);
  } finally {
    setProcActionInlineHint_("receiveProcessOutput()", "");
    procReceiveInFlight = false;
    document.querySelectorAll('button[onclick="receiveProcessOutput()"]').forEach(btn => {
      btn.disabled = false;
    });
  }
}

async function cancelProcessOrder(){
  clearProcBlockNotice_();
  const id = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!id) return showToast("請先載入加工單","error");
  if(!confirm("確定取消此加工單？系統會建立回沖庫存異動。")) return;

  showSaveHint();
  try{
    const po = await getOne("process_order","process_order_id",id).catch(()=>null);
    if(!po) return showToast("找不到加工單","error");
    if((po.status || "").toUpperCase() === "CANCELLED"){
      return showToast("此加工單已取消", "error");
    }

    // 若產出 Lot 已被下游使用，禁止取消（避免回沖造成追溯斷裂）
    const outputsAll = await getAll("process_order_output").catch(()=>[]);
    const outputLots = (outputsAll || []).filter(x => x.process_order_id === id).map(x => x.lot_id).filter(Boolean);
    if(outputLots.length > 0){
      const mvAll = await getAll("inventory_movement").catch(()=>[]);
      const relAll = await getAll("lot_relation").catch(()=>[]);
      const shipItems = await getAll("shipment_item").catch(()=>[]);
      const blockReasons = [];
      (mvAll || []).forEach(m => {
        const lotId = String(m.lot_id || "");
        if(!outputLots.includes(lotId)) return;
        const sameOrder = String(m.ref_type || "") === "PROCESS_ORDER" && String(m.ref_id || "") === id;
        const isReversal = String(m.remark || "").includes("REVERSAL");
        if(!sameOrder && !isReversal){
          const mt = m.movement_type || "UNKNOWN";
          const rt = m.ref_type || "";
          const rid = m.ref_id || "";
          blockReasons.push(`產出 Lot ${lotId} 已被下游使用：庫存異動 ${mt}${rt || rid ? `（ref:${rt}:${rid}）` : ""}。`);
        }
      });
      (relAll || []).forEach(r => {
        const from = String(r.from_lot_id || "");
        if(!outputLots.includes(from)) return;
        const sameOrder = String(r.ref_type || "") === "PROCESS_ORDER" && String(r.ref_id || "") === id;
        if(!sameOrder){
          blockReasons.push(`產出 Lot ${from} 已被後續追溯關聯使用（lot_relation）。`);
        }
      });
      (shipItems || []).forEach(s => {
        const lotId = String(s.lot_id || "");
        if(outputLots.includes(lotId)){
          blockReasons.push(`產出 Lot ${lotId} 已被出貨使用（出貨單：${s.shipment_id || ""}）。`);
        }
      });
      const uniqReasons = Array.from(new Set(blockReasons));
      if(uniqReasons.length){
        showProcBlockNotice_("取消加工單被阻擋", uniqReasons);
        return showToast("取消失敗：有下游使用紀錄，請先展開明細。", "error");
      }
    }

    const allMv = await getAll("inventory_movement").catch(()=>[]);
    const srcMv = (allMv || []).filter(m => m.ref_type === "PROCESS_ORDER" && m.ref_id === id);
    const reversed = srcMv.filter(m => String(m.remark || "").includes("REVERSAL"));
    if(reversed.length > 0){
      return showToast("此加工單已有回沖紀錄，避免重複回沖。", "error");
    }

    for(const m of srcMv){
      const qty = Number(m.qty || 0);
      if(!qty) continue;
      await createRecord("inventory_movement", {
        movement_id: generateId("MV"),
        // 回沖用 ADJUST：避免被 OUT/PROCESS_OUT/SHIP_OUT 的 lot gating 規則卡住
        movement_type: "ADJUST",
        lot_id: m.lot_id || "",
        product_id: m.product_id || "",
        qty: String(-qty),
        unit: m.unit || "",
        ref_type: "PROCESS_ORDER",
        ref_id: id,
        remark: `REVERSAL(${m.movement_type || ""}) of ${m.movement_id || ""} (${id})`,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: "",
      });
    }

    await updateRecord("process_order","process_order_id",id,{
      status: "CANCELLED",
      updated_by: getCurrentUser(),
      updated_at: nowIso16(),
      remark: ((po.remark || "").trim() ? (po.remark + " | ") : "") + "已取消並回沖"
    });
    setProcStatusHint_("加工狀態：已取消");

    await loadProcMasterData();
    await renderProcessOrders();
    await loadProcessOrder(id);
    showToast("加工單已取消，且已建立回沖異動");
  } finally { hideSaveHint(); }
}

async function loadProcessOrder(processOrderId){
  const id = String(processOrderId || "").trim().toUpperCase();
  if(!id) return;
  // 立即回饋：避免捲到上方後使用者誤以為沒反應
  try{
    showToast(`載入中：${id} ...`);
  }catch(_e){}
  setProcStatusHint_(`加工狀態：載入中（${id}）...`);
  try{
    const s1 = document.getElementById("procLoadedSummary");
    const s2 = document.getElementById("procLoadedInputs");
    const s3 = document.getElementById("procLoadedOutputs");
    const s4 = document.getElementById("procLoadedRelations");
    if(s1) s1.textContent = `載入中：${id} ...`;
    if(s2) s2.textContent = "";
    if(s3) s3.textContent = "";
    if(s4) s4.textContent = "";
  }catch(_e2){}
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  await loadProcMasterData();

  const po = await getOne("process_order","process_order_id",id).catch(()=>null);
  if(!po) return showToast("找不到加工單","error");

  procEditing = true;
  procInputs = [];
  procOutputs = [];
  clearProcOutputEditor_();
  renderProcInputs();
  renderProcOutputs();
  updateLossHint();

  const idEl = document.getElementById("proc_id");
  if(idEl){
    idEl.value = id;
    idEl.disabled = true;
  }
  const typeEl = document.getElementById("proc_type");
  if(typeEl){
    typeEl.value = po.process_type || "PROCESS";
    typeEl.disabled = true;
  }
  const srcTypeEl = document.getElementById("proc_source_type");
  if(srcTypeEl){
    srcTypeEl.value = po.source_type || "";
    srcTypeEl.disabled = true;
  }
  const supEl = document.getElementById("proc_supplier_id");
  if(supEl){
    supEl.value = po.supplier_id || "";
    supEl.disabled = true;
  }
  const planEl = document.getElementById("proc_planned_date");
  if(planEl) planEl.value = po.planned_date || "";
  const rmEl = document.getElementById("proc_remark");
  if(rmEl) rmEl.value = po.remark || "";

  const inputsAll = await getAll("process_order_input").catch(()=>[]);
  const outputsAll = await getAll("process_order_output").catch(()=>[]);
  const relAll = await getAll("lot_relation").catch(()=>[]);

  const inputs = (inputsAll || []).filter(x => x.process_order_id === id);
  const outputs = (outputsAll || []).filter(x => x.process_order_id === id);
  const rels = (relAll || []).filter(x => x.ref_type === "PROCESS_ORDER" && x.ref_id === id);

  // 追溯顯示：彙整「每個產出 lot」對應哪些投料 lot（依目前 lot_relation INPUT）
  procRelInputsByOutputLotId = {};
  (rels || []).forEach(r => {
    if(String(r.relation_type || "").toUpperCase() !== "INPUT") return;
    const toLot = String(r.to_lot_id || "");
    const fromLot = String(r.from_lot_id || "");
    if(!toLot || !fromLot) return;
    if(!procRelInputsByOutputLotId[toLot]) procRelInputsByOutputLotId[toLot] = [];
    procRelInputsByOutputLotId[toLot].push(fromLot);
  });
  Object.keys(procRelInputsByOutputLotId).forEach(k => {
    procRelInputsByOutputLotId[k] = Array.from(new Set(procRelInputsByOutputLotId[k]));
  });

  // 供損耗提示使用（草稿清空後仍可計算）
  procLoadedInputsForHint = inputs || [];
  procLoadedOutputsForHint = outputs || [];

  // 一套明細表：載入後直接把正式明細帶到上方表格（操作會變成回沖/作廢）
  procInputs = (inputs || []).map(x => ({
    _mode: "DB",
    process_input_id: x.process_input_id,
    lot_id: x.lot_id,
    product_id: x.product_id,
    issue_qty: x.issue_qty,
    unit: x.unit,
    remark: x.remark || ""
  }));
  procOutputs = (outputs || []).map(x => ({
    _mode: "DB",
    process_output_id: x.process_output_id,
    lot_id: x.lot_id,
    product_id: x.product_id,
    receive_qty: x.receive_qty,
    unit: x.unit,
    status: x.status,
    remark: x.remark || ""
  }));
  renderProcInputs();
  renderProcOutputs();

  // 不鎖投料；由 Lot 可用量過濾 + 超投檢查控管

  setProcStatusHint_(deriveProcStatusHint_(po, inputs, outputs));

  const summaryEl = document.getElementById("procLoadedSummary");
  if(summaryEl){
    summaryEl.textContent =
      `Process Order: ${id}\n` +
      `Type: ${po.process_type || ""}\n` +
      `Source Type: ${po.source_type || ""}\n` +
      `Supplier: ${formatProcSupplierDisplay_(po.supplier_id || "")}\n` +
      `Status: ${termLabel(po.status)}\n` +
      `Planned: ${po.planned_date || ""}\n` +
      `Created: ${(po.created_at||"")} by ${(po.created_by||"")}\n` +
      `Updated: ${(po.updated_at||"")} by ${(po.updated_by||"")}\n` +
      `Remark: ${po.remark || ""}\n`;
  }

  // 已載入明細（文字版）：恢復原本的 pre 顯示（不影響上方一套明細表）
  const inEl = document.getElementById("procLoadedInputs");
  if(inEl){
    inEl.textContent = inputs.length
      ? inputs.map(x => {
          const prod = formatProcProductDisplay_(x.product_id) || (x.product_id || "");
          const idText = x.product_id ? ` (${x.product_id})` : "";
          return `- ${x.process_input_id || ""} | ${x.lot_id} | ${prod}${idText} | qty:${x.issue_qty} ${x.unit} | ${x.remark||""}`;
        }).join("\n")
      : "(無)";
  }
  const outEl = document.getElementById("procLoadedOutputs");
  if(outEl){
    outEl.textContent = outputs.length
      ? outputs.map(x => {
          const prod = formatProcProductDisplay_(x.product_id) || (x.product_id || "");
          const idText = x.product_id ? ` (${x.product_id})` : "";
          const lossText = (x.loss_base_qty_after != null && x.loss_base_unit)
            ? ` | loss_after:${x.loss_base_qty_after} ${x.loss_base_unit}`
            : "";
          return `- ${x.process_output_id || ""} | ${x.lot_id} | ${prod}${idText} | qty:${x.receive_qty} ${x.unit} | status:${termLabel(x.status)}${lossText} | ${x.remark||""}`;
        }).join("\n")
      : "(無)";
  }

  const relEl = document.getElementById("procLoadedRelations");
  if(relEl){
    relEl.textContent = rels.length
      ? rels.map(x => `- ${x.relation_type} | ${x.from_lot_id} -> ${x.to_lot_id} | qty:${x.qty} ${x.unit}`).join("\n")
      : "(無)";
  }

  showToast("已載入加工單：" + id);
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  updateLossHint();
}

async function updateProcessOrderHeader(){
  const id = (document.getElementById("proc_id")?.value || "").trim().toUpperCase();
  if(!id) return showToast("請先載入加工單","error");

  showSaveHint();
  try {
  const po = await getOne("process_order","process_order_id",id).catch(()=>null);
  if(!po) return showToast("找不到加工單","error");

  const planned_date = document.getElementById("proc_planned_date")?.value || "";
  const source_type = document.getElementById("proc_source_type")?.value || "";
  const remark = (document.getElementById("proc_remark")?.value || "").trim();

  await updateRecord("process_order","process_order_id",id,{
    planned_date,
    ...(source_type ? { source_type } : { source_type: null }),
    remark,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  });

  await renderProcessOrders();
  await loadProcessOrder(id);
  showToast("加工單主檔已更新");
  } finally { hideSaveHint(); }
}

async function renderProcessOrders(){
  const tbody = document.getElementById("procTableBody");
  if(!tbody) return;

  const list = await getAll("process_order").catch(()=>[]);
  const sorted = [...list].sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));

  tbody.innerHTML = "";
  sorted.forEach(p => {
    tbody.innerHTML += `
      <tr>
        <td>${p.process_order_id || ""}</td>
        <td>${p.process_type || ""}</td>
        <td>${p.source_type || ""}</td>
        <td>${p.supplier_id || ""}</td>
        <td>${termLabel(p.status)}</td>
        <td>${p.created_at || ""}</td>
        <td>
          <button class="btn-edit" onclick="loadProcessOrder('${p.process_order_id || ""}')">載入</button>
          <button class="btn-secondary" onclick="openLogs('process_order','${p.process_order_id || ""}','process')">Logs</button>
        </td>
      </tr>
    `;
  });
}

// 讓產出損耗提示即時更新
document.addEventListener("input", (e)=>{
  if(e.target?.id === "proc_output_qty"){
    updateLossHint();
  }
});

