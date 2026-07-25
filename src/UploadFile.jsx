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
  order_ref: ["order_ref", "no_order", "order_no", "order_id", "id_order", "no_pesanan", "order_reference", "no_invoice"],
  date: ["txn_date", "tanggal", "date"],
  channel: ["channel", "channel_id", "kanal", "channel_name"],
  store: ["store", "toko", "lokasi", "location", "location_id", "store_name"],
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
const pad2 = (n) => String(n).padStart(2, "0");
const fmtYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const excelSerialToDate = (serial) => {
  // Excel 1900 date system (25569 = jarak hari 1900→epoch 1970). Pakai komponen UTC
  // lalu rakit ulang sebagai tanggal lokal supaya tidak geser akibat timezone.
  const utc = new Date(Math.round((serial - 25569) * 86400 * 1000));
  if (isNaN(utc)) return null;
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
};
const parseDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  // Date object (mis. dari XLSX cellDates)
  if (v instanceof Date) return isNaN(v) ? null : fmtYMD(v);
  // Angka serial Excel (mis. 46361) — JANGAN diperlakukan sebagai tahun
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const num = Number(v);
    if (num > 20000 && num < 80000) { // rentang serial ~1954–2119
      const d = excelSerialToDate(num);
      return d ? fmtYMD(d) : null;
    }
  }
  const s = String(v).trim();
  // Sudah ISO YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Format Indonesia DD/MM/YYYY (pemisah / - .)
  const id = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (id) {
    let [, dd, mm, yy] = id;
    yy = yy.length === 2 ? "20" + yy : yy;
    const M = Number(mm), D = Number(dd);
    if (M < 1 || M > 12 || D < 1 || D > 31) return null;
    return `${yy}-${pad2(M)}-${pad2(D)}`;
  }
  // Fallback parser bawaan, tolak tahun ngawur
  const d = new Date(s);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  if (y < 1990 || y > 2100) return null;
  return fmtYMD(d);
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
  const locName = useMemo(() => { const m = {}; locations.forEach((l) => (m[l.location_id] = l.name || l.location_id)); return m; }, [locations]);

  const resolveChannel = (val) => {
    const v = String(val || "").trim().toLowerCase();
    if (!v) return null;
    return channels.find((c) => String(c.channel_id).toLowerCase() === v || (c.name || "").toLowerCase() === v)
      || (["online", "offline"].includes(v) ? channels.find((c) => c.kind === v) : null) || null;
  };
  const resolveStore = (val) => {
    const v = String(val || "").trim().toLowerCase();
    if (!v) return null;
    return locations.find((l) => l.type === "store" && (
      String(l.location_id).toLowerCase() === v ||
      String(l.location_id).toLowerCase().replace(/^st-/, "") === v ||
      (l.name || "").toLowerCase() === v ||
      (l.name || "").toLowerCase().replace(/^store\s+/, "") === v
    )) || null;
  };

  const locInfo = "Channel & store dibaca per-baris dari file (bisa campur online + banyak store). Pilihan di atas hanya jadi default kalau kolom channel/store di baris itu kosong.";

  async function onFile(e) {
    setParseErr(""); setSaveMsg(null); setProcMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
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
        const orderRef = String(getField(n, ALIASES.order_ref) || "").trim();
        const rowDate = parseDate(getField(n, ALIASES.date));
        const master = skuMap[sku];
        const retail = retailF ?? master?.retail ?? null;
        if ((price === null || price === 0) && retail) price = retail;

        // channel & store per-baris (fallback ke pilihan default di atas)
        const chan = resolveChannel(getField(n, ALIASES.channel)) || (channelId ? channels.find((c) => c.channel_id === channelId) : null);
        let loc = null;
        if (chan) {
          if (chan.kind === "offline") {
            const st = resolveStore(getField(n, ALIASES.store)) || (storeId ? locations.find((l) => l.location_id === storeId) : null);
            loc = st ? st.location_id : null;
          } else {
            loc = chan.fulfill_location_id;
          }
        }

        let ok = true, problem = "";
        if (!sku) { ok = false; problem = "SKU kosong"; }
        else if (!master) { ok = false; problem = "SKU tidak dikenal"; }
        else if (!qty || qty <= 0) { ok = false; problem = "Qty tidak valid"; }
        else if (price === null) { ok = false; problem = "Harga jual kosong"; }
        else if (!chan) { ok = false; problem = "Channel tidak dikenal"; }
        else if (chan.kind === "offline" && !loc) { ok = false; problem = "Store tidak dikenal/kosong"; }

        return {
          sku, name: master?.name || "", qty, price, disc, retail, order_ref: orderRef || null, date: rowDate, ok, problem,
          channel_id: chan?.channel_id || null, channel_name: chan?.name || (getField(n, ALIASES.channel) || ""),
          location_id: loc, loc_label: loc ? (locName[loc] || loc) : (chan && chan.kind !== "offline" ? chan.fulfill_location_id : "—"),
        };
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
    const onlineCh = channels.find((c) => c.kind !== "offline");
    const offlineCh = channels.find((c) => c.kind === "offline");
    const someStore = stores[0];
    const lines = [
      "channel,store,sku,qty,sale_at_price,discount,retail_price,order_ref,txn_date",
      `${onlineCh?.name || "Online"},,${sample},1,395000,0,,ORDER-0001,${date}`,
      `${offlineCh?.name || "Offline"},${someStore?.name || "Store Contoh"},${sample},1,395000,0,,,${date}`,
    ];
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
          channel_id: r.channel_id,
          location_id: r.location_id,
          sku: r.sku,
          qty: r.qty,
          retail_price: r.retail,
          sale_at_price: r.price,
          discount: r.disc,
          order_ref: r.order_ref || null,
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
            <label>Channel default (opsional)</label>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">— dari kolom CSV —</option>
              {channels.map((c) => (<option key={c.channel_id} value={c.channel_id}>{c.name} ({c.kind})</option>))}
            </select>
          </div>
          <div>
            <label>Store default (opsional)</label>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">— dari kolom CSV —</option>
              {stores.map((l) => (<option key={l.location_id} value={l.location_id}>{l.name}</option>))}
            </select>
          </div>
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
          Kolom yang dibaca: <code>channel</code>, <code>sku</code>, <code>qty</code>, <code>sale_at_price</code> (wajib);
          <code>store</code> (wajib untuk channel offline), <code>discount</code>, <code>retail_price</code>, <code>order_ref</code> (no order marketplace), <code>txn_date</code> (opsional).
          Channel & store dicocokkan dari nama/kode. Online ambil stok dari lokasi channel; offline dari store di baris itu. Kalau harga jual kosong, dipakai harga retail.
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
                    <th style={{ padding: "10px 12px" }}>Channel</th>
                    <th style={{ padding: "10px 12px" }}>Lokasi</th>
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
                      <td style={{ padding: "8px 12px" }}>{r.channel_name || "—"}</td>
                      <td style={{ padding: "8px 12px" }} className="muted">{r.loc_label || "—"}</td>
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
