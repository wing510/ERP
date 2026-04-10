let supplierEditing = false;

/* ===== 企業級設定 ===== */
const SUPPLIER_RULES = {
  idRegex: /^[A-Z0-9_-]+$/,
  idMax: 30
};

// `bindUppercaseInput` 已移至 `js/core/utils.js`

/* ===== 初始化 ===== */
async function suppliersInit(){
  bindUppercaseInput("s_id");
  bindAutoSearchToolbar_([
    ["search_supplier_keyword", "input"],
    ["search_supplier_status", "change"]
  ], () => searchSuppliers());
  await renderSuppliers();
  clearSupplierForm();
}

function setSupplierButtons_(){
  const createBtn = document.getElementById("s_create_btn");
  const updateBtn = document.getElementById("s_update_btn");
  if(createBtn){
    createBtn.disabled = !!supplierEditing;
    createBtn.title = supplierEditing ? "已載入供應商，請用更新" : "建立新供應商";
  }
  if(updateBtn){
    updateBtn.disabled = !supplierEditing;
    updateBtn.title = supplierEditing ? "更新此供應商" : "請先載入供應商";
  }
}

/* ===== 建立 ===== */
async function createSupplier(triggerEl){

  const supplier_id = s_id.value.trim().toUpperCase();
  s_id.value = supplier_id;
  const supplier_name = s_name.value.trim();

  if(!supplier_id || !supplier_name)
    return showToast("ID / 名稱 必填","error");

  if(supplier_id.length > SUPPLIER_RULES.idMax)
    return showToast("ID 長度過長（最多 30 字元）","error");

  if(!SUPPLIER_RULES.idRegex.test(supplier_id))
    return showToast("ID 只能使用 A-Z 0-9 _ -","error");

  showSaveHint(triggerEl);
  try {
  const list = await getAll("supplier");
  if(list.some(s=>s.supplier_id===supplier_id))
    return showToast("供應商ID 已存在","error");

  const supplier = {
    supplier_id,
    supplier_name,
    contact_person: s_contact.value.trim(),
    phone: s_phone.value.trim(),
    email: s_email.value.trim(),
    address: s_address.value.trim(),
    country: s_country.value.trim(),
    status: s_status.value,
    remark: s_remark.value.trim(),
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };

  await createRecord("supplier", supplier);

  await renderSuppliers();
  clearSupplierForm();

  showToast("供應商建立成功");
  } finally { hideSaveHint(); }
  setSupplierButtons_();
}

/* ===== 更新 ===== */
async function updateSupplier(triggerEl){

  if(!supplierEditing)
    return showToast("請先選擇供應商","error");

  showSaveHint(triggerEl);
  try {
  const supplier_id = s_id.value.trim();
  const supplier = await getOne("supplier","supplier_id",supplier_id);

  if(!supplier)
    return showToast("找不到供應商","error");

  const newStatus = s_status.value;

  // 停用策略建議：允許停用，但若已被使用則提醒確認（不再硬性阻擋）
  if(supplier.status==="ACTIVE" && newStatus==="INACTIVE"){
    const isUsed = await isIdUsedInAny(supplier_id, [
      { type:"purchase_order", field:"supplier_id" },
      { type:"import_document", field:"supplier_id" },
      { type:"process_order", field:"supplier_id" }
    ]);

    if(isUsed){
      const ok = confirm(
        "此供應商已被使用（可能已有採購/加工紀錄）。\n\n仍要停用嗎？停用後將不能在新單據被選用，但歷史紀錄會保留。"
      );
      if(!ok) return;
    }else{
      // 若無法判定是否被使用，仍給一次基本確認，避免誤停用
      const ok = confirm("確定要將此供應商停用（INACTIVE）嗎？");
      if(!ok) return;
    }
  }

  const newData = {
    supplier_name: s_name.value.trim(),
    contact_person: s_contact.value.trim(),
    phone: s_phone.value.trim(),
    email: s_email.value.trim(),
    address: s_address.value.trim(),
    country: s_country.value.trim(),
    status: newStatus,
    remark: s_remark.value.trim(),
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  };

  await updateRecord("supplier", "supplier_id", supplier_id, newData);

  await renderSuppliers();
  clearSupplierForm();

  showToast("供應商更新成功");
  } finally { hideSaveHint(); }
  setSupplierButtons_();
}

