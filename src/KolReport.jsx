import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { loadHiddenSkus, rejectHidden } from "./hiddenData.js";
import { fmtIDR, fmtNum, dShort, cleanName } from "./format.js";

const KOL_CH = "KOL";

function recipientOf(stid) {
  const s = String(stid || "");
  if (!s.startsWith("KOL-")) return "—";
  const p = s.split("-");
  if (p.length < 4) return p[1] || "—";
  return p.slice(1, p.length - 2).join("-") || "—"; // slug penerima (stamp & idx di belakang)
}

export default function KolReport() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState(null);
  const [fRecv, setFRecv] = useState("");
  const [fMonth, setFMonth] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [fact, items, prods, prc, loc] = await Promise.all([
          supabase.from("cf_sales_fact").select("txn_date,sku,qty,retail_price,location_id,source_txn_id").eq("channel_id", KOL_CH).order("txn_date", { ascending: false }),
          supabase.from("sku_items").select("sku,spk_id,product_name_system,size_label,colour_lv2").limit(10000),
          supabase.from("sku_products").select("spk_id,product_code,product_name_system,collection_code"),
          supabase.from("cogm_retail_prices").select("spk_id,cogm,cogm_final,retail_price"),
          supabase.from("cf_locations").select("location_id,name"),
        ]);
        for (const r of [fact, items, prods, prc, loc]) if (r.error) throw r.error;
        await loadHiddenSkus(); fact.data = rejectHidden(fact.data);
        setRaw({ fact: fact.data || [], items: items.data || [], prods: prods.data || [], prc: prc.data || [], loc: loc.data || [] });
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const data = useMemo(() => {
    if (!raw) return null;
    const { fact, items, prods, prc, loc } = raw;
    const prodBy = {}; prods.forEach((p) => (prodBy[p.spk_id] = p));
    const prcBy = {}; prc.forEach((p) => (prcBy[p.spk_id] = p));
    const itemBy = {}; items.forEach((it) => (itemBy[it.sku] = it));
    const locName = {}; loc.forEach((l) => (locName[l.location_id] = l.name || l.location_id));

    const rows = fact.map((f) => {
      const it = itemBy[f.sku] || {};
      const p = prodBy[it.spk_id] || {};
      const pr = prcBy[it.spk_id] || {};
      const name = cleanName(p.product_name_system || it.product_name_system || f.sku, it.size_label, it.colour_lv2);
      const cogm = Number(pr.cogm_final ?? pr.cogm ?? 0) || 0;
      const retail = Number(f.retail_price ?? pr.retail_price ?? 0) || 0;
      const qty = Number(f.qty) || 0;
      return {
        date: f.txn_date, recv: recipientOf(f.source_txn_id), sku: f.sku, name,
        qty, cogm, mkt: qty * cogm, retailVal: qty * retail, loc: locName[f.location_id] || f.location_id || "—",
      };
    });
    const recipients = [...new Set(rows.map((r) => r.recv))].sort();
    const filtered = rows.filter((r) => {
      if (fRecv && r.recv !== fRecv) return false;
      if (fMonth && !(r.date || "").startsWith(fMonth)) return false;
      return true;
    });
    const tot = filtered.reduce((a, r) => ({ qty: a.qty + r.qty, mkt: a.mkt + r.mkt, retail: a.retail + r.retailVal }), { qty: 0, mkt: 0, retail: 0 });
    return { rows, filtered, recipients, tot };
  }, [raw, fRecv, fMonth]);

  function exportCsv() {
    const head = ["Tanggal", "Penerima", "SKU", "Produk", "Qty", "COGM/unit", "Biaya marketing", "Nilai retail", "Lokasi"];
    const out = [head.join(",")];
    data.filtered.forEach((r) => {
      out.push([r.date, r.recv, r.sku, r.name, r.qty, r.cogm, r.mkt, r.retailVal, r.loc]
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob(["\uFEFF" + out.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kol-giveaway-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <div className="center-msg">Memuat data KOL…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;

  const stat = (label, val) => (
    <div>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>{val}</div>
    </div>
  );

  return (
    <div>
      <h1 className="title">KOL / Giveaway</h1>
      <p className="lead">Barang yang keluar ke KOL (nilai jual Rp 0, diskon 100%). Biaya marketing = qty × COGM.</p>

      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 20, marginBottom: 16 }}>
        {stat("Transaksi", fmtNum(data.filtered.length))}
        {stat("Unit keluar", fmtNum(data.tot.qty))}
        {stat("Biaya marketing (COGM)", fmtIDR(data.tot.mkt))}
        {stat("Nilai retail", fmtIDR(data.tot.retail))}
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <div>
            <label>Penerima</label>
            <select value={fRecv} onChange={(e) => setFRecv(e.target.value)}>
              <option value="">Semua</option>
              {data.recipients.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </div>
          <div>
            <label>Bulan</label>
            <input type="month" value={fMonth} onChange={(e) => setFMonth(e.target.value)} />
          </div>
          {(fRecv || fMonth) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setFRecv(""); setFMonth(""); }}>Reset</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={exportCsv} disabled={!data.filtered.length}>↓ Unduh CSV</button>
        </div>

        {data.filtered.length === 0 ? (
          <p className="small muted">Belum ada barang keluar ke KOL{(fRecv || fMonth) ? " untuk filter ini" : ""}.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ padding: "10px 12px" }}>Tanggal</th>
                  <th style={{ padding: "10px 12px" }}>Penerima</th>
                  <th style={{ padding: "10px 12px" }}>SKU</th>
                  <th style={{ padding: "10px 12px" }}>Produk</th>
                  <th style={{ padding: "10px 12px" }} className="num">Qty</th>
                  <th style={{ padding: "10px 12px" }} className="num">COGM/unit</th>
                  <th style={{ padding: "10px 12px" }} className="num">Biaya mkt</th>
                  <th style={{ padding: "10px 12px" }} className="num">Nilai retail</th>
                  <th style={{ padding: "10px 12px" }}>Lokasi</th>
                </tr>
              </thead>
              <tbody>
                {data.filtered.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "9px 12px" }} className="muted">{dShort(r.date)}</td>
                    <td style={{ padding: "9px 12px" }}>{r.recv}</td>
                    <td style={{ padding: "9px 12px" }}>{r.sku}</td>
                    <td style={{ padding: "9px 12px" }} className="strong">{r.name}</td>
                    <td style={{ padding: "9px 12px" }} className="num">{fmtNum(r.qty)}</td>
                    <td style={{ padding: "9px 12px" }} className="num muted">{r.cogm ? fmtIDR(r.cogm) : "—"}</td>
                    <td style={{ padding: "9px 12px" }} className="num">{fmtIDR(r.mkt)}</td>
                    <td style={{ padding: "9px 12px" }} className="num muted">{fmtIDR(r.retailVal)}</td>
                    <td style={{ padding: "9px 12px" }} className="muted">{r.loc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          CSV mengekspor semua baris sesuai filter. Penerima diambil dari input saat giveaway (karakter khusus seperti @/spasi tersimpan jadi “_”).
        </p>
      </div>
    </div>
  );
}
