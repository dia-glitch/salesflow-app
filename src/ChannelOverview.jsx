import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtNum, fmtShort } from "./format.js";

const stTone = (p) => p >= 60 ? "var(--good)" : p >= 35 ? "var(--warn)" : "var(--bad)";
const ONLINE = "__ONLINE__";

function statusOf(sold, stock, st) {
  if (stock <= 0 && sold > 0) return { t: "Habis", c: "var(--bad)", s: "var(--bad-soft)" };
  if (st >= 65) return { t: "Understock", c: "var(--warn)", s: "var(--warn-soft)" };
  if (st <= 30) return { t: "Overstock", c: "var(--online)", s: "#E2ECF2" };
  return { t: "Sehat", c: "var(--good)", s: "var(--good-soft)" };
}

export default function ChannelOverview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [fact, ch, loc, stock, items, prods, spks] = await Promise.all([
          supabase.from("cf_sales_fact").select("sku,channel_id,location_id,qty,net_amount"),
          supabase.from("cf_sales_channels").select("channel_id,name,kind"),
          supabase.from("cf_locations").select("location_id,name,type"),
          supabase.from("v_cf_stock_on_hand").select("sku,location_id,qty"),
          supabase.from("sku_items").select("sku,spk_id").limit(10000),
          supabase.from("sku_products").select("spk_id,collection_code"),
          supabase.from("spk_orders").select("collection_code,launch_date"),
        ]);
        for (const r of [fact, ch, loc, stock, items, prods, spks]) if (r.error) throw r.error;
        setRaw({ fact: fact.data || [], ch: ch.data || [], loc: loc.data || [], stock: stock.data || [],
          items: items.data || [], prods: prods.data || [], spks: spks.data || [] });
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const D = useMemo(() => {
    if (!raw) return null;
    const chMap = {}; raw.ch.forEach((c) => (chMap[c.channel_id] = c));
    const locName = {}; const locType = {};
    raw.loc.forEach((l) => { locName[l.location_id] = l.name; locType[l.location_id] = l.type; });

    // sku -> collection
    const collBySpk = {}; raw.prods.forEach((p) => (collBySpk[p.spk_id] = p.collection_code || "—"));
    const skuColl = {}; raw.items.forEach((it) => (skuColl[it.sku] = collBySpk[it.spk_id] || "—"));

    // koleksi terbaru by launch_date
    const collLaunch = {};
    raw.spks.forEach((s) => {
      if (!s.collection_code || !s.launch_date) return;
      if (!collLaunch[s.collection_code] || s.launch_date > collLaunch[s.collection_code])
        collLaunch[s.collection_code] = s.launch_date;
    });
    const newest = Object.entries(collLaunch).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 4)
      .map(([code, date]) => ({ code, date }));

    // buckets: ONLINE + tiap store
    const stores = raw.loc.filter((l) => l.type === "store").map((l) => ({ key: l.location_id, name: l.name }));
    const buckets = [{ key: ONLINE, name: "Online (WH Main)" }, ...stores];
    const isWarehouse = (lid) => locType[lid] === "wh_main" || locType[lid] === "wh_online";
    const isStore = (lid) => locType[lid] === "store";

    const saleBucket = (r) => ((chMap[r.channel_id] || {}).kind === "offline" ? r.location_id : ONLINE);
    const stockBucket = (lid) => (isStore(lid) ? lid : isWarehouse(lid) ? ONLINE : null);

    // agregat per bucket + per (koleksi,bucket)
    const sold = {}, stk = {};
    const soldCB = {}, stkCB = {}; // [coll][bucket]
    let tSold = 0, tStock = 0, onlineStock = 0, offlineStock = 0;

    raw.fact.forEach((r) => {
      const net = Number(r.net_amount) || 0;
      const q = (Number(r.qty) || 0) * (net < 0 ? -1 : 1);
      const b = saleBucket(r);
      sold[b] = (sold[b] || 0) + q; tSold += q;
      const coll = skuColl[r.sku] || "—";
      soldCB[coll] = soldCB[coll] || {}; soldCB[coll][b] = (soldCB[coll][b] || 0) + q;
    });
    raw.stock.forEach((s) => {
      const b = stockBucket(s.location_id);
      const qv = Number(s.qty) || 0;
      if (isWarehouse(s.location_id)) { onlineStock += qv; tStock += qv; }
      else if (isStore(s.location_id)) { offlineStock += qv; tStock += qv; }
      if (!b) return;
      stk[b] = (stk[b] || 0) + qv;
      const coll = skuColl[s.sku] || "—";
      stkCB[coll] = stkCB[coll] || {}; stkCB[coll][b] = (stkCB[coll][b] || 0) + qv;
    });

    const st = (so, sk) => (so + sk > 0 ? (so / (so + sk)) * 100 : 0);
    const ratioRows = buckets.map((b) => {
      const so = sold[b.key] || 0, sk = stk[b.key] || 0;
      return { ...b, sold: so, stock: sk, st: st(so, sk) };
    }).filter((r) => r.sold !== 0 || r.stock !== 0);

    const totalST = st(tSold, tStock);

    const matrix = newest.map((c) => ({
      code: c.code, date: c.date,
      cells: buckets.map((b) => {
        const so = (soldCB[c.code] || {})[b.key] || 0;
        const sk = (stkCB[c.code] || {})[b.key] || 0;
        return { key: b.key, sold: so, stock: sk, st: st(so, sk), has: so + sk > 0 };
      }),
    }));

    return { buckets, ratioRows, matrix, tSold, tStock, onlineStock, offlineStock, totalST, newest };
  }, [raw]);

  if (loading) return <div className="center-msg">Memuat data channel…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;
  if (!D) return null;

  const ratioMax = Math.max(...D.ratioRows.map((r) => r.sold + r.stock), 1);

  return (
    <div>
      <div className="grid4" style={{ marginBottom: 8, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <KPI l="Total terjual" v={fmtNum(D.tSold)} />
        <KPI l="Total stok" v={fmtNum(D.tStock)} />
        <KPI l="Sell-through total" v={Math.round(D.totalST) + "%"} />
        <KPI l="Stok online (WH)" v={fmtNum(D.onlineStock)} />
        <KPI l="Stok offline (store)" v={fmtNum(D.offlineStock)} />
      </div>
      <p className="small muted" style={{ marginBottom: 16 }}>
        Online + reseller + marketplace → stok WH Main · offline → stok store masing-masing.
        Total stok = online + offline (stok transit/lainnya tidak dihitung).
      </p>

      <div className="card">
        <div className="section-label">Inventory ratio per lokasi (sell-through · overstock vs understock)</div>
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Lokasi</th>
              <th className="num">Terjual</th>
              <th className="num">Stok</th>
              <th className="num">Sell-through</th>
              <th style={{ width: "26%" }}></th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {D.ratioRows.sort((a, b) => b.st - a.st).map((r) => {
              const s = statusOf(r.sold, r.stock, r.st);
              return (
                <tr key={r.key}>
                  <td className="strong">{r.name}</td>
                  <td className="num">{fmtNum(r.sold)}</td>
                  <td className="num">{fmtNum(r.stock)}</td>
                  <td className="num" style={{ color: stTone(r.st), fontWeight: 500 }}>{Math.round(r.st)}%</td>
                  <td><div className="track"><div className="fill" style={{ width: Math.min(100, r.st) + "%", background: stTone(r.st) }} /></div></td>
                  <td><span className="pill" style={{ background: s.s, color: s.c }}>{s.t}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 10 }}>
          Understock (ST tinggi, stok menipis) = pertimbangkan restock · Overstock (ST rendah, stok menumpuk) = tahan/markdown.
        </p>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 0" }}>
          <div className="section-label">Sell-through 4 koleksi terbaru per channel</div>
          <p className="small muted" style={{ marginTop: 4 }}>Acuan alokasi/distribusi produk upcoming.</p>
        </div>
        <div style={{ overflowX: "auto", padding: "10px 18px 18px" }}>
          {D.matrix.length === 0 ? (
            <p className="small muted">Belum ada koleksi dengan launch date.</p>
          ) : (
            <table>
              <thead>
                <tr style={{ background: "var(--paper)" }}>
                  <th style={{ padding: "8px 10px" }}>Koleksi</th>
                  {D.buckets.map((b) => (
                    <th key={b.key} style={{ padding: "8px 10px", textAlign: "center" }}>{b.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {D.matrix.map((row) => (
                  <tr key={row.code}>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ fontWeight: 500 }}>{row.code}</div>
                      <div className="small muted">{row.date}</div>
                    </td>
                    {row.cells.map((c) => (
                      <td key={c.key} style={{ padding: "8px 10px", textAlign: "center" }}>
                        {c.has ? (
                          <div>
                            <div style={{ fontWeight: 500, color: stTone(c.st) }}>{Math.round(c.st)}%</div>
                            <div className="small muted">{fmtNum(c.sold)}/{fmtNum(c.sold + c.stock)}</div>
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
