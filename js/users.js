/**
 * Users（API 版）
 */

let userEditing = false;

function escHtml_(s){
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr_(s){
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** 列表顯示用（與表單選項中文一致）；未知代碼則原樣顯示 */
function userRoleLabelZh_(role){
  const r = String(role || "").trim().toUpperCase();
  const map = {
    ADMIN: "管理員",
    CEO: "CEO",
    // 新代碼（兩字母縮寫）
    FN: "財務",
    GA: "總務",
    SL: "業務",
    WH: "倉管",
    // 舊代碼（相容歷史資料）
    FINANCE: "財務",
    GENERAL_AFFAIRS: "總務",
    SALES: "業務",
    WAREHOUSE: "倉管",
    QA: "品保",
    OP: "作業",
    // 仍保留 ADMIN/CEO/QA/OP
  };
  return map[r] || String(role || "").trim() || "—";
}

async function usersInit(){
  resetUserForm();
  bindAutoSearchToolbar_([
    ["u_search_keyword", "input"],
    ["u_search_status", "change"]
  ], () => renderUsers());
  await renderUsers();
  if(typeof bindStatusSelectLamp_ === "function") bindStatusSelectLamp_("u_status");
}

function setUserButtons_(){
  const createBtn = document.getElementById("u_create_btn");
  const updateBtn = document.getElementById("u_update_btn");
  if(createBtn){
    createBtn.disabled = !!userEditing;
    createBtn.title = userEditing ? "已載入使用者，請用更新" : "建立新使用者";
  }
  if(updateBtn){
    updateBtn.disabled = !userEditing;
    updateBtn.title = userEditing ? "更新此使用者" : "請先載入使用者";
  }
}

function resetUserForm(){
  userEditing = false;
  const id = document.getElementById("u_id");
  if(id){ id.value = ""; id.disabled = false; }
  const name = document.getElementById("u_name");
  if(name) name.value = "";
  const pw = document.getElementById("u_password");
  if(pw) pw.value = "";
  const role = document.getElementById("u_role");
  if(role) role.value = "";
  const st = document.getElementById("u_status");
  if(st) st.value = "ACTIVE";
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("u_status");
  const rm = document.getElementById("u_remark");
  if(rm) rm.value = "";
  setUserButtons_();
}

async function createUser(triggerEl){
  const user_id = (document.getElementById("u_id")?.value || "").trim();
  const user_name = (document.getElementById("u_name")?.value || "").trim();
  const password = (document.getElementById("u_password")?.value || "").trim();
  const role = (document.getElementById("u_role")?.value || "").trim();
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();

  if(!user_id) return showToast("User ID 必填","error");
  if(!user_name) return showToast("姓名必填","error");
  if(!password) return showToast("密碼必填","error");
  if(!role) return showToast("請選擇角色","error");

  showSaveHint(triggerEl);
  try {
  const exists = await getOne("user","user_id",user_id).catch(()=>null);
  if(exists) return showToast("User ID 已存在","error");

  await createRecord("user", {
    user_id,
    user_name,
    password,
    role,
    status,
    remark,
    created_at: nowIso16(),
    updated_at: nowIso16()
  });

  showToast("使用者建立成功");
  await renderUsers();
  resetUserForm();
  } finally { hideSaveHint(); }
  setUserButtons_();
}

async function loadUser(userId){
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  const u = await getOne("user","user_id",userId);
  if(!u) return;
  userEditing = true;
  const id = document.getElementById("u_id");
  id.value = u.user_id;
  id.disabled = true;
  document.getElementById("u_name").value = u.user_name || "";
  try{ const pw = document.getElementById("u_password"); if(pw) pw.value = ""; }catch(_e){}
  document.getElementById("u_role").value = u.role || "OP";
  document.getElementById("u_status").value = u.status || "ACTIVE";
  if(typeof syncStatusSelectLamp_ === "function") syncStatusSelectLamp_("u_status");
  document.getElementById("u_remark").value = u.remark || "";
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
  setUserButtons_();
}

async function updateUser(triggerEl){
  if(!userEditing) return showToast("請先載入使用者再更新","error");
  const user_id = (document.getElementById("u_id")?.value || "").trim();
  const user_name = (document.getElementById("u_name")?.value || "").trim();
  const passwordRaw = (document.getElementById("u_password")?.value || "");
  const password = String(passwordRaw).trim();
  const role = (document.getElementById("u_role")?.value || "").trim();
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();

  if(!user_name) return showToast("姓名必填","error");
  if(!role) return showToast("請選擇角色","error");

  showSaveHint(triggerEl);
  try {
  await updateRecord("user","user_id",user_id,{
    user_name,
    ...(password ? { password } : {}),
    role,
    status,
    remark,
    updated_at: nowIso16()
  });

  showToast("使用者更新成功");
  await renderUsers();
  } finally { hideSaveHint(); }
  setUserButtons_();
}

function resetUserListSearch(){
  const kw = document.getElementById("u_search_keyword");
  const st = document.getElementById("u_search_status");
  if(kw) kw.value = "";
  if(st) st.value = "";
  renderUsers();
}

async function renderUsers(){
  const tbody = document.getElementById("uTableBody");
  if(!tbody) return;
  setTbodyLoading_(tbody, 5);
  const list = await getAll("user").catch(()=>[]);
  const kw = (document.getElementById("u_search_keyword")?.value || "").trim().toLowerCase();
  const qSt = (document.getElementById("u_search_status")?.value || "").trim().toUpperCase();
  const filtered = (list || []).filter(u => {
    if(qSt && String(u.status || "").toUpperCase() !== qSt) return false;
    if(!kw) return true;
    const roleZh = userRoleLabelZh_(u.role);
    const hay = [
      u.user_id,
      u.user_name,
      u.role,
      roleZh,
      u.remark
    ].map(x => String(x || "").toLowerCase()).join(" ");
    return hay.includes(kw);
  });
  const sorted = [...filtered].sort((a,b)=>(b.updated_at||"").localeCompare(a.updated_at||""));
  tbody.innerHTML = "";
  if(!sorted.length){
    const emptyMsg = kw || qSt
      ? '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px;">沒有符合條件的使用者。</td></tr>'
      : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px;">尚無使用者。請在上方表單建立。</td></tr>';
    tbody.innerHTML = emptyMsg;
    return;
  }
  sorted.forEach(u => {
    const badge = termStatusLampHtml(u.status);
    const roleCode = String(u.role || "").trim();
    tbody.innerHTML += `
      <tr>
        <td>${u.user_id || ""}</td>
        <td>${u.user_name || ""}</td>
        <td${roleCode ? ` title="${escAttr_(roleCode)}"` : ""}>${escHtml_(userRoleLabelZh_(u.role))}</td>
        <td class="col-status">${badge}</td>
        <td><button class="btn-edit" onclick="loadUser('${u.user_id}')">Load</button></td>
      </tr>
    `;
  });
}

