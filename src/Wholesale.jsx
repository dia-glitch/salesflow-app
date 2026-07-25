import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, fmtNum, cleanName } from "./format.js";
import { canAct } from "./permissions.js";

const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function makeOrderNo() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rnd = Math.floor(Math.random() * 9000 + 1000);
  return `DO-${stamp}-${rnd}`;
}
const STATUS_PILL = {
  draft: { bg: "var(--surface2)", c: "var(--sub)", t: "Draft" },
  confirmed: { bg: "var(--sand)", c: "var(--sand-ink)", t: "Confirmed" },
  partial: { bg: "var(--warn-soft)", c: "var(--warn)", t: "Partial" },
  fulfilled: { bg: "var(--good-soft)", c: "var(--good)", t: "Fulfilled" },
  cancelled: { bg: "var(--bad-soft)", c: "var(--bad)", t: "Cancelled" },
};
const OStatus = ({ s }) => { const p = STATUS_PILL[s] || STATUS_PILL.draft; return <span className="pill" style={{ background: p.bg, color: p.c }}>{p.t}</span>; };
const INV_PILL = {
  issued: { bg: "var(--surface2)", c: "var(--sub)", t: "Belum bayar" },
  dp_paid: { bg: "var(--warn-soft)", c: "var(--warn)", t: "DP dibayar" },
  paid: { bg: "var(--good-soft)", c: "var(--good)", t: "Lunas" },
  submitted: { bg: "var(--accent-soft)", c: "var(--accent-ink)", t: "Submitted" },
  cancelled: { bg: "var(--bad-soft)", c: "var(--bad)", t: "Batal" },
};
const IStatus = ({ s }) => { const p = INV_PILL[s] || INV_PILL.issued; return <span className="pill" style={{ background: p.bg, color: p.c }}>{p.t}</span>; };

