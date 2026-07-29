import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient.js";
import { loadHiddenSkus, isHiddenSku } from "./hiddenData.js";
import { fmtIDR, fmtNum, cleanName, dShort } from "./format.js";
import { canViewRes } from "./permissions.js";

/* ---------------- helpers ---------------- */
const num = (n) => Number(n) || 0;
const rp = (n) => Math.round(num(n));
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const stampNow = () => new Date().toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const KOL_CH = "KOL";

const alignTotals = (len, pairs) => { const a = Array(len).fill(null); pairs.forEach(([i, v]) => { a[i] = v; }); return a; };

/* Aging by Launch — kategori SAMA dengan Dashboard/ChannelFlow (umur produk sejak launch date koleksi) */
const LIFE_BUCKETS = [
  { key: "New", label: "New", color: "#2FA37C" },
  { key: "Evergreen 1", label: "Evergreen 1", color: "#3E9E7E" },
  { key: "Evergreen 2", label: "Evergreen 2", color: "#4A8FB0" },
  { key: "Clearance 1", label: "Clearance 1", color: "#C4881A" },
  { key: "Clearance 2", label: "Clearance 2", color: "#EF6C3B" },
  { key: "Old", label: "Old", color: "#CE3F54" },
  { key: "Upcoming", label: "Upcoming", color: "#868D9A" },
];
function monthsSince(launchVal, nowMs) {
  const l = new Date(launchVal), n = new Date(nowMs);
  let m = (n.getFullYear() - l.getFullYear()) * 12 + (n.getMonth() - l.getMonth());
  if (n.getDate() < l.getDate()) m--;
  return m;
}
function lifecycleOf(launchVal, nowMs) {
  if (!launchVal) return "Tanpa launch date";
  const t = new Date(launchVal).getTime();
  if (isNaN(t)) return "Tanpa launch date";
  if (t > nowMs) return "Upcoming";
  const m = monthsSince(launchVal, nowMs);
  if (m < 1) return "New";
  if (m < 3) return "Evergreen 1";
  if (m < 6) return "Evergreen 2";
  if (m < 9) return "Clearance 1";
  if (m < 12) return "Clearance 2";
  return "Old";
}

