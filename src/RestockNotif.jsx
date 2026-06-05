import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtNum } from "./format.js";

const WINDOW_DAYS = 30;       // window laju jual
const PROD_COVER_WARN = 21;   // cover < ini → produksi segera (merah)
const PROD_COVER_WATCH = 45;  // cover < ini → tampil (pantau); di atas ini = aman, disembunyikan
const STORE_COVER_WARN = 14;  // cover store < ini → restock store
const TARGET_COVER = 30;      // target cover utk hitung qty rekomendasi
const WH_SOURCE = "WH-MAIN";  // sumber stok restock ke store

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const stripSize = (name, size) => {
  if (size && name.toUpperCase().endsWith(" " + size.toUpperCase()))
    return name.slice(0, name.length - size.length - 1).trim();
  return name;
};
const th = { padding: "10px 12px", textAlign: "left" };
const thR = { padding: "10px 12px", textAlign: "right" };
const td = { padding: "9px 12px" };
const tdR = { padding: "9px 12px", textAlign: "right" };
const Badge = ({ tone, children }) => (
  <span className="pill" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>{children}</span>
);

export default function RestockNotif() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [fact, items, prods, stock, loc] = await Promise.all([
          supabase.from("cf_sales_fact").select("sku,qty,net_amount,txn_date,location_id").neq("channel_id", "KOL"),
          supabase.from("sku_items").select("sku,spk_id,product_name_system,size_label").limit(10000),
          supabase.from("sku_products").select("spk_id,product_code,product_name_system,collection_code"),
          supabase.from("v_cf_stock_on_hand").select("sku,location_id,qty"),
          supabase.from("cf_locations").select("location_id,name,type"),
        ]);
        for (const r of [fact, items, prods, stock, loc]) if (r.error) throw r.error;
        setRaw({ fact: fact.data || [], items: items.data || [], prods: prods.data || [], stock: stock.data || [], loc: loc.data || [] });
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const data = useMemo(() => {
    if (!raw) return null;
    const { fact, items, prods, stock, loc } = raw;

    const prodBy = {}; prods.forEach((p) => (prodBy[p.spk_id] = p));
    const master = {};
    items.forEach((it) => {
      const p = prodBy[it.spk_id] || {};
      const size = it.size_label || "";
      master[it.sku] = {
        name: stripSize(p.product_name_system || it.product_name_system || it.sku, size),
        size, code: p.product_code || it.sku, collection: p.collection_code || "—",
      };
    });

    const storeName = {};
    loc.forEach((l) => (storeName[l.location_id] = l.name || l.location_id));
    const sellable = new Set(loc.filter((l) => ["wh_main", "wh_online", "store"].includes(l.type)).map((l) => l.location_id));
    const storeIds = new Set(loc.filter((l) => l.type === "store").map((l) => l.location_id));

    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

    // terjual (net) dalam window: total per sku & per (store,sku)
    const soldTot = {}, soldStore = {};
    fact.forEach((r) => {
      if (!r.txn_date || r.txn_date < cutoff) return;
      const sign = (Number(r.net_amount) || 0) < 0 ? -1 : 1;
      const q = (Number(r.qty) || 0) * sign;
      soldTot[r.sku] = (soldTot[r.sku] || 0) + q;
      if (storeIds.has(r.location_id)) {
        const k = r.location_id + "|" + r.sku;
        soldStore[k] = (soldStore[k] || 0) + q;
      }
    });

    // stok sekarang: total sellable per sku, per store per sku, WH source per sku
    const stockTot = {}, stockStore = {}, stockWH = {};
    stock.forEach((s) => {
      const q = Number(s.qty) || 0;
      const k = s.location_id + "|" + s.sku;
      if (sellable.has(s.location_id)) stockTot[s.sku] = (stockTot[s.sku] || 0) + q;
      if (storeIds.has(s.location_id)) stockStore[k] = (stockStore[k] || 0) + q;
      if (s.location_id === WH_SOURCE) stockWH[s.sku] = (stockWH[s.sku] || 0) + q;
    });

    // ---- Sinyal 1: produksi (per style/product_code) ----
    const styleAgg = {};
    const skusAll = new Set([...Object.keys(master), ...Object.keys(soldTot), ...Object.keys(stockTot)]);
    skusAll.forEach((sku) => {
      const m = master[sku] || { code: sku, name: sku, collection: "—" };
      const a = styleAgg[m.code] || (styleAgg[m.code] = { code: m.code, name: m.name, collection: m.collection, sold: 0, stock: 0 });
      a.sold += soldTot[sku] || 0;
      a.stock += stockTot[sku] || 0;
    });
    const prodRows = Object.values(styleAgg)
      .map((a) => { const vel = a.sold / WINDOW_DAYS; return { ...a, vel, cover: vel > 0 ? a.stock / vel : Infinity }; })
      .filter((a) => a.vel > 0 && a.cover < PROD_COVER_WATCH)
      .sort((x, y) => x.cover - y.cover);

    // ---- Sinyal 2: distribusi (store × sku) ----
    const distRows = [];
    Object.keys(soldStore).forEach((k) => {
      const sold = soldStore[k];
      if (sold <= 0) return;
      const [locId, sku] = k.split("|");
      const vel = sold / WINDOW_DAYS;
      const sStock = stockStore[k] || 0;
      const wh = stockWH[sku] || 0;
      const cover = vel > 0 ? sStock / vel : Infinity;
      if (cover >= STORE_COVER_WARN) return; // stok store masih cukup
      if (wh <= 0) return;                   // WH kosong → tak bisa restock
      const rekom = Math.min(Math.max(0, Math.round(vel * TARGET_COVER) - sStock), wh);
      if (rekom <= 0) return;
      const m = master[sku] || { name: sku };
      distRows.push({ locId, store: storeName[locId] || locId, sku, name: m.name, sold30: sold, sStock, wh, cover, rekom });
    });
    distRows.sort((x, y) => x.cover - y.cover);

    return { prodRows, distRows };
  }, [raw]);

  if (loading) return <div className="center-msg">Memuat sinyal restock…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;

  const prodUrgent = data.prodRows.filter((r) => r.cover < PROD_COVER_WARN).length;

  return (
    <div>
      <h1 className="title">Notifikasi Restock</h1>
      <p className="lead">
        Sinyal otomatis dari laju jual {WINDOW_DAYS} hari terakhir &amp; stok terkini. Cover = stok ÷ laju jual (perkiraan berapa hari lagi habis).
      </p>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span className="section-label">🏭 Restock produksi — laku cepat, stok menipis</span>
          <span className="small muted">{prodUrgent} perlu segera · cover &lt; {PROD_COVER_WARN}h</span>
        </div>
        {data.prodRows.length === 0
          ? <p className="small muted">Tidak ada sinyal produksi — semua style aman (cover &gt; {PROD_COVER_WATCH} hari) atau belum ada penjualan {WINDOW_DAYS} hari terakhir.</p>
          : <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr style={{ background: "var(--paper)" }}>
                  <th style={th}>Produk</th><th style={thR}>Laju/hari</th><th style={thR}>Stok total</th><th style={thR}>Cover</th><th style={thR}>Status</th>
                </tr></thead>
                <tbody>
                  {data.prodRows.map((r) => {
                    const tone = r.cover < PROD_COVER_WARN ? "bad" : r.cover < PROD_COVER_WARN * 2 ? "warn" : "good";
                    const label = tone === "bad" ? "Produksi segera" : tone === "warn" ? "Pantau" : "Aman";
                    return (
                      <tr key={r.code}>
                        <td style={td}>{r.name} <span className="muted" style={{ fontSize: 11 }}>· {r.collection}</span></td>
                        <td style={tdR}>{r.vel.toFixed(1)}</td>
                        <td style={tdR}>{fmtNum(r.stock)}</td>
                        <td style={{ ...tdR, fontWeight: 600, color: `var(--${tone})` }}>{Number.isFinite(r.cover) ? Math.round(r.cover) + " hari" : "—"}</td>
                        <td style={tdR}><Badge tone={tone}>{label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
        <p className="small muted" style={{ marginTop: 10 }}>Tindak lanjut: buat SPK produksi baru di LINEFLOW untuk produk di atas.</p>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span className="section-label">🏬 Restock distribusi ke store — laku di store, stok tipis, WH ada</span>
          <span className="small muted">{data.distRows.length} rekomendasi</span>
        </div>
        {data.distRows.length === 0
          ? <p className="small muted">Tidak ada rekomendasi (stok store masih cukup atau WH kosong).</p>
          : <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr style={{ background: "var(--paper)" }}>
                  <th style={th}>Store</th><th style={th}>SKU</th><th style={thR}>Laku {WINDOW_DAYS}h</th><th style={thR}>Stok store</th><th style={thR}>Stok WH</th><th style={thR}>Rekom kirim</th>
                </tr></thead>
                <tbody>
                  {data.distRows.map((r, i) => (
                    <tr key={i}>
                      <td style={td}>{r.store}</td>
                      <td style={{ ...td, fontFamily: MONO, fontSize: 12 }}>{r.sku}</td>
                      <td style={tdR}>{fmtNum(r.sold30)}</td>
                      <td style={{ ...tdR, fontWeight: 600, color: r.sStock === 0 ? "var(--bad)" : "var(--warn)" }}>{fmtNum(r.sStock)}</td>
                      <td style={tdR}>{fmtNum(r.wh)}</td>
                      <td style={{ ...tdR, fontWeight: 700, color: "var(--good)" }}>+{fmtNum(r.rekom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        <p className="small muted" style={{ marginTop: 10 }}>
          Tindak lanjut: buat Restock di CHANNELFLOW (Linesheet) untuk store di atas. Qty rekomendasi = laju × {TARGET_COVER} hari − stok store, dibatasi stok WH.
        </p>
      </div>
    </div>
  );
}
