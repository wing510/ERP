/*********************************
 * ERP Service Layer v3
 * Google Sheet Backend Edition
 *********************************/

const API_BASE =
  "https://script.google.com/macros/s/AKfycbw4Pg6XTXqdqSdjzY8Vcy2p3qkP3yIOqZqo0PrZjvg2D1dR1-XCUhlFAsy8vIm1pb67/exec"

/* =========================================================
   CURRENT USER (暫時固定)
========================================================= */

function getCurrentUser(){
  try{
    return localStorage.getItem("erp_current_user") || "admin";
  }catch(_e){
    return "admin";
  }
}

function setCurrentUser(userId){
  try{
    localStorage.setItem("erp_current_user", userId || "admin");
  }catch(_e){}
}

/* =========================================================
   API Helper
========================================================= */

/** 寫入時在「按鈕列右側」顯示「儲存中，請稍等…」並鎖住同組按鈕，避免重複送出 */
const SAVE_HINT_ID = "erp-save-hint-inline";

/**
 * @param {string|Element} [target] 可傳入 `.button-group` 或其子元素／#id 選擇器；省略則用 #content 內第一個 .button-group（向後相容）
 */
function showSaveHint(target) {
  hideSaveHint();
  const content = document.getElementById("content");
  if (!content) return;
  let btnGroup = null;
  if (target) {
    let el = null;
    if (typeof target === "string") {
      el = target.charAt(0) === "#" ? document.getElementById(target.slice(1)) : content.querySelector(target);
    } else {
      el = target;
    }
    if (el) {
      btnGroup = el.classList && el.classList.contains("button-group") ? el : el.closest(".button-group");
    }
  }
  if (!btnGroup) {
    btnGroup = content.querySelector(".button-group");
  }
  if (!btnGroup) return;
  const buttons = btnGroup.querySelectorAll("button");
  buttons.forEach(function (btn) {
    btn.disabled = true;
  });
  const span = document.createElement("span");
  span.id = SAVE_HINT_ID;
  span.className = "save-hint-inline";
  span.textContent = "儲存中，請稍等…";
  btnGroup.appendChild(span);
}

function hideSaveHint() {
  const content = document.getElementById("content");
  if (content) {
    const groups = content.querySelectorAll(".button-group");
    groups.forEach(function (grp) {
      grp.querySelectorAll("button").forEach(function (btn) {
        btn.disabled = false;
      });
    });
  }
  const el = document.getElementById(SAVE_HINT_ID);
  if (el && el.parentNode) el.remove();
}

async function callAPI(params, options = {}){

  const method = String(options?.method || "GET").toUpperCase();
  try{
    // URLSearchParams 會把 undefined 變成字串 "undefined" 送出，導致試算表寫入錯誤
    const clean = {};
    Object.keys(params || {}).forEach(function (k) {
      const v = params[k];
      if (v !== undefined) clean[k] = v;
    });
    const payload = new URLSearchParams(clean);

    const response =
      method === "POST"
        ? await fetch(API_BASE, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: payload
          })
        : await fetch(`${API_BASE}?${payload.toString()}`);

    if(!response.ok){
      throw new Error("HTTP Error: " + response.status);
    }

    const result = await response.json();

    if(!result.success){
      throw new Error(result.errors?.join(", ") || "API error");
    }

    return result;

  } catch(err){
    console.error("API ERROR:", err);
    try{
      if(typeof showToast === "function"){
        const msg = err?.message || "操作失敗";
        showToast(msg, "error");
      }
    }catch(_e){}
    throw err;
  } finally {}
}

/* =========================================================
   GET ALL（短期快取，寫入時失效，加快選單切換）
========================================================= */

const API_CACHE = {};
const API_CACHE_TTL_MS = 2 * 60 * 1000; // 2 分鐘

function invalidateCache(type) {
  if (type) delete API_CACHE[type];
  else Object.keys(API_CACHE).forEach(k => delete API_CACHE[k]);
}

async function getAll(type) {
  const key = String(type || "").toLowerCase();
  const now = Date.now();
  const hit = API_CACHE[key];
  if (hit && (now - hit.at) < API_CACHE_TTL_MS) return hit.data;

  const result = await callAPI({ action: `list_${type}` });
  const data = result.data;
  API_CACHE[key] = { data, at: now };
  return data;
}

/* =========================================================
   GET ONE
========================================================= */

async function getOne(type, idField, idValue) {

  const list = await getAll(type);

  return list.find(r => r[idField] === idValue);
}

/* =========================================================
   CREATE
========================================================= */

async function createRecord(type, record) {

  // Lot 預設狀態：PENDING（若未明確指定）
  if (type === "lot" && (record.status == null || record.status === "")) {
    record = {
      ...record,
      status: LOT_DEFAULT_STATUS
    };
  }

  validateSchema(type, record);

  const result = await callAPI({
    action: `create_${type}`,
    ...record
  });

  invalidateCache(type);
  return result;
}

/* =========================================================
   UPDATE
========================================================= */

async function updateRecord(type, idField, idValue, newData) {

  validateSchema(type, newData);

  const result = await callAPI({
    action: `update_${type}`,
    [idField]: idValue,
    ...newData
  });

  invalidateCache(type);
  return result;
}

/* =========================================================
   DELETE
========================================================= */

async function deleteRecord(type, idField, idValue) {

  const result = await callAPI({
    action: `delete_${type}`,
    [idField]: idValue,
    updated_by: getCurrentUser()
  });

  invalidateCache(type);
  return result;
}