export default function Wholesale({ role }) {
  const canDo = canAct(role, "wholesale_order");
  const canCust = canAct(role, "wholesale_customer");
  const [view, setView] = useState("orders");   // 'orders' | 'customers'
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [orders, setOrders] = useState([]);
  const [invByOrder, setInvByOrder] = useState({});
  const [customers, setCustomers] = useState([]);
  const [skuList, setSkuList] = useState([]);    // {sku,name,code,retail}
  const [whLoc, setWhLoc] = useState("");        // location_id WH-Main
  const [stockWh, setStockWh] = useState({});    // sku -> qty di WH-Main

  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);    // order dibuka

  async function load() {
    setLoading(true); setErr("");
    try {
      const [ordRes, custRes, invRes, si, sp, prc, loc] = await Promise.all([
        supabase.from("sf_do_orders").select("*").order("order_date", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("sf_customers").select("*").order("name"),
        supabase.from("sf_do_invoices").select("id,order_id,invoice_no,type,total,paid_amount,balance,status"),
        supabase.from("sku_items").select("sku,spk_id,product_name_system,size_label,colour_lv2").limit(10000),
        supabase.from("sku_products").select("spk_id,product_code"),
        supabase.from("cogm_retail_prices").select("spk_id,retail_price"),
        supabase.from("cf_locations").select("location_id,name,type"),
      ]);
      for (const r of [ordRes, custRes, invRes, si, sp, prc, loc]) if (r.error) throw r.error;
      const codeBySpk = {}; (sp.data || []).forEach((p) => (codeBySpk[p.spk_id] = p.product_code));
      const retBySpk = {}; (prc.data || []).forEach((p) => { if (p.spk_id) retBySpk[p.spk_id] = p.retail_price; });
      const list = (si.data || []).map((x) => ({
        sku: x.sku,
        name: cleanName(x.product_name_system || x.sku, x.size_label, x.colour_lv2),
        code: codeBySpk[x.spk_id] || "",
        retail: Number(retBySpk[x.spk_id] ?? 0) || 0,
      }));
      const wh = (loc.data || []).find((l) => l.type === "wh_main");
      const whId = wh?.location_id || "";
      const im = {}; (invRes.data || []).forEach((v) => (im[v.order_id] = v));
      setOrders(ordRes.data || []); setCustomers(custRes.data || []); setInvByOrder(im);
      setSkuList(list); setWhLoc(whId);
      if (whId) {
        const { data: soh } = await supabase.from("v_cf_stock_on_hand").select("sku,qty").eq("location_id", whId);
        const sm = {}; (soh || []).forEach((s) => (sm[s.sku] = Number(s.qty) || 0));
        setStockWh(sm);
      }
    } catch (e) { setErr(e.message || String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const custName = useMemo(() => { const m = {}; customers.forEach((c) => (m[c.id] = c.name)); return m; }, [customers]);

  if (loading) return <div className="center-msg">Memuat…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="title">Pesanan Langsung / Wholesale</div>
          <div className="lead">Beli putus dari WH-Main · bisa pre-order · invoice Full/DP · diskon manual</div>
        </div>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--surface2)", padding: 5, borderRadius: 14 }}>
          {[["orders", "Pesanan"], ["customers", "Customer"]].map(([k, l]) => (
            <button key={k} onClick={() => { setView(k); setCreating(false); }}
              style={{ border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: view === k ? "var(--black)" : "transparent", color: view === k ? "#fff" : "var(--sub)" }}>{l}</button>
          ))}
        </div>
      </div>

      {err && <div className="card err-card" style={{ marginTop: 12 }}>{err}</div>}

      {view === "customers" ? (
        <Customers customers={customers} canEdit={canCust} onChange={load} />
      ) : creating ? (
        <NewOrder skuList={skuList} customers={customers} whLoc={whLoc}
          onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0" }}>
            <span className="small muted">{orders.length} order</span>
            {canDo && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Buat Order</button>}
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {orders.length === 0 ? <div className="center-msg">Belum ada pesanan.</div> : (
              <table>
                <thead><tr>
                  <th>No Order</th><th>Customer</th><th>Tanggal</th><th className="num">Total</th>
                  <th>Status</th><th>Invoice</th><th className="num">Sisa Tagihan</th><th></th>
                </tr></thead>
                <tbody>
                  {orders.map((o) => {
                    const inv = invByOrder[o.id];
                    return (
                      <tr key={o.id}>
                        <td className="strong" style={{ fontSize: 12.5 }}>{o.order_no}</td>
                        <td className="strong">{custName[o.customer_id] || "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{o.order_date}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmtIDR(o.total)}</td>
                        <td><OStatus s={o.status} /></td>
                        <td>{inv ? <IStatus s={inv.status} /> : <span className="muted small">—</span>}</td>
                        <td className="num">{inv ? fmtIDR(inv.balance) : "—"}</td>
                        <td className="num"><button className="btn btn-ghost btn-sm" onClick={() => setDetail(o)}>Detail</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {detail && (
        <OrderDetail order={detail} custName={custName[detail.customer_id] || "—"} skuList={skuList}
          stockWh={stockWh} canDo={canDo} onClose={() => setDetail(null)} onChange={() => { load(); }} />
      )}
    </div>
  );
}

/* ---------------- Buat Order ---------------- */
function NewOrder({ skuList, customers, whLoc, onCancel, onSaved }) {
  const skuMap = useMemo(() => { const m = {}; skuList.forEach((s) => (m[s.sku] = s)); return m; }, [skuList]);
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [rows, setRows] = useState([{ sku: "", qty: 1, disc: "", unit_price: "" }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  function setRow(i, patch) { setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r)); }
  function onSku(i, sku) { const m = skuMap[sku]; setRow(i, { sku, disc: m ? 0 : "", unit_price: m ? m.retail : "" }); }
  // Diskon % ↔ harga jual/unit saling sinkron dari retail
  function onDisc(i, v) {
    const retail = skuMap[rows[i]?.sku]?.retail || 0;
    const up = retail > 0 ? Math.round(retail * (1 - (Number(v) || 0) / 100)) : "";
    setRow(i, { disc: v, unit_price: up });
  }
  function onUnitPrice(i, v) {
    const retail = skuMap[rows[i]?.sku]?.retail || 0;
    const d = retail > 0 ? Math.round((1 - (Number(v) || 0) / retail) * 1000) / 10 : 0;
    setRow(i, { unit_price: v, disc: d });
  }
  const addRow = () => setRows((rs) => [...rs, { sku: "", qty: 1, disc: "", unit_price: "" }]);
  const delRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const calc = rows.map((r) => {
    const m = skuMap[r.sku]; const retail = m?.retail || 0;
    const qty = Number(r.qty) || 0; const up = Number(r.unit_price) || 0;
    return { retail, qty, up, lineTotal: up * qty, subLine: retail * qty };
  });
  const subtotal = calc.reduce((a, c) => a + c.subLine, 0);
  const total = calc.reduce((a, c) => a + c.lineTotal, 0);
  const discount = subtotal - total;

  async function save() {
    if (busy) return;
    const valid = rows.filter((r) => r.sku && (Number(r.qty) || 0) > 0);
    if (!customerId) { setMsg({ t: "err", m: "Pilih customer dulu." }); return; }
    if (valid.length === 0) { setMsg({ t: "err", m: "Tambahkan minimal satu produk." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: ord, error } = await supabase.from("sf_do_orders").insert({
        order_no: makeOrderNo(), customer_id: customerId, order_date: orderDate,
        fulfill_location_id: whLoc || "WH-MAIN", status: "draft",
        subtotal, discount, total, note: note.trim() || null, created_by: user?.id || null,
      }).select().single();
      if (error) throw error;
      const lines = valid.map((r) => {
        const m = skuMap[r.sku]; const qty = Number(r.qty) || 0; const up = Number(r.unit_price) || 0;
        return { order_id: ord.id, sku: r.sku, product_name: m?.name || null, qty_order: qty,
          qty_fulfilled: 0, retail_price: m?.retail || 0, unit_price: up, line_total: up * qty };
      });
      const { error: e2 } = await supabase.from("sf_do_order_lines").insert(lines);
      if (e2) throw e2;
      onSaved();
    } catch (e) { setMsg({ t: "err", m: "Gagal simpan: " + (e.message || "cek izin/koneksi") }); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 14 }}>
      {msg && <div className="card" style={{ background: "var(--bad-soft)", borderColor: "transparent", color: "var(--bad)" }}>{msg.m}</div>}
      <div className="card">
        <div className="grid3">
          <div>
            <label>Customer</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— pilih customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label>Tanggal order</label><input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
          <div><label>Catatan (opsional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. ambil sendiri / kirim" /></div>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Ambil dari WH-Main. Diskon wholesale diisi manual lewat kolom <b>Harga jual/unit</b> (di bawah harga retail).</p>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr>
            <th>Produk</th><th className="num">Qty</th><th className="num">Retail</th><th className="num">Diskon %</th><th className="num">Harga jual/unit</th>
            <th className="num">Total baris</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const c = calc[i];
              return (
                <tr key={i}>
                  <td style={{ minWidth: 240 }}>
                    <input list="wsskus" value={r.sku} onChange={(e) => onSku(i, e.target.value)} placeholder="ketik / pilih SKU" />
                    {skuMap[r.sku] && <div className="small muted" style={{ marginTop: 2 }}>{skuMap[r.sku].name} · {skuMap[r.sku].code}</div>}
                  </td>
                  <td><input className="num" type="number" min="1" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} style={{ width: 70 }} /></td>
                  <td className="num">{c.retail ? fmtIDR(c.retail) : "—"}</td>
                  <td><input className="num" type="number" min="0" max="100" value={r.disc} onChange={(e) => onDisc(i, e.target.value)} style={{ width: 80 }} placeholder="0" disabled={!c.retail} /></td>
                  <td><input className="num" type="number" min="0" value={r.unit_price} onChange={(e) => onUnitPrice(i, e.target.value)} style={{ width: 120 }} /></td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmtIDR(c.lineTotal)}</td>
                  <td className="num"><button className="x" onClick={() => delRow(i)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="wsskus">{skuList.map((s) => <option key={s.sku} value={s.sku}>{s.name} ({s.sku})</option>)}</datalist>
        <div style={{ padding: "10px 14px" }}><button className="btn btn-ghost btn-sm" onClick={addRow}>+ Baris</button></div>
      </div>

      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 28 }}>
          <div><div className="small muted">Subtotal (retail)</div><div style={{ fontWeight: 700 }}>{fmtIDR(subtotal)}</div></div>
          <div><div className="small muted">Diskon</div><div style={{ fontWeight: 700, color: "var(--accent)" }}>{fmtIDR(discount)}</div></div>
          <div><div className="small muted">Total jual</div><div style={{ fontWeight: 800, fontSize: 18 }}>{fmtIDR(total)}</div></div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Order (Draft)"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Detail Order ---------------- */
function OrderDetail({ order, custName, stockWh, canDo, onClose, onChange }) {
  const [lines, setLines] = useState(null);
  const [inv, setInv] = useState(null);
  const [pays, setPays] = useState([]);
  const [ship, setShip] = useState({});      // line_id -> qty kirim
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function reload() {
    const [lnRes, ivRes] = await Promise.all([
      supabase.from("sf_do_order_lines").select("*").eq("order_id", order.id).order("sku"),
      supabase.from("sf_do_invoices").select("*").eq("order_id", order.id).maybeSingle(),
    ]);
    setLines(lnRes.data || []);
    setInv(ivRes.data || null);
    if (ivRes.data) {
      const { data: p } = await supabase.from("sf_do_payments").select("*").eq("invoice_id", ivRes.data.id).order("paid_at");
      setPays(p || []);
    } else setPays([]);
  }
  useEffect(() => { reload(); }, [order.id]);

  async function doFulfill() {
    if (busy) return;
    const payload = Object.entries(ship).map(([line_id, qty]) => ({ line_id, qty: Number(qty) || 0 })).filter((x) => x.qty > 0);
    if (payload.length === 0) { setMsg({ t: "err", m: "Isi qty kirim minimal satu baris." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.rpc("sf_do_fulfill", { p_order_id: order.id, p_lines: payload });
      if (error) throw error;
      setShip({}); setMsg({ t: "ok", m: "Barang dikirim & stok dipotong." });
      await reload(); onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal kirim: " + (e.message || "cek stok/izin") }); } finally { setBusy(false); }
  }

  if (lines === null) return (
    <div className="ar-overlay" onClick={onClose}><div className="ar-modal" onClick={(e) => e.stopPropagation()}><div className="center-msg">Memuat…</div></div></div>
  );

  return (
    <div className="ar-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{order.order_no}</div>
            <div className="small muted">{custName} · {order.order_date} · <OStatus s={order.status} /></div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Tutup</button>
        </div>

        {msg && <div className="card" style={{ background: msg.t === "ok" ? "var(--good-soft)" : "var(--bad-soft)", borderColor: "transparent", color: msg.t === "ok" ? "var(--good)" : "var(--bad)" }}>{msg.m}</div>}

        {/* baris + fulfillment */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead><tr>
              <th>SKU</th><th>Produk</th><th className="num">Order</th><th className="num">Terkirim</th>
              <th className="num">Sisa</th><th className="num">Stok WH</th><th className="num">Harga/unit</th>
              {canDo && order.status !== "cancelled" && order.status !== "fulfilled" && <th className="num">Kirim</th>}
            </tr></thead>
            <tbody>
              {lines.map((l) => {
                const sisa = Number(l.qty_order) - Number(l.qty_fulfilled);
                const stok = stockWh[l.sku] ?? 0;
                const canShip = canDo && order.status !== "cancelled" && order.status !== "fulfilled";
                return (
                  <tr key={l.id}>
                    <td style={{ fontSize: 12 }}>{l.sku}</td>
                    <td className="strong">{l.product_name || "—"}</td>
                    <td className="num">{fmtNum(l.qty_order)}</td>
                    <td className="num">{fmtNum(l.qty_fulfilled)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtNum(sisa)}</td>
                    <td className="num" style={{ color: stok < sisa ? "var(--bad)" : undefined }}>{fmtNum(stok)}</td>
                    <td className="num">{fmtIDR(l.unit_price)}</td>
                    {canShip && (
                      <td className="num">
                        {sisa > 0 ? (
                          <input className="num" type="number" min="0" max={Math.min(sisa, stok)} value={ship[l.id] ?? ""}
                            onChange={(e) => setShip((s) => ({ ...s, [l.id]: e.target.value }))} style={{ width: 70 }} placeholder="0" />
                        ) : <span className="muted">—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canDo && order.status !== "cancelled" && order.status !== "fulfilled" && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={doFulfill} disabled={busy}>{busy ? "Memproses…" : "Kirim dari WH-Main"}</button>
          </div>
        )}

        {/* Invoice + pembayaran */}
        <InvoicePanel order={order} inv={inv} pays={pays} canDo={canDo} onChange={() => { reload(); onChange(); }} />
      </div>
    </div>
  );
}

/* ---------------- Invoice + Pembayaran ---------------- */
function InvoicePanel({ order, inv, pays, canDo, onChange }) {
  const [type, setType] = useState("full");
  const [dp, setDp] = useState("");
  const [due, setDue] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [method, setMethod] = useState("transfer");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function issue() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const dpAmt = type === "dp" ? (Number(dp) || 0) : 0;
      const { error } = await supabase.from("sf_do_invoices").insert({
        order_id: order.id, invoice_no: "INV-" + order.order_no, type,
        total: order.total, dp_amount: dpAmt, paid_amount: 0, balance: order.total,
        status: "issued", due_date: due || null,
      });
      if (error) throw error;
      await supabase.from("sf_do_orders").update({ status: order.status === "draft" ? "confirmed" : order.status }).eq("id", order.id);
      onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal terbitkan invoice: " + (e.message || "") }); } finally { setBusy(false); }
  }

  async function addPayment() {
    if (busy || !inv) return;
    const amt = Number(payAmt) || 0;
    if (amt <= 0) { setMsg({ t: "err", m: "Nominal pembayaran tidak valid." }); return; }
    setBusy(true); setMsg(null);
    try {
      const paid = Number(inv.paid_amount) + amt;
      const balance = Math.max(0, Number(inv.total) - paid);
      const kind = paid < Number(inv.total) ? "dp" : "settlement";
      const { error } = await supabase.from("sf_do_payments").insert({ invoice_id: inv.id, amount: amt, method, kind });
      if (error) throw error;
      const status = balance <= 0 ? "paid" : "dp_paid";
      await supabase.from("sf_do_invoices").update({ paid_amount: paid, balance, status }).eq("id", inv.id);
      setPayAmt(""); onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal catat pembayaran: " + (e.message || "") }); } finally { setBusy(false); }
  }

  async function submitFinance() {
    if (busy || !inv) return;
    setBusy(true);
    try { await supabase.from("sf_do_invoices").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", inv.id); onChange(); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="section-label">Invoice & Pembayaran</div>
      {msg && <div className="small err" style={{ marginTop: 8 }}>{msg.m}</div>}
      {!inv ? (
        canDo ? (
          <div style={{ marginTop: 12 }}>
            <div className="grid3">
              <div>
                <label>Tipe invoice</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="full">Full payment</option>
                  <option value="dp">DP (uang muka)</option>
                </select>
              </div>
              {type === "dp" && <div><label>Nominal DP</label><input type="number" min="0" value={dp} onChange={(e) => setDp(e.target.value)} placeholder="mis. 500000" /></div>}
              <div><label>Jatuh tempo (opsional)</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={issue} disabled={busy}>Terbitkan Invoice · {fmtIDR(order.total)}</button>
            </div>
          </div>
        ) : <p className="small muted" style={{ marginTop: 10 }}>Belum ada invoice.</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="grid3" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="l">Total invoice</div><div className="v" style={{ fontSize: 22 }}>{fmtIDR(inv.total)}</div><div className="d muted">{inv.invoice_no} · {inv.type === "dp" ? "DP" : "Full"}</div></div>
            <div className="kpi"><div className="l">Sudah dibayar</div><div className="v" style={{ fontSize: 22, color: "var(--good)" }}>{fmtIDR(inv.paid_amount)}</div><div className="d"><IStatus s={inv.status} /></div></div>
            <div className="kpi"><div className="l">Sisa tagihan</div><div className="v" style={{ fontSize: 22, color: inv.balance > 0 ? "var(--accent)" : "var(--good)" }}>{fmtIDR(inv.balance)}</div>{inv.due_date && <div className="d muted">jatuh tempo {inv.due_date}</div>}</div>
          </div>

          {pays.length > 0 && (
            <table style={{ marginBottom: 12 }}>
              <thead><tr><th>Tanggal</th><th>Jenis</th><th>Metode</th><th className="num">Nominal</th></tr></thead>
              <tbody>{pays.map((p) => (
                <tr key={p.id}><td>{p.paid_at}</td><td>{p.kind === "dp" ? "DP" : "Pelunasan"}</td><td>{p.method || "—"}</td><td className="num strong">{fmtIDR(p.amount)}</td></tr>
              ))}</tbody>
            </table>
          )}

          {canDo && inv.balance > 0 && inv.status !== "submitted" && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div><label>Catat pembayaran</label><input type="number" min="0" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} placeholder="nominal" style={{ width: 160 }} /></div>
              <div><label>Metode</label><select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 130 }}><option value="transfer">Transfer</option><option value="cash">Cash</option><option value="other">Lainnya</option></select></div>
              <button className="btn btn-primary" onClick={addPayment} disabled={busy}>Tambah</button>
            </div>
          )}

          {canDo && inv.status !== "submitted" && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <button className="btn btn-ghost" onClick={submitFinance} disabled={busy}>Submit Invoice ke Finance</button>
              <span className="small muted" style={{ marginLeft: 10 }}>Tandai siap dioper ke app Finance.</span>
            </div>
          )}
          {inv.status === "submitted" && <p className="small muted" style={{ marginTop: 12 }}>✓ Invoice sudah di-submit ke Finance.</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Master Customer ---------------- */
function Customers({ customers, canEdit, onChange }) {
  const [form, setForm] = useState({ name: "", code: "", contact: "", address: "", payment_term: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function add() {
    if (busy || !form.name.trim()) { setMsg({ t: "err", m: "Nama customer wajib diisi." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.from("sf_customers").insert({
        name: form.name.trim(), code: form.code.trim() || null, contact: form.contact.trim() || null,
        address: form.address.trim() || null, payment_term: form.payment_term.trim() || null,
      });
      if (error) throw error;
      setForm({ name: "", code: "", contact: "", address: "", payment_term: "" });
      onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal simpan: " + (e.message || "") }); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 14 }}>
      {canEdit && (
        <div className="card">
          <div className="section-label">Tambah customer</div>
          {msg && <div className="small err" style={{ marginTop: 8 }}>{msg.m}</div>}
          <div className="grid3" style={{ marginTop: 10 }}>
            <div><label>Nama *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label>Kode (opsional)</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="WS-001" /></div>
            <div><label>Kontak</label><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="HP / email" /></div>
            <div><label>Alamat</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><label>Term pembayaran</label><input value={form.payment_term} onChange={(e) => setForm({ ...form, payment_term: e.target.value })} placeholder="mis. DP 50%" /></div>
          </div>
          <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Customer"}</button></div>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {customers.length === 0 ? <div className="center-msg">Belum ada customer.</div> : (
          <table>
            <thead><tr><th>Nama</th><th>Kode</th><th>Kontak</th><th>Alamat</th><th>Term</th></tr></thead>
            <tbody>{customers.map((c) => (
              <tr key={c.id}><td className="strong">{c.name}</td><td>{c.code || "—"}</td><td>{c.contact || "—"}</td><td className="muted">{c.address || "—"}</td><td>{c.payment_term || "—"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
