// =====================
// Dashboard Module — 待辦、效期、進行中單據、捷徑（非單純主檔筆數）
// =====================

function dbParseYMD_(s) {
  const m = String(s || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!y || isNaN(mo) || !d) return null;
  return { y: y, mo: mo, d: d };
}

function dbEndOfExpiryDay_(ymd) {
  if (!ymd) return null;
  return new Date(ymd.y, ymd.mo, ymd.d, 23, 59, 59, 999);
}

/** true = 有效日已過（無有效日則不算過期） */
function dbIsExpired_(expiryDateStr) {
  const raw = String(expiryDateStr || "").trim();
  if (!raw) return false;
  const ymd = dbParseYMD_(raw);
  const now = new Date();
  if (ymd) {
    const end = dbEndOfExpiryDay_(ymd);
    return end ? now.getTime() > end.getTime() : false;
  }
  const d = new Date(raw);
  return !isNaN(d.getTime()) && now.getTime() > d.getTime();
}

/** 與今天 0:00 比，回傳距離有效日結束還有幾「天」（可為負）；無效日回 null */
function dbDaysFromTodayToExpiryEnd_(expiryDateStr) {
  const raw = String(expiryDateStr || "").trim();
  if (!raw) return null;
  const ymd = dbParseYMD_(raw);
  let end;
  if (ymd) end = dbEndOfExpiryDay_(ymd);
  else {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - startOfToday.getTime()) / 86400000);
}

