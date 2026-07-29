import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { loadHiddenSkus, isHiddenSku } from "./hiddenData.js";
import { fmtIDR, fmtNum, cleanName } from "./format.js";
import { canAct } from "./permissions.js";
import { loadPrefixes, renderNumber, numberStem } from "./prefixes.js";

/* ---------- date helpers (Senin–Minggu) ---------- */
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const dLabel = (d) => `${d.getDate()} ${MON[d.getMonth()]}`;
// Minggu berbasis KALENDER BULAN (tidak lintas bulan):
// W1 mulai tgl 1 (hari apa pun) → Minggu pertama; berikutnya Senin–Minggu;
// minggu terakhir dipotong di akhir bulan. Contoh: 1 Juli = Rabu → W1 = Rabu–Minggu.
function buildWeeks(nMonths) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (let k = 0; k < nMonths; k++) {
    const anchor = new Date(today.getFullYear(), today.getMonth() - k, 1);
    const y = anchor.getFullYear(), mo = anchor.getMonth();
    const lastDay = new Date(y, mo + 1, 0).getDate();
    let day = 1, wno = 0;
    while (day <= lastDay) {
      wno++;
      const s = new Date(y, mo, day);
      const daysToSun = (7 - s.getDay()) % 7;          // getDay(): 0=Minggu
      const endDay = Math.min(day + daysToSun, lastDay); // potong di akhir bulan
      const e = new Date(y, mo, endDay);
      out.push({
        start: iso(s), end: iso(e), wno, month: mo, year: y,
        label: `${MON[mo]} ${y} · W${wno} (${dLabel(s)} – ${dLabel(e)})`,
      });
      day = endDay + 1;
    }
  }
  out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0)); // terbaru dulu
  return out;
}
// label periode dari string ISO (untuk daftar/detail invoice tersimpan)
function fmtPeriod(startISO, endISO) {
  if (!startISO) return "—";
  const s = new Date(startISO + "T00:00:00"), e = new Date((endISO || startISO) + "T00:00:00");
  return `${dLabel(s)} – ${dLabel(e)} ${e.getFullYear()}`;
}
// kode store dari location_id (buang awalan store/st/toko)
function storeCode(loc) {
  return String(loc || "").replace(/^(store|st|toko)[-_ ]?/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "STORE";
}
// nomor AR urut per store mengikuti master (prefix + format), mis. AR-<store>-001
async function nextArNo(loc) {
  const p = await loadPrefixes();
  const cfg = p.consign_ar;
  const code = storeCode(loc);
  const stem = numberStem(cfg.prefix, cfg.format, { store: code });
  const { count } = await supabase.from("sf_ar_invoices").select("id", { count: "exact", head: true }).like("ar_no", `${stem}%`);
  return renderNumber(cfg.prefix, cfg.format, { store: code, seq: (count || 0) + 1 });
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

const StatusPill = ({ status }) => status === "submitted"
  ? <span className="pill" style={{ background: "var(--good-soft)", color: "var(--good)" }}>✓ Submitted</span>
  : <span className="pill" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>● Draft</span>;

export default function Penagihan({ role }) {
  const weeks = useMemo(() => buildWeeks(6), []);
  const [view, setView] = useState("invoice");     // 'invoice' | 'list' | 'setting'
  const [stores, setStores] = useState([]);
  const [store, setStore] = useState("");
  const [wIdx, setWIdx] = useState(() => {          // default: minggu selesai terbaru
    const t = iso(new Date());
    const i = weeks.findIndex((w) => w.end < t);
    return i >= 0 ? i : 0;
  });
  const [priceTiers, setPriceTiers] = useState([]);
  const [discTiers, setDiscTiers] = useState([]);
  const [nameMap, setNameMap] = useState({});       // sku -> nama produk (bersih)
  const [rows, setRows] = useState([]);             // cf_sales_fact untuk periode
  const [existing, setExisting] = useState(null);   // invoice yang sudah ada
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [detail, setDetail] = useState(null);       // invoice dibuka di modal detail
  const canSubmit = canAct(role, "ar");

  const storeMap = useMemo(() => {
    const m = {}; stores.forEach((s) => (m[s.location_id] = s.name)); return m;
  }, [stores]);

  /* ---- initial ---- */
  useEffect(() => {
    (async () => {
      const [locRes, ptRes, dtRes, siRes] = await Promise.all([
        supabase.from("cf_locations").select("location_id,name").order("name"),
        supabase.from("sf_margin_price_tiers").select("*").order("min_price"),
        supabase.from("sf_margin_disc_tiers").select("*").order("disc_pct"),
        supabase.from("sku_items").select("sku,product_name_system,size_label,colour_lv2").limit(10000),
      ]);
      const locs = locRes.data || [];
      setStores(locs); setStore(locs[0]?.location_id || "");
      setPriceTiers(ptRes.data || []); setDiscTiers(dtRes.data || []);
      const nm = {};
      (siRes.data || []).forEach((x) => { nm[x.sku] = cleanName(x.product_name_system || x.sku, x.size_label, x.colour_lv2); });
      setNameMap(nm);
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
      await loadHiddenSkus();
      if (!live) return;
      setRows((fRes.data || []).filter((r) => !isHiddenSku(r.sku)));
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
      return { ...o, name: nameMap[o.sku] || "", pct: c.pct, kind: c.kind, discPct: c.discPct, margin, ar: o.amount - margin };
    }).sort((a, b) => (a.isRet - b.isRet) || (a.sku || "").localeCompare(b.sku || ""));
    const tot = out.reduce((t, l) => ({ sale: t.sale + l.amount, margin: t.margin + l.margin, ar: t.ar + l.ar, qty: t.qty + l.qty }), { sale: 0, margin: 0, ar: 0, qty: 0 });
    return { lines: out, tot };
  }, [rows, priceTiers, discTiers, nameMap]);

  /* ---- simpan (draft / submit) ---- */
  async function saveInvoice(status) {
    if (!canSubmit || busy) return;
    if (!lines.length) { setMsg({ t: "err", m: "Tidak ada penjualan di periode ini." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const arNo = existing?.ar_no || await nextArNo(store);
      const head = {
        period_end: wk.end, status, ar_no: arNo,
        total_sale: tot.sale, total_margin: tot.margin, total_ar: tot.ar, n_lines: lines.length,
        submitted_at: status === "submitted" ? new Date().toISOString() : null,
        submitted_by: status === "submitted" ? (user?.id || null) : null,
      };
      let inv;
      if (existing) {
        const { data, error } = await supabase.from("sf_ar_invoices").update(head).eq("id", existing.id).select().single();
        if (error) throw error;
        inv = data;
        await supabase.from("sf_ar_invoice_lines").delete().eq("invoice_id", inv.id);
      } else {
        const { data, error } = await supabase.from("sf_ar_invoices")
          .insert({ location_id: store, period_start: wk.start, ...head }).select().single();
        if (error) throw error;
        inv = data;
      }
      const payload = lines.map((l) => ({
        invoice_id: inv.id, sku: l.sku, product_name: l.name || null, qty: l.qty,
        retail_price: l.retail, sale_price: l.sale, sale_amount: l.amount,
        disc_pct: l.kind === "disc" ? l.discPct : null, margin_kind: l.kind,
        margin_pct: l.pct, margin_store: l.margin, ar_amount: l.ar, is_return: l.isRet,
      }));
      const { error: e2 } = await supabase.from("sf_ar_invoice_lines").insert(payload);
      if (e2) throw e2;
      setExisting(inv);
      setMsg({ t: "ok", m: status === "submitted" ? "Invoice AR disubmit. Siap dioper ke Finance." : "Draft AR disimpan." });
    } catch (e) {
      const dup = (e.message || "").toLowerCase().includes("duplicate") || e.code === "23505";
      setMsg({ t: "err", m: dup ? "Invoice untuk store & minggu ini sudah ada." : "Gagal: " + (e.message || "cek izin/koneksi") });
    } finally { setBusy(false); }
  }

  if (loading) return <div className="center-msg">Memuat…</div>;
  const storeName = storeMap[store] || store;
  const locked = existing?.status === "submitted";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="title">Penagihan AR</div>
          <div className="lead">Invoice mingguan (Senin–Minggu) berbasis margin konsinyasi</div>
        </div>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--surface2)", padding: 4, borderRadius: 12 }}>
          {[["invoice", "Buat Invoice"], ["list", "Daftar AR"], ["setting", "Setting Margin"]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              style={{ border: "none", borderRadius: 9, padding: "8px 15px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: view === k ? "var(--black)" : "transparent", color: view === k ? "#fff" : "var(--sub)" }}>{l}</button>
          ))}
        </div>
      </div>

      {view === "setting" && (
        <SettingMargin priceTiers={priceTiers} discTiers={discTiers} canEdit={canSubmit}
          onSaved={(pt, dt) => { setPriceTiers(pt); setDiscTiers(dt); }} />
      )}

      {view === "list" && (
        <ArList storeMap={storeMap} canSubmit={canSubmit} onOpen={(inv) => setDetail(inv)} />
      )}

      {view === "invoice" && (
        <>
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
                {weeks.map((w, i) => {
                  const t = iso(new Date());
                  const cur = t >= w.start && t <= w.end;
                  return <option key={w.start} value={i}>{w.label}{cur ? " (berjalan)" : ""}</option>;
                })}
              </select>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {existing && <StatusPill status={existing.status} />}
              {existing && <button className="btn btn-ghost" onClick={() => setDetail(existing)}>Lihat / Cetak</button>}
              {canSubmit && !locked && (
                <>
                  <button className="btn btn-ghost" onClick={() => saveInvoice("draft")} disabled={busy || !lines.length}>
                    {busy ? "…" : "Simpan Draft"}
                  </button>
                  <button className="btn btn-primary" onClick={() => saveInvoice("submitted")} disabled={busy || !lines.length}>
                    {busy ? "Menyimpan…" : "Submit Invoice"}
                  </button>
                </>
              )}
              {locked && <span className="small muted" style={{ alignSelf: "center" }}>Terkunci — ubah status di tab Daftar AR</span>}
            </div>
          </div>

          {existing?.ar_no && (
            <div className="small muted" style={{ margin: "-8px 0 12px" }}>No AR: <b style={{ color: "var(--ink)" }}>{existing.ar_no}</b></div>
          )}

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
                    <th>SKU</th><th>Produk</th><th className="num">Qty</th><th className="num">Retail</th><th className="num">Sale at Price</th>
                    <th className="num">Diskon</th><th>Margin</th><th className="num">Margin Store</th><th className="num">AR (Aleza)</th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} style={l.isRet ? { background: "#FDF6F4", color: "var(--accent)" } : undefined}>
                        <td style={{ fontWeight: 600 }}>{l.isRet ? "↩ " : ""}{l.sku}</td>
                        <td className="strong">{l.name || <span className="muted">—</span>}</td>
                        <td className="num">{fmtNum(l.qty)}</td>
                        <td className="num">{fmtNum(l.retail)}</td>
                        <td className="num">{fmtNum(l.amount)}</td>
                        <td className="num">{l.kind === "disc" ? Math.round((1 - l.sale / l.retail) * 100) + "%" : <span className="muted">—</span>}</td>
                        <td><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: l.kind === "disc" ? "var(--accent-soft)" : "var(--sand)", color: l.kind === "disc" ? "var(--accent-ink)" : "var(--sand-ink)" }}>{l.kind === "disc" ? `DISC ${l.discPct}% · ${l.pct}%` : `Tier ${l.pct}%`}</span></td>
                        <td className="num">{fmtNum(l.margin)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmtNum(l.ar)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                    <td>TOTAL</td><td></td><td className="num">{fmtNum(tot.qty)}</td><td></td><td className="num">{fmtNum(tot.sale)}</td><td></td><td></td>
                    <td className="num">{fmtNum(tot.margin)}</td><td className="num" style={{ color: "var(--accent-ink)" }}>{fmtNum(tot.ar)}</td>
                  </tr></tfoot>
                </table>}
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>
            Margin dihitung otomatis dari sale-at-price: harga normal → tier harga; ada diskon → tabel diskon (dibulatkan ke tier terdekat). Retur (net minus) mengurangi AR di minggu yang sama.
          </div>
        </>
      )}

      {detail && <ArDetail invoice={detail} storeName={storeMap[detail.location_id] || detail.location_id} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ---------- Daftar AR (invoice tersimpan) ---------- */
function ArList({ storeMap, canSubmit, onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [fStatus, setFStatus] = useState("all");

  async function load() {
    const { data, error } = await supabase.from("sf_ar_invoices").select("*")
      .order("period_start", { ascending: false }).order("created_at", { ascending: false });
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function toggleStatus(inv) {
    if (!canSubmit || busyId) return;
    setBusyId(inv.id);
    const next = inv.status === "submitted" ? "draft" : "submitted";
    const { data: { user } } = await supabase.auth.getUser();
    const patch = next === "submitted"
      ? { status: "submitted", submitted_at: new Date().toISOString(), submitted_by: user?.id || null }
      : { status: "draft", submitted_at: null, submitted_by: null };
    const { error } = await supabase.from("sf_ar_invoices").update(patch).eq("id", inv.id);
    if (!error) setRows((rs) => rs.map((r) => r.id === inv.id ? { ...r, ...patch } : r));
    setBusyId(null);
  }

  if (rows === null) return <div className="center-msg">Memuat…</div>;
  if (err) return <div className="card err-card" style={{ marginTop: 12 }}>{err}</div>;

  const filtered = fStatus === "all" ? rows : rows.filter((r) => r.status === fStatus);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, margin: "0 0 14px" }}>
        {[["all", "Semua"], ["draft", "Draft"], ["submitted", "Submitted"]].map(([k, l]) => (
          <button key={k} onClick={() => setFStatus(k)}
            style={{ border: "1px solid var(--line)", background: fStatus === k ? "var(--black)" : "#fff", color: fStatus === k ? "#fff" : "var(--sub)",
              borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>
        ))}
        <span className="small muted" style={{ marginLeft: "auto", alignSelf: "center" }}>{filtered.length} invoice</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0
          ? <div className="center-msg">Belum ada invoice AR.</div>
          : <table>
              <thead><tr>
                <th>No AR</th><th>Store</th><th>Periode</th><th className="num">Baris</th>
                <th className="num">Total AR</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id}>
                    <td className="strong" style={{ fontSize: 12.5 }}>{inv.ar_no || <span className="muted">—</span>}</td>
                    <td className="strong">{storeMap[inv.location_id] || inv.location_id}</td>
                    <td>{fmtPeriod(inv.period_start, inv.period_end)}</td>
                    <td className="num">{fmtNum(inv.n_lines)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtIDR(inv.total_ar)}</td>
                    <td><StatusPill status={inv.status} /></td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {canSubmit && (
                        <button className="btn btn-ghost btn-sm" style={{ marginRight: 6 }} disabled={busyId === inv.id} onClick={() => toggleStatus(inv)}>
                          {busyId === inv.id ? "…" : inv.status === "submitted" ? "→ Draft" : "→ Submit"}
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => onOpen(inv)}>Detail</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
      </div>
    </div>
  );
}

/* ---------- Detail + dokumen cetak ---------- */
function ArDetail({ invoice, storeName, onClose }) {
  const [lines, setLines] = useState(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("sf_ar_invoice_lines").select("*").eq("invoice_id", invoice.id)
        .order("is_return").order("sku");
      setLines(data || []);
    })();
  }, [invoice.id]);

  const periode = fmtPeriod(invoice.period_start, invoice.period_end);

  return (
    <div className="ar-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={(e) => e.stopPropagation()}>
        {/* toolbar (tidak ikut tercetak) */}
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Detail Invoice AR</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={() => window.print()}>Cetak / Print</button>
            <button className="btn btn-ghost" onClick={onClose}>Tutup</button>
          </div>
        </div>

        {/* area cetak */}
        <div className="ar-print">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid var(--ink)", paddingBottom: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.4px" }}>ALEZA</div>
              <div className="small muted">PT Asa Modakreasi Indonesia</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".02em" }}>INVOICE PENAGIHAN AR</div>
              <div className="small" style={{ marginTop: 2 }}>No AR: <b>{invoice.ar_no || "—"}</b></div>
              <div className="small"><StatusPill status={invoice.status} /></div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 40, flexWrap: "wrap", marginBottom: 16 }}>
            <div><div className="section-label">Store</div><div style={{ fontWeight: 700 }}>{storeName}</div></div>
            <div><div className="section-label">Periode Penjualan</div><div style={{ fontWeight: 700 }}>{periode}</div></div>
            <div><div className="section-label">Tanggal Submit</div><div style={{ fontWeight: 700 }}>{invoice.submitted_at ? invoice.submitted_at.slice(0, 10) : "—"}</div></div>
          </div>

          {lines === null
            ? <div className="center-msg">Memuat…</div>
            : <table>
                <thead><tr>
                  <th>SKU</th><th>Produk</th><th className="num">Qty</th><th className="num">Retail</th><th className="num">Sale</th>
                  <th className="num">Diskon</th><th className="num">Margin %</th><th className="num">Margin Store</th><th className="num">AR (Aleza)</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} style={l.is_return ? { color: "var(--accent)" } : undefined}>
                      <td style={{ fontWeight: 600 }}>{l.is_return ? "↩ " : ""}{l.sku}</td>
                      <td className="strong">{l.product_name || <span className="muted">—</span>}</td>
                      <td className="num">{fmtNum(l.qty)}</td>
                      <td className="num">{fmtNum(l.retail_price)}</td>
                      <td className="num">{fmtNum(l.sale_amount)}</td>
                      <td className="num">{l.disc_pct != null ? l.disc_pct + "%" : "—"}</td>
                      <td className="num">{l.margin_pct}%</td>
                      <td className="num">{fmtNum(l.margin_store)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmtNum(l.ar_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ borderTop: "2px solid var(--ink)", fontWeight: 800 }}>
                  <td colSpan={2}>TOTAL</td>
                  <td className="num">{fmtNum(lines.reduce((s, l) => s + Number(l.qty || 0), 0))}</td>
                  <td></td>
                  <td className="num">{fmtNum(invoice.total_sale)}</td>
                  <td></td><td></td>
                  <td className="num">{fmtNum(invoice.total_margin)}</td>
                  <td className="num" style={{ color: "var(--accent-ink)" }}>{fmtNum(invoice.total_ar)}</td>
                </tr></tfoot>
              </table>}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <div style={{ minWidth: 260, border: "1px solid var(--line)", borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span className="muted">Total Penjualan</span><b>{fmtIDR(invoice.total_sale)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span className="muted">Margin Store</span><b>{fmtIDR(invoice.total_margin)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 15 }}><b>AR ke Aleza</b><b style={{ color: "var(--accent-ink)" }}>{fmtIDR(invoice.total_ar)}</b></div>
            </div>
          </div>

          <div className="small muted" style={{ marginTop: 18 }}>
            Dokumen ini dibuat otomatis dari data penjualan store pada periode di atas. AR = nilai penjualan − margin store (konsinyasi).
          </div>
        </div>
      </div>
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
