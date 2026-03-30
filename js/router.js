/*********************************
 * ERP v2.2 - Smart Router
 *********************************/

function loadModule(path, moduleName = null) {

  const content = document.getElementById("content");

  if (!content) {
    console.error("Content container not found");
    return;
  }

  // 點左側選單切換模組時，內容區一律先回到最上方
  content.scrollTop = 0;

  fetch(path)
    .then(response => {
      if (!response.ok) throw new Error("Module not found");
      return response.text();
    })
    .then(async (html) => {
      content.innerHTML = html;

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
        await Promise.resolve(initFn());
      }

      if (hintEl && hintEl.parentNode) {
        hintEl.remove();
      }
    })
    .catch(error => {
      content.innerHTML = `
        <h2>Module Load Error</h2>
        <p>${error.message}</p>
      `;
    });
}

function navigate(module) {
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