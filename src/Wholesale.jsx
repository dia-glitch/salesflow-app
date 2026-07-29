import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { loadHiddenSkus, isHiddenSku, fullyHiddenDocIds } from "./hiddenData.js";
import { fmtIDR, fmtNum, cleanName } from "./format.js";
import { canAct } from "./permissions.js";
import { loadPrefixes, renderNumber, numberStem } from "./prefixes.js";

const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Nomor order urut mengikuti master (prefix + format), mis. DO-YYMMDD-001
async function nextOrderNo() {
  const p = await loadPrefixes();
  const cfg = p.wholesale_order;
  const now = new Date();
  const stem = numberStem(cfg.prefix, cfg.format, { date: now });
  const { count } = await supabase.from("sf_do_orders").select("id", { count: "exact", head: true }).like("order_no", `${stem}%`);
  return renderNumber(cfg.prefix, cfg.format, { date: now, seq: (count || 0) + 1 });
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
  const [tab, setTab] = useState("order");   // 'order'|'invoice'|'fulfillment'|'customers'
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [orders, setOrders] = useState([]);
  const [invsByOrder, setInvsByOrder] = useState({});   // order_id -> [invoices]
  const [aggByOrder, setAggByOrder] = useState({});     // order_id -> {qtyOrder,qtyFulfilled,delivered}
  const [customers, setCustomers] = useState([]);
  const [skuList, setSkuList] = useState([]);
  const [whLoc, setWhLoc] = useState("");
  const [stockWh, setStockWh] = useState({});

  const [creating, setCreating] = useState(false);
  const [modal, setModal] = useState(null);   // {kind:'view'|'invoice'|'fulfill', order}

  async function load() {
    setLoading(true); setErr("");
    try {
      const [ordRes, custRes, invRes, lnRes, si, sp, prc, loc] = await Promise.all([
        supabase.from("sf_do_orders").select("*").order("order_date", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("sf_customers").select("*").order("name"),
        supabase.from("sf_do_invoices").select("*"),
        supabase.from("sf_do_order_lines").select("order_id,sku,qty_order,qty_fulfilled,unit_price"),
        supabase.from("sku_items").select("sku,spk_id,product_name_system,size_label,colour_lv2").limit(10000),
        supabase.from("sku_products").select("spk_id,product_code"),
        supabase.from("cogm_retail_prices").select("spk_id,retail_price"),
        supabase.from("cf_locations").select("location_id,name,type"),
      ]);
      for (const r of [ordRes, custRes, invRes, lnRes, si, sp, prc, loc]) if (r.error) throw r.error;
      await loadHiddenSkus();
      const codeBySpk = {}; (sp.data || []).forEach((p) => (codeBySpk[p.spk_id] = p.product_code));
      const retBySpk = {}; (prc.data || []).forEach((p) => { if (p.spk_id) retBySpk[p.spk_id] = p.retail_price; });
      setSkuList((si.data || []).filter((x) => !isHiddenSku(x.sku)).map((x) => ({
        sku: x.sku, name: cleanName(x.product_name_system || x.sku, x.size_label, x.colour_lv2),
        code: codeBySpk[x.spk_id] || "", retail: Number(retBySpk[x.spk_id] ?? 0) || 0,
      })));
      const invMap = {}; (invRes.data || []).forEach((v) => { (invMap[v.order_id] = invMap[v.order_id] || []).push(v); });
      const hiddenOrderIds = fullyHiddenDocIds(lnRes.data, "order_id");
      const agg = {}; (lnRes.data || []).filter((l) => !isHiddenSku(l.sku)).forEach((l) => {
        const a = agg[l.order_id] = agg[l.order_id] || { qtyOrder: 0, qtyFulfilled: 0, delivered: 0 };
        a.qtyOrder += Number(l.qty_order) || 0; a.qtyFulfilled += Number(l.qty_fulfilled) || 0;
        a.delivered += (Number(l.unit_price) || 0) * (Number(l.qty_fulfilled) || 0);
      });
      const wh = (loc.data || []).find((l) => l.type === "wh_main");
      setOrders((ordRes.data || []).filter((o) => !hiddenOrderIds.has(o.id))); setCustomers(custRes.data || []);
      setInvsByOrder(invMap); setAggByOrder(agg); setWhLoc(wh?.location_id || "");
      if (wh?.location_id) {
        const { data: soh } = await supabase.from("v_cf_stock_on_hand").select("sku,qty").eq("location_id", wh.location_id);
        const sm = {}; (soh || []).forEach((s) => (sm[s.sku] = Number(s.qty) || 0));
        setStockWh(sm);
      }
    } catch (e) { setErr(e.message || String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const custName = useMemo(() => { const m = {}; customers.forEach((c) => (m[c.id] = c.name)); return m; }, [customers]);
  const custById = useMemo(() => { const m = {}; customers.forEach((c) => (m[c.id] = c)); return m; }, [customers]);

  function derive(o) {
    const invs = invsByOrder[o.id] || [];
    const agg = aggByOrder[o.id] || { qtyOrder: 0, qtyFulfilled: 0, delivered: 0 };
    const paidTotal = invs.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    const balanceTotal = invs.reduce((s, i) => s + Number(i.balance || 0), 0);
    const dpPaid = invs.filter((i) => i.type === "dp").reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    const hasFull = invs.some((i) => i.type === "full");
    const hasDp = invs.some((i) => i.type === "dp");
    const hasSettle = invs.some((i) => i.type === "settlement");
    const closedOrDone = o.status === "closed" || o.status === "fulfilled";
    const anyRemaining = agg.qtyOrder - agg.qtyFulfilled > 0;
    const settleAmount = Math.max(0, agg.delivered - dpPaid);
    const financeAction = o.status !== "cancelled" && (
      invs.length === 0 || balanceTotal > 0 || (closedOrDone && hasDp && !hasFull && !hasSettle && settleAmount > 0)
    );
    const fulfillReady = o.status !== "cancelled" && !closedOrDone && anyRemaining && paidTotal > 0;
    // Antrian Warehouse: seluruh siklus pasca-bayar sampai order ditutup
    // (packing → kirim → penerimaan). Sudah diterima tapi belum closed tetap tampil agar bisa ditutup.
    const inFulfill = o.status !== "cancelled" && o.status !== "closed" && paidTotal > 0;
    return { invs, agg, paidTotal, balanceTotal, financeAction, fulfillReady, inFulfill };
  }

  if (loading) return <div className="center-msg">Memuat…</div>;

  const invoiceQueue = orders.filter((o) => derive(o).financeAction);
  const fulfillQueue = orders.filter((o) => derive(o).inFulfill);
  const TABS = [["order", "Order", "Sales"], ["invoice", "Invoice", "Finance"], ["fulfillment", "Fulfillment", "Warehouse"], ["customers", "Customer", ""]];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="title">Direct Purchase</div>
          <div className="lead">Beli putus dari WH-Main · alur estafet: Sales → Finance → Warehouse</div>
        </div>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--surface2)", padding: 5, borderRadius: 14, flexWrap: "wrap" }}>
          {TABS.map(([k, l, pic]) => (
            <button key={k} onClick={() => { setTab(k); setCreating(false); }}
              style={{ border: "none", borderRadius: 10, padding: "8px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer", lineHeight: 1.1, textAlign: "center",
                background: tab === k ? "var(--black)" : "transparent", color: tab === k ? "#fff" : "var(--sub)" }}>
              {l}{pic && <div style={{ fontSize: 10, fontWeight: 700, opacity: .7 }}>{pic}</div>}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="card err-card" style={{ marginTop: 12 }}>{err}</div>}

      {tab === "customers" && <Customers customers={customers} canEdit={canCust} onChange={load} />}

      {tab === "order" && (creating ? (
        <NewOrder skuList={skuList} customers={customers} whLoc={whLoc}
          onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0" }}>
            <span className="small muted">{orders.length} order · antrian Sales</span>
            {canDo && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Buat Order</button>}
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {orders.length === 0 ? <div className="center-msg">Belum ada pesanan.</div> : (
              <table>
                <thead><tr><th>No Order</th><th>Tgl Order</th><th>Customer</th><th className="num">Total</th><th>Progres pipeline</th><th></th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="strong" style={{ fontSize: 12.5 }}>{o.order_no}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{o.order_date || (o.created_at ? String(o.created_at).slice(0, 10) : "—")}</td>
                      <td className="strong">{custName[o.customer_id] || "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmtIDR(o.total)}</td>
                      <td><PipelineChips o={o} d={derive(o)} /></td>
                      <td className="num"><button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "view", order: o })}>Lihat</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ))}

      {tab === "invoice" && (
        <div style={{ marginTop: 14 }}>
          <p className="small muted" style={{ marginBottom: 12 }}>Antrian Finance — order yang butuh invoice / pembayaran / pelunasan.</p>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {invoiceQueue.length === 0 ? <div className="center-msg">Tidak ada order menunggu proses invoice.</div> : (
              <table>
                <thead><tr><th>No Order</th><th>Customer</th><th className="num">Total</th><th className="num">Terbayar</th><th className="num">Sisa</th><th></th></tr></thead>
                <tbody>
                  {invoiceQueue.map((o) => { const d = derive(o); return (
                    <tr key={o.id}>
                      <td className="strong" style={{ fontSize: 12.5 }}>{o.order_no}</td>
                      <td className="strong">{custName[o.customer_id] || "—"}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmtIDR(o.total)}</td>
                      <td className="num">{fmtIDR(d.paidTotal)}</td>
                      <td className="num" style={{ color: d.balanceTotal > 0 ? "var(--accent)" : undefined }}>{d.invs.length ? fmtIDR(d.balanceTotal) : <span className="muted">belum ada invoice</span>}</td>
                      <td className="num"><button className="btn btn-primary btn-sm" onClick={() => setModal({ kind: "invoice", order: o })}>Proses</button></td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "fulfillment" && (
        <div style={{ marginTop: 14 }}>
          <p className="small muted" style={{ marginBottom: 12 }}>Antrian Warehouse — order siap kirim (DP/invoice sudah dibayar).</p>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {fulfillQueue.length === 0 ? <div className="center-msg">Belum ada order siap kirim (menunggu pembayaran DP/invoice dari Finance).</div> : (
              <table>
                <thead><tr><th>No Order</th><th>Customer</th><th className="num">Qty order</th><th className="num">Terkirim</th><th>Tahap</th><th></th></tr></thead>
                <tbody>
                  {fulfillQueue.map((o) => {
                    const d = derive(o);
                    const st = o.status === "closed" ? "done" : o.received_at ? "done" : o.shipped_at ? "receiving" : o.packed_at ? "ship" : "packing";
                    const stLabel = { packing: "Picking & Packing", ship: "Surat Jalan & Kirim", receiving: "Menunggu Terima", done: "Selesai" }[st];
                    const btnLabel = { packing: "Proses", ship: "Kirim", receiving: "Konfirmasi Terima", done: "Lihat" }[st];
                    const stColor = { packing: ["var(--surface2)", "var(--sub)"], ship: ["var(--accent-soft)", "var(--accent-ink)"], receiving: ["var(--warn-soft)", "var(--warn)"], done: ["var(--good-soft)", "var(--good)"] }[st];
                    return (
                      <tr key={o.id}>
                        <td className="strong" style={{ fontSize: 12.5 }}>{o.order_no}</td>
                        <td className="strong">{custName[o.customer_id] || "—"}</td>
                        <td className="num">{fmtNum(d.agg.qtyOrder)}</td>
                        <td className="num">{fmtNum(d.agg.qtyFulfilled)}</td>
                        <td><span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: stColor[0], color: stColor[1] }}>{stLabel}</span></td>
                        <td className="num"><button className="btn btn-primary btn-sm" onClick={() => setModal({ kind: "fulfill", order: o })}>{btnLabel}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {modal?.kind === "view" && <OrderView order={modal.order} custName={custName[modal.order.customer_id] || "—"} canDo={canDo} onClose={() => setModal(null)} onChange={load} />}
      {modal?.kind === "invoice" && <InvoiceModal order={modal.order} custName={custName[modal.order.customer_id] || "—"} canDo={canDo} onClose={() => setModal(null)} onChange={load} />}
      {modal?.kind === "fulfill" && <FulfillModal order={modal.order} custName={custName[modal.order.customer_id] || "—"} customer={custById[modal.order.customer_id] || null} stockWh={stockWh} canDo={canDo} onClose={() => setModal(null)} onChange={load} />}
    </div>
  );
}

/* chips progres pipeline (tab Order) */
function PipelineChips({ o, d }) {
  const chip = (state, label) => {
    const map = { done: { bg: "var(--good-soft)", c: "var(--good)" }, now: { bg: "var(--accent-soft)", c: "var(--accent-ink)" }, pending: { bg: "var(--surface2)", c: "var(--faint)" } };
    const s = map[state] || map.pending;
    return <span className="pill" style={{ background: s.bg, color: s.c, fontSize: 10.5 }}>{label}</span>;
  };
  const orderState = o.status === "draft" ? "now" : o.status === "cancelled" ? "pending" : "done";
  const invState = d.invs.length === 0 ? "pending" : d.financeAction ? "now" : "done";
  const shipDone = o.status === "fulfilled" || o.status === "closed";
  const shipState = shipDone ? "done" : d.fulfillReady ? "now" : "pending";
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {chip(orderState, o.status === "draft" ? "Order (draft)" : "Order ✓")}
      {chip(invState, invState === "done" ? "Invoice ✓" : "Invoice")}
      {chip(shipState, `Kirim ${fmtNum(d.agg.qtyFulfilled)}/${fmtNum(d.agg.qtyOrder)}`)}
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
      const order_no = await nextOrderNo();
      const { data: ord, error } = await supabase.from("sf_do_orders").insert({
        order_no, customer_id: customerId, order_date: orderDate,
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
        <p className="small muted" style={{ marginTop: 8 }}>Ambil dari WH-Main. Isi <b>Diskon %</b> — harga jual/unit otomatis jadi retail − diskon (boleh juga ketik harga jual langsung).</p>
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

/* ---------------- Modal: Lihat Order (read-only, tab Sales) ---------------- */
function OrderView({ order, custName, canDo, onClose, onChange }) {
  const [lines, setLines] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const paidTotal = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  async function cancelOrder() {
    if (busy || paidTotal > 0) return;
    if (!window.confirm(`Batalkan order ${order.order_no}?\n\nOrder akan ditandai Cancelled. Belum ada pembayaran & belum dikirim — jadi tidak ada stok/uang yang bergerak.`)) return;
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.from("sf_do_orders").update({ status: "cancelled" }).eq("id", order.id);
      if (error) throw error;
      onChange && onChange(); onClose();
    } catch (e) { setMsg("Gagal membatalkan: " + (e.message || "")); } finally { setBusy(false); }
  }
  useEffect(() => { (async () => {
    const [lnRes, ivRes] = await Promise.all([
      supabase.from("sf_do_order_lines").select("*").eq("order_id", order.id).order("sku"),
      supabase.from("sf_do_invoices").select("*").eq("order_id", order.id).order("created_at"),
    ]);
    setLines(lnRes.data || []); setInvoices(ivRes.data || []);
  })(); }, [order.id]);
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
        {lines === null ? <div className="center-msg">Memuat…</div> : (
          <>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table>
                <thead><tr><th>SKU</th><th>Produk</th><th className="num">Qty</th><th className="num">Terkirim</th><th className="num">Harga/unit</th><th className="num">Total</th></tr></thead>
                <tbody>{lines.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontSize: 12 }}>{l.sku}</td><td className="strong">{l.product_name || "—"}</td>
                    <td className="num">{fmtNum(l.qty_order)}</td><td className="num">{fmtNum(l.qty_fulfilled)}</td>
                    <td className="num">{fmtIDR(l.unit_price)}</td><td className="num strong">{fmtIDR(Number(l.unit_price) * Number(l.qty_order))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="small muted">Total order: <b style={{ color: "var(--ink)" }}>{fmtIDR(order.total)}</b> · {invoices.length === 0 ? "belum ada invoice" : invoices.map((i) => `${i.invoice_no} (${i.type})`).join(" · ")}</div>
            {canDo && order.status !== "cancelled" && order.status !== "closed" && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                {paidTotal > 0
                  ? <div className="small" style={{ color: "var(--warn)", textAlign: "right", maxWidth: 440 }}>Sudah ada pembayaran ({fmtIDR(paidTotal)}) — order tidak bisa dibatalkan dari sini. Batalkan lewat <b>Refund</b> di FinFlow.</div>
                  : <button className="btn btn-ghost btn-sm" style={{ color: "var(--bad)", borderColor: "var(--bad-soft)" }} onClick={cancelOrder} disabled={busy}>{busy ? "…" : "Batalkan Order"}</button>}
              </div>
            )}
            {msg && <div className="small err" style={{ marginTop: 8 }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Dokumen cetak (Picking List / Surat Jalan) ---------------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function openPrint(title, bodyHtml) {
  const w = window.open("", "_blank", "width=840,height=940");
  if (!w) { alert("Popup diblokir browser. Izinkan popup untuk mencetak dokumen."); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    *{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:0;padding:30px 34px;font-size:13px}
    .doc-h{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}
    .doc-h .co{font-size:18px;font-weight:800;letter-spacing:.5px}.doc-h .co small{display:block;font-weight:500;color:#555;font-size:11px;letter-spacing:0}
    .doc-t{font-size:18px;font-weight:800;letter-spacing:1px;text-align:right}.doc-meta{text-align:right;font-size:11.5px;color:#333;margin-top:4px;line-height:1.5}
    .meta-row{display:flex;gap:48px;margin:2px 0 14px}.meta-row b{display:block;color:#666;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px}
    .ship-to{margin:2px 0 16px}.ship-to b{display:block;color:#666;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px}.ship-to .nm{font-size:15px;font-weight:800}.ship-to .addr{font-size:12px;color:#333;margin-top:2px;max-width:72%;line-height:1.45;white-space:pre-line}
    table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1px solid #bbb;padding:7px 9px;text-align:left;font-size:12px}
    th{background:#f2f2f0;text-transform:uppercase;font-size:10px;letter-spacing:.4px}td.n,th.n{text-align:right}
    tfoot td{font-weight:700;background:#fafafa}
    .sign{display:flex;justify-content:space-between;margin-top:52px}.sign div{width:42%;text-align:center;font-size:12px;color:#333}.sign .ln{margin-top:54px;border-top:1px solid #111;padding-top:5px}
    @media print{body{padding:6px}}
  </style></head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
  w.document.close();
}
function docHTML(kind, ord, lines, cust) {
  const isSJ = kind === "sj";
  const dateStr = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const qtyOf = (l) => isSJ ? (Number(l.qty_packed) || 0) : (Number(l.qty_order) - Number(l.qty_fulfilled));
  const rows = (lines || []).filter((l) => qtyOf(l) > 0).map((l, i) =>
    `<tr><td class="n">${i + 1}</td><td>${esc(l.sku)}</td><td>${esc(l.product_name || "")}</td><td class="n">${qtyOf(l)}</td>${isSJ ? "" : '<td class="n" style="width:90px"></td>'}</tr>`
  ).join("");
  const totQty = (lines || []).reduce((s, l) => s + Math.max(0, qtyOf(l)), 0);
  const meta = (isSJ ? `No. Surat Jalan: <b>${esc(ord.sj_no || "-")}</b><br>` : "") + `No. DO: ${esc(ord.order_no)}<br>${dateStr}`;
  return `
    <div class="doc-h"><div class="co">ALEZA<small>PT Asa Modakreasi Indonesia</small></div>
      <div><div class="doc-t">${isSJ ? "SURAT JALAN" : "PICKING LIST"}</div><div class="doc-meta">${meta}</div></div></div>
    <div class="ship-to"><b>Kepada</b><div class="nm">${esc((cust && cust.name) || "-")}</div>${cust && cust.address ? `<div class="addr">${esc(cust.address)}</div>` : '<div class="addr" style="color:#b00">— alamat customer belum diisi —</div>'}${cust && cust.contact ? `<div class="addr">Kontak: ${esc(cust.contact)}</div>` : ""}</div>
    <table><thead><tr><th class="n">#</th><th>SKU</th><th>Produk</th><th class="n">${isSJ ? "Qty Kirim" : "Qty Diminta"}</th>${isSJ ? "" : '<th class="n">Qty Diambil</th>'}</tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#999">Tidak ada baris</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">TOTAL</td><td class="n">${totQty}</td>${isSJ ? "" : "<td></td>"}</tr></tfoot></table>
    ${ord.note ? `<p style="margin-top:12px;font-size:12px"><b>Catatan:</b> ${esc(ord.note)}</p>` : ""}
    <div class="sign"><div>Pengirim / Gudang<div class="ln">(&nbsp;____________________&nbsp;)</div></div><div>${isSJ ? "Penerima / Customer" : "Diperiksa"}<div class="ln">(&nbsp;____________________&nbsp;)</div></div></div>`;
}

/* ---------------- Modal: Fulfillment (tab Warehouse) ---------------- */
function FulfillModal({ order, custName, customer, stockWh, canDo, onClose, onChange }) {
  const [ord, setOrd] = useState(order);
  const [lines, setLines] = useState(null);
  const [pack, setPack] = useState({});     // line_id -> qty tersedia (packing)
  const [recv, setRecv] = useState({});     // line_id -> qty diterima customer
  const [photos, setPhotos] = useState([]); // File[] belum diupload
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function reload() {
    const [o, l] = await Promise.all([
      supabase.from("sf_do_orders").select("*").eq("id", order.id).single(),
      supabase.from("sf_do_order_lines").select("*").eq("order_id", order.id).order("sku"),
    ]);
    if (o.data) setOrd(o.data);
    setLines(l.data || []);
  }
  useEffect(() => { reload(); }, [order.id]);

  const packed = !!ord.packed_at, shipped = !!ord.shipped_at, received = !!ord.received_at;
  const closed = ord.status === "cancelled" || ord.status === "closed";
  const stage = closed ? "closed" : received ? "done" : shipped ? "receiving" : packed ? "ship" : "packing";
  const rem = (l) => Number(l.qty_order) - Number(l.qty_fulfilled);

  async function confirmPacking() {
    if (busy) return;
    const rows = (lines || []).map((l) => {
      const maxv = Math.max(0, Math.min(rem(l), stockWh[l.sku] ?? 0));
      const raw = pack[l.id] != null && pack[l.id] !== "" ? Number(pack[l.id]) : maxv;
      return { id: l.id, qty: Math.max(0, Math.min(raw || 0, maxv)) };
    });
    if (!rows.some((r) => r.qty > 0)) { setMsg({ t: "err", m: "Isi qty tersedia minimal satu baris." }); return; }
    setBusy(true); setMsg(null);
    try {
      for (const r of rows) await supabase.from("sf_do_order_lines").update({ qty_packed: r.qty }).eq("id", r.id);
      const sjNo = ord.sj_no || ("SJ" + String(order.order_no || "").replace(/^DO/i, ""));
      await supabase.from("sf_do_orders").update({ packed_at: new Date().toISOString(), sj_no: sjNo, status: ord.status === "draft" ? "confirmed" : ord.status }).eq("id", order.id);
      setMsg({ t: "ok", m: "Packing dikonfirmasi. Cetak Surat Jalan & upload foto, lalu Kirim." });
      await reload(); onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal simpan packing: " + (e.message || "") }); } finally { setBusy(false); }
  }
  async function reopenPacking() {
    if (busy) return; setBusy(true); setMsg(null);
    try { await supabase.from("sf_do_orders").update({ packed_at: null }).eq("id", order.id); await reload(); onChange(); }
    finally { setBusy(false); }
  }

  async function uploadPhotos() {
    const urls = Array.isArray(ord.ship_photo_urls) ? [...ord.ship_photo_urls] : [];
    for (let i = 0; i < photos.length; i++) {
      const f = photos[i];
      const safe = String(f.name || "foto").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${order.id}/${Date.now()}_${i}_${safe}`;
      const { error } = await supabase.storage.from("do-shipment-photos").upload(path, f, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("do-shipment-photos").getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  async function shipNow() {
    if (busy) return;
    const payload = (lines || []).map((l) => ({ line_id: l.id, qty: Number(l.qty_packed) || 0 })).filter((x) => x.qty > 0);
    if (!payload.length) { setMsg({ t: "err", m: "Qty packing kosong — ulangi packing." }); return; }
    setBusy(true); setMsg(null);
    try {
      let photoUrls = ord.ship_photo_urls || [];
      if (photos.length) photoUrls = await uploadPhotos();
      const { error } = await supabase.rpc("sf_do_fulfill", { p_order_id: order.id, p_lines: payload });
      if (error) throw error;
      await supabase.from("sf_do_orders").update({ shipped_at: new Date().toISOString(), ship_photo_urls: photoUrls }).eq("id", order.id);
      setPhotos([]); setMsg({ t: "ok", m: "Barang dikirim & stok dipotong. Menunggu konfirmasi penerimaan customer." });
      await reload(); onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal kirim: " + (e.message || "cek stok/izin/bucket foto") }); } finally { setBusy(false); }
  }

  async function confirmReceiving() {
    if (busy) return; setBusy(true); setMsg(null);
    try {
      for (const l of lines) {
        const shp = Number(l.qty_fulfilled) || 0;
        const raw = recv[l.id] != null && recv[l.id] !== "" ? Number(recv[l.id]) : shp;
        await supabase.from("sf_do_order_lines").update({ qty_received: Math.max(0, Math.min(raw || 0, shp)) }).eq("id", l.id);
      }
      await supabase.from("sf_do_orders").update({ received_at: new Date().toISOString() }).eq("id", order.id);
      setMsg({ t: "ok", m: "Penerimaan dikonfirmasi. Tagihan final mengikuti qty diterima." });
      await reload(); onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal simpan penerimaan: " + (e.message || "") }); } finally { setBusy(false); }
  }

  async function closeOrder() {
    if (busy) return; setBusy(true);
    try { await supabase.from("sf_do_orders").update({ status: "closed" }).eq("id", order.id); await reload(); onChange(); }
    finally { setBusy(false); }
  }

  if (lines === null) return (
    <div className="ar-overlay" onClick={onClose}><div className="ar-modal" onClick={(e) => e.stopPropagation()}><div className="center-msg">Memuat…</div></div></div>
  );

  const STEPS = [["packing", "Picking & Packing"], ["ship", "Surat Jalan & Kirim"], ["receiving", "Penerimaan"], ["done", "Selesai"]];
  const stepIdx = { packing: 0, ship: 1, receiving: 2, done: 3, closed: 3 }[stage];

  return (
    <div className="ar-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{order.order_no}</div>
            <div className="small muted">Fulfillment · {custName} · <OStatus s={ord.status} />{ord.sj_no ? " · SJ " + ord.sj_no : ""}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Tutup</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {STEPS.map(([k, label], i) => (
            <div key={k} style={{ flex: 1, minWidth: 118, padding: "7px 10px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, textAlign: "center",
              background: i < stepIdx ? "var(--good-soft)" : i === stepIdx ? "var(--accent-soft)" : "var(--surface2)",
              color: i < stepIdx ? "var(--good)" : i === stepIdx ? "var(--accent-ink)" : "var(--faint)" }}>
              {i < stepIdx ? "✓ " : ""}{label}
            </div>
          ))}
        </div>

        {msg && <div className="card" style={{ background: msg.t === "ok" ? "var(--good-soft)" : "var(--bad-soft)", borderColor: "transparent", color: msg.t === "ok" ? "var(--good)" : "var(--bad)" }}>{msg.m}</div>}

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead><tr>
              <th>SKU</th><th>Produk</th><th className="num">Order</th>
              <th className="num">{stage === "receiving" || stage === "done" ? "Dikirim" : "Terkirim"}</th>
              {stage === "packing" && <><th className="num">Stok WH</th><th className="num">Qty Tersedia</th></>}
              {stage === "ship" && <th className="num">Qty Packing</th>}
              {stage === "receiving" && <th className="num">Qty Diterima</th>}
              {stage === "done" && <><th className="num">Diterima</th><th className="num">Selisih</th></>}
            </tr></thead>
            <tbody>
              {lines.map((l) => {
                const stok = stockWh[l.sku] ?? 0;
                const shp = Number(l.qty_fulfilled) || 0;
                const selisih = shp - (Number(l.qty_received) || 0);
                return (
                  <tr key={l.id}>
                    <td style={{ fontSize: 12 }}>{l.sku}</td>
                    <td className="strong">{l.product_name || "—"}</td>
                    <td className="num">{fmtNum(l.qty_order)}</td>
                    <td className="num">{fmtNum(shp)}</td>
                    {stage === "packing" && <>
                      <td className="num" style={{ color: stok < rem(l) ? "var(--bad)" : undefined }}>{fmtNum(stok)}</td>
                      <td className="num">{rem(l) > 0 && canDo
                        ? <input className="num" type="number" min="0" max={Math.min(rem(l), stok)} value={pack[l.id] ?? ""} placeholder={String(Math.max(0, Math.min(rem(l), stok)))} onChange={(e) => setPack((s) => ({ ...s, [l.id]: e.target.value }))} style={{ width: 72 }} />
                        : <span className="muted">{rem(l) <= 0 ? "—" : fmtNum(Math.min(rem(l), stok))}</span>}</td>
                    </>}
                    {stage === "ship" && <td className="num" style={{ fontWeight: 700 }}>{fmtNum(l.qty_packed)}</td>}
                    {stage === "receiving" && <td className="num">{canDo
                      ? <input className="num" type="number" min="0" max={shp} value={recv[l.id] ?? ""} placeholder={String(shp)} onChange={(e) => setRecv((s) => ({ ...s, [l.id]: e.target.value }))} style={{ width: 72 }} />
                      : fmtNum(shp)}</td>}
                    {stage === "done" && <>
                      <td className="num">{fmtNum(l.qty_received)}</td>
                      <td className="num" style={{ color: selisih > 0 ? "var(--bad)" : "var(--good)" }}>{selisih > 0 ? "-" + fmtNum(selisih) : "0"}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {stage === "packing" && canDo && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => openPrint("Picking List", docHTML("pick", ord, lines, customer || { name: custName }))}>🖨 Cetak Picking List</button>
            <button className="btn btn-primary" onClick={confirmPacking} disabled={busy}>{busy ? "Menyimpan…" : "Konfirmasi Packing →"}</button>
          </div>
        )}
        {stage === "packing" && !canDo && <p className="small muted">Role kamu tidak punya akses aksi fulfillment.</p>}

        {stage === "ship" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="btn btn-ghost" onClick={() => openPrint("Surat Jalan", docHTML("sj", ord, lines, customer || { name: custName }))}>🖨 Cetak Surat Jalan</button>
              {canDo && <button className="btn btn-ghost" onClick={reopenPacking} disabled={busy}>← Ubah Packing</button>}
            </div>
            <div className="card">
              <div className="section-label">Foto dokumentasi pengiriman</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                {(Array.isArray(ord.ship_photo_urls) ? ord.ship_photo_urls : []).map((u, i) => (
                  <a key={"u" + i} href={u} target="_blank" rel="noopener"><img src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} /></a>
                ))}
                {photos.map((f, i) => (<img key={"f" + i} src={URL.createObjectURL(f)} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px dashed var(--accent)" }} />))}
                {canDo && <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>+ Tambah foto
                  <input type="file" accept="image/*" multiple capture="environment" style={{ display: "none" }} onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files || [])])} /></label>}
                {photos.length > 0 && <span className="small muted">{photos.length} foto baru diupload saat Kirim</span>}
              </div>
            </div>
            {canDo && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button className="btn btn-primary" onClick={shipNow} disabled={busy}>{busy ? "Mengirim…" : "Kirim barang (potong stok)"}</button>
            </div>}
          </>
        )}

        {stage === "receiving" && (
          <>
            {Array.isArray(ord.ship_photo_urls) && ord.ship_photo_urls.length > 0 && (
              <div className="card"><div className="section-label">Foto pengiriman ({ord.ship_photo_urls.length})</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {ord.ship_photo_urls.map((u, i) => (<a key={i} href={u} target="_blank" rel="noopener"><img src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} /></a>))}
                </div></div>
            )}
            {canDo && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-primary" onClick={confirmReceiving} disabled={busy}>{busy ? "Menyimpan…" : "Konfirmasi Penerimaan Customer"}</button>
            </div>}
            <p className="small muted" style={{ marginTop: 6 }}>Isi qty yang benar-benar diterima customer. Selisih (kirim − terima) otomatis mengurangi nilai tagihan.</p>
          </>
        )}

        {stage === "done" && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="small muted">Diterima customer {ord.received_at ? new Date(ord.received_at).toLocaleDateString("id-ID") : "—"} · tagihan final mengikuti qty diterima.</div>
            {ord.status !== "closed" && canDo && <button className="btn btn-ghost" onClick={closeOrder} disabled={busy}>Tutup order</button>}
          </div>
        )}

        {stage === "closed" && <p className="small muted">Order sudah {ord.status}. Tidak ada aksi lagi.</p>}
      </div>
    </div>
  );
}

/* ---------------- Modal: Invoice (tab Finance) ---------------- */
function InvoiceModal({ order, custName, canDo, onClose, onChange }) {
  const [ord, setOrd] = useState(order);
  const [lines, setLines] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [paysByInv, setPaysByInv] = useState({});

  async function reload() {
    const [ordRes, lnRes, ivRes] = await Promise.all([
      supabase.from("sf_do_orders").select("*").eq("id", order.id).single(),
      supabase.from("sf_do_order_lines").select("unit_price,qty_fulfilled,qty_received").eq("order_id", order.id),
      supabase.from("sf_do_invoices").select("*").eq("order_id", order.id).order("created_at"),
    ]);
    if (ordRes.data) setOrd(ordRes.data);
    setLines(lnRes.data || []);
    const invs = ivRes.data || [];
    setInvoices(invs);
    if (invs.length) {
      const { data: p } = await supabase.from("sf_do_payments").select("*").in("invoice_id", invs.map((i) => i.id)).order("paid_at");
      const map = {}; (p || []).forEach((x) => { (map[x.invoice_id] = map[x.invoice_id] || []).push(x); });
      setPaysByInv(map);
    } else setPaysByInv({});
  }
  useEffect(() => { reload(); }, [order.id]);
  // Nilai tagihan: setelah customer konfirmasi terima -> pakai qty diterima
  // (selisih kirim-terima mengurangi tagihan). Sebelum itu -> qty dikirim.
  const deliveredValue = (lines || []).reduce((s, l) => s + Number(l.unit_price || 0) * Number((ord.received_at ? l.qty_received : l.qty_fulfilled) || 0), 0);

  return (
    <div className="ar-overlay" onClick={onClose}>
      <div className="ar-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{order.order_no}</div>
            <div className="small muted">Invoice · {custName} · total {fmtIDR(order.total)} · <OStatus s={ord.status} /></div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Tutup</button>
        </div>
        {lines === null ? <div className="center-msg">Memuat…</div> : (
          <InvoicePanel order={ord} invoices={invoices} paysByInv={paysByInv} deliveredValue={deliveredValue}
            orderClosed={ord.status === "closed" || ord.status === "fulfilled"} canDo={canDo}
            onChange={() => { reload(); onChange(); }} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Invoice (bertahap) + Pembayaran ---------------- */
function InvoicePanel({ order, invoices, paysByInv, deliveredValue, orderClosed, canDo, onChange }) {
  const [type, setType] = useState("full");
  const [dpPct, setDpPct] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const dpInv = invoices.find((i) => i.type === "dp");
  const fullInv = invoices.find((i) => i.type === "full");
  const settleInv = invoices.find((i) => i.type === "settlement");
  const dpPaid = dpInv ? Number(dpInv.paid_amount) : 0;
  const settleAmount = Math.max(0, deliveredValue - dpPaid);
  const dpNominal = Math.round(order.total * (Number(dpPct) || 0) / 100);

  async function issueFirst() {
    if (busy) return;
    const isDp = type === "dp";
    const amount = isDp ? dpNominal : order.total;
    if (isDp && amount <= 0) { setMsg({ t: "err", m: "Isi DP % dulu." }); return; }
    setBusy(true); setMsg(null);
    try {
      const p = await loadPrefixes();
      const { error } = await supabase.from("sf_do_invoices").insert({
        order_id: order.id, invoice_no: (isDp ? p.inv_dp.prefix : p.inv_full.prefix) + order.order_no, type: isDp ? "dp" : "full",
        total: amount, dp_amount: isDp ? amount : 0, paid_amount: 0, balance: amount, status: "issued", due_date: due || null,
      });
      if (error) throw error;
      if (order.status === "draft") await supabase.from("sf_do_orders").update({ status: "confirmed" }).eq("id", order.id);
      onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal terbitkan invoice: " + (e.message || "") }); } finally { setBusy(false); }
  }

  async function issueSettlement() {
    if (busy) return;
    if (settleAmount <= 0) { setMsg({ t: "err", m: "Tidak ada sisa untuk ditagih (DP sudah menutupi barang terkirim)." }); return; }
    setBusy(true); setMsg(null);
    try {
      const p = await loadPrefixes();
      const { error } = await supabase.from("sf_do_invoices").insert({
        order_id: order.id, invoice_no: p.inv_ln.prefix + order.order_no, type: "settlement",
        total: settleAmount, dp_amount: 0, paid_amount: 0, balance: settleAmount, status: "issued", due_date: null,
      });
      if (error) throw error;
      onChange();
    } catch (e) { setMsg({ t: "err", m: "Gagal terbitkan pelunasan: " + (e.message || "") }); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="section-label">Invoice & Pembayaran</div>
      {msg && <div className="small err" style={{ marginTop: 8 }}>{msg.m}</div>}

      {/* terbitkan invoice pertama (Full atau DP) */}
      {invoices.length === 0 && (canDo ? (
        <div style={{ marginTop: 12 }}>
          <div className="grid3">
            <div>
              <label>Tipe invoice</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="full">Full payment</option>
                <option value="dp">DP (uang muka)</option>
              </select>
            </div>
            {type === "dp" && (
              <div>
                <label>DP %</label>
                <input type="number" min="0" max="100" value={dpPct} onChange={(e) => setDpPct(e.target.value)} placeholder="mis. 50" />
                <div className="small muted" style={{ marginTop: 4 }}>tagih {fmtIDR(dpNominal)} dari total {fmtIDR(order.total)}</div>
              </div>
            )}
            <div><label>Jatuh tempo (opsional)</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={issueFirst} disabled={busy}>
              {type === "dp" ? "Terbitkan Invoice DP · " + fmtIDR(dpNominal) : "Terbitkan Invoice · " + fmtIDR(order.total)}
            </button>
          </div>
        </div>
      ) : <p className="small muted" style={{ marginTop: 10 }}>Belum ada invoice.</p>)}

      {/* daftar invoice yang sudah ada */}
      {invoices.map((inv) => (
        <InvoiceCard key={inv.id} inv={inv} pays={paysByInv[inv.id] || []} canDo={canDo} onChange={onChange} />
      ))}

      {/* terbitkan pelunasan setelah barang dikirim & order selesai/ditutup */}
      {canDo && dpInv && !fullInv && !settleInv && (
        orderClosed ? (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <div className="small muted" style={{ marginBottom: 8 }}>
              Barang terkirim <b style={{ color: "var(--ink)" }}>{fmtIDR(deliveredValue)}</b> − DP dibayar {fmtIDR(dpPaid)} = <b style={{ color: "var(--accent)" }}>{fmtIDR(settleAmount)}</b>
            </div>
            <button className="btn btn-primary" onClick={issueSettlement} disabled={busy || settleAmount <= 0}>Terbitkan Invoice Pelunasan · {fmtIDR(settleAmount)}</button>
          </div>
        ) : (
          <p className="small muted" style={{ marginTop: 12 }}>Invoice pelunasan bisa diterbitkan setelah barang dikirim & order ditutup/selesai — dihitung dari nilai barang terkirim − DP.</p>
        )
      )}
    </div>
  );
}

/* satu kartu invoice: ringkasan + submit finance (pembayaran diproses di FINFLOW) */
function InvoiceCard({ inv, pays, canDo, onChange }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const typeLabel = inv.type === "dp" ? "DP" : inv.type === "settlement" ? "Pelunasan" : "Full";

  async function submitFinance() {
    if (busy) return; setBusy(true);
    try { await supabase.from("sf_do_invoices").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", inv.id); onChange(); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div><b>{inv.invoice_no}</b> <span className="pill" style={{ background: "var(--surface2)", color: "var(--sub)", marginLeft: 6 }}>{typeLabel}</span></div>
        <IStatus s={inv.status} />
      </div>
      {msg && <div className="small err" style={{ marginBottom: 8 }}>{msg.m}</div>}
      <div className="grid3" style={{ marginBottom: 10 }}>
        <div className="kpi"><div className="l">Total</div><div className="v" style={{ fontSize: 20 }}>{fmtIDR(inv.total)}</div></div>
        <div className="kpi"><div className="l">Dibayar</div><div className="v" style={{ fontSize: 20, color: "var(--good)" }}>{fmtIDR(inv.paid_amount)}</div></div>
        <div className="kpi"><div className="l">Sisa</div><div className="v" style={{ fontSize: 20, color: inv.balance > 0 ? "var(--accent)" : "var(--good)" }}>{fmtIDR(inv.balance)}</div>{inv.due_date && <div className="d muted">jatuh tempo {inv.due_date}</div>}</div>
      </div>
      {pays.length > 0 && (
        <table style={{ marginBottom: 10 }}>
          <thead><tr><th>Tanggal</th><th>Metode</th><th className="num">Nominal</th></tr></thead>
          <tbody>{pays.map((p) => <tr key={p.id}><td>{p.paid_at}</td><td>{p.method || "—"}</td><td className="num strong">{fmtIDR(p.amount)}</td></tr>)}</tbody>
        </table>
      )}
      {canDo && inv.status !== "submitted" && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={submitFinance} disabled={busy}>Submit ke Finance</button>
          <span className="small muted">Pembayaran &amp; perubahan status diproses di FINFLOW.</span>
        </div>
      )}
      {inv.status === "submitted" && <p className="small muted" style={{ marginTop: 10 }}>✓ Sudah di-submit ke Finance. Pembayaran diproses di FINFLOW.</p>}
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
