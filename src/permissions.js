// Aturan akses SalesFlow — DB-driven dari tabel role_access (app='salesflow').
// Data di-load sekali di App.jsx lalu di-set via setAccess(); canView/canAct baca set itu.
// (RLS database tetap pengaman akhir.)

export const ROLE_LABEL = {
  admin: "Admin", bi_sales: "BI Sales", md_sales: "MD Sales", finance: "Finance",
  manager: "Manager", director: "Director", rnd: "RnD", store_ops: "Store Ops",
  designer: "Designer", mdp: "MDP", purchasing: "Purchasing", qc: "QC", spg: "SPG",
  warehouse_material: "Warehouse Material", warehouse_inbound: "Warehouse Inbound",
  warehouse_inventory: "Warehouse Inventory", warehouse_outbound: "Warehouse Outbound",
  bi: "BI",
};

// tab UI -> slug resource di role_access (app='salesflow')
const PAGE2RES = {
  dash:       "dashboard",
  collection: "collection",
  restock:    "notifikasi_restock",
  ai:         "analisa_ai",
  sales:      "penjualan",
  input:      "input_sales",
  upload:     "upload_sales",
  kol:        "kol_giveaway",
  ar:         "penagihan_ar",
  wholesale:  "wholesale_order",
  skus:       "sku_master",
  admin:      "admin_panel",
  prefix:     "doc_prefix",
  panduan:    "panduan",
};

// area aksi -> resource yang dicek can_act
const AREA2RES = {
  doc_prefix: ["doc_prefix"],               // edit master prefix dokumen
  penjualan: ["penjualan"],                 // ekspor CSV di halaman Penjualan
  input:     ["input_sales", "upload_sales"], // input + upload penjualan
  sku:       ["sku_master"],                // edit SKU master
  ar:        ["penagihan_ar"],              // submit invoice AR + edit margin
  wholesale_order:    ["wholesale_order"],       // buat order + fulfillment + invoice
  wholesale_customer: ["wholesale_customer"],    // kelola master customer
  target:    ["dashboard"],                 // set target (Dashboard)
  admin:     ["admin_panel"],               // kelola user/role
};

let VIEW_SET = new Set();
let ACT_SET = new Set();

// Dipanggil dari App.jsx setelah role_access termuat.
export function setAccess(view, act) {
  VIEW_SET = view instanceof Set ? view : new Set(view || []);
  ACT_SET = act instanceof Set ? act : new Set(act || []);
}

// true kalau role punya minimal satu halaman yang boleh dilihat di SalesFlow.
export function hasSalesflowAccess() {
  return VIEW_SET.size > 0;
}

export function canView(_role, page) {
  const res = PAGE2RES[page];
  return res ? VIEW_SET.has(res) : false;
}

export function canAct(_role, area) {
  const list = AREA2RES[area];
  return Array.isArray(list) && list.some((r) => ACT_SET.has(r));
}
