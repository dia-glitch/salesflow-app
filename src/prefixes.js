import { supabase } from "./supabaseClient.js";

// default fallback bila tabel master belum ada / gagal dibaca
export const DEFAULTS = {
  wholesale_order: { prefix: "DO", format: "-{YY}{MM}{DD}-{SEQ:3}" },
  consign_ar:      { prefix: "AR", format: "-{STORE}-{SEQ:3}" },
  inv_dp:          { prefix: "INV/DP/", format: "{DOC}" },
  inv_ln:          { prefix: "INV/LN/", format: "{DOC}" },
  inv_full:        { prefix: "INV/", format: "{DOC}" },
};

const pad = (n, w = 2) => String(n).padStart(w, "0");

// baca master prefix → {key: {prefix, format}}
export async function loadPrefixes() {
  const m = {};
  for (const k of Object.keys(DEFAULTS)) m[k] = { ...DEFAULTS[k] };
  try {
    const { data, error } = await supabase.from("sf_doc_prefixes").select("key,prefix,number_format");
    if (error) throw error;
    (data || []).forEach((r) => {
      if (!m[r.key]) m[r.key] = { prefix: "", format: "{DOC}" };
      if (r.prefix != null) m[r.key].prefix = r.prefix;
      if (r.number_format != null && r.number_format !== "") m[r.key].format = r.number_format;
    });
  } catch { /* pakai default */ }
  return m;
}

// render nomor: prefix + format(token). ctx = { date, store, doc, seq }
export function renderNumber(prefix, format, ctx = {}) {
  const d = ctx.date || new Date();
  let s = String(format || "");
  s = s.replace(/\{YYYY\}/g, String(d.getFullYear()))
       .replace(/\{YY\}/g, String(d.getFullYear()).slice(2))
       .replace(/\{MM\}/g, pad(d.getMonth() + 1))
       .replace(/\{DD\}/g, pad(d.getDate()));
  if (ctx.store != null) s = s.replace(/\{STORE\}/g, ctx.store);
  if (ctx.doc != null) s = s.replace(/\{DOC\}/g, ctx.doc);
  s = s.replace(/\{SEQ(?::(\d+))?\}/g, (_, n) => String(ctx.seq ?? 1).padStart(Number(n) || 1, "0"));
  return (prefix || "") + s;
}

// "stem" = prefix + format sampai sebelum {SEQ} (untuk hitung nomor urut via LIKE)
export function numberStem(prefix, format, ctx = {}) {
  const before = String(format || "").split(/\{SEQ/)[0];
  return renderNumber(prefix, before, ctx);
}

// ---- Prefix per channel penjualan (untuk source_txn_id Input/Upload sales) ----
export const chKey = (channelId) => "ch_" + channelId;

// {channel_id: prefix} dari sf_doc_prefixes (key 'ch_<channel_id>')
export async function loadChannelPrefixes() {
  const m = {};
  try {
    const { data, error } = await supabase.from("sf_doc_prefixes").select("key,prefix").like("key", "ch\\_%");
    if (error) throw error;
    (data || []).forEach((r) => { if (r.prefix) m[r.key.slice(3)] = r.prefix; });
  } catch { /* kosong */ }
  return m;
}

// "YYYY-MM-DD" atau Date → "YYMMDD"
export function yymmdd(d) {
  const s = typeof d === "string" ? d : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return String(s).slice(2).replace(/-/g, "");
}

// nomor urut terakhir dari source_txn_id untuk (channel, base) di cf_sales_fact
// base = "<prefix><YYMMDD>-" ; mengembalikan angka terbesar setelah "-".
export async function lastOrderSeq(channelId, base) {
  let max = 0;
  try {
    const { data } = await supabase.from("cf_sales_fact")
      .select("source_txn_id").eq("channel_id", channelId).ilike("source_txn_id", base + "%").limit(2000);
    (data || []).forEach((x) => { const m = String(x.source_txn_id).match(/-(\d+)$/); if (m) max = Math.max(max, Number(m[1]) || 0); });
  } catch { /* ignore */ }
  return max;
}
