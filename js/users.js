/**
 * Users（API 版）
 */

let userEditing = false;

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
  const role = document.getElementById("u_role");
  if(role) role.value = "OP";
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
  const role = document.getElementById("u_role")?.value || "OP";
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();

  if(!user_id) return showToast("User ID 必填","error");
  if(!user_name) return showToast("姓名必填","error");

  showSaveHint(triggerEl);
  try {
  const exists = await getOne("user","user_id",user_id).catch(()=>null);
  if(exists) return showToast("User ID 已存在","error");

  await createRecord("user", {
    user_id,
    user_name,
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
  const role = document.getElementById("u_role")?.value || "OP";
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();

  if(!user_name) return showToast("姓名必填","error");

  showSaveHint(triggerEl);
  try {
  await updateRecord("user","user_id",user_id,{
    user_name,
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
    const hay = [
      u.user_id,
      u.user_name,
      u.role,
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
    tbody.innerHTML += `
      <tr>
        <td>${u.user_id || ""}</td>
        <td>${u.user_name || ""}</td>
        <td>${u.role || ""}</td>
        <td class="col-status">${badge}</td>
        <td><button class="btn-edit" onclick="loadUser('${u.user_id}')">Load</button></td>
      </tr>
    `;
  });
}

