/**
 * Warehouse Stock（含有效期限）
 * - 依倉別查看產品彙總 / Lot 明細
 * - 可用量：inventory_movement 依 lot_id 加總
 * - 到期：expiry_date 當天 23:59:59 視為有效期限截止
 */

let wsWarehouses = [];
let wsLots = [];
let wsMovements = [];
let wsProducts = [];
let wsMovementLoadFailed = false;

function wsEscapeHtml_(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function wsExpiryInfo_(expiryDateStr){
  return invExpiryInfo_(expiryDateStr);
}

function wsAvailableByLotId_(lotId){
  return invAvailableByLotId_(lotId, wsLots, wsMovements);
}

function wsProductDisplay_(productId){
  const p = (wsProducts || []).find(x => String(x.product_id||"") === String(productId||""));
  const name = p?.product_name || productId || "";
  const spec = String(p?.spec || "").trim();
  return spec ? `${name}（${spec}）` : name;
}

function wsWarehouseLabel_(w){
  const name = String(w?.warehouse_name || "").trim();
  const cat = String(w?.category || "").trim().toUpperCase();
  const catLabel = (typeof termShortZh_ === "function" ? termShortZh_(cat) : ((typeof termLabel === "function" ? termLabel(cat) : "") || cat));
  if(name && catLabel) return `${name}-${catLabel}`;
  return name || (w?.warehouse_id || "");
}

async function warehouseStockInit(){
  await wsLoadData_();
  wsInitWarehouseDropdown_();
  bindAutoSearchToolbar_([
    ["ws_warehouse","change"],
    ["ws_keyword","input"],
    ["ws_view","change"],
    ["ws_expiry_window","change"]
  ], ()=> wsRender_());
  wsRender_();
}

async function wsLoadData_(){
  const core = await loadInventoryCoreData_({ needWarehouses: true });
  wsWarehouses = core.warehouses || [];
  wsLots = core.lots || [];
  wsMovements = core.movements || [];
  wsProducts = core.products || [];
  wsMovementLoadFailed = !!core.movementLoadFailed;
  if(wsMovementLoadFailed && typeof showToast === "function"){
    showToast("讀取庫存異動失敗，可用量可能不準。請重新整理頁面或稍後再試。", "error");
  }
}

function wsInitWarehouseDropdown_(){
  const sel = document.getElementById("ws_warehouse");
  if(!sel) return;
  const rows = (wsWarehouses || []).filter(w => String(w.status||"ACTIVE").toUpperCase() === "ACTIVE");
  rows.sort((a,b)=>String(a.warehouse_id||"").localeCompare(String(b.warehouse_id||"")));
  if(!rows.length){
    sel.innerHTML = '<option value="">尚無倉庫，請先至「Warehouses 倉庫」建立</option>';
    sel.value = "";
    return;
  }
  sel.innerHTML =
    rows.map(w=>{
      const id = String(w.warehouse_id||"").toUpperCase();
      return `<option value="${id}">${wsEscapeHtml_(wsWarehouseLabel_(w))}</option>`;
    }).join("");
  if(!sel.value) sel.value = String(rows[0].warehouse_id||"").toUpperCase();
}

function wsGetFilters_(){
  const warehouseId = (document.getElementById("ws_warehouse")?.value || "").trim().toUpperCase();
  const kw = (document.getElementById("ws_keyword")?.value || "").trim().toLowerCase();
  const view = document.getElementById("ws_view")?.value || "product";
  const windowDays = Number(document.getElementById("ws_expiry_window")?.value || 30);
  return { warehouseId, kw, view, windowDays };
}

function wsFilterLots_(){
  const { warehouseId, kw } = wsGetFilters_();
  const source = (wsLots || []).filter(l => String(l.warehouse_id||"").toUpperCase() === warehouseId);
  if(!kw) return source;
  return source.filter(l=>{
    const lotId = String(l.lot_id||"").toLowerCase();
    const pid = String(l.product_id||"").toLowerCase();
    const prodText = String(wsProductDisplay_(l.product_id)||"").toLowerCase();
    const spec = String((wsProducts||[]).find(p=>p.product_id===l.product_id)?.spec || "").toLowerCase();
    return lotId.includes(kw) || pid.includes(kw) || prodText.includes(kw) || spec.includes(kw);
  });
}

function wsRender_(){
  const thead = document.getElementById("ws_thead");
  const tbody = document.getElementById("ws_tbody");
  const summary = document.getElementById("ws_summary");
  if(!thead || !tbody || !summary) return;

  const { view, windowDays, warehouseId } = wsGetFilters_();
  if(!warehouseId){
    thead.innerHTML = "";
    tbody.innerHTML = '<tr><td style="text-align:center;color:#64748b;padding:22px;">請先建立倉庫</td></tr>';
    summary.textContent = "";
    return;
  }

  const lots = wsFilterLots_();
  const rows = lots.map(l=>{
    const av = wsAvailableByLotId_(l.lot_id);
    const exp = wsExpiryInfo_(l.expiry_date);
    return { lot:l, av, exp };
  }).filter(x => Number(x.av || 0) > 1e-9); // 只看有可用量

  const expWindowOn = windowDays > 0;
  const windowed = expWindowOn
    ? rows.filter(x => !x.exp.has || x.exp.expired || (x.exp.days != null && x.exp.days <= windowDays))
    : rows;

  const expiredCount = windowed.filter(x => x.exp.expired).length;
  const nearCount = windowed.filter(x => !x.exp.expired && x.exp.days != null && x.exp.days <= (windowDays || 30)).length;
  const noDateCount = windowed.filter(x => !x.exp.has).length;
  summary.innerHTML =
    `倉別：<strong>${wsEscapeHtml_(wsWarehouseLabel_((wsWarehouses||[]).find(w=>String(w.warehouse_id||"").toUpperCase()===warehouseId)))}</strong>` +
    `　|　有可用量 Lot：<strong>${windowed.length}</strong>` +
    `　|　已過期：<strong style="color:#b91c1c;">${expiredCount}</strong>` +
    `　|　${expWindowOn ? `${windowDays} 天內到期` : "到期日有填"}：<strong style="color:#b45309;">${nearCount}</strong>` +
    `　|　未填到期：<strong>${noDateCount}</strong>`;

  if(view === "lot"){
    thead.innerHTML = `
      <tr>
        <th>Lot</th>
        <th>產品（規格）</th>
        <th>可用量</th>
        <th>有效期</th>
        <th>狀態</th>
      </tr>
    `;
    const sorted = [...windowed].sort((a,b)=>{
      const ea = String(a.lot.expiry_date||"");
      const eb = String(b.lot.expiry_date||"");
      if(ea !== eb) return ea.localeCompare(eb);
      return String(a.lot.lot_id||"").localeCompare(String(b.lot.lot_id||""));
    });
    tbody.innerHTML = "";
    if(!sorted.length){
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:22px;">查無資料（可用量 > 0）</td></tr>';
      return;
    }
    sorted.forEach(x=>{
      const exp = x.exp;
      const statusText = exp.expired ? "已過期" : (exp.days != null && exp.days <= (windowDays||30) ? `即將到期（${exp.days}天）` : "OK");
      const color = exp.expired ? "#b91c1c" : (exp.days != null && exp.days <= (windowDays||30) ? "#b45309" : "#0f172a");
      tbody.innerHTML += `
        <tr>
          <td>${wsEscapeHtml_(x.lot.lot_id || "")}</td>
          <td>${wsEscapeHtml_(wsProductDisplay_(x.lot.product_id))}</td>
          <td>${wsEscapeHtml_(String(Math.round(Number(x.av||0)*10000)/10000))} ${wsEscapeHtml_(x.lot.unit || "")}</td>
          <td>${wsEscapeHtml_(x.lot.expiry_date || "—")}</td>
          <td style="color:${color};font-weight:600;">${wsEscapeHtml_(statusText)}</td>
        </tr>
      `;
    });
    return;
  }

  // product summary
  thead.innerHTML = `
    <tr>
      <th>產品（規格）</th>
      <th>可用量合計</th>
      <th>最近到期日</th>
      <th>Lot 數</th>
      <th>提醒</th>
    </tr>
  `;

  const byProduct = {};
  windowed.forEach(x=>{
    const pid = String(x.lot.product_id || "");
    if(!pid) return;
    if(!byProduct[pid]) byProduct[pid] = [];
    byProduct[pid].push(x);
  });

  const pids = Object.keys(byProduct).sort((a,b)=>wsProductDisplay_(a).localeCompare(wsProductDisplay_(b)));
  tbody.innerHTML = "";
  if(!pids.length){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:22px;">查無資料（可用量 > 0）</td></tr>';
    return;
  }

  pids.forEach(pid=>{
    const items = byProduct[pid] || [];
    const total = items.reduce((s,x)=>s+Number(x.av||0),0);
    const unit = items[0]?.lot?.unit || "";
    // nearest expiry (ignore empty)
    const withExpiry = items.filter(x=>String(x.lot.expiry_date||"").trim());
    withExpiry.sort((a,b)=>String(a.lot.expiry_date||"").localeCompare(String(b.lot.expiry_date||"")));
    const nearest = withExpiry[0]?.lot?.expiry_date || "—";
    const exp0 = wsExpiryInfo_(withExpiry[0]?.lot?.expiry_date || "");
    const expiredLots = items.filter(x=>x.exp.expired).length;
    const nearLots = items.filter(x=>!x.exp.expired && x.exp.days!=null && x.exp.days <= (windowDays||30)).length;
    const hint =
      expiredLots ? `已過期 ${expiredLots}` :
      nearLots ? `${expWindowOn ? windowDays : 30} 天內到期 ${nearLots}` :
      (withExpiry.length ? "OK" : "未填到期");
    const hintColor = expiredLots ? "#b91c1c" : (nearLots ? "#b45309" : "#0f172a");

    const detailId = `ws_${pid.replace(/[^a-zA-Z0-9]/g,"_")}`;
    tbody.innerHTML += `
      <tr style="background:#f8fafc;">
        <td>
          <button class="btn-secondary" type="button" onclick="wsToggleDetail('${detailId}')">明細</button>
          <span style="margin-left:8px;font-weight:600;">${wsEscapeHtml_(wsProductDisplay_(pid))}</span>
          <div style="color:#64748b;font-size:12px;">${wsEscapeHtml_(pid)}</div>
        </td>
        <td style="font-weight:700;">${wsEscapeHtml_(String(Math.round(total*10000)/10000))} ${wsEscapeHtml_(unit)}</td>
        <td>${wsEscapeHtml_(nearest)}${exp0.days!=null && nearest!=="—" ? ` <span style="color:#64748b;font-size:12px;">(${exp0.expired ? "已過期" : exp0.days + "天"})</span>` : ""}</td>
        <td>${items.length}</td>
        <td style="color:${hintColor};font-weight:700;">${wsEscapeHtml_(hint)}</td>
      </tr>
      <tr id="${detailId}" style="display:none;">
        <td colspan="5" style="padding:10px 10px 14px 10px;">
          <div style="overflow:auto;">
            <table class="data-table" style="min-width:760px;">
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>可用量</th>
                  <th>有效期</th>
                  <th>提醒</th>
                </tr>
              </thead>
              <tbody>
                ${
                  items
                    .slice()
                    .sort((a,b)=>String(a.lot.expiry_date||"").localeCompare(String(b.lot.expiry_date||"")))
                    .map(x=>{
                      const exp = x.exp;
                      const statusText = exp.expired ? "已過期" : (exp.days != null && exp.days <= (windowDays||30) ? `即將到期（${exp.days}天）` : "OK");
                      const color = exp.expired ? "#b91c1c" : (exp.days != null && exp.days <= (windowDays||30) ? "#b45309" : "#0f172a");
                      return `
                        <tr>
                          <td>${wsEscapeHtml_(x.lot.lot_id||"")}</td>
                          <td>${wsEscapeHtml_(String(Math.round(Number(x.av||0)*10000)/10000))} ${wsEscapeHtml_(x.lot.unit||"")}</td>
                          <td>${wsEscapeHtml_(x.lot.expiry_date||"—")}</td>
                          <td style="color:${color};font-weight:700;">${wsEscapeHtml_(statusText)}</td>
                        </tr>
                      `;
                    })
                    .join("")
                }
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    `;
  });
}

function wsToggleDetail(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.style.display = (el.style.display === "none" || !el.style.display) ? "table-row" : "none";
}

async function refreshWarehouseStock(triggerEl){
  showSaveHint(triggerEl);
  try{
    await wsLoadData_();
    wsInitWarehouseDropdown_();
    wsRender_();
    showToast("倉庫庫存已更新");
  }finally{
    hideSaveHint();
  }
}

