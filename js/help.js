/*********************************
 * ERP Global Help Component v1
 * Inline (藍底展開式)
 *********************************/

/* ===============================
   Help Content 集中管理
================================ */

const HelpConfig = {

  productEdit: `
    <strong>流程：</strong><br>
    • 填寫上方欄位後按「建立」新增產品；已建立的產品可按列表 Edit 載入後「更新」<br>
    • 投料／回收單位不同時：展開「多單位換算」填好後按「建立」或「更新」<br>
    <strong>規則：</strong><br>
    • 產品 ID（product_id）可由系統自動產生，建立並儲存後不可修改<br>
    • ID 最長 30 字元，只能用 A–Z／0–9／_／-<br>
    • 產品類型僅允許：RM（原料）/ WIP（半成品）/ FG（成品）<br>
    • 委外若投料（原料）單位與回收（成品／半成品）單位不同：在<strong>成品／半成品</strong>設定多單位換算<br>
    • 停用（INACTIVE 停用）前若已有被使用，系統會提醒你確認（保留歷史、不破壞追溯）<br>
    <strong>常見提示：</strong><br>
    • ID / 名稱 必填<br>
    • ID 長度/格式不合法（最多 30；僅 A–Z 0–9 _ -）<br>
    • 名稱過長（最多 100）／規格過長（最多 200）／備註過長（最多 500）<br>
    • 產品 ID 已存在／找不到產品<br>
    • 委外回收若提示單位無法換算：請先在本產品完成多單位換算並更新<br>
    • 建立成功／更新成功
  `,

  productList: `
    <strong>流程：</strong><br>
    • 點欄位標題可排序；點 Edit 會載入到上方編輯區<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：產品ID／名稱／規格／備註／uom_config（JSON 字串）<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認關鍵字/類型/狀態條件
  `,
  supplierEdit: `
    <strong>流程：</strong><br>
    • 填寫後按「建立」新增供應商；點列表 Edit 載入後可「更新」<br>
    • 稽核/修改紀錄請到 Logs 查<br>
    <strong>規則：</strong><br>
    • 供應商 ID（supplier_id）可由系統自動產生，建立並儲存後不可修改<br>
    • ID 最長 30 字元，只能用 A–Z／0–9／_／-<br>
    • 名稱必填（supplier_name）<br>
    • 停用（INACTIVE 停用）前若已有被使用，系統會提醒你確認<br>
    <strong>常見提示：</strong><br>
    • ID / 名稱 必填<br>
    • ID 長度/格式不合法<br>
    • 供應商 ID 已存在／找不到供應商<br>
    • 建立成功／更新成功
  `,

  supplierList: `
    <strong>流程：</strong><br>
    • 點欄位可排序；點 Edit 載入到上方編輯區<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：供應商ID／名稱／聯絡人／電話／Email<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 建立/修改資訊請到 Logs 查
  `,

  customerEdit: `
    <strong>流程：</strong><br>
    • 填寫後按「建立」新增客戶；點列表 Edit 載入後可「更新」<br>
    • 稽核/修改紀錄請到 Logs 查<br>
    <strong>規則：</strong><br>
    • 客戶 ID（customer_id）可由系統自動產生，建立並儲存後不可修改<br>
    • ID 最長 30 字元，只能用 A–Z／0–9／_／-<br>
    • 名稱必填（customer_name）<br>
    • 停用（INACTIVE 停用）前若已有被使用，系統會提醒你確認<br>
    <strong>常見提示：</strong><br>
    • ID / 名稱 必填<br>
    • ID 長度/格式不合法<br>
    • 客戶 ID 已存在／找不到客戶<br>
    • 建立成功／更新成功
  `,

  customerList: `
    <strong>流程：</strong><br>
    • 點欄位可排序；點 Edit 載入到上方編輯區<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：客戶ID／名稱／聯絡人／電話／Email<br>
    • 狀態：ACTIVE（使用中）/ INACTIVE（停用保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 建立/修改資訊請到 Logs 查
  `,

  usersMain: `
    <strong>流程：</strong><br>
    • 建立使用者後，上方 User 下拉即可切換目前操作者（created_by/updated_by）<br>
    • 需要調整姓名/角色/狀態時：先載入再更新<br>
    <strong>規則：</strong><br>
    • User 下拉只顯示 ACTIVE（使用中）使用者<br>
    • 建議用 INACTIVE（停用）保留歷史帳號，不建議刪除（避免稽核斷裂）<br>
    <strong>常見提示：</strong><br>
    • User ID 必填／姓名必填<br>
    • User ID 已存在<br>
    • 建立成功／更新成功（更新前需先載入）
  `,

  purchaseHeader: `
    <strong>流程：</strong><br>
    • 採購單號由系統自動產生（欄位唯讀）；完成主檔與品項明細後建立採購單<br>
    • 需要入庫時請到「收貨入庫（Goods Receipt）」收貨，才會產生 Lot（批次）<br>
    <strong>規則：</strong><br>
    • 採購單（PO, Purchase Order）本身不產生庫存；收貨入庫才產生 Lot<br>
    • 文件連結：可貼 PDF／雲端檔案 URL 方便追資料<br>
    • Edit 會先檢查收貨狀態：檢查中 / 已收貨 / 未收貨<br>
    • 已收貨後：整張採購單會鎖定不可改（避免破壞追溯）<br>
    • 狀態 CLOSED（結案）不可再修改<br>
    <strong>常見提示：</strong><br>
    • 請選擇供應商／請填寫下單日期<br>
    • 請至少新增 1 筆品項／請至少保留 1 筆品項<br>
    • 採購單號已存在／找不到採購單／請先載入再更新<br>
    • 已收貨：整張採購單不可修改<br>
    • CLOSED：不可再修改<br>
    • 更新成功
  `,
  purchaseItems: `
    <strong>流程：</strong><br>
    • 在採購單中新增品項（產品/數量/單位）；明細表以「項次」對齊列<br>
    • 已存檔列（POI-）可點列帶入表單，只改品項備註可按「更新本筆備註」寫入後端<br>
    <strong>規則：</strong><br>
    • 明細表「狀態」：草稿；已存檔列則依已收／訂購顯示未收貨、部分收貨、已收畢（與銷售「出貨狀態」對齊）；品項備註僅在上方表單編輯<br>
    • 明細的 產品 / 數量 / 單位 會決定後續「可收上限」<br>
    • 已收貨後不建議改明細（避免追溯與帳務不一致）<br>
    • 已收貨時：新增/刪除/更新會鎖定<br>
    <strong>常見提示：</strong><br>
    • 請選擇產品<br>
    • 訂購數量需大於 0<br>
    • 找不到產品單位：請先確認產品主檔
  `,
  purchaseList: `
    <strong>流程：</strong><br>
    • Edit：載入到上方編輯區；收貨：跳到收貨入庫並預選該 PO<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：採購單號、供應商 ID<br>
    • 有填文件連結才會顯示「連結」<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認範圍/狀態條件
  `,

  importHeader: `
    <strong>流程：</strong><br>
    • 報單 ID 由系統自動產生（欄位唯讀）；完成主檔與品項明細後建立報單（主檔+明細一併送出）<br>
    • 需要入庫時到「收貨入庫」選該報單收貨，才會產生 Lot（批次）<br>
    <strong>規則：</strong><br>
    • 進口報單（Import Document）是來源文件：收貨入庫會以報單明細計算可收上限<br>
    • 批號（Inv No. 發票/文件批號）必填（請依文件填）<br>
    • Edit 會先檢查收貨狀態：檢查中 / 已收貨 / 未收貨<br>
    • 已收貨後：整張報單會鎖定不可改（避免追溯風險）<br>
    • 若需調整：請用「沖銷/補單」<br>
    &nbsp;&nbsp;沖銷（Reversal）：多收/收錯要減量 → 到「庫存異動」選 Lot 扣回數量<br>
    &nbsp;&nbsp;補單（New Doc）：原報單不動；新建一張報單，再到「收貨入庫」收貨<br>
    <strong>常見提示：</strong><br>
    • CLOSED/CANCELLED：不可再修改<br>
    • 已有進口收貨：不可修改明細（請用沖銷/補單）<br>
    • 建立／更新成功或失敗會以 Toast 顯示<br>
    • 找不到報單／請先載入或建立一張報單<br>
    • 請至少新增 1 筆報單品項
  `,
  importItems: `
    <strong>流程：</strong><br>
    • 新增品項並寫入報單；明細表以「項次」對齊列<br>
    • 已存檔列（IMPI-）可點列帶入，只改備註可按「更新本筆備註」寫入後端<br>
    <strong>規則：</strong><br>
    • 明細表「狀態」為簡版：草稿／已存檔（與出貨明細「草稿／已過帳」同類）；品項備註僅在上方表單編輯<br>
    • 已收貨時：新增品項/刪除/更新會鎖定（避免追溯風險）<br>
    • 批號（Inv No）必填，建議全大寫一致<br>
    <strong>常見提示：</strong><br>
    • 請選擇產品<br>
    • 批號必填（請依文件發票號填寫）<br>
    • 數量需大於 0<br>
    • 找不到產品單位：請先確認產品主檔
  `,
  importList: `
    <strong>流程：</strong><br>
    • Edit：載入到上方編輯區；收貨：跳到收貨入庫並預選該報單<br>
    <strong>規則：</strong><br>
    • 列表不顯示備註（避免太擠），編輯區仍可填寫<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認狀態/關鍵字條件
  `,

  receiveHeader: `
    <strong>流程：</strong><br>
    • 來源類型請先選 PO 或進口報單，再選單號<br>
    • 選單後填收貨日期、倉別（連倉庫主檔）；於收貨明細輸入各列「本次收貨數量」後產生批次<br>
    • 同卡下方摺疊「已收列表」：點開才載入該來源單之已收紀錄；作廢與預檢說明見明細區說明<br>
    <strong>規則：</strong><br>
    • 收貨單 ID 自動產生（唯讀）<br>
    • 「剩餘可收」由系統計算；已作廢之收貨不計入彙總與判斷<br>
    • 建立的 Lot 預設 PENDING（待 QA）<br>
    <strong>常見提示：</strong><br>
    • 收貨日期 必填／請選擇來源類型與單號<br>
    • 請至少輸入一筆本次收貨數量<br>
    • 找不到報單或載入失敗：依畫面提示重試<br>
    • 收貨完成：已產生 X 個 Lot（PENDING 待QA）
  `,
  receiveLines: `
    <strong>流程：</strong><br>
    • 依「項次」對應來源明細逐列輸入本次收貨數量；表含產品（規格）、倉別、已收／剩餘、製造日／有效期<br>
    • 摺疊「已收列表」展開後載入；作廢鈕會帶入該收貨單號並開啟視窗：選作廢原因（下拉為主），選「其他」須填補充說明並寫入備註<br>
    • 無法作廢之列按鈕顯示「無法作廢」，游標停留可看預判原因<br>
    <strong>規則：</strong><br>
    • 本次收貨數量不可超過剩餘可收；製造日／有效期寫入新 Lot<br>
    • 作廢僅限狀態「未取消」之收貨單；若產生之 Lot 已被出庫、加工或調整扣減導致無法沖銷入庫，則無法整張作廢<br>
    <strong>常見提示：</strong><br>
    • 品項超過剩餘可收／本次無可收量，未產生 Lot
  `,

  lotsMain: `
    <strong>流程：</strong><br>
    • 需補登製造日／有效期時按「補登日期」；QA 放行／退回於此頁對 PENDING 批次操作<br>
    <strong>規則：</strong><br>
    • Lot（批次）是追溯單位；可用量以 inventory_movement 加總為準；系統追溯說明與使用者備註分欄存放<br>
    • 庫存狀態（inventory_status）：ACTIVE（可使用）／CLOSED（無庫存）／VOID（已過期）<br>
    • 品檢狀態（status）：PENDING（待 QA）／APPROVED（QA 已放行）／REJECTED（QA 已退回）<br>
    • 建議只出貨／扣庫已放行批次<br>
    <strong>常見提示：</strong><br>
    • 找不到此批次／已放行／已退回
  `,

  movementsMain: `
    <strong>流程：</strong><br>
    • 一般扣庫：輸入數量後按「確認扣庫」；可選用途（內部領用／樣品／報廢／其他）與「給誰（領用／交付）」<br>
    • 轉倉：選「轉倉到」目標倉並輸入數量後按「轉倉」；可按「轉全部」一鍵帶入該批全部可用量（僅轉倉模式）<br>
    <strong>規則：</strong><br>
    • 庫存異動為庫存帳本來源；手動扣庫預設僅 APPROVED 且 ACTIVE 的 Lot<br>
    • 不允許負庫存；扣庫／轉出量不可超過可用量<br>
    • 轉倉：整批可用量轉出可走待 QA；只轉一部分時來源須已 QA 放行；來源與新批 QA 狀態會依規則同步，避免卡單<br>
    • 轉倉會沖帳並於目標倉產生新批號，追溯與備註與人為填寫分離<br>
    <strong>常見提示：</strong><br>
    • 請選擇 Lot／找不到 Lot／數量需大於 0<br>
    • 扣庫數量不可超過可用量／轉倉須選目標倉<br>
    • 異動或轉倉已建立
  `,

  shippingHeader: `
    <strong>流程：</strong><br>
    • 完成主檔與出貨明細（選 Lot 或自動分配），過帳出貨後才扣庫<br>
    • 作廢：僅限已過帳（POSTED）出貨單，系統反沖庫存<br>
    <strong>規則：</strong><br>
    • 出貨會產生庫存扣庫異動<br>
    • 只允許使用 QA 已放行批次，且不允許負庫存<br>
    <strong>常見提示：</strong><br>
    • 出貨單ID 必填／請選擇客戶／出貨日期必填<br>
    • 請至少新增 1 筆出貨明細<br>
    • 找不到出貨單／請先載入出貨單<br>
    • 僅 POSTED 出貨單可作廢／作廢完成：已反沖庫存並回寫 SO
  `,
  shippingItems: `
    <strong>流程：</strong><br>
    • 建議先選銷售單（可選）、銷售品項（可選）；「Lot 自動分配（FEFO）」預設開啟：依有效期先到期先出，可自動拆成多筆明細；關閉後改以「選擇 Lot」手動指定（可覆寫自動結果）<br>
    • 填寫區將品項／Lot 與數量分區；自動分配帶出的數量為唯讀，避免誤改；手動模式再於數量欄輸入<br>
    • 「選擇 Lot」視窗可搜尋，列表強調效期並顯示倉別；產品顯示為「名稱（規格）」<br>
    • 按「新增明細」加入草稿；表頭為「項次」；只改備註用「更新本筆備註」；完成後過帳出貨<br>
    <strong>規則：</strong><br>
    • Lot 與銷售品項的產品需一致（有綁品項時）<br>
    • 出貨不可超過可用量，亦不可超過銷售單剩餘未出貨量（若有綁 SO）<br>
    • 明細「狀態」：草稿／已過帳；備註僅在上方表單編輯<br>
    <strong>常見提示：</strong><br>
    • 找不到 Lot／Lot 單位缺失／出貨數量需大於 0<br>
    • 超過可用量或剩餘未出貨量／Lot 與銷售品項產品不一致<br>
    • FEFO 開啟時若無足夠效期資料，請改手動選批或檢查 Lot
  `,
  shippingList: `
    <strong>流程：</strong><br>
    • 「載入」帶回上方檢視；作廢前請確認（會反沖庫存）<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：出貨單／客戶／銷售單<br>
    • 只能作廢 POSTED（已過帳）出貨單<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認狀態/關鍵字條件
  `,

  logsMain: `
    <strong>流程：</strong><br>
    • 用分頁（MASTER/INBOUND/INVENTORY/PROCESS/SALES/SHIPMENT）縮小範圍<br>
    • 點 View 查看差異明細<br>
    <strong>規則：</strong><br>
    • 動作代碼：CREATE（建立）/ UPDATE（更新）/ DELETE（刪除）<br>
    • 關鍵字可搜：ID / 參考ID / 舊值 / 新值<br>
    <strong>常見提示：</strong><br>
    • 若儲存/查詢失敗：畫面可能直接顯示後端錯誤訊息（err.message）
  `,

  salesHeader: `
    <strong>流程：</strong><br>
    • 完成主檔與品項明細後建立銷售單（主檔+明細一併寫入）；可指定「業務」（使用者主檔）<br>
    • 實際扣庫請到「出貨（Shipment）」建立出貨單<br>
    <strong>規則：</strong><br>
    • 銷售單（Sales Order, SO）不直接扣庫；實際扣庫發生在 Shipment<br>
    • 狀態 SHIPPED（全數出貨）/ CANCELLED（已取消）的銷售單不可再修改<br>
    <strong>常見提示：</strong><br>
    • 銷售單ID 必填／請選擇客戶／下單日期必填<br>
    • 請至少新增 1 筆品項<br>
    • 銷售單ID 已存在／找不到銷售單／請先載入再更新<br>
    • 已結束（SHIPPED/CANCELLED）：不可再修改<br>
    • 已有出貨：主檔可更新但不允許重建明細
  `,
  salesItems: `
    <strong>流程：</strong><br>
    • 填主檔欄位並「新增品項」組出明細；明細表以「項次」對齊列；產品下拉為「名稱（規格）」為主<br>
    • 草稿列（DRAFT-）點列或「編輯」會帶回上方，改完再按「新增品項」加回（與委外投料相同，每次加回新草稿鍵）<br>
    • 已存檔列（SOI-）點列僅帶入表單；只改備註可按「更新本筆備註」寫入後端；改數量／產品請用「編輯」後再「新增品項」，整張單須再寫入更新<br>
    <strong>規則：</strong><br>
    • 明細決定後續可出貨的品項與上限<br>
    • 明細表「狀態」欄對齊委外投料列表：草稿／已存檔列則依已出貨量顯示未出貨、部分出貨、已出畢；品項備註僅在上方表單編輯<br>
    <strong>常見提示：</strong><br>
    • 請選擇產品<br>
    • 訂購數量需大於 0<br>
    • 產品單位缺失
  `,
  salesList: `
    <strong>流程：</strong><br>
    • 「Edit」載入到上方編輯區；「出貨」可捷徑帶單至出貨模組<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：銷售單 ID／客戶／業務等（與列表欄位一致）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認狀態/關鍵字條件
  `,

  usersList: `
    <strong>流程：</strong><br>
    • 需要修改請回到上方載入後更新<br>
    <strong>規則：</strong><br>
    • 建議用 INACTIVE（停用）保留歷史使用者，不建議刪除（避免稽核斷裂）<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認狀態/關鍵字條件
  `,

  outsourceHeader: `
    <strong>流程：</strong><br>
    • 輸入加工單 ID 後建立加工單；已存在則可更新備註／預計日期或取消加工單（回沖）<br>
    • 送加工（扣庫）與回收加工品分別在投料區、回收區操作，可分批、多次<br>
    • 建議：建立或從列表載入 → 送加工 → 回收<br>
    <strong>規則：</strong><br>
    • 投料只允許 QA已放行 且庫存 ACTIVE、可用量 &gt; 0 的批次（選 Lot 視窗已過濾）<br>
    • 回收中通常維持 OPEN；回收完畢會轉 POSTED（已結案）<br>
    • 取消加工單為整張回沖；若產出 Lot 已被下游使用會被阻擋；多筆原因時畫面會顯示可展開的阻擋明細<br>
    • 投料與產出若單位不同，需先在「產出產品」主檔設定多單位換算，系統才會換算到同一基準後比較總量<br>
    • 加工類型代碼：PROCESS / PACKING / REPACK / REWORK / SPLIT / MERGE<br>
    • 來源類別：RM（原料）/ WIP（半成品）/ FG（成品）供管理與篩選<br>
    <strong>常見提示：</strong><br>
    • 加工單ID 必填／請選擇加工類型／請選擇加工廠<br>
    • 找不到加工單／請先載入加工單<br>
    • 加工單主檔已更新
  `,
  outsourceInputs: `
    <strong>流程：</strong><br>
    • 與出貨明細相同：按「新增投料」旁的「選擇 Lot」開啟視窗；可搜尋、切換「一般清單／依來源分組」；列表會顯示倉別，點選列帶回 Lot<br>
    • 填投料數量後按「新增投料」；同一張加工單可多次「2) 送加工（扣庫）」追加投料（分批投料）<br>
    • 下方表格為「同一套明細」：草稿列可編輯／刪除；已送加工的列可「回沖本筆投料」<br>
    • 點選某一列後，上方備註欄可帶出該筆；按「更新本筆備註」只改備註、不影響已扣庫數量<br>
    <strong>規則：</strong><br>
    • 選單／列表僅顯示 QA已放行、庫存 ACTIVE、可用量 &gt; 0 的 Lot<br>
    • 系統會檢查可用量（不可超投）；可用量以 inventory_movement 加總為準<br>
    <strong>常見提示：</strong><br>
    • 請選擇 Lot／找不到符合條件的 Lot／Lot 單位缺失<br>
    • 投料數量需大於 0／投料不可超過可用量<br>
    • 送加工時若無新草稿投料：請先新增投料再按 2)
  `,
  outsourceOutputs: `
    <strong>流程：</strong><br>
    • 選產出產品、輸入回收數量後按「新增產出」；產出明細表以「項次」對齊列；可累積多筆草稿再按「3) 回收加工品」一次入帳<br>
    • 「預估損耗」主要依「尚未入帳的草稿產出」與已送加工總量（換算後）即時估算；已作廢的回收不計入有效產出<br>
    • 可勾選「本次回收後結案（允許耗損）」：在仍有合理耗損、總量未完全對齊時，仍可將加工單結案<br>
    • 下方表格同為「同一套明細」：草稿可編輯／刪除；已入帳列可「作廢本筆回收」；點列可帶出備註並用「更新本筆備註」<br>
    <strong>規則：</strong><br>
    • 新 Lot 預設 PENDING（待QA）；是否可出庫需到 Lots 放行（QA已放行）<br>
    • 回收總量（換算後）不可超過已送加工；單位對不上時，到<strong>本次選的產出產品</strong>主檔設好多單位即可<br>
    • 多筆投料合一筆產出時，損耗以 Σ投料（換算後基準）－Σ有效產出（換算後基準）理解；細到「每個原料各自配方」需另建 BOM 才支援<br>
    • 每次有效回收寫入的損耗會存於該筆 process_order_output（loss_base_qty_after 等欄位）<br>
    <strong>常見提示：</strong><br>
    • 請選擇產出產品／回收數量需大於 0／產出單位缺失<br>
    • 回收總量不可超過已送加工總量／單位無法換算時請先設定產品換算<br>
    • 作廢回收後若畫面數字異常：請重新載入加工單或確認草稿列是否已清除<br>
    • 回收完成：產生新 Lot（PENDING）
  `,
  outsourceList: `
    <strong>流程：</strong><br>
    • 在加工單列表點「載入」：帶回主檔並刷新投料／回收明細<br>
    • 最下方「已載入加工單明細」以文字區摘要投料、產出與 lot_relation 關聯（方便核對）<br>
    • 需要稽核單筆異動時可用上方「Log」（加工單主檔）<br>
    <strong>規則：</strong><br>
    • 列表可依狀態等條件篩選（與畫面上方條件一致）<br>
    • 明細操作以「投料／回收」兩張卡片內的表格為準；摘要區僅供閱讀、不提供按鈕<br>
    <strong>常見提示：</strong><br>
    • 若載入後表格仍空：請確認是否已按 2) 送加工／3) 回收，或加工單ID是否正確
  `,

  traceMain: `
    <strong>流程：</strong><br>
    • 輸入 Lot ID 後查詢追溯結果<br>
    <strong>規則：</strong><br>
    • 向上追（來源）主要依 lot_relation<br>
    • 向下追（流向）包含加工產出與出貨扣庫<br>
    <strong>常見提示：</strong><br>
    • 請輸入 Lot ID
  `,

  splitMain: `
    <strong>流程：</strong><br>
    • 選來源 Lot，新增要拆出的新 Lot 與數量；明細表以「項次」對齊列；於表下方按「確認拆批（過帳）」送出後建立新批次<br>
    <strong>規則：</strong><br>
    • 拆批（SPLIT）會用 inventory_movement 調整可用量<br>
    • 會寫入 lot_relation（SPLIT）供追溯（來源 → 新批次）<br>
    • 新批次預設沿用原批次 QA 狀態（PENDING/APPROVED/REJECTED）<br>
    <strong>常見提示：</strong><br>
    • 請先選擇來源 Lot／找不到來源 Lot<br>
    • 新 Lot ID 必填／新 Lot ID 重複<br>
    • 數量需大於 0／單位缺失／拆出總量不可超過可用量<br>
    • 拆批完成
  `,
  mergeMain: `
    <strong>流程：</strong><br>
    • 上方填新 Lot 與備註；於來源區加入至少 2 個來源 Lot 與取用數量；來源明細以「項次」對齊列；於表下方按「確認合批（過帳）」送出<br>
    <strong>規則：</strong><br>
    • 合批（MERGE）會用 inventory_movement 調整可用量<br>
    • 會寫入 lot_relation（MERGE）供追溯（來源 → 新批次）<br>
    • 合批必須同一產品、同一單位<br>
    <strong>常見提示：</strong><br>
    • 請選擇來源 Lot／找不到 Lot／同一 Lot 不可重複加入<br>
    • 取用數量需大於 0／取用不可超過可用量<br>
    • 新 Lot ID 必填／新 Lot ID 已存在<br>
    • 合批至少需要 2 個來源 Lot<br>
    • 合批完成
  `,

  warehouseMain: `
    <strong>流程：</strong><br>
    • 填倉庫名稱、溫層類別（常溫／冷藏／冷凍）、地址等後按「建立」；已存在倉庫可從列表載入後「更新」或停用<br>
    • 倉庫 ID 可由系統自動產生，建立前仍可手動調整；儲存後作為全站收貨、出貨、庫存異動、挑 Lot 之下拉依據<br>
    <strong>規則：</strong><br>
    • 收貨、出貨、加工、拆併、手動異動等倉別皆連倉庫主檔；下拉顯示「名稱＋溫層」，避免手打錯倉<br>
    • 停用（INACTIVE）前若已有被使用，系統會提醒確認（保留歷史）<br>
    <strong>常見提示：</strong><br>
    • 倉庫 ID／名稱 必填<br>
    • 倉庫 ID 已存在／找不到倉庫／建立或更新成功<br>
    • 變更紀錄可到 Logs 查
  `,

  warehouseList: `
    <strong>流程：</strong><br>
    • 點欄位可排序；Edit 載入到上方編輯區<br>
    <strong>規則：</strong><br>
    • 關鍵字比對：倉庫 ID／名稱<br>
    <strong>常見提示：</strong><br>
    • 若找不到資料：請確認關鍵字／狀態條件
  `,

  warehouseStockHeader: `
    <strong>流程：</strong><br>
    • 先選倉別，再選檢視「產品彙總」或「Lot 明細」；可輸入關鍵字並用「到期視窗」篩選（例如 30／60／90 天內到期）<br>
    • 按「更新」重新彙總<br>
    <strong>規則：</strong><br>
    • 可用量以 inventory_movement 加總為準；畫面會標示即將到期與已過期，利於先進先出規劃<br>
    • 到期判斷以 expiry_date 當日 23:59:59 為截止<br>
    <strong>常見提示：</strong><br>
    • 請先選擇倉別再查詢<br>
    • 若數字與預期不符：確認是否剛完成轉倉／扣庫，可按「更新」或切換視圖核對
  `,
};