/** 與 Lots 相同：依異動加總；該 Lot 無異動列時用入庫 qty */
function buildLotAvailabilityMap_(lots, movements) {
  const movByLot = {};
  (movements || []).forEach(function (m) {
    if (!m || !m.lot_id) return;
    if (!movByLot[m.lot_id]) movByLot[m.lot_id] = [];
    movByLot[m.lot_id].push(m);
  });
  const map = {};
  (lots || []).forEach(function (l) {
    if (!l || !l.lot_id) return;
    const rows = movByLot[l.lot_id] || [];
    if (rows.length === 0) {
      map[l.lot_id] = Number(l.qty || 0);
    } else {
      map[l.lot_id] = rows.reduce(function (s, x) {
        return s + Number(x.qty || 0);
      }, 0);
    }
  });
  return map;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function dbDerivedInventoryStatus_(lot, availableQty, movementLoadFailed) {
  if (movementLoadFailed) return String(lot.inventory_status || "ACTIVE").toUpperCase();
  if (dbIsExpired_(lot.expiry_date)) return "VOID";
  if (Number(availableQty || 0) <= 1e-9) return "CLOSED";
  return "ACTIVE";
}

async function dashboardInit() {
  if (!window.DB) window.DB = {};

  let movementLoadFailed = false;
  let movements = [];
  try {
    movements = await getAll("inventory_movement");
    if (!Array.isArray(movements)) movements = [];
  } catch (_e) {
    movementLoadFailed = true;
    movements = [];
  }

  const [products, lots, pos, imports, shipments, salesOrders] = await Promise.all([
    getAll("product").catch(function () {
      return [];
    }),
    getAll("lot").catch(function () {
      return [];
    }),
    getAll("purchase_order").catch(function () {
      return [];
    }),
    getAll("import_document").catch(function () {
      return [];
    }),
    getAll("shipment").catch(function () {
      return [];
    }),
    getAll("sales_order").catch(function () {
      return [];
    })
  ]);

  window.DB.products = products || [];
  window.DB.lots = lots || [];
  window.DB.movements = movements;
  window.DB.movementLoadFailed = movementLoadFailed;

  renderDashboard({
    products: products || [],
    lots: lots || [],
    movements: movements,
    movementLoadFailed: movementLoadFailed,
    purchaseOrders: pos || [],
    importDocs: imports || [],
    shipments: shipments || [],
    salesOrders: salesOrders || []
  });
}

function renderDashboard(ctx) {
  const products = ctx.products || [];
  const lots = ctx.lots || [];
  const movements = ctx.movements || [];
  const movementLoadFailed = !!ctx.movementLoadFailed;
  const availMap = buildLotAvailabilityMap_(lots, movements);

  let pendingQa = 0;
  let shippable = 0;
  let expired = 0;
  let expiring30 = 0;

  lots.forEach(function (l) {
    const av = availMap[l.lot_id];
    const inv = dbDerivedInventoryStatus_(l, av, movementLoadFailed);
    const qa = (l.status || "PENDING").toUpperCase();

    const exp = l.expiry_date;
    const isExpired = dbIsExpired_(exp);
    if (isExpired) {
      expired += 1;
      return;
    } else {
      const days = dbDaysFromTodayToExpiryEnd_(exp);
      if (days != null && days >= 0 && days <= 30) expiring30 += 1;
    }

    // 待 QA：只計入仍可用的批次，避免「無庫存/作廢」長期佔住指標
    if (qa === "PENDING" && inv === "ACTIVE" && av > 0) pendingQa += 1;
    if (qa === "APPROVED" && inv === "ACTIVE" && av > 0) shippable += 1;
  });

  setText("db_pending_qa", String(pendingQa));
  setText("db_shippable_lots", String(shippable));
  setText("db_expired_lots", String(expired));
  setText("db_expiring_soon", String(expiring30));

  const noteEl = document.getElementById("db_movement_note");
  if (noteEl) noteEl.style.display = movementLoadFailed ? "block" : "none";

  const pos = ctx.purchaseOrders || [];
  let poOpen = 0;
  let poClosed = 0;
  pos.forEach(function (p) {
    const s = (p.status || "").toUpperCase();
    if (s === "OPEN" || s === "PARTIAL") poOpen += 1;
    else if (s === "CLOSED") poClosed += 1;
  });
  setText("db_po_open", String(poOpen));
  setText("db_po_closed", String(poClosed));

  const imps = ctx.importDocs || [];
  let impOpen = 0;
  let impDone = 0;
  imps.forEach(function (d) {
    const s = (d.status || "").toUpperCase();
    if (s === "OPEN") impOpen += 1;
    else if (s === "CLOSED" || s === "CANCELLED") impDone += 1;
  });
  setText("db_imp_open", String(impOpen));
  setText("db_imp_done", String(impDone));

  const sos = ctx.salesOrders || [];
  let soOpen = 0;
  let soDone = 0;
  sos.forEach(function (so) {
    const s = (so.status || "").toUpperCase();
    if (s === "OPEN" || s === "PARTIAL") soOpen += 1;
    else if (s === "SHIPPED" || s === "CANCELLED") soDone += 1;
  });
  setText("db_so_open", String(soOpen));
  setText("db_so_done", String(soDone));

  const ships = ctx.shipments || [];
  let shipOpen = 0;
  let shipPosted = 0;
  ships.forEach(function (sh) {
    const s = (sh.status || "").toUpperCase();
    if (s === "OPEN") shipOpen += 1;
    else if (s === "POSTED") shipPosted += 1;
  });
  setText("db_ship_open", String(shipOpen));
  setText("db_ship_posted", String(shipPosted));

  var guide = document.getElementById("dashboardFirstTimeGuide");
  if (guide) guide.style.display = products.length === 0 ? "block" : "none";
}

function devClearNonMasterClick() {
  if (
    !confirm(
      "確定要刪除「除主檔外」所有工作表的資料嗎？\n主檔（產品、供應商、客戶、使用者）會保留。"
    )
  )
    return;
  showSaveHint();
  callAPI({ action: "dev_clear_non_master" })
    .then(function (res) {
      if (typeof invalidateCache === "function") invalidateCache();
      if (typeof showToast === "function")
        showToast(
          "已清除非主檔資料：" +
            (res.cleared && res.cleared.length ? res.cleared.join(", ") : "完成")
        );
      return dashboardInit();
    })
    .catch(function (err) {
      if (typeof showToast === "function")
        showToast(err && err.message ? err.message : "清除失敗", "error");
    })
    .finally(function () {
      hideSaveHint();
    });
}
