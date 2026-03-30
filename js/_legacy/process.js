let editingMode = false;

/* ===== 初始化 ===== */
function productsInit(){
  renderProducts();
}

/* =========================
   建立 Product（v3）
========================= */
function createProduct(){

  const product = {
    product_id: p_id.value.trim(),
    product_name: p_name.value.trim(),
    type: p_type.value,
    spec: p_spec.value.trim(),
    unit: p_unit.value,
    status: p_status.value,
    created_by: getCurrentUser(),
    created_at: nowIso16(),
    updated_by: "",
    updated_at: ""
  };

  try{
    createRecord("product", product);
    renderProducts();
    clearForm();
    showToast("產品建立成功");
  }catch(err){
    showToast(err.message,"error");
  }
}

/* =========================
   更新 Product（v3）
========================= */
function updateProduct(){

  if(!editingMode)
    return showToast("請先選擇產品","error");

  const product_id = p_id.value.trim();

  const updates = {
    product_name: p_name.value.trim(),
    type: p_type.value,
    spec: p_spec.value.trim(),
    unit: p_unit.value,
    status: p_status.value,
    updated_by: getCurrentUser(),
    updated_at: nowIso16()
  };

  try{
    updateRecord("product","product_id",product_id,updates);
    renderProducts();
    clearForm();
    showToast("產品更新成功");
  }catch(err){
    showToast(err.message,"error");
  }
}

/* ========================= */
function clearForm(){
  editingMode = false;
  p_id.disabled = false;

  document.querySelectorAll("#p_id,#p_name,#p_spec,#p_remark")
    .forEach(el=>el.value="");

  p_status.value = "ACTIVE";
  p_type.value = "RM";
}

/* ========================= */
function loadProduct(product_id){

  const list = getAll("product");
  const p = list.find(x=>x.product_id===product_id);
  if(!p) return;

  editingMode = true;

  p_id.value = p.product_id;
  p_name.value = p.product_name;
  p_type.value = p.type;
  p_spec.value = p.spec;
  p_unit.value = p.unit;
  p_status.value = p.status;

  p_id.disabled = true;
}

/* ========================= */
function searchProducts(){

  const kw = (document.getElementById("search_product_keyword")?.value || "").trim().toLowerCase();
  const type = document.getElementById("search_type")?.value || "";
  const status = document.getElementById("search_status")?.value || "";

  let result = getAll("product").filter(p=>{
    const matchKw = !kw ||
      p.product_id.toLowerCase().includes(kw) ||
      p.product_name.toLowerCase().includes(kw) ||
      String(p.spec || "").toLowerCase().includes(kw) ||
      String(p.remark || "").toLowerCase().includes(kw);
    return matchKw && (!type || p.type === type) && (!status || p.status === status);
  });

  renderProducts(result);
}

function resetSearch(){
  const kwEl = document.getElementById("search_product_keyword");
  const typeEl = document.getElementById("search_type");
  const statusEl = document.getElementById("search_status");
  if(kwEl) kwEl.value = "";
  if(typeEl) typeEl.value = "";
  if(statusEl) statusEl.value = "";
  renderProducts();
}

/* ========================= */
let productSort = { field:"", asc:true };

function sortProducts(field){
  const sorted = applySorting(getAll("product"), field, productSort);
  renderProducts(sorted);
}

/* ========================= */
function renderProducts(list=getAll("product")){

  const tbody=document.getElementById("productTableBody");
  if(!tbody) return;

  tbody.innerHTML="";

  list.forEach(p=>{

    const badge=p.status==="ACTIVE"
      ? `<span class="badge badge-active">ACTIVE</span>`
      : `<span class="badge badge-inactive">INACTIVE</span>`;

    tbody.innerHTML+=`
      <tr>
        <td>${p.product_id}</td>
        <td>${p.product_name}</td>
        <td>${p.type}</td>
        <td>${p.spec||""}</td>
        <td>${p.unit}</td>
        <td>${badge}</td>
        <td>${p.created_by||""}</td>
        <td>${p.created_at||""}</td>
        <td>${p.updated_by||""}</td>
        <td>${p.updated_at||""}</td>
        <td><button class="btn-edit" onclick="loadProduct('${p.product_id}')">Edit</button></td>
      </tr>
    `;
  });
}