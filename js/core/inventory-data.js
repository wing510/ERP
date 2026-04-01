/**
 * Inventory Data Loader（共用：lots/products/warehouses/movements）
 * - 統一讀取策略與錯誤旗標（movements 失敗 => movementLoadFailed=true）
 */

async function loadInventoryCoreData_(options = {}){
  const needWarehouses = options?.needWarehouses !== false;

  const pWarehouses = needWarehouses ? getAll("warehouse").catch(() => null) : Promise.resolve(null);
  const [lots, products, movements, warehouses] = await Promise.all([
    getAll("lot").catch(() => []),
    getAll("product").catch(() => []),
    getAll("inventory_movement").catch(() => null),
    pWarehouses
  ]);

  const movementLoadFailed = movements == null;

  return {
    lots: lots || [],
    products: products || [],
    warehouses: Array.isArray(warehouses) ? warehouses : [],
    movements: Array.isArray(movements) ? movements : [],
    movementLoadFailed,
    loaded_at: Date.now()
  };
}

