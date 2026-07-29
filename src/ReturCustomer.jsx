import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, fmtNum, cleanName, dShort, todayISO } from "./format.js";

/* ================= Return Customer (marketplace / online / reseller) =================
 * Alur: Buat Retur (map SO → sales negatif + stok masuk QUARANTINE)
 *       → Proses (QC good/damage → put-away WH-MAIN/DAMAGE)
 *       → Refund (marketplace: selesai · online/reseller: ajukan ke FinFlow)
 * Stok lewat ledger bersama cf_stock_movements. Uang di FinFlow (fin_refund_requests).
 * ==================================================================================== */

const num = (n) => Number(n) || 0;
const nowISO = () => new Date().toISOString();
const routeOf = (chName) => (/market|shopee|tokopedia|lazada|blibli|tiktok|zalora/i.test(chName || "") ? "platform_auto" : "finflow_refund");
const ROUTE_LABEL = { platform_auto: "Dipotong marketplace", finflow_refund: "Refund via FinFlow" };
const ST = {
  qc:     { t: "QC & Put-away", bg: "var(--warn-soft)", c: "var(--warn)" },
  refund: { t: "Menunggu refund", bg: "var(--accent-soft)", c: "var(--accent-ink)" },
  done:   { t: "Selesai", bg: "var(--good-soft)", c: "var(--good)" },
  cancelled: { t: "Batal", bg: "var(--surface2)", c: "var(--faint)" },
};
function RStatus({ s }) { const m = ST[s] || ST.qc; return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: m.bg, color: m.c }}>{m.t}</span>; }

async function nextReturnNo() {
  const d = new Date();
  const stem = `RET-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-`;
  const { count } = await supabase.from("sf_customer_returns").select("id", { count: "exact", head: true }).like("return_no", `${stem}%`);
  return stem + String((count || 0) + 1).padStart(3, "0");
}

