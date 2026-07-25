import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, fmtNum } from "./format.js";
import { canAct } from "./permissions.js";

/* ---------- date helpers (Senin–Minggu) ---------- */
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const dLabel = (d) => `${d.getDate()} ${MON[d.getMonth()]}`;
function mondayOf(dt) { const x = new Date(dt); const off = (x.getDay() + 6) % 7; x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0); return x; }
function buildWeeks(n) {
  const out = []; let m = mondayOf(new Date());
  for (let i = 0; i < n; i++) {
    const s = new Date(m), e = new Date(m); e.setDate(e.getDate() + 6);
    out.push({ start: iso(s), end: iso(e), label: `${dLabel(s)} – ${dLabel(e)} ${e.getFullYear()}` });
    m.setDate(m.getDate() - 7);
  }
  return out;
}

/* ---------- margin classification ---------- */
function classify(retail, sale, priceTiers, discTiers) {
  const r = Number(retail) || 0, s = Number(sale) || 0;
  const disc = r > 0 ? (r - s) / r : 0;
  if (r > 0 && disc >= 0.05) {
    let tier = Math.round(disc * 10) * 10;
    if (tier < 10) tier = 10; if (tier > 50) tier = 50;
    const row = discTiers.find((t) => Number(t.disc_pct) === tier);
    return { pct: row ? Number(row.margin_pct) : 0, kind: "disc", discPct: tier };
  }
  const base = s > 0 ? s : r;
  const sorted = [...priceTiers].sort((a, b) => Number(b.min_price) - Number(a.min_price));
  const row = sorted.find((t) => base >= Number(t.min_price)) || sorted[sorted.length - 1];
  return { pct: row ? Number(row.margin_pct) : 0, kind: "tier", discPct: null };
}