async function fetchAll(builder) {
  const PAGE = 1000; let from = 0, out = [];
  for (let i = 0; i < 300; i++) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function downloadXlsx(filename, sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    const widths = (s.aoa[3] || s.aoa[0] || []).map((_, c) => {
      let w = 8;
      for (const row of s.aoa) { const v = row[c]; const len = v == null ? 0 : String(v).length; if (len > w) w = len; }
      return { wch: Math.min(w + 2, 48) };
    });
    ws["!cols"] = widths;
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

/* ikon SVG inline (SalesFlow tidak memuat font ikon) */
const ICONS = {
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8"/><path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-9"/>',
};
function Icon({ k, color, size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[k] || "" }} />;
}

const REPORTS = [
  { key: "summary", label: "Ringkasan Penjualan",   desc: "Total pcs terjual + % per kategori aging (New/Evergreen/…) & per channel · periode", filt: "range_channel", res: "penjualan",  color: "#0E7C86", icon: "chart" },
  { key: "sales",  label: "Download Penjualan",     desc: "Semua transaksi penjualan · bisa difilter per channel & periode",            filt: "range_channel", res: "penjualan",       color: "#1F5FA8", icon: "cart" },
  { key: "kol",    label: "Laporan KOL / Giveaway", desc: "Produk yang keluar ke KOL/influencer (channel KOL) + nilai retail · periode", filt: "range",         res: "kol_giveaway",    color: "#7C3AED", icon: "gift" },
  { key: "ar",     label: "Daftar AR (SKU-level)",  desc: "Piutang per invoice AR + rincian tiap SKU (margin, retur) · versi lengkap",  filt: "range",         res: "penagihan_ar",    color: "#C4881A", icon: "receipt" },
  { key: "direct", label: "Direct Purchase (DO)",   desc: "Order Direct Purchase + rincian tiap SKU, fulfillment & status bayar · lengkap", filt: "range",     res: "wholesale_order", color: "#3F7D58", icon: "truck" },
  { key: "retur",  label: "Laporan Retur",          desc: "Semua transaksi retur (nilai penjualan negatif) · bisa difilter per channel & periode",   filt: "range_channel", res: "penjualan",   color: "#A33636", icon: "undo" },
];

const isPctHdr = (h) => /%/.test(h);   // kolom persen (Margin %, Disc %) — angka biasa, bukan Rp
const isMoneyHdr = (h) => !isPctHdr(h) && /retail|harga|net|amount|margin|price|subtotal|terbayar|nilai|total|diskon/i.test(h);
const isNumHdr = (h) => isMoneyHdr(h) || isPctHdr(h) || /qty|disc|fulfill/i.test(h);

export default function Laporan() {
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState(null);
  const cache = useRef({});                 // ref data cache
  const [channels, setChannels] = useState([]); // untuk dropdown filter Penjualan

  const now = new Date();
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(now));
  const [channel, setChannel] = useState("");   // "" = semua

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("cf_sales_channels").select("channel_id,name").order("name");
      setChannels(data || []);
      setReady(true);
    })();
  }, []);

  /* ---- reference data (cached) ---- */
  async function getRef() {
    if (!cache.current.ref) {
      const [chRes, locRes, siRes, spRes] = await Promise.all([
        supabase.from("cf_sales_channels").select("channel_id,name"),
        supabase.from("cf_locations").select("location_id,name"),
        fetchAll(() => supabase.from("sku_items").select("sku,spk_id,product_name_system,size_label,colour_lv2")),
        supabase.from("sku_products").select("spk_id,product_code,product_name_system,collection_code"),
      ]);
      const ch = {}; (chRes.data || []).forEach((c) => { ch[c.channel_id] = c.name; });
      const loc = {}; (locRes.data || []).forEach((l) => { loc[l.location_id] = l.name; });
      const si = {}; (siRes || []).forEach((x) => { si[x.sku] = x; });
      const sp = {}; (spRes.data || []).forEach((x) => { sp[x.spk_id] = x; });
      cache.current.ref = { ch, loc, si, sp };
    }
    return cache.current.ref;
  }
  function skuInfo(ref, sku) {
    const si = ref.si[sku] || {};
    const sp = ref.sp[si.spk_id] || {};
    return {
      name: cleanName(si.product_name_system || sp.product_name_system || sku, si.size_label, si.colour_lv2),
      code: sp.product_code || "",
      size: si.size_label || "",
      colour: si.colour_lv2 || "",
      collection: sp.collection_code || "",
    };
  }

  function pack(title, headers, body, totals, filename) {
    const aoa = [[title], ["Dibuat: " + stampNow()], [], headers, ...body];
    if (totals) { const r = totals.slice(); if (r[0] == null) r[0] = "TOTAL"; aoa.push(r); }
    return { title, headers, body, filename, sheets: [{ name: "Laporan", aoa }] };
  }

  /* ---------------- generators ---------------- */
  async function build(key) {
    const ref = await getRef();
    await loadHiddenSkus();
    const loc = (id) => ref.loc[id] || id || "";
    const ch = (id) => ref.ch[id] || id || "";

    if (key === "sales") {
      const rows = await fetchAll(() => {
        let q = supabase.from("cf_sales_fact").select("txn_date,channel_id,location_id,sku,qty,retail_price,sale_at_price,discount,net_amount,order_ref");
        if (channel) q = q.eq("channel_id", channel);
        return q.gte("txn_date", from).lte("txn_date", to);
      });
      rows.sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
      const headers = ["Tgl", "Channel", "Lokasi", "SKU", "Kode Produk", "Produk", "Size", "Warna", "Qty", "Retail", "Harga Jual", "Diskon", "Net", "Ref Order"];
      let tQ = 0, tN = 0;
      const body = rows.filter((r) => !isHiddenSku(r.sku)).map((r) => {
        const s = skuInfo(ref, r.sku); tQ += num(r.qty); tN += num(r.net_amount);
        return [dShort(r.txn_date), ch(r.channel_id), loc(r.location_id), r.sku, s.code, s.name, s.size, s.colour, num(r.qty), rp(r.retail_price), rp(r.sale_at_price), rp(r.discount), rp(r.net_amount), r.order_ref || ""];
      });
      const totals = alignTotals(headers.length, [[0, "TOTAL"], [8, tQ], [12, rp(tN)]]);
      const chLabel = channel ? "_" + (ch(channel) || channel).replace(/\s+/g, "") : "_semua-channel";
      return pack(`Laporan Penjualan — ${dShort(from)} s/d ${dShort(to)}${channel ? " · " + ch(channel) : " · Semua channel"}`, headers, body, totals, `Penjualan${chLabel}_${from}_${to}.xlsx`);
    }

    if (key === "kol") {
      const rows = await fetchAll(() => supabase.from("cf_sales_fact").select("txn_date,location_id,sku,qty,retail_price,order_ref").eq("channel_id", KOL_CH).gte("txn_date", from).lte("txn_date", to));
      rows.sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
      const headers = ["Tgl", "Lokasi", "SKU", "Kode Produk", "Produk", "Koleksi", "Size", "Warna", "Qty", "Nilai Retail", "Ref"];
      let tQ = 0, tV = 0;
      const body = rows.filter((r) => !isHiddenSku(r.sku)).map((r) => {
        const s = skuInfo(ref, r.sku); const val = num(r.qty) * num(r.retail_price);
        tQ += num(r.qty); tV += val;
        return [dShort(r.txn_date), loc(r.location_id), r.sku, s.code, s.name, s.collection, s.size, s.colour, num(r.qty), rp(val), r.order_ref || ""];
      });
      const totals = alignTotals(headers.length, [[0, "TOTAL"], [8, tQ], [9, rp(tV)]]);
      return pack(`Laporan KOL / Giveaway — ${dShort(from)} s/d ${dShort(to)}`, headers, body, totals, `KOL_${from}_${to}.xlsx`);
    }

    if (key === "ar") {
      const invs = await fetchAll(() => supabase.from("sf_ar_invoices").select("*").gte("period_start", from).lte("period_start", to));
      const invById = {}; invs.forEach((i) => { invById[i.id] = i; });
      const ids = invs.map((i) => i.id);
      const lines = ids.length ? await fetchAll(() => supabase.from("sf_ar_invoice_lines").select("*").in("invoice_id", ids)) : [];
      lines.sort((a, b) => {
        const A = invById[a.invoice_id] || {}, B = invById[b.invoice_id] || {};
        return String(A.ar_no || "").localeCompare(String(B.ar_no || "")) || String(a.sku || "").localeCompare(String(b.sku || ""));
      });
      const headers = ["No AR", "Store", "Periode", "Status", "SKU", "Produk", "Qty", "Retail", "Harga Jual", "Sale Amount", "Disc %", "Jenis Margin", "Margin %", "Margin Store", "AR Amount", "Retur?"];
      let tQ = 0, tS = 0, tM = 0, tAr = 0;
      const body = lines.filter((l) => !isHiddenSku(l.sku)).map((l) => {
        const inv = invById[l.invoice_id] || {};
        tQ += num(l.qty); tS += num(l.sale_amount); tM += num(l.margin_store); tAr += num(l.ar_amount);
        return [inv.ar_no || "", loc(inv.location_id), `${dShort(inv.period_start)}–${dShort(inv.period_end)}`, inv.status || "", l.sku, l.product_name || skuInfo(ref, l.sku).name, num(l.qty), rp(l.retail_price), rp(l.sale_price), rp(l.sale_amount), l.disc_pct != null ? num(l.disc_pct) : "", l.margin_kind || "", l.margin_pct != null ? num(l.margin_pct) : "", rp(l.margin_store), rp(l.ar_amount), l.is_return ? "Retur" : ""];
      });
      const totals = alignTotals(headers.length, [[0, "TOTAL"], [6, tQ], [9, rp(tS)], [13, rp(tM)], [14, rp(tAr)]]);
      return pack(`Daftar AR (SKU-level) — periode ${dShort(from)} s/d ${dShort(to)}`, headers, body, totals, `AR_SKU_${from}_${to}.xlsx`);
    }

    if (key === "direct") {
      const orders = await fetchAll(() => supabase.from("sf_do_orders").select("*").gte("order_date", from).lte("order_date", to));
      const ordById = {}; orders.forEach((o) => { ordById[o.id] = o; });
      const ids = orders.map((o) => o.id);
      const [lines, custRes, invRes] = await Promise.all([
        ids.length ? fetchAll(() => supabase.from("sf_do_order_lines").select("*").in("order_id", ids)) : Promise.resolve([]),
        supabase.from("sf_customers").select("id,name"),
        ids.length ? supabase.from("sf_do_invoices").select("order_id,paid_amount").in("order_id", ids) : Promise.resolve({ data: [] }),
      ]);
      const custName = {}; (custRes.data || []).forEach((c) => { custName[c.id] = c.name; });
      const paidByOrder = {}; (invRes.data || []).forEach((i) => { paidByOrder[i.order_id] = (paidByOrder[i.order_id] || 0) + num(i.paid_amount); });
      lines.sort((a, b) => {
        const A = ordById[a.order_id] || {}, B = ordById[b.order_id] || {};
        return String(A.order_no || "").localeCompare(String(B.order_no || "")) || String(a.sku || "").localeCompare(String(b.sku || ""));
      });
      const headers = ["No Order", "Tgl", "Customer", "Status", "Fulfill Lokasi", "SKU", "Kode Produk", "Produk", "Qty Order", "Qty Fulfilled", "Retail", "Unit Price", "Subtotal", "Total Order", "Terbayar"];
      let tQo = 0, tQf = 0, tSub = 0;
      const body = lines.filter((l) => !isHiddenSku(l.sku)).map((l) => {
        const o = ordById[l.order_id] || {}; const s = skuInfo(ref, l.sku);
        tQo += num(l.qty_order); tQf += num(l.qty_fulfilled); tSub += num(l.line_total);
        return [o.order_no || "", dShort(o.order_date), custName[o.customer_id] || o.customer_id || "", o.status || "", loc(o.fulfill_location_id), l.sku, s.code, l.product_name || s.name, num(l.qty_order), num(l.qty_fulfilled), rp(l.retail_price), rp(l.unit_price), rp(l.line_total), rp(o.total), rp(paidByOrder[o.id])];
      });
      const totals = alignTotals(headers.length, [[0, "TOTAL"], [8, tQo], [9, tQf], [12, rp(tSub)]]);
      return pack(`Laporan Direct Purchase (DO) — ${dShort(from)} s/d ${dShort(to)}`, headers, body, totals, `Direct_Purchase_${from}_${to}.xlsx`);
    }

    if (key === "retur") {
      const rows = await fetchAll(() => {
        let q = supabase.from("cf_sales_fact").select("txn_date,channel_id,location_id,sku,qty,retail_price,sale_at_price,net_amount,order_ref");
        if (channel) q = q.eq("channel_id", channel);
        return q.gte("txn_date", from).lte("txn_date", to).lt("net_amount", 0);
      });
      rows.sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
      const headers = ["Tgl", "Channel", "Lokasi", "SKU", "Kode Produk", "Produk", "Size", "Warna", "Qty Retur", "Retail", "Harga Jual", "Nilai Retur", "Ref Order"];
      let tQ = 0, tN = 0;
      const body = rows.filter((r) => !isHiddenSku(r.sku)).map((r) => {
        const s = skuInfo(ref, r.sku); const qty = Math.abs(num(r.qty)); const val = Math.abs(num(r.net_amount));
        tQ += qty; tN += val;
        return [dShort(r.txn_date), ch(r.channel_id), loc(r.location_id), r.sku, s.code, s.name, s.size, s.colour, qty, rp(r.retail_price), rp(r.sale_at_price), rp(val), r.order_ref || ""];
      });
      const totals = alignTotals(headers.length, [[0, "TOTAL"], [8, tQ], [11, rp(tN)]]);
      const chLabel = channel ? "_" + (ch(channel) || channel).replace(/\s+/g, "") : "";
      return pack(`Laporan Retur — ${dShort(from)} s/d ${dShort(to)}${channel ? " · " + ch(channel) : ""}`, headers, body, totals, `Retur${chLabel}_${from}_${to}.xlsx`);
    }

    if (key === "summary") {
      // launch date: collection_code -> launch_date (via spk_orders); sku -> spk_id -> collection_code (dari ref)
      const soRes = await supabase.from("spk_orders").select("collection_code,launch_date");
      if (soRes.error) throw soRes.error;
      const launchByColl = {};
      (soRes.data || []).forEach((o) => { if (o.collection_code && o.launch_date && !launchByColl[o.collection_code]) launchByColl[o.collection_code] = o.launch_date; });
      const launchOf = (sku) => { const si = ref.si[sku]; if (!si) return null; const sp = ref.sp[si.spk_id]; if (!sp) return null; return launchByColl[sp.collection_code] || null; };

      const rows = await fetchAll(() => {
        let q = supabase.from("cf_sales_fact").select("txn_date,channel_id,sku,qty,net_amount");
        if (channel) q = q.eq("channel_id", channel); else q = q.neq("channel_id", KOL_CH);
        return q.gte("txn_date", from).lte("txn_date", to);
      });

      const agingAgg = {}, chAgg = {};
      let totPcs = 0, totNet = 0;
      for (const r of rows) {
        if (isHiddenSku(r.sku)) continue;
        const q = num(r.qty), net = num(r.net_amount);
        totPcs += q; totNet += net;
        const b = lifecycleOf(launchOf(r.sku), new Date(r.txn_date).getTime()); // umur produk SAAT terjual
        (agingAgg[b] || (agingAgg[b] = { pcs: 0, net: 0 }));
        agingAgg[b].pcs += q; agingAgg[b].net += net;
        const cid = r.channel_id || "—";
        (chAgg[cid] || (chAgg[cid] = { pcs: 0, net: 0 }));
        chAgg[cid].pcs += q; chAgg[cid].net += net;
      }
      const pctOf = (a, b) => (b ? (a / b) * 100 : 0);

      const seen = new Set(), agingRows = [];
      for (const b of LIFE_BUCKETS) if (agingAgg[b.key]) { agingRows.push({ label: b.label, color: b.color, ...agingAgg[b.key] }); seen.add(b.key); }
      for (const k of Object.keys(agingAgg)) if (!seen.has(k)) agingRows.push({ label: k, color: "#9AA0AA", ...agingAgg[k] });
      agingRows.forEach((r) => { r.pctPcs = pctOf(r.pcs, totPcs); r.pctNet = pctOf(r.net, totNet); });

      const chRows = Object.entries(chAgg)
        .map(([cid, v]) => ({ label: ch(cid), pcs: v.pcs, net: v.net, pctPcs: pctOf(v.pcs, totPcs), pctNet: pctOf(v.net, totNet) }))
        .sort((a, b) => b.pcs - a.pcs);

      const scope = channel ? ch(channel) : "Semua channel (tanpa KOL/giveaway)";
      const p1 = (n) => +Number(n).toFixed(1);
      const agingAoa = [[`Ringkasan Penjualan per Kategori Aging — ${dShort(from)} s/d ${dShort(to)} · ${scope}`], ["Dibuat: " + stampNow()], [],
        ["Kategori Aging", "Pcs", "% Pcs", "Net (Rp)", "% Net"],
        ...agingRows.map((r) => [r.label, r.pcs, p1(r.pctPcs), rp(r.net), p1(r.pctNet)]),
        ["TOTAL", totPcs, 100, rp(totNet), 100]];
      const chAoa = [[`Ringkasan Penjualan per Channel — ${dShort(from)} s/d ${dShort(to)} · ${scope}`], ["Dibuat: " + stampNow()], [],
        ["Channel", "Pcs", "% Pcs", "Net (Rp)", "% Net"],
        ...chRows.map((r) => [r.label, r.pcs, p1(r.pctPcs), rp(r.net), p1(r.pctNet)]),
        ["TOTAL", totPcs, 100, rp(totNet), 100]];

      return {
        kind: "summary",
        title: `Ringkasan Penjualan — ${dShort(from)} s/d ${dShort(to)}`,
        filename: `Ringkasan_Penjualan_${from}_${to}.xlsx`,
        summary: { totPcs, totNet, agingRows, chRows, scope, from, to },
        body: agingRows,
        sheets: [{ name: "Ringkasan Aging", aoa: agingAoa }, { name: "Per Channel", aoa: chAoa }],
      };
    }

    throw new Error("Laporan tidak dikenal");
  }

  async function generate() {
    setBusy(true); setErr(null); setResult(null);
    try { setResult(await build(report)); }
    catch (e) { console.error(e); setErr(e.message || "Gagal membuat laporan"); }
    finally { setBusy(false); }
  }

  const openReport = (k) => { setReport(k); setResult(null); setErr(null); };
  const backToGrid = () => { setReport(null); setResult(null); setErr(null); };

  const visibleReports = REPORTS.filter((r) => canViewRes(r.res));
  const meta = report ? REPORTS.find((r) => r.key === report) : null;

  if (!ready) return <div className="card" style={{ textAlign: "center", color: "var(--sub)" }}>Memuat…</div>;

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      <style>{`.sf-rcard{transition:.14s;cursor:pointer}.sf-rcard:hover{border-color:#D8D8D4!important;box-shadow:0 8px 24px rgba(11,11,13,.08);transform:translateY(-2px)}`}</style>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "var(--ink)", letterSpacing: "-.3px" }}>Laporan</div>
        <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 3 }}>Tarik & download data SalesFlow ke Excel</div>
      </div>

      {/* GRID KARTU */}
      {!report && (
        <>
          {visibleReports.length === 0
            ? <div className="card" style={{ color: "var(--sub)" }}>Role kamu belum punya akses ke modul laporan mana pun.</div>
            : <>
                <div style={{ fontSize: 13, color: "var(--sub)", marginBottom: 14 }}>Pilih jenis laporan yang ingin dibuat:</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                  {visibleReports.map((r) => (
                    <div key={r.key} className="card sf-rcard" style={{ margin: 0 }} onClick={() => openReport(r.key)}>
                      <div style={{ width: 46, height: 46, borderRadius: 13, background: r.color + "18", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                        <Icon k={r.icon} color={r.color} />
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)", letterSpacing: "-.2px" }}>{r.label}</div>
                      <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 5, lineHeight: 1.45 }}>{r.desc}</div>
                    </div>
                  ))}
                </div>
              </>}
        </>
      )}

      {/* DETAIL */}
      {report && meta && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <button onClick={backToGrid} className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>← Semua laporan</button>

          <div className="card" style={{ margin: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: meta.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon k={meta.icon} color={meta.color} size={19} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>{meta.label}</div>
                <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 1 }}>{meta.desc}</div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
              <Field label="Dari"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></Field>
              <Field label="Sampai"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} /></Field>
              {meta.filt === "range_channel" && (
                <Field label="Channel">
                  <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 200 }}>
                    <option value="">Semua channel</option>
                    {channels.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
              <button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? "Memproses…" : "Buat Laporan"}</button>
            </div>
          </div>

          {err && <div className="card" style={{ margin: 0, background: "var(--bad-soft)", borderColor: "#E7B7AD", color: "var(--bad)" }}>{err}</div>}

          {result && (result.kind === "summary" ? (
            <SummaryCard result={result} onDownload={() => downloadXlsx(result.filename, result.sheets)} />
          ) : (
            <div className="card" style={{ margin: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>Hasil · {result.body.length.toLocaleString("id-ID")} baris</div>
                <button className="btn btn-primary btn-sm" onClick={() => downloadXlsx(result.filename, result.sheets)}>⬇ Download Excel</button>
              </div>
              {result.body.length === 0
                ? <div style={{ padding: 20, textAlign: "center", color: "var(--sub)" }}>Tidak ada data untuk parameter ini.</div>
                : <div style={{ overflowX: "auto" }}>
                    <table style={{ whiteSpace: "nowrap", fontSize: 12.5, width: "100%" }}>
                      <thead><tr>{result.headers.map((h) => <th key={h} style={{ textAlign: isNumHdr(h) ? "right" : "left", padding: "8px 10px", color: "var(--faint)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".3px", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {result.body.slice(0, 200).map((row, i) => (
                          <tr key={i}>{row.map((c, j) => {
                            const h = result.headers[j]; const money = isMoneyHdr(h), n = isNumHdr(h);
                            return <td key={j} style={{ padding: "7px 10px", textAlign: n ? "right" : "left", borderTop: "1px solid var(--line)", color: "var(--ink)" }}>{money && typeof c === "number" ? fmtIDR(c) : (n && typeof c === "number" ? fmtNum(c) : c)}</td>;
                          })}</tr>
                        ))}
                      </tbody>
                    </table>
                    {result.body.length > 200 && <div style={{ padding: "10px 4px 0", fontSize: 12, color: "var(--sub)" }}>Menampilkan 200 dari {result.body.length.toLocaleString("id-ID")} baris · file Excel berisi semua.</div>}
                  </div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ result, onDownload }) {
  const s = result.summary;
  const Bar = ({ label, color, pcs, pctPcs, net }) => (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, fontSize: 13, marginBottom: 5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink)", fontWeight: 600, minWidth: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: color || "var(--online)", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        </span>
        <span style={{ display: "flex", gap: 14, alignItems: "baseline", flexShrink: 0 }}>
          <b>{fmtNum(pcs)} pcs</b>
          <span style={{ color: "var(--sub)", minWidth: 46, textAlign: "right" }}>{pctPcs.toFixed(1)}%</span>
          <span style={{ color: "var(--faint)", fontSize: 12, minWidth: 104, textAlign: "right" }}>{fmtIDR(net)}</span>
        </span>
      </div>
      <div style={{ height: 7, background: "var(--surface2)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: Math.max(0, Math.min(100, pctPcs)) + "%", height: "100%", background: color || "var(--online)", borderRadius: 6 }} />
      </div>
    </div>
  );
  const Stat = ({ label, value, big }) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 18, fontWeight: 800, color: "var(--ink)", marginTop: 3, letterSpacing: "-.4px" }}>{value}</div>
    </div>
  );
  return (
    <div className="card" style={{ margin: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
          <Stat label="Total pcs terjual" value={fmtNum(s.totPcs) + " pcs"} big />
          <Stat label="Total net penjualan" value={fmtIDR(s.totNet)} big />
          <Stat label="Cakupan" value={s.scope} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={onDownload}>⬇ Download Excel</button>
      </div>

      {s.totPcs === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--sub)" }}>Tidak ada penjualan untuk parameter ini.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 26 }}>
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>Per Kategori Aging</div>
            {s.agingRows.map((r) => <Bar key={r.label} {...r} />)}
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8, lineHeight: 1.5 }}>Umur produk dihitung saat terjual, dari launch date koleksi. Produk tanpa launch date masuk “Tanpa launch date”.</div>
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>Per Channel</div>
            {s.chRows.map((r) => <Bar key={r.label} {...r} color="var(--online)" />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</span>
    {children}
  </div>;
}
