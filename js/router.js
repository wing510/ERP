/*********************************
 * ERP v3.1 - Smart Router
 *********************************/

// 避免「切換模組時，上一個模組的 async 還在跑」導致偶發 null 元素錯誤
let __ERP_MODULE_LOAD_SEQ__ = 0;

function escapeModuleLoadHtml_(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 依錯誤類型回傳繁中標題、說明與操作建議（純內建文案，可搭配 escape 後寫入 HTML） */
function formatModuleLoadError_(err, httpStatus) {
  const msg = String(err && err.message != null ? err.message : err || "");
  const name = String(err && err.name ? err.name : "");
  if (name === "TypeError" && /fetch|Failed to fetch|Load failed|NetworkError/i.test(msg)) {
    return {
      title: "無法連線",
      detail: "無法取得模組內容，請檢查網路或網址是否正確。",
      tips: [
        "確認裝置已連上網路（Wi‑Fi 或行動數據），其他網頁能否正常開啟。",
        "重新整理頁面（F5）或稍後再試；若為暫時性斷線，通常可恢復。",
        "若在公司或校園網路，確認防火牆／Proxy 未阻擋此站台或路徑下的 modules 檔案。",
        "若以本機檔案（網址列為 file://）開啟，請改由本機或正式環境的 HTTP 伺服器提供整個專案資料夾。"
      ]
    };
  }
  if (httpStatus === 404) {
    return {
      title: "找不到模組檔案",
      detail: "請求的路徑不存在（404），請確認已部署 modules 目錄且路徑正確。",
      tips: [
        "確認伺服器上存在 `modules/` 資料夾，且檔名與選單載入路徑一致（含大小寫）。",
        "確認上傳／部署時未漏檔；`index.html` 與 `modules` 的相對位置應與開發環境相同。",
        "嘗試強制重新整理（Ctrl+F5 或清除快取後再開），排除舊版快取指向錯誤路徑。"
      ]
    };
  }
  if (httpStatus != null && httpStatus >= 400) {
    const is5xx = httpStatus >= 500;
    const is401 = httpStatus === 401;
    const is403 = httpStatus === 403;
    const tips = is5xx
      ? [
          "多為伺服器暫時異常，請稍候再試或重新整理頁面。",
          "若重試仍失敗，請記下時間、點選的選單項目與畫面上的狀態碼，聯絡系統管理員。"
        ]
      : is401 || is403
        ? [
            "可能是未登入、工作階段過期或無權限存取此路徑；請重新登入或換有權限的帳號。",
            "若您確認應有權限，請聯絡管理員檢查站台設定與目錄權限。"
          ]
        : [
            "請確認瀏覽器網址列路徑正確，且未手動改寫過部署結構。",
            "若問題持續，請提供狀態碼與操作步驟給管理員排查。"
          ];
    return {
      title: "無法載入模組",
      detail: "伺服器回傳錯誤（HTTP " + httpStatus + "）。",
      tips: tips
    };
  }
  return {
    title: "載入模組失敗",
    detail: msg ? escapeModuleLoadHtml_(msg) : "發生未知錯誤。",
    tips: [
      "按 F12 開啟開發者工具，切到「主控台（Console）」查看紅色錯誤訊息。",
      "先按下方「返回儀表板」，再重新點選該功能一次。",
      "若每次必現，請截圖此畫面與 Console 內容，並註明瀏覽器與版本，方便排查。"
    ]
  };
}

function loadModule(path, moduleName = null) {

  const content = document.getElementById("content");

  if (!content) {
    console.error("Content container not found");
    return;
  }

  // 點左側選單切換模組時，內容區一律先回到最上方
  content.scrollTop = 0;

  const seq = ++__ERP_MODULE_LOAD_SEQ__;
  try{
    window.__ERP_ACTIVE_MODULE__ = moduleName || "";
    window.__ERP_ACTIVE_MODULE_SEQ__ = seq;
  }catch(_e){}

  fetch(path)
    .then(response => {
      if (!response.ok) {
        const e = new Error("HTTP " + response.status);
        e.httpStatus = response.status;
        throw e;
      }
      return response.text();
    })
    .then(async (html) => {
      // 若使用者在等待期間又切到別的模組，直接中止（避免舊回呼覆蓋新畫面）
      if(seq !== __ERP_MODULE_LOAD_SEQ__) return;
      content.innerHTML = html;

      // 確保 DOM 插入完成再初始化（避免極少數瀏覽器/快取情境的 timing 問題）
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      if(seq !== __ERP_MODULE_LOAD_SEQ__) return;

      if (typeof initHelpComponent === "function") {
        initHelpComponent();
      }

      // 有 init 的模組：先顯示「載入中…」，等列表載入完再移除，避免以為資料不見
      const initFn = moduleName && window[moduleName + "Init"];
      let hintEl = null;
      if (initFn && typeof initFn === "function") {
        hintEl = document.createElement("div");
        hintEl.className = "module-loading-hint";
        hintEl.textContent = "載入中…";
        hintEl.setAttribute("aria-live", "polite");
        content.insertBefore(hintEl, content.firstChild);
      }

      if (initFn && typeof initFn === "function") {
        try{
          await Promise.resolve(initFn());
        }catch(err){
          // 若已切到別的模組，忽略舊模組的錯誤（常見為 DOM 已被替換造成 null）
          if(seq !== __ERP_MODULE_LOAD_SEQ__) return;
          throw err;
        }
      }

      if (hintEl && hintEl.parentNode) {
        hintEl.remove();
      }
    })
    .catch(error => {
      // 若已切到別的模組，不要覆蓋畫面
      if(seq !== __ERP_MODULE_LOAD_SEQ__) return;
      const st = error && error.httpStatus != null ? error.httpStatus : null;
      const formatted = formatModuleLoadError_(error, st);
      const title = formatted.title;
      const detail = formatted.detail;
      const tips = formatted.tips || [];
      let tipsBlock = "";
      if (tips.length) {
        tipsBlock =
          '<p style="margin-top:14px;margin-bottom:6px;font-weight:600;color:#334155;">操作建議</p>' +
          '<ul style="margin:0 0 0 1.15em;padding:0;line-height:1.55;">' +
          tips.map(function (line) {
            return "<li>" + escapeModuleLoadHtml_(line) + "</li>";
          }).join("") +
          "</ul>";
      }
      content.innerHTML =
        '<div class="card" style="max-width:520px;margin:24px auto;">' +
        '<div class="card-header">' + escapeModuleLoadHtml_(title) + "</div>" +
        '<div class="card-body" style="color:#475569;line-height:1.6;">' +
        detail +
        tipsBlock +
        '<p style="margin-top:16px;margin-bottom:0;"><button type="button" class="btn-secondary" onclick="navigate(\'dashboard\')">返回儀表板</button></p>' +
        "</div></div>";
    });
}

function navigate(module) {
  if (typeof window.closeSidebarDrawer === "function") {
    window.closeSidebarDrawer();
  }
  switch (module) {

    case "dashboard":
      loadModule("modules/dashboard.html", "dashboard");
      break;

    case "products":
      loadModule("modules/products.html", "products");
      break;

    case "suppliers":
      loadModule("modules/suppliers.html", "suppliers");
      break;

    case "customers":
      loadModule("modules/customers.html", "customers");
      break;

    case "warehouses":
      loadModule("modules/warehouses.html", "warehouses");
      break;

    case "users":
      loadModule("modules/users.html", "users");
      break;

    case "purchase":
      loadModule("modules/purchase.html", "purchase");
      break;

    case "lots":
      loadModule("modules/lots.html", "lots");
      break;

    case "movements":
      loadModule("modules/movements.html", "movements");
      break;

    case "warehouse_stock":
      loadModule("modules/warehouse-stock.html", "warehouseStock");
      break;

    case "split":
      loadModule("modules/split.html", "split");
      break;

    case "merge":
      loadModule("modules/merge.html", "merge");
      break;

    case "outsource":
      loadModule("modules/outsource.html", "outsource");
      break;

    case "receive":
      loadModule("modules/receive.html", "receive");
      break;

    case "sales":
      loadModule("modules/sales.html", "sales");
      break;

    case "shipping":
      loadModule("modules/shipping.html", "shipping");
      break;

    case "trace":
      loadModule("modules/trace.html", "trace");
      break;

    case "logs":
      loadModule("modules/logs.html", "logs");
      break;

    case "import":
      loadModule("modules/import.html", "import");
      break;

    default:
      loadModule("modules/dashboard.html");
  }
}

document.addEventListener("DOMContentLoaded", function () {
  navigate("dashboard");
});