export default function Penagihan({ role }) {
  const weeks = useMemo(() => buildWeeks(14), []);
  const [view, setView] = useState("invoice");     // 'invoice' | 'setting'
  const [stores, setStores] = useState([]);
  const [store, setStore] = useState("");
  const [wIdx, setWIdx] = useState(1);              // default minggu lalu (index 1)
  const [priceTiers, setPriceTiers] = useState([]);
  const [discTiers, setDiscTiers] = useState([]);
  const [rows, setRows] = useState([]);             // cf_sales_fact untuk periode
  const [existing, setExisting] = useState(null);   // invoice yang sudah ada
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const canSubmit = canAct(role, "ar");

  /* ---- initial ---- */
  useEffect(() => {
    (async () => {
      const [locRes, ptRes, dtRes] = await Promise.all([
        supabase.from("cf_locations").select("location_id,name").order("name"),
        supabase.from("sf_margin_price_tiers").select("*").order("min_price"),
        supabase.from("sf_margin_disc_tiers").select("*").order("disc_pct"),
      ]);
      const locs = locRes.data || [];
      setStores(locs); setStore(locs[0]?.location_id || "");
      setPriceTiers(ptRes.data || []); setDiscTiers(dtRes.data || []);
      setLoading(false);
    })();
  }, []);

  const wk = weeks[wIdx];

  /* ---- load penjualan + invoice existing per store/week ---- */
  useEffect(() => {
    if (!store || !wk) return;
    let live = true;
    (async () => {
      setMsg(null);
      const [fRes, iRes] = await Promise.all([
        supabase.from("cf_sales_fact")
          .select("sku,qty,retail_price,sale_at_price,net_amount,txn_date,location_id")
          .eq("location_id", store).gte("txn_date", wk.start).lte("txn_date", wk.end),
        supabase.from("sf_ar_invoices").select("*").eq("location_id", store).eq("period_start", wk.start).maybeSingle(),
      ]);
      if (!live) return;
      setRows(fRes.data || []);
      setExisting(iRes.data || null);
    })();
    return () => { live = false; };
  }, [store, wk?.start]);

  /* ---- compute lines (agregasi per sku|retail|sale|retur) ---- */
  const { lines, tot } = useMemo(() => {
    const g = {};
    for (const r of rows) {
      const saleAmt = Number(r.net_amount) || 0;
      const isRet = saleAmt < 0;
      const key = `${r.sku}|${r.retail_price}|${r.sale_at_price}|${isRet ? "R" : "S"}`;
      const o = g[key] || (g[key] = { sku: r.sku, retail: Number(r.retail_price) || 0, sale: Number(r.sale_at_price) || 0, qty: 0, amount: 0, isRet });
      o.qty += Number(r.qty) || 0; o.amount += saleAmt;
    }
    const out = Object.values(g).map((o) => {
      const c = classify(o.retail, o.sale, priceTiers, discTiers);
      const margin = o.amount * c.pct / 100;
      return { ...o, pct: c.pct, kind: c.kind, discPct: c.discPct, margin, ar: o.amount - margin };
    }).sort((a, b) => (a.isRet - b.isRet) || (a.sku || "").localeCompare(b.sku || ""));
    const tot = out.reduce((t, l) => ({ sale: t.sale + l.amount, margin: t.margin + l.margin, ar: t.ar + l.ar, qty: t.qty + l.qty }), { sale: 0, margin: 0, ar: 0, qty: 0 });
    return { lines: out, tot };
  }, [rows, priceTiers, discTiers]);

  /* ---- submit ---- */
  async function submit() {
    if (!canSubmit || busy || existing) return;
    if (!lines.length) { setMsg({ t: "err", m: "Tidak ada penjualan di periode ini." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inv, error } = await supabase.from("sf_ar_invoices").insert({
        location_id: store, period_start: wk.start, period_end: wk.end, status: "submitted",
        total_sale: tot.sale, total_margin: tot.margin, total_ar: tot.ar, n_lines: lines.length,
        submitted_at: new Date().toISOString(), submitted_by: user?.id || null,
      }).select().single();
      if (error) throw error;
      const payload = lines.map((l) => ({
        invoice_id: inv.id, sku: l.sku, product_name: null, qty: l.qty,
        retail_price: l.retail, sale_price: l.sale, sale_amount: l.amount,
        disc_pct: l.kind === "disc" ? l.discPct : null, margin_kind: l.kind,
        margin_pct: l.pct, margin_store: l.margin, ar_amount: l.ar, is_return: l.isRet,
      }));
      const { error: e2 } = await supabase.from("sf_ar_invoice_lines").insert(payload);
      if (e2) throw e2;
      setExisting(inv);
      setMsg({ t: "ok", m: "Invoice AR disubmit. Siap dioper ke Finance." });
    } catch (e) {
      const dup = (e.message || "").toLowerCase().includes("duplicate") || e.code === "23505";
      setMsg({ t: "err", m: dup ? "Invoice untuk store & minggu ini sudah ada." : "Gagal submit: " + (e.message || "cek izin/koneksi") });
    } finally { setBusy(false); }
  }

  if (loading) return <div className="center-msg">Memuat…</div>;
  const storeName = stores.find((s) => s.location_id === store)?.name || store;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="title">Penagihan AR</div>
          <div className="lead">Invoice mingguan (Senin–Minggu) berbasis margin konsinyasi</div>
        </div>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--surface2)", padding: 4, borderRadius: 12 }}>
          {[["invoice", "Invoice"], ["setting", "Setting Margin"]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              style={{ border: "none", borderRadius: 9, padding: "8px 15px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: view === k ? "var(--black)" : "transparent", color: view === k ? "#fff" : "var(--sub)" }}>{l}</button>
          ))}
        </div>
      </div>

      {view === "setting"
        ? <SettingMargin priceTiers={priceTiers} discTiers={discTiers} canEdit={canSubmit}
            onSaved={(pt, dt) => { setPriceTiers(pt); setDiscTiers(dt); }} />
        : <>
          {/* filter */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "6px 0 16px" }}>
            <div style={{ minWidth: 220 }}>
              <label>Store</label>
              <select value={store} onChange={(e) => setStore(e.target.value)}>
                {stores.map((s) => <option key={s.location_id} value={s.location_id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 240 }}>
              <label>Periode (minggu)</label>
              <select value={wIdx} onChange={(e) => setWIdx(Number(e.target.value))}>
                {weeks.map((w, i) => <option key={w.start} value={i}>{w.label}{i === 0 ? " (berjalan)" : ""}</option>)}
              </select>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-end", gap: 10 }}>
              {existing
                ? <span className="pill" style={{ background: "var(--good-soft)", color: "var(--good)" }}>✓ Sudah disubmit {existing.submitted_at ? "· " + existing.submitted_at.slice(0, 10) : ""}</span>
                : <span className="pill" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>● Draft</span>}
              <button className="btn btn-primary" onClick={submit} disabled={!canSubmit || busy || !!existing || !lines.length}>
                {busy ? "Menyimpan…" : existing ? "Sudah disubmit" : "Submit Invoice"}
              </button>
            </div>
          </div>

          {msg && <div className="card" style={{ background: msg.t === "ok" ? "var(--good-soft)" : "var(--bad-soft)", borderColor: "transparent", color: msg.t === "ok" ? "var(--good)" : "var(--bad)" }}>{msg.m}</div>}

          {/* KPI */}
          <div className="grid3" style={{ marginBottom: 4 }}>
            <div className="kpi card"><div className="l">Total Penjualan (sale)</div><div className="v">{fmtIDR(tot.sale)}</div><div className="d">{lines.length} baris · {fmtNum(tot.qty)} pcs</div></div>
            <div className="kpi card" style={{ background: "var(--sand)", border: "none" }}><div className="l">Margin Store</div><div className="v">{fmtIDR(tot.margin)}</div><div className="d" style={{ color: "var(--sand-ink)" }}>jatah store</div></div>
            <div className="kpi card" style={{ background: "var(--black)", border: "none", color: "#fff" }}><div className="l" style={{ color: "#A1A1AA" }}>AR — Payment to Aleza</div><div className="v" style={{ color: "#fff" }}>{fmtIDR(tot.ar)}</div><div className="d" style={{ color: "#fff" }}>{storeName} · {wk?.label}</div></div>
          </div>

          {/* table */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {lines.length === 0
              ? <div className="center-msg">Tidak ada penjualan di periode ini.</div>
              : <table>
                  <thead><tr>
                    <th>SKU</th><th className="num">Qty</th><th className="num">Retail</th><th className="num">Sale at Price</th>
                    <th className="num">Diskon</th><th>Margin</th><th className="num">Margin Store</th><th className="num">AR (Aleza)</th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} style={l.isRet ? { background: "#FDF6F4", color: "var(--accent)" } : undefined}>
                        <td style={{ fontWeight: 500 }}>{l.isRet ? "↩ " : ""}{l.sku}</td>
                        <td className="num">{fmtNum(l.qty)}</td>
                        <td className="num">{fmtNum(l.retail)}</td>
                        <td className="num">{fmtNum(l.amount)}</td>
                        <td className="num">{l.kind === "disc" ? Math.round((1 - l.sale / l.retail) * 100) + "%" : <span className="muted">—</span>}</td>
                        <td><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: l.kind === "disc" ? "var(--accent-soft)" : "var(--sand)", color: l.kind === "disc" ? "var(--accent-ink)" : "var(--sand-ink)" }}>{l.kind === "disc" ? `DISC ${l.discPct}% · ${l.pct}%` : `Tier ${l.pct}%`}</span></td>
                        <td className="num">{fmtNum(l.margin)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{fmtNum(l.ar)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                    <td>TOTAL</td><td className="num">{fmtNum(tot.qty)}</td><td></td><td className="num">{fmtNum(tot.sale)}</td><td></td><td></td>
                    <td className="num">{fmtNum(tot.margin)}</td><td className="num" style={{ color: "var(--accent-ink)" }}>{fmtNum(tot.ar)}</td>
                  </tr></tfoot>
                </table>}
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>
            Margin dihitung otomatis dari sale-at-price: harga normal → tier harga; ada diskon → tabel diskon (dibulatkan ke tier terdekat). Retur (net minus) mengurangi AR di minggu yang sama.
          </div>
        </>}
    </div>
  );
}

