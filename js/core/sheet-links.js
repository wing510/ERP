/**
 * Google Sheets 對照表（與後端試算表分頁對應）
 * 修改連結請只改此檔，不必動各模組 HTML。
 */
const SHEET_LINKS = {
  product:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1114076682#gid=1114076682",
  supplier:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=99221118#gid=99221118",
  customer:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1601673747#gid=1601673747",
  warehouse:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=267971627#gid=267971627",
  user:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1751545572#gid=1751545572",

  purchase_order:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1975679446#gid=1975679446",
  purchase_order_item:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1592901409#gid=1592901409",

  import_document:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1372231910#gid=1372231910",
  import_item:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1501371837#gid=1501371837",

  goods_receipt:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=280711382#gid=280711382",
  goods_receipt_item:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=2022541079#gid=2022541079",

  import_receipt:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1725385985#gid=1725385985",
  import_receipt_item:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=478887238#gid=478887238",

  lot:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=11316360#gid=11316360",
  lot_relation:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=783277553#gid=783277553",

  process_order:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=356318207#gid=356318207",

  sales_order:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1520633879#gid=1520633879",
  sales_order_item:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1113223744#gid=1113223744",

  shipment:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1147399524#gid=1147399524",
  shipment_item:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=1610733267#gid=1610733267",

  inventory_movement:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=88937962#gid=88937962",

  logs:
    "https://docs.google.com/spreadsheets/d/17CFX0_mgvGaaOoxRub9mw33LuukzhwrEGK5se8LbwTw/edit?gid=475164289#gid=475164289"
};

/**
 * @param {keyof typeof SHEET_LINKS} key
 */
function openSheetLink(key) {
  const url = SHEET_LINKS[key];
  if (!url) {
    if (typeof showToast === "function") {
      showToast("尚未設定此分頁的 Sheet 連結", "error");
    }
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