/* ===== 清除 ===== */
function clearSupplierForm(){
  supplierEditing=false;
  s_id.disabled=false;

  document.querySelectorAll(
    "#s_id,#s_name,#s_contact,#s_phone,#s_email,#s_address,#s_country,#s_remark"
  ).forEach(el=>el.value="");

  s_status.value="ACTIVE";
  s_id.value = generateShortId("S");
  setSupplierButtons_();
}

/* ===== 載入 ===== */
async function loadSupplier(id){
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  const s = await getOne("supplier","supplier_id",id);
  if(!s) return;

  supplierEditing=true;

  s_id.value = s.supplier_id;
  s_name.value = s.supplier_name;
  s_contact.value = s.contact_person;
  s_phone.value = s.phone;
  s_email.value = s.email;
  s_address.value = s.address;
  s_country.value = s.country;
  s_status.value = s.status;
  s_remark.value = s.remark;

  s_id.disabled=true;
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  setSupplierButtons_();
}

/* ===== Render ===== */
async function renderSuppliers(list=null){

  const tbody=document.getElementById("supplierTableBody");
  if(!tbody) return;

  if(!list){
    setTbodyLoading_(tbody, 6);
    list = await getAll("supplier");
  }

  tbody.innerHTML="";
  if(!list.length){
    tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px;">尚無供應商。請在上方表單填寫後按「建立」新增第一筆供應商。</td></tr>';
    return;
  }

  list.forEach(s=>{

    const badge = s.status==="ACTIVE"
      ? `<span class="badge badge-active">${termLabel("ACTIVE")}</span>`
      : `<span class="badge badge-inactive">${termLabel(s.status||"INACTIVE")}</span>`;

    tbody.innerHTML+=`
      <tr>
        <td>${s.supplier_id}</td>
        <td>${s.supplier_name}</td>
        <td>${s.contact_person||""}</td>
        <td>${s.phone||""}</td>
        <td>${badge}</td>
        <td>
          <button class="btn-edit" onclick="loadSupplier('${s.supplier_id}')">Edit</button>
          <button class="btn-secondary" onclick="openLogs('supplier','${s.supplier_id}','master')">Logs</button>
        </td>
      </tr>
    `;
  });
}

/*********************************
 * Sort (內建穩定排序)
 *********************************/

let supplierSort = { field:"", asc:true };

async function sortSuppliers(field){
  setTbodyLoading_("supplierTableBody", 6);
  const list = [...(await getAll("supplier"))];

  if(supplierSort.field===field){
    supplierSort.asc=!supplierSort.asc;
  }else{
    supplierSort.field=field;
    supplierSort.asc=true;
  }

  list.sort((a,b)=>{
    let valA=a[field]??"";
    let valB=b[field]??"";

    if(typeof valA==="string") valA=valA.toLowerCase();
    if(typeof valB==="string") valB=valB.toLowerCase();

    if(valA>valB) return supplierSort.asc?1:-1;
    if(valA<valB) return supplierSort.asc?-1:1;
    return 0;
  });

  renderSuppliers(list);
}

/* ===== 搜尋 ===== */
async function searchSuppliers(){
  setTbodyLoading_("supplierTableBody", 6);

  const kw = (document.getElementById("search_supplier_keyword")?.value || "").trim().toLowerCase();
  const status = document.getElementById("search_supplier_status")?.value || "";

  const result = (await getAll("supplier")).filter(s=>{
    const matchKw = !kw ||
      s.supplier_id.toLowerCase().includes(kw) ||
      s.supplier_name.toLowerCase().includes(kw) ||
      String(s.contact_person || "").toLowerCase().includes(kw) ||
      String(s.phone || "").toLowerCase().includes(kw) ||
      String(s.email || "").toLowerCase().includes(kw);
    return matchKw && (!status || s.status === status);
  });

  renderSuppliers(result);
}

/* ===== 重設 ===== */
async function resetSupplierSearch(){
  const kwEl = document.getElementById("search_supplier_keyword");
  const stEl = document.getElementById("search_supplier_status");
  if(kwEl) kwEl.value = "";
  if(stEl) stEl.value = "";
  await renderSuppliers();
}