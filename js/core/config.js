/**
 * ERP 前端設定（部署時主要改 API_BASE 即可）
 * 若需在「不修改本檔」下覆寫：在 index.html 於本檔之前執行
 *   window.__ERP_CONFIG__ = { API_BASE: "https://你的部署網址/exec" };
 */
(function () {
  var defaults = {
    API_BASE:
      "https://script.google.com/macros/s/AKfycbzi46e9WFl5C-OMY9fD5iCCBBFhX7ur6Pg1sFVwvGnEadOLjYRItkn2lMiEpI-ckoJh/exec"
    ,
    // Google Sign-In（GIS）Client ID（Web）
    // - PROD：GitHub Pages
    // - LOCAL：本機開發（localhost/127）
    GOOGLE_CLIENT_ID_PROD:
      "165277125304-e3prg9l893f64nmne3pn6ki5agib8akm.apps.googleusercontent.com",
    GOOGLE_CLIENT_ID_LOCAL:
      "165277125304-mf5cfjntll4bt4queucub8oajrgkf1ts.apps.googleusercontent.com"
    ,
    // 安全：預設只允許 Google 登入；需要救火時才手動打開帳密登入
    ALLOW_PASSWORD_LOGIN: true
  };
  var prev = typeof window.__ERP_CONFIG__ === "object" && window.__ERP_CONFIG__ !== null ? window.__ERP_CONFIG__ : {};
  var merged = Object.assign({}, defaults, prev);
  // 依來源自動選用 client id（避免本機/線上來回手動切換）
  try{
    var origin = "";
    try{ origin = String(location && location.origin || ""); }catch(_e0){ origin = ""; }
    var isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    var chosen = isLocal ? merged.GOOGLE_CLIENT_ID_LOCAL : merged.GOOGLE_CLIENT_ID_PROD;
    merged.GOOGLE_CLIENT_ID = String(chosen || "").trim();
  }catch(_eSel){
    merged.GOOGLE_CLIENT_ID = String(merged.GOOGLE_CLIENT_ID_PROD || "").trim();
  }
  // 防呆：曾出現誤貼/快取導致 client id 變成 *.apps.googleusercontentcontent.com（多了 content）→ 會造成 origin not allowed
  try{
    var cid = typeof merged.GOOGLE_CLIENT_ID === "string" ? String(merged.GOOGLE_CLIENT_ID || "").trim() : "";
    if (cid && cid.indexOf("googleusercontentcontent.com") !== -1) {
      merged.GOOGLE_CLIENT_ID = cid.replace("googleusercontentcontent.com", "googleusercontent.com");
    }
  }catch(_e){}
  window.__ERP_CONFIG__ = merged;
})();
