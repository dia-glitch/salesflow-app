// Aturan akses SalesFlow — sumber tunggal untuk gating di UI.
// (RLS database tetap jadi pengaman akhir di Langkah E.)

export const ROLE_LABEL = {
  admin: "Admin", bi: "BI", md_sales: "MD Sales", finance: "Finance",
  manager: "Manager", director: "Director", rnd: "RnD", store_ops: "Store Ops",
};

// Halaman yang boleh DILIHAT per role.
// "all" = semua role. Array = hanya role tersebut.
const VIEW = {
  dash: "all",
  collection: "all",
  sales: "all",
  skus: "all",
  input: ["bi", "md_sales", "manager", "finance", "admin"],   // exclude RnD, Director, Store Ops
  upload: ["bi", "md_sales", "manager", "finance", "admin"],   // exclude RnD, Director, Store Ops
  admin: ["admin"],
};

// Aksi (tulis) yang boleh DILAKUKAN per role.
const ACT = {
  penjualan: ["bi", "md_sales", "finance", "admin"], // mis. ekspor CSV
  input: ["bi", "md_sales", "admin"],                // input + upload penjualan
  sku: ["bi", "md_sales", "admin"],                  // edit SKU master (upload gambar)
  target: ["bi", "md_sales", "admin"],               // set target penjualan
  admin: ["admin"],                                  // kelola user/role
};

export function canView(role, page) {
  const v = VIEW[page];
  return v === "all" || (Array.isArray(v) && v.includes(role));
}

export function canAct(role, area) {
  return Array.isArray(ACT[area]) && ACT[area].includes(role);
}