export default function ReturCustomer({ role }) {
  const [tab, setTab] = useState("proses");
  const [channels, setChannels] = useState([]);
  const [locName, setLocName] = useState({});
  const [nameMap, setNameMap] = useState({});
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  async function load() {
    setLoading(true);
    const [chRes, locRes, siRes, retRes] = await Promise.all([
      supabase.from("cf_sales_channels").select("channel_id,name").order("name"),
      supabase.from("cf_locations").select("location_id,name"),
      supabase.from("sku_items").select("sku,product_name_system,size_label,colour_lv2").limit(10000),
      supabase.from("sf_customer_returns").select("*").order("created_at", { ascending: false }),
    ]);
    setChannels(chRes.data || []);
    const ln = {}; (locRes.data || []).forEach((l) => (ln[l.location_id] = l.name)); setLocName(ln);
    const nm = {}; (siRes.data || []).forEach((x) => (nm[x.sku] = cleanName(x.product_name_system || x.sku, x.size_label, x.colour_lv2))); setNameMap(nm);
    setReturns(retRes.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const chName = useMemo(() => { const m = {}; channels.forEach((c) => (m[c.channel_id] = c.name)); return m; }, [channels]);
  const active = returns.filter((r) => r.status === "qc" || r.status === "refund");
  const history = returns.filter((r) => r.status === "done" || r.status === "cancelled");

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.3px" }}>Retur Customer</div>
        <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 3 }}>Retur marketplace / online / reseller — terima, QC, put-away, refund. (Retur POS diproses di store.)</div>
      </div>

      <div style={{ display: "inline-flex", gap: 4, background: "var(--surface2)", padding: 4, borderRadius: 12, marginBottom: 16 }}>
        {[["buat", "Buat Retur"], ["proses", `Proses${active.length ? " · " + active.length : ""}`], ["riwayat", "Riwayat"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="btn btn-sm" style={{ background: tab === k ? "#fff" : "transparent", color: "var(--ink)", boxShadow: tab === k ? "var(--shadow)" : "none", fontWeight: 700 }}>{l}</button>
        ))}
      </div>

      {loading ? <div className="center-msg">Memuat…</div> : (
        <>
          {tab === "buat" && <BuatRetur channels={channels} nameMap={nameMap} onDone={() => { load(); setTab("proses"); }} />}
          {tab === "proses" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {active.length === 0 ? <div className="center-msg">Belum ada retur berjalan.</div> : (
                <table>
                  <thead><tr><th>No Retur</th><th>Channel</th><th>No SO</th><th>Customer</th><th>Jalur</th><th>Status</th><th></th></tr></thead>
                  <tbody>{active.map((r) => (
                    <tr key={r.id}>
                      <td className="strong" style={{ fontSize: 12.5 }}>{r.return_no}</td>
                      <td>{chName[r.channel_id] || r.channel_id}</td>
                      <td className="strong">{r.sales_order_ref}</td>
                      <td>{r.customer_name || "—"}</td>
                      <td className="small">{ROUTE_LABEL[r.refund_route]}</td>
                      <td><RStatus s={r.status} /></td>
                      <td className="num"><button className="btn btn-primary btn-sm" onClick={() => setModal(r)}>{r.status === "qc" ? "Proses" : "Refund"}</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}
          {tab === "riwayat" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {history.length === 0 ? <div className="center-msg">Belum ada riwayat.</div> : (
                <table>
                  <thead><tr><th>No Retur</th><th>Channel</th><th>No SO</th><th>Customer</th><th>Jalur</th><th>Status</th><th></th></tr></thead>
                  <tbody>{history.map((r) => (
                    <tr key={r.id}>
                      <td className="strong" style={{ fontSize: 12.5 }}>{r.return_no}</td>
                      <td>{chName[r.channel_id] || r.channel_id}</td>
                      <td className="strong">{r.sales_order_ref}</td>
                      <td>{r.customer_name || "—"}</td>
                      <td className="small">{ROUTE_LABEL[r.refund_route]}</td>
                      <td><RStatus s={r.status} /></td>
                      <td className="num"><button className="btn btn-ghost btn-sm" onClick={() => setModal(r)}>Lihat</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {modal && <ProsesModal ret={modal} chName={chName[modal.channel_id] || modal.channel_id} locName={locName} onClose={() => setModal(null)} onChange={load} />}
    </div>
  );
}

/* ---------------- Tab: Buat Retur ---------------- */
function BuatRetur({ channels, nameMap, onDone }) {
  const [channel, setChannel] = useState("");
  const [route, setRoute] = useState("finflow_refund");
  const [soRef, setSoRef] = useState("");
  const [custName, setCustName] = useState("");
  const [reason, setReason] = useState("");
  const [bankName, setBankName] = useState("");
  const [accNo, setAccNo] = useState("");
  const [accName, setAccName] = useState("");
  const [cand, setCand] = useState(null);   // hasil cari SO: [{sku,name,sold,retail,sale,location_id,retQty}]
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState(null);

  function pickChannel(id) {
    setChannel(id);
    const c = channels.find((x) => x.channel_id === id);
    setRoute(routeOf(c?.name));
  }

  async function searchSO() {
    if (!soRef.trim()) { setMsg({ t: "err", m: "Isi No. Sales Order dulu." }); return; }
    setSearching(true); setMsg(null); setCand(null);
    try {
      // No. order bisa ada di order_ref (No. DO / marketplace) ATAU source_txn_id
      // (ID transaksi internal, mis. "DP260726-1" / "MAN-…-2"). Strategi:
      //  1) cocokkan persis di kedua kolom
      //  2) kalau baris punya order_ref → tarik SEMUA baris order itu (kelompok benar)
      //  3) kalau tanpa order_ref (data lama) → tarik saudara sebatch via base source_txn_id
      const t = soRef.trim();
      const sel = "id,sku,qty,retail_price,sale_at_price,location_id,channel_id,order_ref,source_txn_id";
      const [byRef, byTxn] = await Promise.all([
        supabase.from("cf_sales_fact").select(sel).eq("order_ref", t),
        supabase.from("cf_sales_fact").select(sel).eq("source_txn_id", t),
      ]);
      const pool = [...(byRef.data || []), ...(byTxn.data || [])];
      const orderRefs = [...new Set(pool.map((r) => r.order_ref).filter(Boolean))];
      if (orderRefs.length) {
        const { data } = await supabase.from("cf_sales_fact").select(sel).in("order_ref", orderRefs);
        pool.push(...(data || []));
      } else {
        const base = t.replace(/-\d+$/, "-");
        if (base !== t && base.length > 2) {
          const { data } = await supabase.from("cf_sales_fact").select(sel).like("source_txn_id", base + "%");
          pool.push(...(data || []));
        }
      }
      const seen = new Set(); const merged = [];
      pool.forEach((row) => { if (!seen.has(row.id)) { seen.add(row.id); merged.push(row); } });
      const rows = merged.filter((r) => num(r.qty) > 0);
      if (!rows.length) { setMsg({ t: "err", m: "No. Order tidak ditemukan di penjualan. Cek nomornya (No. DO, No. Order marketplace, atau ID seperti DP260726-1)." }); setCand([]); return; }
      const g = {};
      rows.forEach((r) => {
        const k = r.sku; if (!g[k]) g[k] = { sku: r.sku, name: nameMap[r.sku] || r.sku, sold: 0, retail: num(r.retail_price), sale: num(r.sale_at_price), location_id: r.location_id, retQty: "" };
        g[k].sold += num(r.qty);
      });
      if (rows[0].channel_id && !channel) pickChannel(rows[0].channel_id);
      setCand(Object.values(g));
    } catch (e) { setMsg({ t: "err", m: "Gagal cari SO: " + (e.message || "") }); } finally { setSearching(false); }
  }

  async function uploadPhotos(retNo) {
    const urls = [];
    for (let i = 0; i < photos.length; i++) {
      const f = photos[i]; const safe = String(f.name || "foto").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${retNo}/${Date.now()}_${i}_${safe}`;
      const { error } = await supabase.storage.from("customer-return-photos").upload(path, f, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      urls.push(supabase.storage.from("customer-return-photos").getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }

  async function submit() {
    if (busy) return;
    if (!channel) { setMsg({ t: "err", m: "Pilih channel." }); return; }
    if (!soRef.trim()) { setMsg({ t: "err", m: "Isi No. Sales Order." }); return; }
    if (!custName.trim()) { setMsg({ t: "err", m: "Nama customer wajib diisi." }); return; }
    if (route === "finflow_refund" && (!bankName.trim() || !accNo.trim() || !accName.trim())) {
      setMsg({ t: "err", m: "Detail rekening (Bank, No. Rekening, Atas Nama) wajib diisi untuk refund via FinFlow." }); return;
    }
    const picked = (cand || []).map((l) => ({ ...l, retQty: Math.max(0, num(l.retQty)) })).filter((l) => l.retQty > 0);
    if (!picked.length) { setMsg({ t: "err", m: "Isi qty retur minimal satu SKU." }); return; }
    for (const l of picked) if (l.sold && l.retQty > l.sold) { setMsg({ t: "err", m: `Qty retur ${l.sku} melebihi qty terjual (${l.sold}).` }); return; }
    setBusy(true); setMsg(null);
    try {
      const return_no = await nextReturnNo();
      let photoUrls = [];
      if (photos.length) photoUrls = await uploadPhotos(return_no);
      const { data: ret, error } = await supabase.from("sf_customer_returns").insert({
        return_no, channel_id: channel, refund_route: route, sales_order_ref: soRef.trim(),
        customer_name: custName.trim() || null, reason: reason.trim() || null, status: "qc",
        photo_urls: photoUrls.length ? photoUrls : null, received_at: nowISO(), sales_reduced: true,
        refund_bank_name: route === "finflow_refund" ? (bankName.trim() || null) : null,
        refund_account_no: route === "finflow_refund" ? (accNo.trim() || null) : null,
        refund_account_name: route === "finflow_refund" ? (accName.trim() || null) : null,
      }).select().single();
      if (error) throw error;
      await supabase.from("sf_customer_return_lines").insert(picked.map((l) => ({
        return_id: ret.id, sku: l.sku, product_name: l.name, qty_returned: l.retQty, qty_good: 0, qty_damage: 0, unit_price: l.sale,
      })));
      // pengurangan penjualan (baris negatif di cf_sales_fact)
      await supabase.from("cf_sales_fact").insert(picked.map((l, i) => ({
        txn_date: todayISO(), channel_id: channel, location_id: l.location_id || null, sku: l.sku,
        qty: -l.retQty, retail_price: l.retail, sale_at_price: l.sale, discount: 0, net_amount: -(l.retQty * l.sale),
        order_ref: soRef.trim(), source_txn_id: `${return_no}-${i}`,
      })));
      // stok masuk QUARANTINE (ledger bersama)
      await supabase.from("cf_stock_movements").insert(picked.map((l) => ({
        type: "return_in", sku: l.sku, location_id: "QUARANTINE", qty: l.retQty,
        ref_type: "customer_return", ref_id: return_no, note: `Retur ${soRef.trim()}`,
      })));
      onDone();
    } catch (e) { setMsg({ t: "err", m: "Gagal simpan retur: " + (e.message || "cek izin/kolom SQL") }); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="section-label">Buat retur baru</div>
      {msg && <div className="small" style={{ marginTop: 8, color: msg.t === "err" ? "var(--bad)" : "var(--good)" }}>{msg.m}</div>}
      <div className="grid3" style={{ marginTop: 12 }}>
        <div><label>Channel *</label>
          <select value={channel} onChange={(e) => pickChannel(e.target.value)}>
            <option value="">— pilih —</option>
            {channels.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.name}</option>)}
          </select>
        </div>
        <div><label>Jalur refund</label>
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="platform_auto">Dipotong marketplace (tanpa refund kita)</option>
            <option value="finflow_refund">Refund via FinFlow (online/reseller)</option>
          </select>
        </div>
        <div><label>Customer *</label><input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Nama customer" /></div>
      </div>
      <div className="grid3" style={{ marginTop: 12, alignItems: "end" }}>
        <div><label>No. Sales Order *</label><input value={soRef} onChange={(e) => setSoRef(e.target.value)} placeholder="cari No. SO…" /></div>
        <div><button className="btn btn-ghost" onClick={searchSO} disabled={searching}>{searching ? "Mencari…" : "🔍 Cari SO"}</button></div>
        <div><label>Alasan retur</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. rusak, salah size" /></div>
      </div>

      {route === "finflow_refund" && (
        <>
          <div className="section-label" style={{ marginTop: 14 }}>Rekening tujuan refund (wajib untuk FinFlow)</div>
          <div className="grid3" style={{ marginTop: 8 }}>
            <div><label>Bank *</label><input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="mis. BCA / Mandiri" /></div>
            <div><label>No. Rekening *</label><input value={accNo} onChange={(e) => setAccNo(e.target.value)} placeholder="contoh: 1234567890" /></div>
            <div><label>Atas Nama *</label><input value={accName} onChange={(e) => setAccName(e.target.value)} placeholder="nama pemilik rekening" /></div>
          </div>
        </>
      )}

      {cand && cand.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginTop: 14 }}>
          <table>
            <thead><tr><th>SKU</th><th>Produk</th><th className="num">Terjual</th><th className="num">Harga Jual</th><th className="num">Qty Retur</th></tr></thead>
            <tbody>{cand.map((l, idx) => (
              <tr key={l.sku}>
                <td className="k" style={{ fontSize: 12 }}>{l.sku}</td>
                <td className="strong">{l.name}</td>
                <td className="num">{fmtNum(l.sold)}</td>
                <td className="num">{fmtIDR(l.sale)}</td>
                <td className="num"><input className="num" type="number" min="0" max={l.sold} value={l.retQty}
                  onChange={(e) => setCand((c) => c.map((x, i) => i === idx ? { ...x, retQty: e.target.value } : x))} style={{ width: 72 }} placeholder="0" /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
        <div className="section-label" style={{ width: "100%" }}>Foto barang retur (opsional)</div>
        {photos.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" style={{ width: 58, height: 58, objectFit: "cover", borderRadius: 8, border: "1px dashed var(--accent)" }} />)}
        <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>+ Foto
          <input type="file" accept="image/*" multiple capture="environment" style={{ display: "none" }} onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files || [])])} /></label>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Retur (barang → Quarantine)"}</button>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Saat disimpan: penjualan otomatis dikurangi (baris negatif ke sales) & stok barang masuk ke <b>QUARANTINE</b>, menunggu QC.</p>
    </div>
  );
}

/* ---------------- Modal: Proses (QC → Put-away → Refund) ---------------- */
function ProsesModal({ ret, chName, locName, onClose, onChange }) {
  const [r, setR] = useState(ret);
  const [lines, setLines] = useState(null);
  const [qc, setQc] = useState({});      // line_id -> {good,damage}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function reload() {
    const [rr, ll] = await Promise.all([
      supabase.from("sf_customer_returns").select("*").eq("id", ret.id).single(),
      supabase.from("sf_customer_return_lines").select("*").eq("return_id", ret.id).order("sku"),
    ]);
    if (rr.data) setR(rr.data);
    setLines(ll.data || []);
  }
  useEffect(() => { reload(); }, [ret.id]);

  const refundAmount = (lines || []).reduce((s, l) => s + num(l.qty_returned) * num(l.unit_price), 0);

  async function doPutaway() {
    if (busy) return;
    const rows = (lines || []).map((l) => {
      const g = qc[l.id]?.good; const d = qc[l.id]?.damage;
      const good = g != null && g !== "" ? num(g) : num(l.qty_returned);
      const dmg = d != null && d !== "" ? num(d) : 0;
      return { l, good: Math.max(0, good), dmg: Math.max(0, dmg) };
    });
    for (const x of rows) if (x.good + x.dmg > num(x.l.qty_returned)) { setMsg({ t: "err", m: `${x.l.sku}: good + damage melebihi qty retur.` }); return; }
    setBusy(true); setMsg(null);
    try {
      for (const x of rows) await supabase.from("sf_customer_return_lines").update({ qty_good: x.good, qty_damage: x.dmg }).eq("id", x.l.id);
      // ledger: keluar dari QUARANTINE, masuk WH-MAIN (good) & DAMAGE (damage)
      const mv = [];
      for (const x of rows) {
        const total = x.good + x.dmg; if (total <= 0) continue;
        mv.push({ type: "return_putaway", sku: x.l.sku, location_id: "QUARANTINE", qty: -total, ref_type: "customer_return", ref_id: r.return_no, note: "Put-away dari Quarantine" });
        if (x.good > 0) mv.push({ type: "return_putaway", sku: x.l.sku, location_id: "WH-MAIN", qty: x.good, ref_type: "customer_return", ref_id: r.return_no, note: "Layak jual → WH-Main" });
        if (x.dmg > 0) mv.push({ type: "return_putaway", sku: x.l.sku, location_id: "DAMAGE", qty: x.dmg, ref_type: "customer_return", ref_id: r.return_no, note: "Rusak → Damage" });
      }
      if (mv.length) await supabase.from("cf_stock_movements").insert(mv);
      await supabase.from("sf_customer_returns").update({ status: "refund", putaway_at: nowISO() }).eq("id", ret.id);
      setMsg({ t: "ok", m: "Put-away selesai. Lanjut ke refund." });
      await reload(); onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal put-away: " + (e.message || "") }); } finally { setBusy(false); }
  }

  async function finishMarketplace() {
    if (busy) return; setBusy(true); setMsg(null);
    try {
      await supabase.from("sf_customer_returns").update({ status: "done", refund_at: nowISO() }).eq("id", ret.id);
      await reload(); onChange();
    } catch (e) { setMsg({ t: "err", m: e.message || "gagal" }); } finally { setBusy(false); }
  }

  async function ajukanRefund() {
    if (busy) return; setBusy(true); setMsg(null);
    try {
      const d = new Date();
      const refund_no = `RFD-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(r.return_no).slice(-3)}`;
      const { error } = await supabase.from("fin_refund_requests").insert({
        refund_no, return_id: ret.id, source_app: "salesflow", channel_id: r.channel_id,
        sales_order_ref: r.sales_order_ref, customer_name: r.customer_name, amount: refundAmount,
        status: "requested", note: `Retur ${r.return_no}`,
        bank_name: r.refund_bank_name || null, account_no: r.refund_account_no || null, account_name: r.refund_account_name || null,
      });
      if (error) throw error;
      await supabase.from("sf_customer_returns").update({ status: "done", refund_at: nowISO() }).eq("id", ret.id);
      setMsg({ t: "ok", m: "Pengajuan refund dikirim ke FinFlow." });
      await reload(); onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal ajukan refund: " + (e.message || "") }); } finally { setBusy(false); }
  }

  const stage = r.status === "qc" ? "qc" : r.status === "refund" ? "refund" : "done";

  return (
    <div className="ar-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{r.return_no}</div>
            <div className="small muted">{chName} · SO {r.sales_order_ref} · {r.customer_name || "—"} · <RStatus s={r.status} /></div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Tutup</button>
        </div>

        {msg && <div className="card" style={{ background: msg.t === "ok" ? "var(--good-soft)" : "var(--bad-soft)", borderColor: "transparent", color: msg.t === "ok" ? "var(--good)" : "var(--bad)" }}>{msg.m}</div>}

        {lines === null ? <div className="center-msg">Memuat…</div> : (
          <>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table>
                <thead><tr>
                  <th>SKU</th><th>Produk</th><th className="num">Qty Retur</th>
                  {stage === "qc" ? <><th className="num">Layak Jual</th><th className="num">Damage</th></> : <><th className="num">→ WH-Main</th><th className="num">→ Damage</th></>}
                </tr></thead>
                <tbody>{lines.map((l) => (
                  <tr key={l.id}>
                    <td className="k" style={{ fontSize: 12 }}>{l.sku}</td>
                    <td className="strong">{l.product_name || "—"}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtNum(l.qty_returned)}</td>
                    {stage === "qc" ? <>
                      <td className="num"><input className="num" type="number" min="0" max={l.qty_returned} value={qc[l.id]?.good ?? ""} placeholder={String(l.qty_returned)}
                        onChange={(e) => setQc((s) => ({ ...s, [l.id]: { ...s[l.id], good: e.target.value } }))} style={{ width: 66 }} /></td>
                      <td className="num"><input className="num" type="number" min="0" max={l.qty_returned} value={qc[l.id]?.damage ?? ""} placeholder="0"
                        onChange={(e) => setQc((s) => ({ ...s, [l.id]: { ...s[l.id], damage: e.target.value } }))} style={{ width: 66 }} /></td>
                    </> : <>
                      <td className="num" style={{ color: "var(--good)" }}>{fmtNum(l.qty_good)}</td>
                      <td className="num" style={{ color: "var(--bad)" }}>{fmtNum(l.qty_damage)}</td>
                    </>}
                  </tr>
                ))}</tbody>
              </table>
            </div>

            {Array.isArray(r.photo_urls) && r.photo_urls.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {r.photo_urls.map((u, i) => <a key={i} href={u} target="_blank" rel="noopener"><img src={u} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} /></a>)}
              </div>
            )}

            {stage === "qc" && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn btn-primary" onClick={doPutaway} disabled={busy}>{busy ? "Memproses…" : "QC → Put-away (WH-Main / Damage)"}</button>
              </div>
            )}

            {stage === "refund" && (
              <div style={{ marginTop: 14 }}>
                <div className="card" style={{ background: "var(--surface2)", border: "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div className="small muted">Nilai retur (qty retur × harga jual)</div>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtIDR(refundAmount)}</div>
                    </div>
                    {r.refund_route === "platform_auto"
                      ? <button className="btn btn-primary" onClick={finishMarketplace} disabled={busy}>Selesai (dipotong marketplace)</button>
                      : <button className="btn btn-primary" onClick={ajukanRefund} disabled={busy}>{busy ? "Mengirim…" : "Ajukan Refund ke FinFlow"}</button>}
                  </div>
                </div>
                <p className="small muted" style={{ marginTop: 8 }}>
                  {r.refund_route === "platform_auto"
                    ? "Marketplace sudah memotong pembayaran di platform — tidak ada pengajuan refund dari kita."
                    : "Pengajuan refund akan masuk ke antrian FinFlow untuk diproses pembayarannya."}
                </p>
              </div>
            )}

            {stage === "done" && <p className="small muted" style={{ marginTop: 12 }}>Retur selesai{r.refund_at ? " · " + new Date(r.refund_at).toLocaleDateString("id-ID") : ""}. {r.refund_route === "finflow_refund" ? "Refund diproses di FinFlow." : "Dipotong marketplace."}</p>}
          </>
        )}
      </div>
    </div>
  );
}