/* ===============================
   Help Engine
================================ */

function initHelpComponent(){

  document.querySelectorAll("[data-help]").forEach(el=>{

    const key = el.getAttribute("data-help");
    const content = HelpConfig[key];
    if(!content) return;

    el.classList.add("info-icon");
    el.innerHTML = "!";
    el.setAttribute("title","注意事項");

    const header = el.closest(".card-header");

    const box = document.createElement("div");
    box.className = "help-inline";
    box.innerHTML = content;

    header.insertAdjacentElement("afterend", box);

    el.addEventListener("click",()=>{
      box.classList.toggle("show");
    });

  });

  // 明細列表：展開時 summary 改為「隱藏明細列表」，收合時改為「顯示明細列表」
  const content = document.getElementById("content");
  if (content) {
    content.querySelectorAll(".items-list-details").forEach(function (details) {
      const summary = details.querySelector("summary");
      if (!summary) return;
      const showText = summary.getAttribute("data-summary-show") || "顯示明細列表";
      const hideText = summary.getAttribute("data-summary-hide") || "隱藏明細列表";
      details.addEventListener("toggle", function () {
        summary.textContent = details.open ? hideText : showText;
      });
      summary.textContent = details.open ? hideText : showText;
    });
  }
}

/*********************************
 * Global Sort Engine v1
 *********************************/

function applySorting(list, field, sortState){

  if(sortState.field === field){
    sortState.asc = !sortState.asc;
  }else{
    sortState.field = field;
    sortState.asc = true;
  }

  const sorted = [...list].sort((a,b)=>{
    if(a[field] > b[field]) return sortState.asc ? 1 : -1;
    if(a[field] < b[field]) return sortState.asc ? -1 : 1;
    return 0;
  });

  updateSortIcons(sortState.field, sortState.asc);

  return sorted;
}


function updateSortIcons(field, asc){

  document.querySelectorAll("th span[id^='sort-']")
    .forEach(el=>el.innerHTML="");

  if(!field) return;

  const icon = asc ? " ▲" : " ▼";
  const target = document.getElementById("sort-"+field);

  if(target) target.innerHTML = icon;
}

/*********************************
 * Global Deactivate Engine v1
 *********************************/

function canDeactivate(recordId, relationConfig){

  for(const config of relationConfig){

    const moduleData = erpData[config.module] || [];

    if(moduleData.some(r => r[config.field] === recordId)){
      return false;
    }
  }

  return true;
}