import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, fmtNum, fmtShort, cleanName } from "./format.js";

const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 86400000);
};
const plusDays = (iso, n) => {
  const d = new Date(iso); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const stScore = (p) =>
  p >= 60 ? { t: "Excellent", c: "var(--good)", s: "var(--good-soft)" }
  : p >= 35 ? { t: "Good", c: "var(--warn)", s: "var(--warn-soft)" }
  : { t: "Poor", c: "var(--bad)", s: "var(--bad-soft)" };

export default function CollectionPerf() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState(null);
  const [coll, setColl] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [fact, items, prods, prices, spks, stock, loc, imgs] = await Promise.all([
          supabase.from("cf_sales_fact").select("sku,qty,net_amount,txn_date").neq("channel_id", "KOL"),
          supabase.from("sku_items").select("sku,spk_id").limit(10000),
          supabase.from("sku_products").select("spk_id,product_code,product_name_system,collection_code,colour_lv2"),
          supabase.from("cogm_retail_prices").select("spk_id,cogm,cogm_final,retail_price"),
          supabase.from("spk_orders").select("collection_code,designer,launch_date"),
          supabase.from("v_cf_stock_on_hand").select("sku,location_id,qty"),
          supabase.from("cf_locations").select("location_id,type"),
          supabase.from("product_images").select("product_code,image_url"),
        ]);
        for (const r of [fact, items, prods, prices, spks, stock, loc, imgs]) if (r.error) throw r.error;
        setRaw({ fact: fact.data || [], items: items.data || [], prods: prods.data || [],
          prices: prices.data || [], spks: spks.data || [], stock: stock.data || [],
          loc: loc.data || [], imgs: imgs.data || [] });
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const base = useMemo(() => {
    if (!raw) return null;
    const prodBy = {}; raw.prods.forEach((p) => (prodBy[p.spk_id] = p));
    const priceBy = {}; raw.prices.forEach((p) => (priceBy[p.spk_id] = p));
    const imgBy = {}; raw.imgs.forEach((x) => (imgBy[x.product_code] = x.image_url));
    const sellable = new Set(raw.loc.filter((l) => ["wh_main", "wh_online", "store"].includes(l.type)).map((l) => l.location_id));

    // sku -> {collection, code, name, cogm, retail}
    const sku = {};
    raw.items.forEach((it) => {
      const p = prodBy[it.spk_id] || {};
      const pr = priceBy[it.spk_id] || {};
      sku[it.sku] = {
        coll: p.collection_code || "—", code: p.product_code || it.sku,
        name: cleanName(p.product_name_system || it.sku, "", p.colour_lv2),
        cogm: Number(pr.cogm_final ?? pr.cogm ?? 0) || 0,
        retail: Number(pr.retail_price ?? 0) || 0,
      };
    });

    // koleksi -> launch (min) + designer
    const collMeta = {};
    raw.spks.forEach((s) => {
      if (!s.collection_code) return;
      const m = collMeta[s.collection_code] || { launch: null, designer: null };
      if (s.launch_date && (!m.launch || s.launch_date < m.launch)) m.launch = s.launch_date;
      if (!m.designer && s.designer) m.designer = s.designer;
      collMeta[s.collection_code] = m;
    });

    const collections = [...new Set(raw.prods.map((p) => p.collection_code).filter(Boolean))]
      .sort((a, b) => ((collMeta[b]?.launch || "") < (collMeta[a]?.launch || "") ? -1 : 1));

    return { sku, collMeta, imgBy, sellable, collections };
  }, [raw]);

  useEffect(() => {
    if (base && !coll && base.collections.length) setColl(base.collections[0]);
  }, [base, coll]);

  const D = useMemo(() => {
    if (!base || !coll) return null;
    const { sku, collMeta, imgBy, sellable } = base;
    const launch = collMeta[coll]?.launch || null;
    const cut1m = launch ? plusDays(launch, 30) : null;

    const soldBy = {}, sold1mBy = {}, revBy = {}, stockBy = {};
    raw.fact.forEach((r) => {
      if ((sku[r.sku]?.coll) !== coll) return;
      const net = Number(r.net_amount) || 0;
      const q = (Number(r.qty) || 0) * (net < 0 ? -1 : 1);
      soldBy[r.sku] = (soldBy[r.sku] || 0) + q;
      revBy[r.sku] = (revBy[r.sku] || 0) + net;
      if (cut1m && r.txn_date <= cut1m) sold1mBy[r.sku] = (sold1mBy[r.sku] || 0) + q;
    });
    raw.stock.forEach((s) => {
      if ((sku[s.sku]?.coll) !== coll) return;
      if (!sellable.has(s.location_id)) return;
      stockBy[s.sku] = (stockBy[s.sku] || 0) + (Number(s.qty) || 0);
    });

    // per product_code
    const byCode = {};
    const codeRetail = {};
    Object.keys(sku).forEach((k) => {
      if (sku[k].coll !== coll) return;
      const c = sku[k].code;
      byCode[c] = byCode[c] || { sold: 0, sold1m: 0, stock: 0, cogm: 0, rev: 0, name: sku[k].name };
      byCode[c].sold += soldBy[k] || 0;
      byCode[c].sold1m += sold1mBy[k] || 0;
      byCode[c].stock += stockBy[k] || 0;
      byCode[c].cogm += (sku[k].cogm || 0) * (soldBy[k] || 0);
      byCode[c].rev += revBy[k] || 0;
      codeRetail[c] = sku[k].retail || codeRetail[c] || 0;
    });

    const codes = Object.keys(byCode);
    let totalSold = 0, total1m = 0, totalStock = 0, totalCOGM = 0, totalRev = 0, retailValue = 0;
    codes.forEach((c) => {
      totalSold += byCode[c].sold; total1m += byCode[c].sold1m; totalStock += byCode[c].stock;
      totalCOGM += byCode[c].cogm; totalRev += byCode[c].rev;
      retailValue += (codeRetail[c] || 0) * byCode[c].sold;
    });
    const received = totalSold + totalStock;
    const sellThrough = received > 0 ? (totalSold / received) * 100 : 0;
    const avgRetail = codes.length ? codes.reduce((a, c) => a + (codeRetail[c] || 0), 0) / codes.length : 0;
    const avgQty = codes.length ? totalSold / codes.length : 0;

    const prods = codes.map((c) => {
      const b = byCode[c];
      const st = (b.sold + b.stock) > 0 ? (b.sold / (b.sold + b.stock)) * 100 : 0;
      return { code: c, name: b.name, sold: b.sold, stock: b.stock, st };
    }).sort((a, b) => b.sold - a.sold);

    return {
      launch, designer: collMeta[coll]?.designer || "—",
      lifetime: daysSince(launch),
      products: codes.length, totalSold, total1m, totalStock, totalCOGM, totalRev, retailValue,
      received, sellThrough, avgRetail, avgQty,
      pctToDate: received > 0 ? (totalSold / received) * 100 : 0,
      pct1m: received > 0 ? (total1m / received) * 100 : 0,
      prods,
    };
  }, [base, coll, raw]);

  if (loading) return <div className="center-msg">Memuat data koleksi…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;
  if (!base) return null;

  return (
    <div>
      <h1 className="title">Collection Performance</h1>
      <p className="lead">Performa per koleksi · metrik aktual (Plan/budget belum tersedia).</p>

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 220 }}>
            <label>Koleksi</label>
            <select value={coll} onChange={(e) => setColl(e.target.value)}>
              {base.collections.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        </div>
      </div>

      {!D ? null : (() => {
        const sc = stScore(D.sellThrough);
        const life = D.lifetime == null ? "—" : D.lifetime < 0 ? "belum launch" : D.lifetime + " hari";
        return (
          <>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 24, fontWeight: 600 }}>{coll}</div>
                  <div style={{ display: "flex", gap: 28, marginTop: 10, flexWrap: "wrap" }}>
                    <Meta k="Designer" v={D.designer} />
                    <Meta k="Launch date" v={D.launch || "—"} />
                    <Meta k="Lifetime" v={life} />
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="small muted">Sell-through score</div>
                  <span className="pill" style={{ background: sc.s, color: sc.c, fontSize: 14, marginTop: 4 }}>
                    {Math.round(D.sellThrough)}% · {sc.t}
                  </span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-label">Overview (actual)</div>
              <div className="grid3" style={{ marginTop: 12 }}>
                <Mini l="#Products" v={fmtNum(D.products)} />
                <Mini l="Total qty" v={fmtNum(D.totalSold)} />
                <Mini l="Avg qty / product" v={fmtNum(Math.round(D.avgQty))} />
                <Mini l="Total COGM" v={fmtShort(D.totalCOGM)} />
                <Mini l="Total value retail" v={fmtShort(D.retailValue)} />
                <Mini l="Avg retail price" v={fmtIDR(Math.round(D.avgRetail))} />
              </div>
            </div>

            <div className="card">
              <div className="section-label">Sales</div>
              <div style={{ marginTop: 12 }}>
                <SalesRow label="Qty sold 1st month" qty={D.total1m} pct={D.pct1m} />
                <SalesRow label="Qty sold to date" qty={D.totalSold} pct={D.pctToDate} />
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>
                % dihitung terhadap stok masuk (terjual + stok terkini).
              </p>
            </div>

            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="section-label">Semua produk</span>
                <span className="small muted">{fmtNum(D.prods.length)} produk · urut terlaris</span>
              </div>
              {D.prods.length === 0 ? (
                <p className="small muted" style={{ marginTop: 10 }}>Belum ada produk pada koleksi ini.</p>
              ) : (
                <div className="grid2" style={{ marginTop: 12 }}>
                  {D.prods.map((p) => (<ProdCell key={p.code} p={p} img={base.imgBy[p.code]} />))}
                </div>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}

const Meta = ({ k, v }) => (
  <div>
    <div className="small muted">{k}</div>
    <div style={{ fontWeight: 500 }}>{v}</div>
  </div>
);
const ProdCell = ({ p, img }) => {
  const sc = stScore(p.st);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}>
      <div style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0,
        background: img ? `center/cover no-repeat url(${img})` : "var(--paper)", border: "1px solid var(--line)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
        <div className="small muted">{p.code} · {fmtNum(p.sold)} terjual · sisa {fmtNum(p.stock)}</div>
        <div className="track" style={{ marginTop: 6 }}>
          <div className="fill" style={{ width: Math.min(100, p.st) + "%", background: sc.c }} />
        </div>
      </div>
      <div style={{ fontWeight: 600, color: sc.c, minWidth: 42, textAlign: "right" }}>{Math.round(p.st)}%</div>
    </div>
  );
};
const Mini = ({ l, v }) => (
  <div style={{ background: "var(--paper)", borderRadius: 8, padding: "10px 12px" }}>
    <div className="small muted">{l}</div>
    <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 600 }}>{v}</div>
  </div>
);
const SalesRow = ({ label, qty, pct }) => (
  <div className="bar">
    <div className="row"><span className="nm">{label}</span>
      <span className="rt">{fmtNum(qty)} · <b>{Math.round(pct)}%</b></span></div>
    <div className="track"><div className="fill" style={{ width: Math.min(100, pct) + "%", background: "var(--accent)" }} /></div>
  </div>
);
