import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { loadHiddenSkus, isHidden } from "./hiddenData.js";
import { fmtIDR, fmtNum } from "./format.js";

/* ============ Log Penjualan — riwayat batch Input/Upload + Batalkan (admin) ============
 * Batch = cf_sales_staging.file_label (satu aksi Input/Upload sales).
 * Batalkan = RPC sf_cancel_sales_batch: balikkan stok + hapus baris cf_sales_fact,
 * staging tetap tersimpan (ditandai cancelled) sebagai jejak audit. */

const num = (n) => Number(n) || 0;
const dS = (v) => (v ? new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const srcLabel = (s) => (s === "manual" ? "Input manual" : s === "upload" ? "Upload CSV" : s || "—");

export default function LogPenjualan({ role }) {
  const [rows, setRows] = useState([]);
  const [chName, setChName] = useState({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(null);   // file_label sedang diproses
  const [msg, setMsg] = useState(null);
  const isAdmin = role === "admin";

  async function load() {
    setLoading(true);
    const [stRes, chRes] = await Promise.all([
      supabase.from("cf_sales_staging").select("id,source,file_label,imported_at,cancelled,cancelled_at,raw").order("imported_at", { ascending: false }).limit(20000),
      supabase.from("cf_sales_channels").select("channel_id,name"),
    ]);
    await loadHiddenSkus();
    // kelompokkan per file_label (batch) — kecualikan produk tersembunyi
    const stRows = (stRes.data || []).filter((s) => !isHidden(s.raw));
    const g = {};
    stRows.forEach((s) => {
      const k = s.file_label || "(tanpa batch)";
      const b = g[k] || (g[k] = { file_label: k, source: s.source, imported_at: s.imported_at, cancelled: !!s.cancelled, cancelled_at: s.cancelled_at, rows: 0, total: 0, channels: new Set() });
      const r = s.raw || {};
      b.rows += 1;
      b.total += num(r.sale_at_price) * num(r.qty) - num(r.discount);
      if (r.channel_id) b.channels.add(r.channel_id);
      if (s.cancelled) { b.cancelled = true; b.cancelled_at = s.cancelled_at; }
      if (s.imported_at && (!b.imported_at || s.imported_at > b.imported_at)) b.imported_at = s.imported_at;
    });
    setRows(Object.values(g).map((b) => ({ ...b, channels: [...b.channels] })).sort((a, z) => String(z.imported_at || "").localeCompare(String(a.imported_at || ""))));
    const m = {}; (chRes.data || []).forEach((c) => (m[c.channel_id] = c.name)); setChName(m);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((b) => {
    if (fStatus === "active" && b.cancelled) return false;
    if (fStatus === "cancelled" && !b.cancelled) return false;
    if (from && String(b.imported_at || "").slice(0, 10) < from) return false;
    if (to && String(b.imported_at || "").slice(0, 10) > to) return false;
    if (q) { const t = (b.file_label + " " + b.channels.map((c) => chName[c] || c).join(" ")).toLowerCase(); if (!t.includes(q.toLowerCase())) return false; }
    return true;
  }), [rows, fStatus, from, to, q, chName]);

  const kpi = useMemo(() => ({
    active: rows.filter((b) => !b.cancelled).reduce((a, b) => a + b.total, 0),
    activeN: rows.filter((b) => !b.cancelled).length,
    cancelled: rows.filter((b) => b.cancelled).length,
  }), [rows]);

  async function cancelBatch(b) {
    if (busy) return;
    if (!window.confirm(`Batalkan batch penjualan "${b.file_label}"?\n\n${b.rows} baris · ${fmtIDR(b.total)}\n\nSistem akan MENGEMBALIKAN STOK (gerakan balik di ledger) & menghapus baris penjualan batch ini dari laporan. Batch tetap tersimpan di log sebagai jejak audit (Dibatalkan). Aksi ini tidak bisa di-undo.`)) return;
    setBusy(b.file_label); setMsg(null);
    try {
      const { error } = await supabase.rpc("sf_cancel_sales_batch", { p_file_label: b.file_label });
      if (error) throw error;
      setMsg({ t: "ok", m: `Batch ${b.file_label} dibatalkan — stok dikembalikan.` });
      await load();
    } catch (e) { setMsg({ t: "err", m: "Gagal membatalkan: " + (e.message || "cek izin admin / SQL") }); } finally { setBusy(null); }
  }

  return (
    <div>
      <h1 className="h1" style={{ fontSize: 24, fontWeight: 800 }}>Log Penjualan</h1>
      <p className="lead" style={{ marginTop: 2, color: "var(--sub)", fontSize: 13.5 }}>Riwayat batch Input / Upload sales. Kalau salah input, klik <b>Batalkan</b> (admin) — sistem mengembalikan stok & menghapus baris dari laporan, batch tetap tercatat sebagai jejak audit. Penjualan Direct Purchase tidak termasuk di sini.</p>

      {msg && <div className="card" style={{ background: msg.t === "ok" ? "var(--good-soft)" : "var(--bad-soft)", borderColor: "transparent", color: msg.t === "ok" ? "var(--good)" : "var(--bad)" }}>{msg.m}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ margin: 0 }}><div className="small muted">Total penjualan (aktif)</div><div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.5px", margin: "3px 0" }}>{fmtIDR(kpi.active)}</div><div className="small muted">{kpi.activeN} batch aktif</div></div>
        <div className="card" style={{ margin: 0 }}><div className="small muted">Dibatalkan</div><div style={{ fontSize: 24, fontWeight: 800, color: "var(--bad)", margin: "3px 0" }}>{kpi.cancelled}</div><div className="small muted">batch (stok dikembalikan)</div></div>
        <div className="card" style={{ margin: 0 }}><div className="small muted">Ditampilkan</div><div style={{ fontSize: 24, fontWeight: 800, margin: "3px 0" }}>{filtered.length}</div><div className="small muted">batch</div></div>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cari batch / channel…" style={{ maxWidth: 240 }} />
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="all">Semua status</option>
            <option value="active">Aktif</option>
            <option value="cancelled">Dibatalkan</option>
          </select>
          <span className="small muted">Dari</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 160 }} />
          <span className="small muted">Sampai</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 160 }} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr>
              <th>Tanggal</th><th>Sumber</th><th>Batch</th><th>Channel</th><th className="num">Baris</th><th className="num">Total</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="center-msg">Memuat…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={8} className="center-msg">Tidak ada batch.</td></tr>
                  : filtered.map((b) => (
                    <tr key={b.file_label} style={b.cancelled ? { color: "var(--faint)" } : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>{dS(b.imported_at)}</td>
                      <td><span className="pill" style={{ background: "var(--surface2)", color: "var(--sub)", fontSize: 11 }}>{srcLabel(b.source)}</span></td>
                      <td className="mono" style={{ fontSize: 11.5, textDecoration: b.cancelled ? "line-through" : "none" }}>{b.file_label}</td>
                      <td className="small">{b.channels.map((c) => chName[c] || c).join(", ") || "—"}</td>
                      <td className="num">{fmtNum(b.rows)}</td>
                      <td className="num strong" style={{ textDecoration: b.cancelled ? "line-through" : "none" }}>{fmtIDR(b.total)}</td>
                      <td>{b.cancelled
                        ? <span className="pill" style={{ background: "var(--bad-soft)", color: "var(--bad)", fontSize: 11 }}>Dibatalkan</span>
                        : <span className="pill" style={{ background: "var(--good-soft)", color: "var(--good)", fontSize: 11 }}>Aktif</span>}</td>
                      <td className="num">
                        {b.cancelled ? <span className="muted small">{dS(b.cancelled_at)}</span>
                          : isAdmin ? <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad)", borderColor: "var(--bad-soft)" }} onClick={() => cancelBatch(b)} disabled={busy === b.file_label}>{busy === b.file_label ? "…" : "Batalkan"}</button>
                            : <span className="muted small">admin only</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
