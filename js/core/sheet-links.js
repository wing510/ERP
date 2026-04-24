/**
 * Sheet 連結（方案 B：DEV/PROD 不同試算表）
 * - 不再在前端寫死 Spreadsheet ID（避免正式站還開到測試表）
 * - 由後端 `env_info` 回傳 spreadsheet_id，前端快取後組出連結
 *
 * 注意：
 * - 複製試算表後，各分頁 gid 會改變，因此這裡採「開整份試算表」方式；
 *   使用者再自行切到對應工作表分頁即可。
 */
let ERP_SPREADSHEET_ID_CACHE_ = "";

async function getSpreadsheetIdFromBackend_(){
  if(ERP_SPREADSHEET_ID_CACHE_) return ERP_SPREADSHEET_ID_CACHE_;
  if(typeof callAPI !== "function") return "";
  try{
    const res = await callAPI({ action: "env_info" }, { method: "GET", silent: true });
    const sid = String(res?.spreadsheet_id || res?.data?.spreadsheet_id || "").trim();
    if(sid) ERP_SPREADSHEET_ID_CACHE_ = sid;
    return sid;
  }catch(_e){
    return "";
  }
}

function buildSheetUrl_(spreadsheetId){
  const sid = String(spreadsheetId || "").trim();
  if(!sid) return "";
  return `https://docs.google.com/spreadsheets/d/${sid}/edit`;
}

function erpCanOpenSheet_(){
  try{
    const r = (typeof getCurrentUserRole === "function" ? String(getCurrentUserRole() || "") : "").trim().toUpperCase();
    return r === "CEO" || r === "GA" || r === "ADMIN";
  }catch(_e){
    return false;
  }
}

function erpApplySheetPermissions(){
  try{
    const ok = erpCanOpenSheet_();
    document.querySelectorAll("button.btn-sheet").forEach(btn=>{
      btn.style.display = ok ? "" : "none";
      btn.setAttribute("aria-hidden", ok ? "false" : "true");
    });
  }catch(_e){}
}
try{ window.erpApplySheetPermissions = erpApplySheetPermissions; }catch(_e0){}

/**
 * @param {keyof typeof SHEET_LINKS} key
 */
async function openSheetLink(key) {
  // Sheet 連結視為「管理/維運」入口：預設僅 CEO/GA/ADMIN 可開
  try{
    const ok = erpCanOpenSheet_();
    if(!ok){
      if (typeof showToast === "function") showToast("僅 CEO/總務/ADMIN 可開啟 Sheet。", "error");
      return;
    }
  }catch(_e0){}

  const sid = await getSpreadsheetIdFromBackend_();
  const url = buildSheetUrl_(sid);
  if(!url){
    if (typeof showToast === "function") showToast("取得試算表連結失敗（請確認後端 env_info 與權限）", "error");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 兼容：部分環境可能擋 inline onclick，導致 Sheet 按鈕無反應。
 * 這裡用事件委派把 `.btn-sheet` 點擊導向 openSheetLink。
 */
function bindSheetButtons_(){
  try{
    if(document.documentElement && document.documentElement.getAttribute("data-erp-sheetbind") === "1") return;
    if(document.documentElement) document.documentElement.setAttribute("data-erp-sheetbind","1");
  }catch(_e){}

  document.addEventListener("click", function(ev){
    const t = ev && ev.target;
    if(!t) return;
    const btn = (typeof t.closest === "function") ? t.closest("button.btn-sheet") : null;
    if(!btn) return;

    // 支援：HTML 仍用 onclick="openSheetLink('xxx')"
    const raw = String(btn.getAttribute("onclick") || "");
    const m = raw.match(/openSheetLink\(\s*['"]([^'"]+)['"]\s*\)/i);
    const key = m && m[1] ? String(m[1]).trim() : "";
    if(!key) return;

    try{
      ev.preventDefault();
      ev.stopPropagation();
    }catch(_e2){}

    try{
      openSheetLink(key);
    }catch(_e3){
      if(typeof showToast === "function") showToast("開啟 Sheet 失敗", "error");
    }
  }, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", function(){
    bindSheetButtons_();
    erpApplySheetPermissions();
  });
}else{
  bindSheetButtons_();
  erpApplySheetPermissions();
}
