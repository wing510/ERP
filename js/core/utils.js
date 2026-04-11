/**
 * ERP Core Utils
 * - 以「穩定可追溯」為優先：ID 由前端產生並寫入 Sheet
 * - 時間：僅保留一個共用函式 nowIso16()（台灣本地時間），各模組一律使用此函式，勿再自訂 nowTime/nowIso16
 */

/** 唯一共用：台灣本地時間 YYYY-MM-DDTHH:mm（供 datetime-local 與 created_at/updated_at 儲存用） */
function nowIso16(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 擷取 YYYY-MM-DD，供 `<input type="date">` 與列表顯示（相容舊資料含時間） */
function dateInputValue_(v){
  const s = String(v || "").trim();
  if(!s) return "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/**
 * 產生可讀且不易撞號的 ID
 * 範例：IMP-260320-1813-9CF6
 */
function generateId(prefix){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,"0");
  // YYMMDD（短版）+ HHMM（分鐘精度）+ 4 位隨機（16 進位）
  const yy = String(d.getFullYear()).slice(-2);
  const ymd = `${yy}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rnd = Math.random().toString(16).slice(2,6).toUpperCase();
  return `${prefix}-${ymd}-${hm}-${rnd}`;
}

/** 較短的主檔 ID：例如 P260411-A3（日期後僅 2 碼英數，主檔用） */
function generateShortId(prefix){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,"0");
  const yy = String(d.getFullYear()).slice(-2);
  const ymd = `${yy}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const n = Math.floor(Math.random() * 36 * 36);
  const rnd = n.toString(36).toUpperCase().padStart(2, "0");
  return `${prefix}${ymd}-${rnd}`;
}

/**
 * 下拉與既有資料對齊：若值不在固定選項內，暫時加一筆「舊資料」避免載入後空白。
 * 適用客戶分類／國家、供應商國家、進口原產地等。
 */
function syncSelectWithLegacy_(selectId, storedValue){
  const sel = document.getElementById(selectId);
  if(!sel) return;
  sel.querySelectorAll("option[data-legacy='1']").forEach(function(o){
    o.remove();
  });
  const v = String(storedValue || "").trim();
  if(!v){
    sel.value = "";
    return;
  }
  const exists = Array.from(sel.options).some(function(o){
    return String(o.value) === v;
  });
  if(!exists){
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v + "（舊資料）";
    opt.dataset.legacy = "1";
    sel.appendChild(opt);
  }
  sel.value = v;
}

/** 數量框旁單位後綴：hidden 存值、span 顯示；無單位時空白（不顯示佔位符）。 */
function syncErpQtyUnitSuffix_(hiddenId, suffixId){
  const h = document.getElementById(hiddenId);
  const s = document.getElementById(suffixId);
  if(!s) return;
  const u = h ? String(h.value || "").trim() : "";
  s.textContent = u;
}

/* =========================================================
   QA / 批次 / 異動 名詞：雙語或白話（新手友善）
========================================================= */
var TERM_LABELS = {
  PENDING: "PENDING（待QA）",
  APPROVED: "APPROVED（QA已放行）",
  REJECTED: "REJECTED（QA已退回）",
  ACTIVE: "ACTIVE（使用中）",
  INACTIVE: "INACTIVE（停用）",
  CLOSED: "CLOSED（已關閉）",
  VOID: "VOID（作廢不可用）",
  OPEN: "OPEN（開單中）",
  PARTIAL: "PARTIAL（部分）",
  CANCELLED: "CANCELLED（已取消）",
  SHIPPED: "SHIPPED（全數出貨）",
  POSTED: "POSTED（已過帳）",
  PROCESS_OUT: "PROCESS_OUT（加工扣庫）",
  PROCESS_IN: "PROCESS_IN（加工入庫）",
  SHIP_OUT: "SHIP_OUT（出貨扣庫）",
  IN: "IN（入庫）",
  OUT: "OUT（扣庫）",
  ADJUST: "ADJUST（調整）",
  PASSED: "PASSED（已通過）",
  FAILED: "FAILED（未通過）",
  INTERNAL_USE: "INTERNAL_USE（內部領用）",
  SAMPLE: "SAMPLE（樣品）",
  SCRAP: "SCRAP（報廢）",
  OTHER: "OTHER（其他）"
  ,AMBIENT: "AMBIENT（常溫）"
  ,CHILLED: "CHILLED（冷藏）"
  ,FROZEN: "FROZEN（冷凍）"
};

function termLabel(code) {
  if (code == null || code === "") return "";
  var s = String(code).trim().toUpperCase();
  return TERM_LABELS[s] || code;
}

/** 列表等僅顯示中文：termLabel 為「CODE（說明）」時取括號內，否則沿用原字串。 */
function termLabelZhOnly(code) {
  if (code == null || code === "") return "";
  var full = (typeof termLabel === "function" ? termLabel(code) : String(code)) || "";
  var m = String(full).match(/^([A-Z0-9_]+)（([^）]+)）$/);
  if (m) return m[2];
  return full;
}

/**
 * 狀態徽章內文：英文碼一行、（中文說明）下一行（對齊 termLabel「CODE（說明）」）
 */
function termStatusBadgeInnerHtml(code){
  var full = (typeof termLabel === "function" ? termLabel(code) : String(code || "")) || "";
  var esc = function(t){
    return String(t || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  var m = String(full).match(/^([A-Z0-9_]+)（([^）]+)）$/);
  if(m){
    return '<span class="badge-line badge-line-en">' + esc(m[1]) + '</span>' +
      '<span class="badge-line badge-line-zh">（' + esc(m[2]) + '）</span>';
  }
  return esc(full);
}

/**
 * 主檔列表狀態：僅燈號（hover 可看完整說明，與表單旁燈號同色）
 */
function termStatusLampHtml(code){
  var raw = String(code == null ? "" : code).trim();
  var st = raw.toUpperCase();
  var active = st === "ACTIVE";
  var inactive = st === "INACTIVE";
  var esc = function(t){
    return String(t || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  var normCode = active ? "ACTIVE" : (inactive ? "INACTIVE" : (raw || "INACTIVE"));
  var labelFull = (typeof termLabelZhOnly === "function" ? termLabelZhOnly(normCode) : ((typeof termLabel === "function" ? termLabel(normCode) : normCode) || normCode)) || normCode;
  var modClass = active ? "status-lamp--active" : (inactive ? "status-lamp--inactive" : "status-lamp--unknown");
  return (
    '<span class="status-lamp status-lamp--solo ' + modClass + '" title="' + esc(labelFull) + '" aria-label="' + esc(labelFull) + '" role="img">' +
    '<span class="status-lamp-dot" aria-hidden="true"></span></span>'
  );
}

/**
 * 主檔表單：依狀態下拉目前值更新旁邊燈號（lamp 預設 id = selectId + "_lamp"）
 */
function syncStatusSelectLamp_(selectId, lampId){
  var sel = document.getElementById(selectId);
  var lamp = document.getElementById(lampId || (selectId + "_lamp"));
  if(!sel || !lamp) return;
  var raw = String(sel.value || "").trim();
  var st = raw.toUpperCase();
  var active = st === "ACTIVE";
  var inactive = st === "INACTIVE";
  var normCode = active ? "ACTIVE" : (inactive ? "INACTIVE" : (raw || "INACTIVE"));
  var labelFull = (typeof termLabel === "function" ? termLabel(normCode) : normCode) || normCode;
  var modClass = active ? "status-lamp--active" : (inactive ? "status-lamp--inactive" : "status-lamp--unknown");
  lamp.className = "status-lamp status-lamp--solo " + modClass;
  lamp.setAttribute("title", labelFull);
  lamp.setAttribute("aria-label", labelFull);
  lamp.setAttribute("role", "img");
  lamp.innerHTML = '<span class="status-lamp-dot" aria-hidden="true"></span>';
}

function bindStatusSelectLamp_(selectId, lampId){
  var sel = document.getElementById(selectId);
  if(!sel || sel.dataset.statusLampBound) return;
  sel.dataset.statusLampBound = "1";
  var lid = lampId || (selectId + "_lamp");
  sel.addEventListener("change", function(){
    syncStatusSelectLamp_(selectId, lid);
  });
  syncStatusSelectLamp_(selectId, lid);
}

/**
 * 取「短中文」標籤（常用於下拉/列表的倉別等）
 * - 若 termLabel(term) 形如 "AMBIENT（常溫）" → 回傳 "常溫"
 * - 否則回傳 termLabel(term)（或原字串）
 */
function termShortZh_(term){
  var full = (typeof termLabel === "function" ? termLabel(term) : String(term || "")) || "";
  var m = String(full).match(/（([^）]+)）/);
  return m ? m[1] : String(full || "");
}

/* =========================================================
   UI 基礎：Toast / Uppercase Input
========================================================= */

function showToast(message, type="success"){
  const toast = document.getElementById("toast");
  if(!toast) return alert(message);

  toast.innerText = String(message || "");
  toast.className = "toast show " + type;
  setTimeout(()=>{ toast.className = "toast"; }, 3000);
}

function bindUppercaseInput(elementId){
  const el = document.getElementById(elementId);
  if(!el) return;
  if(el.dataset.uppercaseBound) return;
  el.dataset.uppercaseBound = "1";

  el.addEventListener("input", () => {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const upper = (el.value || "").toUpperCase();
    if(el.value !== upper){
      el.value = upper;
      if(start != null && end != null){
        el.setSelectionRange(start, end);
      }
    }
  });
}

/* =========================================================
   UX：列表按 Load 後捲到上方編輯區
========================================================= */

function scrollToEditorTop(){
  try{
    // 這個專案的滾動容器是 #content（不是整個 window）
    const content = document.getElementById("content");
    if(content && typeof content.scrollTo === "function"){
      content.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }catch(_e){
    try{
      const content = document.getElementById("content");
      if(content) content.scrollTop = 0;
      window.scrollTo(0,0);
    }catch(_e2){}
  }
}

/* =========================================================
   UX：資料表 tbody 載入中（與收貨「已收列表」同風格）
========================================================= */

function setTbodyLoading_(tbodyOrId, colspan, message){
  const tbody = typeof tbodyOrId === "string" ? document.getElementById(tbodyOrId) : tbodyOrId;
  if(!tbody) return;
  const n = Math.max(1, Number(colspan) || 1);
  const msg = message == null || message === "" ? "載入中…" : String(message);
  const esc = msg.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  tbody.innerHTML =
    `<tr><td colspan="${n}" style="text-align:center;color:#64748b;padding:18px;">${esc}</td></tr>`;
}

/* =========================================================
   參考關聯檢查（停用策略用）
========================================================= */

async function isIdUsedInAny(idValue, refs){
  const id = String(idValue || "");
  const list = Array.isArray(refs) ? refs : [];
  if(!id || list.length === 0) return false;

  // 簡單快取：避免同一輪重複打 API
  const cache = {};

  for(const r of list){
    const type = r?.type;
    const field = r?.field;
    if(!type || !field) continue;

    if(!cache[type]){
      cache[type] = await getAll(type).catch(()=>[]);
    }
    const rows = cache[type] || [];
    if(rows.some(x => String(x[field] || "") === id)){
      return true;
    }
  }
  return false;
}

/* =========================================================
   搜尋列：輸入／下拉變更即篩選（比照 Logs，不必再按「搜尋」）
========================================================= */

/**
 * @param {Array<[string, "input"|"change"]>} controls - [元素 id, 事件名稱]
 * @param {Function} callback - 例如 searchProducts 或 () => renderShipments()
 */
function bindAutoSearchToolbar_(controls, callback){
  if(!Array.isArray(controls) || typeof callback !== "function") return;
  controls.forEach(function(pair){
    const id = pair[0];
    const ev = pair[1] || "input";
    const el = document.getElementById(id);
    if(!el) return;
    if(el.dataset.erpAutoSearchBound) return;
    el.dataset.erpAutoSearchBound = "1";
    el.addEventListener(ev, function(){
      try{
        const ret = callback();
        if(ret && typeof ret.then === "function"){
          ret.catch(function(){});
        }
      }catch(_e){}
    });
  });
}

/* =========================================================
  單位換算（主檔規則）
========================================================= */

function normalizeUnit(unit){
  return String(unit || "").trim().toUpperCase();
}

function parseUnitRatioToBaseMap(raw){
  if(raw == null || raw === "") return {};
  let obj = raw;
  if(typeof raw === "string"){
    try{
      obj = JSON.parse(raw);
    }catch(_e){
      return null;
    }
  }
  if(!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  Object.keys(obj).forEach(k => {
    const key = normalizeUnit(k);
    const val = Number(obj[k]);
    if(!key) return;
    if(!(val > 0)) return;
    out[key] = val;
  });
  return out;
}

function parseProductUomConfigFromRemark_(remark){
  const text = String(remark || "");
  const m = text.match(/@UOM:\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
  if(!m) return null;
  try{
    const obj = JSON.parse(m[1]);
    if(!obj || typeof obj !== "object") return null;
    const base = normalizeUnit(obj.base_unit || "");
    const map = parseUnitRatioToBaseMap(obj.map || {});
    if(!base) return null;
    if(map === null) return null;
    return { base_unit: base, map: map || {} };
  }catch(_e){
    return null;
  }
}

/** 從 product.uom_config 欄位解析（與 @UOM JSON 相同結構） */
function parseProductUomConfigFromField_(uomRaw){
  const text = String(uomRaw || "").trim();
  if(!text) return null;
  try{
    const obj = JSON.parse(text);
    if(!obj || typeof obj !== "object") return null;
    const base = normalizeUnit(obj.base_unit || "");
    const map = parseUnitRatioToBaseMap(obj.map || {});
    if(!base) return null;
    if(map === null) return null;
    return { base_unit: base, map: map || {} };
  }catch(_e){
    return null;
  }
}

/**
 * 讀取產品多單位設定：優先 uom_config，其次備註內舊版 @UOM:
 */
function getProductUomConfig(product){
  const p = product || {};
  const fromField = parseProductUomConfigFromField_(p.uom_config);
  if(fromField) return fromField;
  return parseProductUomConfigFromRemark_(p.remark);
}

function upsertProductUomRemark(remark, cfg){
  const raw = String(remark || "");
  const cleaned = raw.replace(/\n?@UOM:\s*\{[\s\S]*?\}\s*(?:\n|$)/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if(!cfg) return cleaned;
  const base = normalizeUnit(cfg.base_unit || "");
  const map = cfg.map && typeof cfg.map === "object" ? cfg.map : {};
  const json = JSON.stringify({ base_unit: base, map }, null, 0);
  return (cleaned ? (cleaned + "\n") : "") + `@UOM:${json}`;
}

function stripProductUomRemark(remark){
  const raw = String(remark || "");
  return raw.replace(/\n?@UOM:\s*\{[\s\S]*?\}\s*(?:\n|$)/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 將 qty + unit 轉為產品基準單位數量
 * 規則：
 * - unit === base_unit 時直接回傳 qty
 * - 否則查 product.unit_ratio_to_base_json[unit]
 * - 找不到或格式錯誤時回傳 null
 */
function convertToBase(product, qty, unit){
  const q = Number(qty);
  if(!Number.isFinite(q)) return null;
  const p = product || {};
  const cfg = getProductUomConfig(p);
  const baseUnit = normalizeUnit(cfg?.base_unit || p.unit || "");
  const srcUnit = normalizeUnit(unit || p.unit || "");
  if(!baseUnit || !srcUnit) return null;
  if(srcUnit === baseUnit) return q;

  const map = cfg ? (cfg.map || {}) : {};
  if(!map) return null;
  const rate = Number(map[srcUnit] || 0);
  if(!(rate > 0)) return null;
  return q * rate;
}

