/**
 * Warehouses（API 版）
 */

let whEditing = false;
let whLoadedStatus_ = "";

const WAREHOUSE_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30
};

async function warehousesInit(){
  bindUppercaseInput("wh_id");
  clearWarehouseForm();
  bindAutoSearchToolbar_([
    ["search_wh_keyword", "input"],
    ["search_wh_status", "change"]
  ], () => searchWarehouses());
  await renderWarehouses();
  if(typeof bindStatusSelectLamp_ === "function") bindStatusSelectLamp_("wh_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("wh_status");
}

function setWarehouseButtons_(){
  const createBtn = document.getElementById("wh_create_btn");
  const updateBtn = document.getElementById("wh_update_btn");
  if(createBtn){
    createBtn.disabled = !!whEditing;
    createBtn.title = whEditing ? "已載入倉庫，請用更新" : "建立新倉庫";
  }
  if(updateBtn){
    updateBtn.disabled = !whEditing;
    updateBtn.title = whEditing ? "更新此倉庫" : "請先載入倉庫";
  }
}

function clearWarehouseForm(){
  whEditing = false;
  whLoadedStatus_ = "";
  const idEl = document.getElementById("wh_id");
  if(idEl){ idEl.value = (typeof generateShortId === "function" ? generateShortId("WH") : ""); idEl.disabled = false; }
  const nameEl = document.getElementById("wh_name");
  if(nameEl) nameEl.value = "";
  const catEl = document.getElementById("wh_category");
  if(catEl) catEl.value = "";
  const stEl = document.getElementById("wh_status");
  if(stEl) stEl.value = "ACTIVE";
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("wh_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("wh_status");
  const addrEl = document.getElementById("wh_address");
  if(addrEl) addrEl.value = "";
  const rmEl = document.getElementById("wh_remark");
  if(rmEl) rmEl.value = "";
  setWarehouseButtons_();
}

async function createWarehouse(triggerEl){
  const warehouse_id = (document.getElementById("wh_id")?.value || "").trim().toUpperCase();
  const warehouse_name = (document.getElementById("wh_name")?.value || "").trim();
  const category = (document.getElementById("wh_category")?.value || "").trim().toUpperCase();
  const address = (document.getElementById("wh_address")?.value || "").trim();
  const status = document.getElementById("wh_status")?.value || "ACTIVE";
  const remark = (document.getElementById("wh_remark")?.value || "").trim();

  if(!warehouse_id || !warehouse_name) return showToast("倉庫ID / 名稱 必填", "error");
  if(!category) return showToast("請選擇類別", "error");
  if(warehouse_id.length > WAREHOUSE_RULES.idMax) return showToast("倉庫ID 長度過長", "error");
  if(!WAREHOUSE_RULES.idRegex.test(warehouse_id)) return showToast("倉庫ID 只能使用 A-Z 0-9 _ -", "error");

  showSaveHint(triggerEl);
  try{
    const exists = await getOne("warehouse","warehouse_id",warehouse_id).catch(()=>null);
    if(exists) return showToast("倉庫ID 已存在", "error");
    try{
      await createRecord("warehouse", {
        warehouse_id,
        warehouse_name,
        category,
        address,
        status,
        remark,
        created_by: getCurrentUser(),
        created_at: nowIso16(),
        updated_by: "",
        updated_at: ""
      });
    }catch(err){
      // callAPI 會自己 toast（含 Permission denied）；這裡避免未捕捉 Promise 造成 Console 紅字
      return;
    }
    showToast("倉庫建立成功");
    clearWarehouseForm();
    await renderWarehouses();
  }finally{
    hideSaveHint();
  }
  setWarehouseButtons_();
}

async function loadWarehouse(id){
  const wid = String(id || "").trim();
  const row = await getOne("warehouse","warehouse_id",wid).catch(()=>null);
  if(!row) return;
  whEditing = true;
  whLoadedStatus_ = String(row.status || "ACTIVE");
  const idEl = document.getElementById("wh_id");
  if(idEl){ idEl.value = row.warehouse_id || wid; idEl.disabled = true; }
  const nameEl = document.getElementById("wh_name");
  if(nameEl) nameEl.value = row.warehouse_name || "";
  const catEl = document.getElementById("wh_category");
  if(catEl) catEl.value = (row.category || "AMBIENT");
  const stEl = document.getElementById("wh_status");
  if(stEl) stEl.value = row.status || "ACTIVE";
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("wh_status");
  if(typeof erpLockStatusSelect_ === "function") erpLockStatusSelect_("wh_status");
  const addrEl = document.getElementById("wh_address");
  if(addrEl) addrEl.value = row.address || "";
  const rmEl = document.getElementById("wh_remark");
  if(rmEl) rmEl.value = row.remark || "";
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  setWarehouseButtons_();
}

async function updateWarehouse(triggerEl){
  if(!whEditing) return showToast("請先載入倉庫再更新", "error");
  const warehouse_id = (document.getElementById("wh_id")?.value || "").trim().toUpperCase();
  const warehouse_name = (document.getElementById("wh_name")?.value || "").trim();
  const category = (document.getElementById("wh_category")?.value || "").trim().toUpperCase();
  const address = (document.getElementById("wh_address")?.value || "").trim();
  const status = document.getElementById("wh_status")?.value || "ACTIVE";
  const remark = (document.getElementById("wh_remark")?.value || "").trim();
  if(!warehouse_name) return showToast("倉庫名稱必填", "error");
  if(!category) return showToast("請選擇類別", "error");

  // 狀態（ACTIVE/INACTIVE）僅 CEO/GA/ADMIN 可改（主檔）
  if(String(whLoadedStatus_||"") !== String(status||"")){
    if(typeof erpCanChangeMasterStatus_ === "function" && !erpCanChangeMasterStatus_()){
      return showToast("僅 CEO／GA／ADMIN 可修改倉庫狀態（ACTIVE/INACTIVE）。", "error");
    }
  }

  showSaveHint(triggerEl);
  try{
    try{
      await updateRecord("warehouse","warehouse_id",warehouse_id,{
        warehouse_name,
        category,
        address,
        status,
        remark,
        updated_by: getCurrentUser(),
        updated_at: nowIso16()
      });
    }catch(err){
      // callAPI 會自己 toast（含 Permission denied）；這裡避免未捕捉 Promise 造成 Console 紅字
      return;
    }
    whLoadedStatus_ = String(status || "");
    showToast("倉庫更新成功");
    await renderWarehouses();
  }finally{
    hideSaveHint();
  }
  setWarehouseButtons_();
}

async function renderWarehouses(list=null){
  const tbody = document.getElementById("whTableBody");
  if(!tbody) return;
  let rows = list;
  if(rows == null){
    setTbodyLoading_(tbody, 4);
    rows = await getAll("warehouse").catch(()=>[]);
  }
  const sorted = [...(rows || [])].sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
  tbody.innerHTML = "";
  if(sorted.length === 0){
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:24px;">尚無倉庫。請先在上方建立倉庫（例如 MAIN）。</td></tr>';
    return;
  }
  sorted.forEach(w=>{
    const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(w.category) : (termLabel(w.category) || w.category || ""));
    const badge = termStatusLampHtml(w.status);
    tbody.innerHTML += `
      <tr>
        <td>${w.warehouse_id || ""}</td>
        <td>${w.warehouse_name || ""}${catLabel ? ` <span style="color:#64748b;font-size:12px;">(${catLabel})</span>` : ""}</td>
        <td class="col-status">${badge}</td>
        <td><button class="btn-edit" onclick="loadWarehouse('${String(w.warehouse_id||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}')">Load</button></td>
      </tr>
    `;
  });
}

async function searchWarehouses(){
  setTbodyLoading_("whTableBody", 4);
  const kw = (document.getElementById("search_wh_keyword")?.value || "").trim().toLowerCase();
  const status = (document.getElementById("search_wh_status")?.value || "").trim().toUpperCase();
  const list = await getAll("warehouse").catch(()=>[]);
  const result = (list || []).filter(w=>{
    const stOk = !status || String(w.status||"").toUpperCase() === status;
    if(!stOk) return false;
    if(!kw) return true;
    return String(w.warehouse_id||"").toLowerCase().includes(kw) || String(w.warehouse_name||"").toLowerCase().includes(kw);
  });
  renderWarehouses(result);
}

async function resetWarehouseSearch(){
  const a = document.getElementById("search_wh_keyword");
  const b = document.getElementById("search_wh_status");
  if(a) a.value = "";
  if(b) b.value = "";
  await renderWarehouses();
}

