import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, todayISO } from "./format.js";
import { canAct } from "./permissions.js";

const emptyRow = () => ({ sku: "", name: "", retail: "", qty: 1, price: "", disc: 0 });

export default function InputManual({ role }) {
  const allowed = canAct(role, "input");
  const [channels, setChannels] = useState([]);
  const [locations, setLocations] = useState([]);
  const [skuList, setSkuList] = useState([]);      // {sku,label,name,retail}
  const [skuMap, setSkuMap] = useState({});
  const [loadErr, setLoadErr] = useState("");

  const [date, setDate] = useState(todayISO());
  const [channelId, setChannelId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [txnType, setTxnType] = useState("sale"); // sale | return | kol
  const [kolName, setKolName] = useState("");
  const [rows, setRows] = useState([emptyRow(), emptyRow()]);

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
          supabase.from("cogm_retail_prices").select("spk_id,retail_price,cogm_final,cogm"),
        ]);
        for (const r of [ch, loc, si, prc]) if (r.error) throw r.error;

        const prcBySpk = {};
        (prc.data || []).forEach((p) => { if (p.spk_id) prcBySpk[p.spk_id] = p; });
        const list = (si.data || []).map((x) => {
          const p = prcBySpk[x.spk_id] || {};
          const retail = p.retail_price ?? "";
          const cogm = p.cogm_final ?? p.cogm ?? 0;
          const name = `${x.product_name_system || ""} ${x.colour_lv2 || ""}`.trim();
          return { sku: x.sku, label: `${name} (${x.sku})`, name, retail, cogm };
        });
        const map = {};
        list.forEach((s) => (map[s.sku] = s));

        setChannels(ch.data || []);
        setLocations((loc.data || []).filter((l) => l.is_active !== false));
        setSkuList(list);
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

  const KOL_CH = "KOL";
  const isKol = txnType === "kol";
  const kolChannel = channels.find((c) => c.channel_id === KOL_CH);
  const kolLoc = kolChannel?.fulfill_location_id || "WH-MAIN";

  const setRow = (i, patch) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const onSku = (i, val) => {
    const item = skuMap[val.trim()];
    if (item) {
      setRow(i, { sku: val, name: item.name, retail: item.retail,
        price: rows[i].price || item.retail });
    } else {
      setRow(i, { sku: val, name: val ? "— SKU tidak dikenal —" : "", retail: "" });
    }
  };

  const rowNet = (r) => (Number(r.price) || 0) * (Number(r.qty) || 0) - (Number(r.disc) || 0);
  const total = useMemo(() => rows.reduce((a, r) => a + (r.sku ? (isKol ? 0 : rowNet(r)) : 0), 0), [rows, isKol]);
  const marketingCost = useMemo(() => rows.reduce((a, r) => {
    const m = skuMap[(r.sku || "").trim()];
    return a + (r.sku ? (Number(r.qty) || 0) * (Number(m?.cogm) || 0) : 0);
  }, 0), [rows, skuMap]);

  const locInfo = !channel ? "" : offline
    ? `Channel toko → stok berkurang di store yang dipilih · basis net: ${channel.default_net_basis}`
    : `Channel online → stok dari ${channel.fulfill_location_id} · basis net: ${channel.default_net_basis}`;

  function buildPayload() {
    const loc = offline ? storeId : channel?.fulfill_location_id;
    const stamp = Date.now();
    let idx = 0;
    return rows
      .filter((r) => r.sku.trim())
      .map((r) => {
        idx++;
        if (isKol) {
          const qty = Number(r.qty) || 0;
          const retail = Number(r.retail) || 0;
          const slug = ((kolName || "sample").trim().replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 30)) || "sample";
          return {
            source: "manual",
            file_label: "kol-" + date + "-" + stamp,
            processed: false,
            imported_at: new Date().toISOString(),
            raw: {
              txn_date: date,
              channel_id: KOL_CH,
              location_id: kolLoc,
              sku: r.sku.trim(),
              qty,
              retail_price: retail || null,
              sale_at_price: retail,      // diskon 100% → net 0
              discount: retail * qty,
              txn_type: "sale",           // barang tetap keluar (stok berkurang)
              source_txn_id: "KOL-" + slug + "-" + stamp + "-" + idx,
            },
          };
        }
        return {
          source: "manual",
          file_label: "manual-" + date + "-" + stamp,
          processed: false,
          imported_at: new Date().toISOString(),
          raw: {
            txn_date: date,
            channel_id: channelId,
            location_id: loc,
            sku: r.sku.trim(),
            qty: Number(r.qty) || 0,
            retail_price: Number(r.retail) || null,
            sale_at_price: Number(r.price) || 0,
            discount: Number(r.disc) || 0,
            txn_type: txnType,
            source_txn_id: (txnType === "return" ? "RET-" : "MAN-") + stamp + "-" + idx,
          },
        };
      });
  }

  async function save() {
    setSaveMsg(null);
    const payload = buildPayload();
    if (payload.length === 0) {
      setSaveMsg({ type: "err", text: "Tidak ada baris dengan SKU." });
      return;
    }
    if (isKol && !kolChannel) {
      setSaveMsg({ type: "err", text: "Channel 'KOL' belum ada di Master Channel. Buat dulu channel KOL (fulfill WH-MAIN) sebelum input giveaway." });
      return;
    }
    const unknown = [...new Set(payload.map((p) => p.raw.sku).filter((s) => !skuMap[s]))];
    if (unknown.length) {
      setSaveMsg({ type: "err", text: "SKU tidak dikenal: " + unknown.join(", ") });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.from("cf_sales_staging").insert(payload).select("id");
      if (error) throw error;
      setSaveMsg({ type: "ok", text: `Tersimpan ${data.length} baris ke staging (batch ${payload[0].file_label}).` });
      setRows([emptyRow()]);
    } catch (e) {
      setSaveMsg({ type: "err", text: "Gagal menyimpan: " + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  async function process() {
    setProcMsg(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("process_sales_staging", { p_file_label: null });
      if (error) throw error;
      const r = data || {};
      setProcMsg({ type: "ok", text: `Diproses: ${r.processed || 0} jadi penjualan, ${r.quarantined || 0} karantina, ${r.duplicate || 0} duplikat.` });
    } catch (e) {
      setProcMsg({ type: "err", text: "Gagal memproses: " + (e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  if (loadErr)
    return (
      <div>
        <h1 className="title">Input penjualan</h1>
        <div className="card err-card">
          Gagal memuat data master: {loadErr}.<br />
          Cek koneksi & kebijakan baca (RLS) untuk cf_sales_channels, cf_locations, sku_items, cogm_retail_prices.
        </div>
      </div>
    );

  return (
    <div>
      <h1 className="title">Input penjualan</h1>
      <p className="lead">Tambah baris penjualan → simpan ke staging → proses jadi penjualan final + gerakan stok.</p>

      <div className="card">
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className={"btn btn-sm " + (txnType === "sale" ? "btn-primary" : "btn-ghost")}
            onClick={() => setTxnType("sale")}>Penjualan</button>
          <button className={"btn btn-sm " + (txnType === "return" ? "btn-primary" : "btn-ghost")}
            onClick={() => setTxnType("return")}>Retur</button>
          <button className={"btn btn-sm " + (txnType === "kol" ? "btn-primary" : "btn-ghost")}
            onClick={() => setTxnType("kol")}>KOL (free)</button>
          {txnType === "return" && (
            <span className="small" style={{ color: "var(--warn)" }}>
              Mode retur — stok kembali masuk &amp; omzet berkurang.
            </span>
          )}
          {isKol && (
            <span className="small" style={{ color: "var(--accent)" }}>
              Mode KOL — barang keluar dicatat, nilai jual Rp 0 (diskon 100%).
            </span>
          )}
        </div>
        <div className="grid3">
          <div>
            <label>Tanggal</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {isKol ? (
            <>
              <div>
                <label>Channel</label>
                <input readOnly value="KOL / Sample (giveaway)" />
              </div>
              <div>
                <label>KOL / penerima (opsional)</label>
                <input value={kolName} placeholder="mis. @beautybyrara"
                  onChange={(e) => setKolName(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label>Channel</label>
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  {channels.map((c) => (
                    <option key={c.channel_id} value={c.channel_id}>{c.name} ({c.kind})</option>
                  ))}
                </select>
              </div>
              {offline && (
                <div>
                  <label>Store / lokasi</label>
                  <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                    {stores.map((l) => (
                      <option key={l.location_id} value={l.location_id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {isKol
            ? `Barang keluar dicatat · nilai jual Rp 0 (diskon 100%) · stok dari ${kolLoc}${kolChannel ? "" : " · ⚠ channel KOL belum dibuat"}`
            : locInfo}
        </p>
      </div>

      <div className="card">
        <div className="section-label">Baris penjualan</div>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ width: "26%" }}>SKU</th>
              <th style={{ width: "22%" }}>Produk</th>
              <th style={{ width: "9%" }} className="num">Qty</th>
              <th style={{ width: "13%" }} className="num">Retail</th>
              <th style={{ width: "13%" }} className="num">Harga jual</th>
              <th style={{ width: "10%" }} className="num">Diskon</th>
              <th className="num">Net</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input list="skulist" value={r.sku} placeholder="ketik / pilih SKU"
                    onChange={(e) => onSku(i, e.target.value)} />
                </td>
                <td className="small muted">{r.name}</td>
                <td><input className="num" type="number" min="1" value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })} /></td>
                <td><input className="num" readOnly value={r.retail} /></td>
                {isKol ? (
                  <>
                    <td className="num muted">0</td>
                    <td className="num muted">100%</td>
                    <td className="num">{fmtIDR(0)}</td>
                  </>
                ) : (
                  <>
                    <td><input className="num" type="number" value={r.price} placeholder="0"
                      onChange={(e) => setRow(i, { price: e.target.value })} /></td>
                    <td><input className="num" type="number" value={r.disc}
                      onChange={(e) => setRow(i, { disc: e.target.value })} /></td>
                    <td className="num">{fmtIDR(r.sku ? rowNet(r) : 0)}</td>
                  </>
                )}
                <td><button className="x" title="hapus"
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="skulist">
          {skuList.map((s) => (<option key={s.sku} value={s.sku}>{s.label}</option>))}
        </datalist>

        <div className="foot">
          <button className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
            + Tambah baris
          </button>
          <div>
            {isKol && (
              <span style={{ marginRight: 16, color: "var(--accent)" }}>
                Biaya marketing (qty × COGM): <span className="total">{fmtIDR(marketingCost)}</span>
              </span>
            )}
            Total net: <span className="total">{fmtIDR(total)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        {allowed ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={save}>Simpan ke staging</button>
            <button className="btn btn-ghost" disabled={busy} style={{ marginLeft: 8 }} onClick={process}>
              Proses staging → penjualan
            </button>
            {saveMsg && <div className={"small " + saveMsg.type} style={{ marginTop: 12 }}>{saveMsg.text}</div>}
            {procMsg && <div className={"small " + procMsg.type} style={{ marginTop: 8 }}>{procMsg.text}</div>}
          </>
        ) : (
          <div className="small muted">Role Anda hanya bisa melihat halaman ini. Aksi simpan &amp; proses dinonaktifkan.</div>
        )}
      </div>
    </div>
  );
}