/* ---------- setting margin (editable) ---------- */
function SettingMargin({ priceTiers, discTiers, canEdit, onSaved }) {
  const [pt, setPt] = useState(priceTiers.map((r) => ({ ...r })));
  const [dt, setDt] = useState(discTiers.map((r) => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setPt(priceTiers.map((r) => ({ ...r }))); setDt(discTiers.map((r) => ({ ...r }))); }, [priceTiers, discTiers]);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      for (const r of pt) await supabase.from("sf_margin_price_tiers").update({ margin_pct: Number(r.margin_pct) || 0 }).eq("id", r.id);
      for (const r of dt) await supabase.from("sf_margin_disc_tiers").update({ margin_pct: Number(r.margin_pct) || 0 }).eq("disc_pct", r.disc_pct);
      onSaved(pt, dt);
      setMsg({ t: "ok", m: "Tersimpan." });
    } catch (e) { setMsg({ t: "err", m: "Gagal simpan: " + (e.message || "cek izin") }); } finally { setBusy(false); }
  }

  const editCell = (val, set) => <input value={val} onChange={(e) => set(e.target.value)} style={{ width: 80, textAlign: "right", padding: "6px 8px" }} disabled={!canEdit} />;

  return (
    <div style={{ marginTop: 8 }}>
      {msg && <div className="card" style={{ background: msg.t === "ok" ? "var(--good-soft)" : "var(--bad-soft)", borderColor: "transparent", color: msg.t === "ok" ? "var(--good)" : "var(--bad)" }}>{msg.m}</div>}
      <div className="grid2">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>Non-Discount · base harga jual</div>
          <table><thead><tr><th>Harga Jual</th><th className="num">Margin Store %</th></tr></thead>
            <tbody>{pt.map((r, i) => (
              <tr key={r.id}><td>{r.label}</td><td className="num">{editCell(r.margin_pct, (v) => setPt((a) => a.map((x, j) => j === i ? { ...x, margin_pct: v } : x)))}</td></tr>
            ))}</tbody></table>
        </div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>Discount · base level diskon</div>
          <table><thead><tr><th>Diskon</th><th className="num">Margin Store %</th></tr></thead>
            <tbody>{dt.map((r, i) => (
              <tr key={r.disc_pct}><td>DISC {r.disc_pct}%</td><td className="num">{editCell(r.margin_pct, (v) => setDt((a) => a.map((x, j) => j === i ? { ...x, margin_pct: v } : x)))}</td></tr>
            ))}</tbody></table>
        </div>
      </div>
      {canEdit && <div style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Perubahan"}</button></div>}
    </div>
  );
}
