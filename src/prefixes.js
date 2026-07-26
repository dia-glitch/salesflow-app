import { supabase } from "./supabaseClient.js";

// default fallback bila tabel master belum ada / gagal dibaca
export const DEFAULT_PREFIXES = {
  wholesale_order: "DO",
  consign_ar: "AR",
  inv_dp: "INV/DP/",
  inv_ln: "INV/LN/",
  inv_full: "INV/",
};

// baca master prefix (sf_doc_prefixes) → objek {key: prefix}
export async function loadPrefixes() {
  try {
    const { data, error } = await supabase.from("sf_doc_prefixes").select("key,prefix");
    if (error) throw error;
    const m = { ...DEFAULT_PREFIXES };
    (data || []).forEach((r) => { if (r.prefix != null && r.prefix !== "") m[r.key] = r.prefix; });
    return m;
  } catch {
    return { ...DEFAULT_PREFIXES };
  }
}
