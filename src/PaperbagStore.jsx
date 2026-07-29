import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";

const num = (n) => new Intl.NumberFormat("id-ID").format(Number(n) || 0);
const rp = (n) => "Rp " + num(Math.round(Number(n) || 0));
const RESALE = ["PAPERBAG", "SHOPPING_BAG", "MERCHANDISE"];

export default function PaperbagStore({ role }) {
  const [tab, setTab] = useState("input");
  const [stores, setStores] = useState([]);
  const [storeStock, setStoreStock] = useState([]);
  const [items, setItems] = useState([]);
  const [bills, setBills] = useState([]);
  const [cashAccts, setCashAccts] = useState([]);
  const [selCash, setSelCash] = useState("");
  const [email, setEmail] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setEmail(user?.email || "");
    const [sRes, ssRes, bRes, itRes, caRes, accRes] = await Promise.all([
      supabase.from("cf_locations").select("location_id,name,type").eq("type", "store"),
      supabase.from("pkg_store_stock").select("*").order("location_id"),
      supabase.from("pkg_bill").select("*").order("created_at", { ascending: false }),
      supabase.schema("purchasing").from("items").select("code,name,sell_price_store,category").in("category", RESALE),
      supabase.from("fin_cash_accounts").select("id,name,coa_id,kind").eq("is_active", true),
      supabase.from("fin_accounts").select("id,code"),
    ]);
    setStores(sRes.data || []); setStoreStock(ssRes.data || []); setBills(bRes.data || []); setItems(itRes.data || []);
    const codeById = {}; (accRes.data || []).forEach((a) => (codeById[a.id] = a.code));
    const cash = (caRes.data || []).map((c) => ({ ...c, coa_code: codeById[c.coa_id] })).filter((c) => c.coa_code && c.kind !== "talangan");
    setCashAccts(cash); if (cash[0]) setSelCash(cash[0].coa_code);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const storeName = useMemo(() => { const m = {}; stores.forEach((s) => (m[s.location_id] = s.name)); return m; }, [stores]);

  function parseRows() {
    const rows = [];
    (paste || "").split(/\n/).forEach((line) => {
      const t = line.trim(); if (!t) return;
      const p = t.split(/[,\t;]+/).map((x) => x.trim());
      if (p.length < 3) return;
      const qty = Number(p[2]);
      if (!p[0] || !p[1] || !(qty > 0)) return;
      rows.push({ location_id: p[0], item_code: p[1], qty });
    });
    return rows;
  }
  const parsed = parseRows();

  async function submit() {
    if (!from || !to) { setMsg({ t: "err", m: "Isi periode (dari & sampai)." }); return; }
    if (!parsed.length) { setMsg({ t: "err", m: "Tidak ada baris valid. Format tiap baris: STORE, KODE_ITEM, QTY" }); return; }
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("pkg_post_sales", { p_rows: parsed, p_period_start: from, p_period_end: to, p_by: email });
    setBusy(false);
    if (error) { setMsg({ t: "err", m: error.message }); return; }
    setMsg({ t: "ok", m: `Berhasil — ${data} tagihan store dibuat & masuk FinFlow.` });
    setPaste(""); await load(); setTab("bills");
  }
  async function pay(bill) {
    if (!selCash) { setMsg({ t: "err", m: "Pilih akun kas penerima dulu." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("pkg_bill_pay", { p_bill_id: bill.id, p_cash_coa_code: selCash, p_by: email });
    setBusy(false);
    if (error) { setMsg({ t: "err", m: error.message }); return; }
    setMsg({ t: "ok", m: "Tagihan ditandai lunas." }); load();
  }

  const C = "#A84238";
  const tabBtn = (k, label) => (
    <button key={k} onClick={() => setTab(k)} className="btn btn-sm" style={{ background: tab === k ? "#fff" : "transparent", color: "var(--ink)", boxShadow: tab === k ? "var(--shadow)" : "none", fontWeight: 700 }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: 1150, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.3px" }}>Paperbag ke Store</div>
        <div className="small muted" style={{ marginTop: 3 }}>Upload mingguan paperbag keluar per store → kurangi stok store &amp; tagih store. Terpisah dari penjualan produk.</div>
      </div>

      <div style={{ display: "inline-flex", gap: 4, background: "var(--surface2)", padding: 4, borderRadius: 12, marginBottom: 16 }}>
        {tabBtn("input", "Upload")}{tabBtn("bills", `Tagihan${bills.length ? " · " + bills.length : ""}`)}{tabBtn("stock", "Stok Store")}
      </div>

      {msg && <div className="card" style={{ background: msg.t === "err" ? "#FCE7EB" : "#E7F6EC", color: msg.t === "err" ? "#B4232E" : "#166534", padding: "10px 13px", marginBottom: 14 }}>{msg.m}</div>}

      {loading ? <div className="center-msg">Memuat…</div> : (
        <>
          {tab === "input" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
              <div className="card">
                <div style={{ fontWeight: 800, marginBottom: 12 }}>Upload Penjualan Paperbag (per minggu)</div>
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}><label className="small" style={{ fontWeight: 700 }}>Periode dari</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%" }} /></div>
                  <div style={{ flex: 1 }}><label className="small" style={{ fontWeight: 700 }}>sampai</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "100%" }} /></div>
                </div>
                <label className="small" style={{ fontWeight: 700 }}>Data (tempel dari GSheet) — tiap baris: <b>STORE, KODE_ITEM, QTY</b></label>
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={9} placeholder={"STORE-MKS, RSL-PPB-0001, 120\nSTORE-BDG, RSL-PPB-0001, 80"} style={{ width: "100%", fontFamily: "ui-monospace,monospace", fontSize: 13 }} />
                <div className="small muted" style={{ margin: "6px 0 12px" }}>{parsed.length} baris valid terbaca · pemisah boleh koma / tab / titik-koma.</div>
                <button className="btn btn-primary" disabled={busy} onClick={submit} style={{ background: C, borderColor: C }}>{busy ? "Memproses…" : "Proses & Tagih Store"}</button>
              </div>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", fontWeight: 800 }}>Item paperbag (referensi kode)</div>
                <table><thead><tr><th style={{ textAlign: "left" }}>Kode</th><th style={{ textAlign: "left" }}>Nama</th><th className="num">Harga Store</th></tr></thead>
                  <tbody>{items.length === 0 ? <tr><td colSpan={3} className="center-msg">Belum ada item beli-jadi.</td></tr>
                    : items.map((it) => <tr key={it.code}><td className="mono">{it.code}</td><td>{it.name}</td><td className="num">{Number(it.sell_price_store) > 0 ? rp(it.sell_price_store) : "–"}</td></tr>)}</tbody></table>
              </div>
            </div>
          )}

          {tab === "bills" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>Tagihan ke Store</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="small muted">Terima ke:</span>
                  <select value={selCash} onChange={(e) => setSelCash(e.target.value)} style={{ maxWidth: 200 }}>
                    {cashAccts.map((c) => <option key={c.id} value={c.coa_code}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <table>
                <thead><tr><th style={{ textAlign: "left" }}>Store</th><th style={{ textAlign: "left" }}>Periode</th><th className="num">Revenue</th><th className="num">HPP</th><th className="num">Margin</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {bills.length === 0 ? <tr><td colSpan={7} className="center-msg">Belum ada tagihan.</td></tr>
                    : bills.map((b) => {
                      const margin = Number(b.total_revenue) - Number(b.total_cogs);
                      return <tr key={b.id}>
                        <td className="strong">{storeName[b.location_id] || b.location_id}</td>
                        <td className="small">{b.period_start} – {b.period_end}</td>
                        <td className="num">{rp(b.total_revenue)}</td>
                        <td className="num" style={{ color: "var(--sub)" }}>{rp(b.total_cogs)}</td>
                        <td className="num" style={{ fontWeight: 700, color: margin >= 0 ? "#166534" : "#B4232E" }}>{rp(margin)}</td>
                        <td>{b.status === "paid" ? <span className="tag" style={{ background: "#E7F6EC", color: "#166534" }}>Lunas</span> : <span className="tag" style={{ background: "#FFF4D6", color: "#8a5a00" }}>Belum bayar</span>}</td>
                        <td className="num">{b.status !== "paid" && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => pay(b)} style={{ background: C, borderColor: C }}>Tandai Lunas</button>}</td>
                      </tr>;
                    })}
                </tbody>
              </table>
            </div>
          )}

          {tab === "stock" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", fontWeight: 800 }}>Stok Paperbag per Store</div>
              <table><thead><tr><th style={{ textAlign: "left" }}>Store</th><th style={{ textAlign: "left" }}>Kode</th><th style={{ textAlign: "left" }}>Item</th><th className="num">Qty</th></tr></thead>
                <tbody>{storeStock.length === 0 ? <tr><td colSpan={4} className="center-msg">Belum ada stok packaging di store.</td></tr>
                  : storeStock.map((s) => <tr key={s.id}><td>{storeName[s.location_id] || s.location_id}</td><td className="mono">{s.item_code}</td><td>{s.item_name}</td><td className="num" style={{ fontWeight: 700 }}>{num(s.qty)}</td></tr>)}</tbody></table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
