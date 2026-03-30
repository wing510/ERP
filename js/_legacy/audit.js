/*********************************
 * ERP v2.2 - Audit Log Module
 *********************************/

function writeAuditLog(action, module, recordId, oldData, newData) {

  erpData.logs.push({
    id: generateId("LOG"),
    action,                 // CREATE / UPDATE
    module,                 // PRODUCTS / PURCHASE ...
    recordId,
    oldData: oldData || null,
    newData: newData || null,
    user: getCurrentUser(),
    timestamp: new Date().toISOString()
  });

  saveERPData(erpData);
}