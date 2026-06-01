import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, todayISO } from "./format.js";
import { canAct } from "./permissions.js";

const norm = (k) => String(k).trim().toLowerCase().replace(/\s+/g, "_");
const ALIASES = {
  sku: ["sku", "varian_code", "variant_code", "kode_sku", "kode"],
  qty: ["qty", "quantity", "qty_sold", "jumlah"],
  price: ["sale_at_price", "harga_jual", "sale_price", "price", "harga"],
  disc: ["discount", "diskon"],
  retail: ["retail_price", "retail", "harga_retail"],
  date: ["txn_date", "tanggal", "date"],
};
const getField = (nrow, keys) => {
  for (const k of keys) if (nrow[k] !== undefined && nrow[k] !== "") return nrow[k];
  return "";
};
const parseNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d-]/g, "")); // asumsi rupiah bulat (tanpa desimal)
  return isNaN(n) ? null : n;
};
const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

export default function UploadFile({ role }) {
  const allowed = canAct(role, "input");
  const [channels, setChannels] = useState([]);
  const [locations, setLocations] = useState([]);
  const [skuMap, setSkuMap] = useState({});
  const [loadErr, setLoadErr] = useState("");

  const [date, setDate] = useState(todayISO());
  const [channelId, setChannelId] = useState("");
  const [storeId, setStoreId] = useState("");

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState([]); // {sku,name,qty,price,disc,retail,date,ok,problem}
  const [parseErr, setParseErr] = useState("");

  const [saveMsg, setSaveMsg] = useState(null);
  const [procMsg, setProcMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ch, loc, si, prc] = await Promise.all([
          supabase.from("cf_sales_channels").select("channel_id,name,kind,fulfill_location_id,default_net_basis"),
          supabase.from("cf_locations").select("location_id,name,type,is_active"),
          supabase.from("sku_items").select("sku,spk_id,product_name_system,colour_lv2").limit(5000),
          supabase.from("cogm_retail_prices").select("spk_id,retail_price"),
        ]);
        for (const r of [ch, loc, si, prc]) if (r.error) throw r.error;
        const prcBySpk = {};
        (prc.data || []).forEach((p) => { if (p.spk_id) prcBySpk[p.spk_id] = p; });
        const map = {};
        (si.data || []).forEach((x) => {
          map[x.sku] = {
            name: `${x.product_name_system || ""} ${x.colour_lv2 || ""}`.trim(),
            retail: prcBySpk[x.spk_id]?.retail_price ?? null,
          };
        });
        setChannels(ch.data || []);
        setLocations((loc.data || []).filter((l) => l.is_active !== false));
        setSkuMap(map);
        const firstCh = (ch.data || [])[0];
        if (firstCh) setChannelId(firstCh.channel_id);
        const firstStore = (loc.data || []).find((l) => l.type === "store");
        if (firstStore) setStoreId(firstStore.location_id);
      } catch (e) {
        setLoadErr(e.message || String(e));
      }
    })();
  }, []);

  const channel = channels.find((c) => c.channel_id === channelId);
  const offline = channel && channel.kind === "offline";
  const stores = locations.filter((l) => l.type === "store");

  const locInfo = !channel ? "" : offline
    ? `Channel toko → stok berkurang di store yang dipilih · basis net: ${channel.default_net_basis}`
    : `Channel online → stok dari ${channel.fulfill_location_id} · basis net: ${channel.default_net_basis}`;

  async function onFile(e) {
    setParseErr(""); setSaveMsg(null); setProcMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (json.length === 0) { setParsed([]); setParseErr("File kosong atau tidak terbaca."); return; }

      const out = json.map((row) => {
        const n = {};
        Object.keys(row).forEach((k) => (n[norm(k)] = row[k]));
        const sku = String(getField(n, ALIASES.sku)).trim();
        const qty = parseNum(getField(n, ALIASES.qty));
        let price = parseNum(getField(n, ALIASES.price));
        const disc = parseNum(getField(n, ALIASES.disc)) || 0;
        const retailF = parseNum(getField(n, ALIASES.retail));
        const rowDate = parseDate(getField(n, ALIASES.date));
        const master = skuMap[sku];
        const retail = retailF ?? master?.retail ?? null;
        if ((price === null || price === 0) && retail) price = retail;

        let ok = true, problem = "";
        if (!sku) { ok = false; problem = "SKU kosong"; }
        else if (!master) { ok = false; problem = "SKU tidak dikenal"; }
        else if (!qty || qty <= 0) { ok = false; problem = "Qty tidak valid"; }
        else if (price === null) { ok = false; problem = "Harga jual kosong"; }

        return { sku, name: master?.name || "", qty, price, disc, retail, date: rowDate, ok, problem };
      });
      setParsed(out);
    } catch (err) {
      setParseErr("Gagal membaca file: " + (err.message || err));
      setParsed([]);
    }
  }

  const stats = useMemo(() => {
    const ok = parsed.filter((r) => r.ok).length;
    return { total: parsed.length, ok, bad: parsed.length - ok };
  }, [parsed]);

  function downloadTemplate() {
    const sample = Object.keys(skuMap)[0] || "SKU-CONTOH";
    const lines = ["sku,qty,sale_at_price,discount,txn_date",
      `${sample},1,395000,0,${date}`];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "template_penjualan.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    setSaveMsg(null);
    const okRows = parsed.filter((r) => r.ok);
    if (okRows.length === 0) { setSaveMsg({ type: "err", text: "Tidak ada baris valid untuk disimpan." }); return; }
    const loc = offline ? storeId : channel?.fulfill_location_id;
    const stamp = Date.now();
    let idx = 0;
    const payload = okRows.map((r) => {
      idx++;
      return {
        source: "upload",
        file_label: (fileName || "upload") + "-" + stamp,
        processed: false,
        imported_at: new Date().toISOString(),
        raw: {
          txn_date: r.date || date,
          channel_id: channelId,
          location_id: loc,
          sku: r.sku,
          qty: r.qty,
          retail_price: r.retail,
          sale_at_price: r.price,
          discount: r.disc,
          source_txn_id: "UPL-" + stamp + "-" + idx,
        },
      };
    });
    setBusy(true);
    try {
      const { data, error } = await supabase.from("cf_sales_staging").insert(payload).select("id");
      if (error) throw error;
      setSaveMsg({ type: "ok", text: `Tersimpan ${data.length} baris ke staging (batch ${payload[0].file_label}).` });
    } catch (e) {
      setSaveMsg({ type: "err", text: "Gagal menyimpan: " + (e.message || e) });
    } finally { setBusy(false); }
  }

  async function process() {
    setProcMsg(null); setBusy(true);
    try {
      const { data, error } = await supabase.rpc("process_sales_staging", { p_file_label: null });
      if (error) throw error;
      const r = data || {};
      setProcMsg({ type: "ok", text: `Diproses: ${r.processed || 0} jadi penjualan, ${r.quarantined || 0} karantina, ${r.duplicate || 0} duplikat.` });
    } catch (e) {
      setProcMsg({ type: "err", text: "Gagal memproses: " + (e.message || e) });
    } finally { setBusy(false); }
  }

  if (loadErr)
    return (
      <div>
        <h1 className="title">Upload penjualan</h1>
        <div className="card err-card">Gagal memuat master: {loadErr}</div>
      </div>
    );

  return (
    <div>
      <h1 className="title">Upload penjualan</h1>
      <p className="lead">Unggah file Excel/CSV → pratinjau → simpan ke staging → proses jadi penjualan.</p>

      <div className="card">
        <div className="grid3">
          <div>
            <label>Tanggal default</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label>Channel</label>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {channels.map((c) => (<option key={c.channel_id} value={c.channel_id}>{c.name} ({c.kind})</option>))}
            </select>
          </div>
          {offline && (
            <div>
              <label>Store / lokasi</label>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                {stores.map((l) => (<option key={l.location_id} value={l.location_id}>{l.name}</option>))}
              </select>
            </div>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>{locInfo}</p>
      </div>

      <div className="card">
        <div className="section-label">File penjualan</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} />
          <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>Unduh template CSV</button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Kolom yang dibaca: <code>sku</code>, <code>qty</code>, <code>sale_at_price</code> (wajib);
          <code>discount</code>, <code>retail_price</code>, <code>txn_date</code> (opsional).
          Harga dianggap rupiah bulat. Kalau harga jual kosong, dipakai harga retail.
        </p>
        {parseErr && <div className="err small" style={{ marginTop: 8 }}>{parseErr}</div>}
      </div>

      {parsed.length > 0 && (
        <>
          <div className="card">
            <div className="grid3">
              <Stat n={stats.total} label="Total baris" />
              <Stat n={stats.ok} label="Valid (siap)" tone="ok" />
              <Stat n={stats.bad} label="Bermasalah (di-skip)" tone={stats.bad ? "err" : "muted"} />
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto", maxHeight: 360 }}>
              <table>
                <thead>
                  <tr style={{ background: "var(--paper)" }}>
                    <th style={{ padding: "10px 12px" }}>Status</th>
                    <th style={{ padding: "10px 12px" }}>SKU</th>
                    <th style={{ padding: "10px 12px" }}>Produk</th>
                    <th style={{ padding: "10px 12px" }} className="num">Qty</th>
                    <th style={{ padding: "10px 12px" }} className="num">Harga jual</th>
                    <th style={{ padding: "10px 12px" }} className="num">Diskon</th>
                    <th style={{ padding: "10px 12px" }}>Tanggal</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 300).map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: "8px 12px" }}>
                        {r.ok
                          ? <span className="pill" style={{ background: "var(--good-soft)", color: "var(--good)" }}>ok</span>
                          : <span className="pill" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>{r.problem}</span>}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 12 }}>{r.sku}</td>
                      <td style={{ padding: "8px 12px" }} className="muted">{r.name}</td>
                      <td style={{ padding: "8px 12px" }} className="num">{r.qty ?? "—"}</td>
                      <td style={{ padding: "8px 12px" }} className="num">{r.price != null ? fmtIDR(r.price) : "—"}</td>
                      <td style={{ padding: "8px 12px" }} className="num">{fmtIDR(r.disc || 0)}</td>
                      <td style={{ padding: "8px 12px" }} className="muted">{r.date || date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            {allowed ? (
              <>
                <button className="btn btn-primary" disabled={busy || stats.ok === 0} onClick={save}>
                  Simpan {stats.ok} baris valid ke staging
                </button>
                <button className="btn btn-ghost" disabled={busy} style={{ marginLeft: 8 }} onClick={process}>
                  Proses staging → penjualan
                </button>
                {saveMsg && <div className={"small " + saveMsg.type} style={{ marginTop: 12 }}>{saveMsg.text}</div>}
                {procMsg && <div className={"small " + procMsg.type} style={{ marginTop: 8 }}>{procMsg.text}</div>}
              </>
            ) : (
              <div className="small muted">Role Anda hanya bisa melihat &amp; meninjau file. Aksi simpan &amp; proses dinonaktifkan.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const Stat = ({ n, label, tone }) => (
  <div>
    <div style={{ fontFamily: "var(--serif)", fontSize: 24, fontWeight: 600,
      color: tone === "ok" ? "var(--good)" : tone === "err" ? "var(--bad)" : "var(--ink)" }}>{n}</div>
    <div className="small muted">{label}</div>
  </div>
);
