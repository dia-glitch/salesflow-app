import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, fmtNum, todayISO } from "./format.js";
import { canAct } from "./permissions.js";

function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// CSV-safe: bungkus kalau ada koma/kutip/baris baru
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export default function Sales({ role }) {
  const canExport = canAct(role, "penjualan");
  const [rows, setRows] = useState([]);
  const [chMap, setChMap] = useState({});
  const [locMap, setLocMap] = useState({});
  const [skuMap, setSkuMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // filter
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [store, setStore] = useState("all");
  const [monthSel, setMonthSel] = useState("");

  function applyMonth(mm) {
    setMonthSel(mm);
    if (!mm) return;
    const [y, m] = mm.split("-").map(Number);
    const dim = new Date(y, m, 0).getDate();
    setFrom(`${mm}-01`);
    setTo(`${mm}-${String(dim).padStart(2, "0")}`);
  }

  async function load() {
    setLoading(true); setError("");
    try {
      const [f, ch, loc, si, prc] = await Promise.all([
        supabase.from("cf_sales_fact")
          .select("id,txn_date,channel_id,location_id,sku,qty,retail_price,sale_at_price,discount,net_amount,source_txn_id")
          .neq("channel_id", "KOL")
          .order("txn_date", { ascending: false }).order("id", { ascending: false }),
        supabase.from("cf_sales_channels").select("channel_id,name,kind"),
        supabase.from("cf_locations").select("location_id,name"),
        supabase.from("sku_items").select("sku,spk_id,product_name_system").limit(5000),
        supabase.from("cogm_retail_prices").select("spk_id,cogm,cogm_final"),
      ]);
      for (const r of [f, ch, loc, si, prc]) if (r.error) throw r.error;
      const cm = {}; (ch.data || []).forEach((c) => (cm[c.channel_id] = c));
      const lm = {}; (loc.data || []).forEach((l) => (lm[l.location_id] = l.name));
      const prcBySpk = {};
      (prc.data || []).forEach((p) => { if (p.spk_id) prcBySpk[p.spk_id] = p; });
      const sm = {};
      (si.data || []).forEach((x) => {
        const p = prcBySpk[x.spk_id] || {};
        sm[x.sku] = { name: x.product_name_system || x.sku, cogm: Number(p.cogm_final ?? p.cogm ?? 0) };
      });
      setRows(f.data || []); setChMap(cm); setLocMap(lm); setSkuMap(sm);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function reload() {
    setMonthSel(""); setFrom(""); setTo(""); setStore("all");
    load();
  }

  // daftar lokasi yang benar-benar muncul di data, untuk dropdown filter
  const storeOptions = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.location_id))];
    return ids.map((id) => ({ id, name: locMap[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, locMap]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (from && r.txn_date < from) return false;
      if (to && r.txn_date > to) return false;
      if (store !== "all" && r.location_id !== store) return false;
      return true;
    });
  }, [rows, from, to, store]);

  const totals = useMemo(() => {
    let net = 0, qty = 0, cogm = 0, retVal = 0, retQty = 0;
    filtered.forEach((r) => {
      const n = Number(r.net_amount) || 0;
      const isRet = n < 0;
      const q = (Number(r.qty) || 0) * (isRet ? -1 : 1);
      net += n; qty += q;
      cogm += (Number(skuMap[r.sku]?.cogm) || 0) * q;
      if (isRet) { retVal += n; retQty += Number(r.qty) || 0; }
    });
    return { net, qty, cogm, retVal, retQty, count: filtered.length, margin: net > 0 ? (net - cogm) / net : 0 };
  }, [filtered, skuMap]);

  function tableData() {
    return filtered.map((r) => {
      const isRet = (Number(r.net_amount) || 0) < 0;
      return {
        tanggal: r.txn_date,
        tipe: isRet ? "Retur" : "Jual",
        id_order: r.source_txn_id,
        channel: chMap[r.channel_id]?.name || r.channel_id,
        grup: chMap[r.channel_id]?.kind === "offline" ? "Offline" : "Online",
        store: locMap[r.location_id] || r.location_id,
        sku: r.sku,
        produk: skuMap[r.sku]?.name || "",
        qty: (Number(r.qty) || 0) * (isRet ? -1 : 1),
        retail_price: r.retail_price,
        discount: r.discount,
        sale_at_price: r.sale_at_price,
        cogm: skuMap[r.sku]?.cogm ?? "",
      };
    });
  }

  function downloadCSV() {
    const data = tableData();
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const lines = [
      headers.join(","),
      ...data.map((row) => headers.map((h) => csvCell(row[h])).join(",")),
    ];
    // BOM \uFEFF supaya Excel membaca UTF-8 dengan benar
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `penjualan_${from}_sd_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="center-msg">Memuat data…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;

  return (
    <div>
      <h1 className="title">Penjualan</h1>
      <p className="lead">Daftar transaksi dari cf_sales_fact · filter periode &amp; store · ekspor CSV.</p>

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label>Bulan</label>
            <input type="month" value={monthSel} onChange={(e) => applyMonth(e.target.value)} />
          </div>
          <div>
            <label>Dari tanggal</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMonthSel(""); }} />
          </div>
          <div>
            <label>Sampai tanggal</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMonthSel(""); }} />
          </div>
          <div>
            <label>Store / lokasi</label>
            <select value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="all">Semua lokasi</option>
              {storeOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button className="btn btn-ghost" onClick={reload}>Muat ulang</button>
            {canExport && (
              <button className="btn btn-primary" onClick={downloadCSV} disabled={filtered.length === 0}>
                Unduh CSV
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 20, alignItems: "start" }}>
        <Stat l="Transaksi" v={fmtNum(totals.count)} />
        <Stat l="Total qty" v={fmtNum(totals.qty)} />
        <Stat l="Total penjualan" v={fmtIDR(totals.net)} />
        <Stat l="Total retur" v={fmtIDR(Math.abs(totals.retVal))} sub={fmtNum(totals.retQty) + " pcs"} />
        <Stat l="Total COGM" v={fmtIDR(totals.cogm)} />
        <Stat l="Margin" v={Math.round(totals.margin * 100) + "%"} />
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr style={{ background: "var(--paper)" }}>
                <th style={{ padding: "10px 12px" }}>Tanggal</th>
                <th style={{ padding: "10px 12px" }}>Tipe</th>
                <th style={{ padding: "10px 12px" }}>ID order</th>
                <th style={{ padding: "10px 12px" }}>Channel</th>
                <th style={{ padding: "10px 12px" }}>Store</th>
                <th style={{ padding: "10px 12px" }}>SKU</th>
                <th style={{ padding: "10px 12px" }}>Produk</th>
                <th style={{ padding: "10px 12px" }} className="num">Qty</th>
                <th style={{ padding: "10px 12px" }} className="num">Retail</th>
                <th style={{ padding: "10px 12px" }} className="num">Diskon</th>
                <th style={{ padding: "10px 12px" }} className="num">Sale at Price</th>
                <th style={{ padding: "10px 12px" }} className="num">COGM</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={12} className="center-msg">Tidak ada transaksi pada filter ini.</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const isRet = (Number(r.net_amount) || 0) < 0;
                  return (
                  <tr key={r.id}>
                    <td style={{ padding: "9px 12px" }} className="muted">{r.txn_date}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <span className="pill" style={{ background: isRet ? "var(--bad-soft)" : "var(--good-soft)", color: isRet ? "var(--bad)" : "var(--good)" }}>
                        {isRet ? "Retur" : "Jual"}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{r.source_txn_id}</td>
                    <td style={{ padding: "9px 12px" }}>{chMap[r.channel_id]?.name || r.channel_id}</td>
                    <td style={{ padding: "9px 12px" }} className="muted">{locMap[r.location_id] || r.location_id}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{r.sku}</td>
                    <td style={{ padding: "9px 12px" }} className="muted">{skuMap[r.sku]?.name || ""}</td>
                    <td style={{ padding: "9px 12px" }} className="num">{(Number(r.qty) || 0) * (isRet ? -1 : 1)}</td>
                    <td style={{ padding: "9px 12px" }} className="num muted">{fmtIDR(r.retail_price)}</td>
                    <td style={{ padding: "9px 12px" }} className="num">{fmtIDR(r.discount || 0)}</td>
                    <td style={{ padding: "9px 12px", color: isRet ? "var(--bad)" : undefined }} className="num">{fmtIDR(r.sale_at_price)}</td>
                    <td style={{ padding: "9px 12px" }} className="num muted">{skuMap[r.sku]?.cogm ? fmtIDR(skuMap[r.sku].cogm) : "—"}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {filtered.length > 500 && (
        <p className="small muted">Menampilkan 500 baris pertama di tabel; tombol Unduh CSV mengekspor semua {fmtNum(filtered.length)} baris.</p>
      )}
    </div>
  );
}

const Stat = ({ l, v, sub }) => (
  <div>
    <div className="small muted">{l}</div>
    <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 600 }}>{v}</div>
    {sub && <div className="small muted">{sub}</div>}
  </div>
);
