/**
 * Users（API 版）
 */

let userEditing = false;

async function usersInit(){
  resetUserForm();
  await renderUsers();
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
  const rm = document.getElementById("u_remark");
  if(rm) rm.value = "";
}

async function createUser(){
  const user_id = (document.getElementById("u_id")?.value || "").trim();
  const user_name = (document.getElementById("u_name")?.value || "").trim();
  const role = document.getElementById("u_role")?.value || "OP";
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();

  if(!user_id) return showToast("User ID 必填","error");
  if(!user_name) return showToast("姓名必填","error");

  showSaveHint();
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
  document.getElementById("u_remark").value = u.remark || "";
  if(typeof scrollToEditorTop === "function") scrollToEditorTop();
}

async function updateUser(){
  if(!userEditing) return showToast("請先載入使用者再更新","error");
  const user_id = (document.getElementById("u_id")?.value || "").trim();
  const user_name = (document.getElementById("u_name")?.value || "").trim();
  const role = document.getElementById("u_role")?.value || "OP";
  const status = document.getElementById("u_status")?.value || "ACTIVE";
  const remark = (document.getElementById("u_remark")?.value || "").trim();

  if(!user_name) return showToast("姓名必填","error");

  showSaveHint();
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
}

async function renderUsers(){
  const tbody = document.getElementById("uTableBody");
  if(!tbody) return;
  const list = await getAll("user").catch(()=>[]);
  const sorted = [...list].sort((a,b)=>(b.updated_at||"").localeCompare(a.updated_at||""));
  tbody.innerHTML = "";
  sorted.forEach(u => {
    tbody.innerHTML += `
      <tr>
        <td>${u.user_id || ""}</td>
        <td>${u.user_name || ""}</td>
        <td>${u.role || ""}</td>
        <td>${termLabel(u.status)}</td>
        <td>${u.updated_at || ""}</td>
        <td><button class="btn-edit" onclick="loadUser('${u.user_id}')">Edit</button></td>
      </tr>
    `;
  });
}

