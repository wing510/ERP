/**
 * ERP 前端設定（部署時主要改 API_BASE 即可）
 * 若需在「不修改本檔」下覆寫：在 index.html 於本檔之前執行
 *   window.__ERP_CONFIG__ = { API_BASE: "https://你的部署網址/exec" };
 */
(function () {
  var defaults = {
    API_BASE:
      "https://script.google.com/macros/s/AKfycbznFuq-blQh3iF23MbM2TlEcmww3-52YkHNLdfluSyvNxjJ0uYlFY1kyj3iru3uCCl0/exec"
  };
  var prev = typeof window.__ERP_CONFIG__ === "object" && window.__ERP_CONFIG__ !== null ? window.__ERP_CONFIG__ : {};
  window.__ERP_CONFIG__ = Object.assign({}, defaults, prev);
})();
