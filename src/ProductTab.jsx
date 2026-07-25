import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtShort, fmtNum } from "./format.js";

const stripSize = (name, size) => {
  if (size && name.toUpperCase().endsWith(" " + size.toUpperCase()))
    return name.slice(0, name.length - size.length - 1).trim();
  return name;
};
const stTone = (p) => p >= 60 ? "var(--good)" : p >= 35 ? "var(--warn)" : "var(--bad)";

// Kategori koleksi dari prefix kode (CR-001 → Core). Prefix tak dikenal → tampil apa adanya.
const COLL_CAT = { CR: "Core", RY: "Raya", ES: "Esense" };
const collCat = (code) => {
  const m = String(code || "").match(/^[A-Za-z]+/);
  const p = m ? m[0].toUpperCase() : "";
  return COLL_CAT[p] || (p || "—");
};

export default function ProductTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [skuAgg, setSkuAgg] = useState([]); // {sku,name,code,collection,cat1,size,sold,stock,rev,cost}
  const [imgMap, setImgMap] = useState({});

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [fact, items, prods, prices, stock, loc, imgs] = await Promise.all([
          supabase.from("cf_sales_fact").select("sku,qty,net_amount").neq("channel_id", "KOL"),
          supabase.from("sku_items").select("sku,spk_id,product_name_system,size_label").limit(10000),
          supabase.from("sku_products").select("spk_id,product_code,product_name_system,collection_code,category_lv1,category_lv2"),
          supabase.from("cogm_retail_prices").select("spk_id,cogm,cogm_final"),
          supabase.from("v_cf_stock_on_hand").select("sku,location_id,qty"),
          supabase.from("cf_locations").select("location_id,type"),
          supabase.from("product_images").select("product_code,image_url"),
        ]);
        for (const r of [fact, items, prods, prices, stock, loc, imgs]) if (r.error) throw r.error;
        const im = {}; (imgs.data || []).forEach((x) => (im[x.product_code] = x.image_url));
        setImgMap(im);

        const prodBy = {}; (prods.data || []).forEach((p) => (prodBy[p.spk_id] = p));
        const priceBy = {}; (prices.data || []).forEach((p) => (priceBy[p.spk_id] = p));
        const master = {};
        (items.data || []).forEach((it) => {
          const p = prodBy[it.spk_id] || {};
          const pr = priceBy[it.spk_id] || {};
          const size = it.size_label || "";
          const name = stripSize(p.product_name_system || it.product_name_system || it.sku, size);
          master[it.sku] = {
            name, size,
            code: p.product_code || it.sku,
            collection: p.collection_code || "—",
            cat1: p.category_lv1 || "—",
            cogm: Number(pr.cogm_final ?? pr.cogm ?? 0) || 0,
          };
        });

        const soldBy = {}, revBy = {};
        (fact.data || []).forEach((r) => {
          const net = Number(r.net_amount) || 0;
          const q = (Number(r.qty) || 0) * (net < 0 ? -1 : 1);
          soldBy[r.sku] = (soldBy[r.sku] || 0) + q;
          revBy[r.sku] = (revBy[r.sku] || 0) + net;
        });
        const sellable = new Set(
          (loc.data || []).filter((l) => ["wh_main", "wh_online", "store"].includes(l.type)).map((l) => l.location_id)
        );
        const stockBy = {};
        (stock.data || []).forEach((s) => {
          if (!sellable.has(s.location_id)) return;
          stockBy[s.sku] = (stockBy[s.sku] || 0) + (Number(s.qty) || 0);
        });

        const allSkus = new Set([...Object.keys(master), ...Object.keys(soldBy), ...Object.keys(stockBy)]);
        const agg = [];
        allSkus.forEach((sku) => {
          const mst = master[sku] || { name: sku, size: "", code: sku, collection: "—", cat1: "—", cogm: 0 };
          const sold = soldBy[sku] || 0;
          const stk = stockBy[sku] || 0;
          agg.push({
            sku, name: mst.name, code: mst.code, collection: mst.collection, cat1: mst.cat1, size: mst.size,
            sold, stock: stk, rev: revBy[sku] || 0, cost: mst.cogm * sold,
          });
        });
        setSkuAgg(agg);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const data = useMemo(() => {
    const st = (sold, stock) => (sold + stock > 0 ? (sold / (sold + stock)) * 100 : 0);

    let tSold = 0, tStock = 0, tRev = 0, tCost = 0;
    const byColl = {}, byProd = {}, bySize = {}, byCat = {}, byCollCat = {};
    const styles = new Set();
    skuAgg.forEach((r) => {
      tSold += r.sold; tStock += r.stock; tRev += r.rev; tCost += r.cost;
      if (r.sold > 0 || r.stock > 0) styles.add(r.code);
      const acc = (obj, key) => {
        obj[key] = obj[key] || { sold: 0, stock: 0, rev: 0, cost: 0, name: r.name };
        obj[key].sold += r.sold; obj[key].stock += r.stock; obj[key].rev += r.rev; obj[key].cost += r.cost;
      };
      acc(byColl, r.collection);
      acc(byProd, r.code);
      acc(bySize, r.size || "—");
      acc(byCat, r.cat1);
      acc(byCollCat, collCat(r.collection));
    });

    const toArr = (obj) => Object.entries(obj).map(([k, v]) => ({
      key: k, ...v, st: st(v.sold, v.stock),
      margin: v.rev > 0 ? ((v.rev - v.cost) / v.rev) * 100 : 0,
    }));

    const colls = toArr(byColl).sort((a, b) => b.st - a.st);
    const prods = toArr(byProd).filter((p) => p.sold + p.stock > 0);
    const best = [...prods].sort((a, b) => b.st - a.st).slice(0, 10);
    const slow = [...prods].sort((a, b) => a.st - b.st).slice(0, 10);
    const sizes = toArr(bySize).filter((s) => s.key !== "—").sort((a, b) => b.st - a.st);
    const cats = toArr(byCat).filter((c) => c.key !== "—").sort((a, b) => b.st - a.st);
    const collCats = toArr(byCollCat).filter((c) => c.key !== "—").sort((a, b) => b.st - a.st);

    return {
      avgST: st(tSold, tStock), tSold, tStock,
      avgMargin: tRev > 0 ? ((tRev - tCost) / tRev) * 100 : 0,
      styles: styles.size,
      colls: colls.slice(0, 10), cogmColls: [...colls].sort((a, b) => b.margin - a.margin).slice(0, 10),
      best, slow, sizes, cats, collCats,
    };
  }, [skuAgg]);

  if (loading) return <div className="center-msg">Memuat data produk…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;

  return (
    <div>
      <div className="grid4" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <KPI l="Avg sell-through" v={Math.round(data.avgST) + "%"} />
        <KPI l="Unit terjual" v={fmtNum(data.tSold)} />
        <KPI l="Stok sisa" v={fmtNum(data.tStock)} />
        <KPI l="Avg margin" v={Math.round(data.avgMargin) + "%"} />
        <KPI l="Active styles" v={fmtNum(data.styles)} />
      </div>

      <p className="small muted" style={{ marginTop: -4, marginBottom: 14 }}>
        Kumulatif (sepanjang waktu) · sell-through = terjual ÷ (terjual + stok terkini)
      </p>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span className="section-label">Sell-through per kategori koleksi</span>
          <span className="small muted">Core · Raya · Esense · dst</span>
        </div>
        {data.collCats.length === 0 ? <p className="small muted">—</p> :
          data.collCats.map((c) => (
            <STBar key={c.key} label={c.key} sub={`${fmtNum(c.sold)} / ${fmtNum(c.sold + c.stock)}`} pct={c.st} color={stTone(c.st)} />
          ))}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span className="section-label">Sell-through per koleksi</span>
          <span className="small muted">tertinggi → terendah</span>
        </div>
        {data.colls.map((c) => (
          <STBar key={c.key} label={c.key} sub={`${fmtNum(c.sold)} / ${fmtNum(c.sold + c.stock)}`} pct={c.st} color={stTone(c.st)} />
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="section-label">Best seller — sell-through tertinggi (top 10)</div>
          <div style={{ marginTop: 12 }}>
            {data.best.map((p) => (
              <STBar key={p.key} hasThumb img={imgMap[p.key]} label={p.name} sub={`${fmtNum(p.sold)} terjual`} pct={p.st} color="var(--good)" />
            ))}
          </div>
        </div>
        <div className="card">
          <div className="section-label">Slow moving — sell-through terendah (top 10)</div>
          <div style={{ marginTop: 12 }}>
            {data.slow.map((p) => (
              <STBar key={p.key} hasThumb img={imgMap[p.key]} label={p.name} sub={`sisa ${fmtNum(p.stock)}`} pct={p.st} color={stTone(p.st)} />
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-label">Performa margin per koleksi</div>
        <div style={{ marginTop: 12 }}>
          {data.cogmColls.map((c) => (
            <STBar key={c.key} label={c.key} sub={`rev ${fmtShort(c.rev)}`} pct={Math.max(0, Math.round(c.margin))} color="#17171A" suffix="margin" />
          ))}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="section-label">Sell-through per size</div>
          <div style={{ marginTop: 12 }}>
            {data.sizes.length === 0 ? <p className="small muted">—</p> :
              data.sizes.map((s) => (
                <STBar key={s.key} label={s.key} sub={`${fmtNum(s.sold)} terjual`} pct={s.st} color="#71717A" />
              ))}
          </div>
        </div>
        <div className="card">
          <div className="section-label">Sell-through per kategori</div>
          <div style={{ marginTop: 12 }}>
            {data.cats.length === 0 ? <p className="small muted">—</p> :
              data.cats.map((c) => (
                <STBar key={c.key} label={c.key} sub={`${fmtNum(c.sold)} terjual`} pct={c.st} color={stTone(c.st)} />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const KPI = ({ l, v }) => (
  <div className="card kpi" style={{ margin: 0 }}>
    <p className="l">{l}</p>
    <p className="v">{v}</p>
  </div>
);

const STBar = ({ label, sub, pct, color, suffix, img, hasThumb }) => (
  <div className="bar">
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {hasThumb && (
        <div style={{ width: 38, height: 38, borderRadius: 7, flexShrink: 0,
          background: img ? `center/cover no-repeat url(${img})` : "var(--paper)", border: "1px solid var(--line)" }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row">
          <span className="nm">{label}</span>
          <span className="rt">{sub ? sub + " · " : ""}<b style={{ color }}>{Math.round(pct)}%</b>{suffix ? " " + suffix : ""}</span>
        </div>
        <div className="track"><div className="fill" style={{ width: Math.min(100, pct) + "%", background: color }} /></div>
      </div>
    </div>
  </div>
);
