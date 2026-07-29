// ────────────────────────────────────────────────────────────────────────────
// Data testing yang DISEMBUNYIKAN dari seluruh app SalesFlow (tanpa dihapus dari
// database — DB dipakai bersama app lain). Semua list, total, dropdown, dan chart
// otomatis mengecualikan baris yang cocok. Konsisten dengan ChannelFlow.
//
// Untuk MEMUNCULKAN lagi: kosongkan HIDDEN_NAME_PREFIX / HIDDEN_NAMES di bawah.
// Untuk menyembunyikan produk lain: tambahkan nama / prefix produknya.
// ────────────────────────────────────────────────────────────────────────────
import { supabase } from "./supabaseClient.js";

const HIDDEN_NAMES        = ["Beyva Testing Blouse Brick"];
const HIDDEN_NAME_PREFIX  = ["Beyva Testing"]; // cocok bila product_name_system diawali string ini

export function isHiddenName(name) {
  const s = name == null ? "" : String(name).trim();
  if (!s) return false;
  if (HIDDEN_NAMES.includes(s)) return true;
  return HIDDEN_NAME_PREFIX.some((p) => s.startsWith(p));
}

// Cache (per sesi) daftar SKU & SPK milik produk tersembunyi. Banyak tabel
// (cf_sales_fact, sf_do_order_lines, sf_ar_invoice_lines, sf_customer_return_lines)
// hanya menyimpan `sku` tanpa nama produk — jadi kita resolusi SKU-nya sekali.
let _hiddenSkus = null;
let _hiddenSpks = null;
let _loadPromise = null;

export async function loadHiddenSkus() {
  if (_hiddenSkus) return _hiddenSkus;
  if (!supabase) { _hiddenSkus = new Set(); _hiddenSpks = new Set(); return _hiddenSkus; }
  if (!_loadPromise) {
    _loadPromise = (async () => {
      const skus = new Set();
      const spks = new Set();
      try {
        // 1) SKU yang product_name_system-nya sendiri cocok (server-side filter).
        const it1 = await supabase
          .from("sku_items")
          .select("sku,spk_id,product_name_system")
          .ilike("product_name_system", "Beyva Testing%");
        (it1.data || []).forEach((r) => {
          if (isHiddenName(r.product_name_system)) { if (r.sku) skus.add(r.sku); if (r.spk_id) spks.add(r.spk_id); }
        });

        // 2) SPK (produk induk) yang namanya cocok → semua SKU turunannya.
        const pr = await supabase
          .from("sku_products")
          .select("spk_id,product_name_system")
          .ilike("product_name_system", "Beyva Testing%");
        (pr.data || []).forEach((p) => { if (isHiddenName(p.product_name_system) && p.spk_id) spks.add(p.spk_id); });

        if (spks.size) {
          const it2 = await supabase
            .from("sku_items")
            .select("sku,spk_id")
            .in("spk_id", Array.from(spks));
          (it2.data || []).forEach((r) => { if (r.sku) skus.add(r.sku); });
        }
      } catch (_) { /* kalau gagal: set kosong, app tetap jalan */ }
      _hiddenSkus = skus;
      _hiddenSpks = spks;
      return _hiddenSkus;
    })();
  }
  return _loadPromise;
}

export function isHiddenSku(sku) { return _hiddenSkus ? _hiddenSkus.has(sku) : false; }
export function isHiddenSpk(spk) { return _hiddenSpks ? _hiddenSpks.has(spk) : false; }

// true bila baris ini termasuk produk tersembunyi. Toleran ke berbagai bentuk baris.
export function isHidden(row) {
  if (!row || typeof row !== "object") return false;
  const name = row.product_name_system ?? row.product_name ?? row.product ?? row.name;
  if (name != null && isHiddenName(name)) return true;
  const spk = row.spk_id;
  if (spk != null && isHiddenSpk(spk)) return true;
  const sku = row.sku ?? row.seller_sku;
  if (sku && isHiddenSku(sku)) return true;
  return false;
}

// Buang baris produk tersembunyi dari array (aman untuk null/undefined).
// PENTING: panggil `await loadHiddenSkus()` dulu di awal fungsi load tiap halaman.
export function rejectHidden(arr) {
  return (arr || []).filter((row) => !isHidden(row));
}

// Buang dokumen (DO / invoice / retur) yang SEMUA barisnya produk tersembunyi.
// `lines` = array baris (punya `sku`), `idField` = nama kolom id dokumen.
// Mengembalikan Set berisi id dokumen yang harus disembunyikan.
export function fullyHiddenDocIds(lines, idField) {
  const byDoc = {};
  (lines || []).forEach((l) => {
    const id = l && l[idField];
    if (id == null) return;
    (byDoc[id] || (byDoc[id] = [])).push(l.sku);
  });
  const set = new Set();
  for (const id in byDoc) {
    const skus = byDoc[id];
    if (skus.length && skus.every((s) => isHiddenSku(s))) set.add(id);
  }
  return set;
}
