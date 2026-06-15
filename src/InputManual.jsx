import { useEffect, useMemo, useRef, useState } from "react";
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
  const [txnType, setTxnType] = useState("sale"); // sale | return
  const [rows, setRows] = useState([emptyRow(), emptyRow()]);

  const [saveMsg, setSaveMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false); // cegah double-submit (double klik) sebelum re-render
  const [stock, setStock] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [ch, loc, si, prc, soh] = await Promise.all([
          supabase.from("cf_sales_channels").select("channel_id,name,kind,fulfill_location_id,default_net_basis"),
          supabase.from("cf_locations").select("location_id,name,type,is_active"),
          supabase.from("sku_items").select("sku,spk_id,product_name_system,colour_lv2").limit(5000),
          supabase.from("cogm_retail_prices").select("spk_id,retail_price"),
          supabase.from("v_cf_stock_on_hand").select("sku,location_id,qty"),
        ]);
        for (const r of [ch, loc, si, prc]) if (r.error) throw r.error;
        const smap = {};
        (soh.data || []).forEach((s) => { smap[`${s.location_id}|${s.sku}`] = Number(s.qty) || 0; });
        setStock(smap);

        const prcBySpk = {};
        (prc.data || []).forEach((p) => { if (p.spk_id) prcBySpk[p.spk_id] = p; });
        const list = (si.data || []).map((x) => {
          const retail = prcBySpk[x.spk_id]?.retail_price ?? "";
          const name = `${x.product_name_system || ""} ${x.colour_lv2 || ""}`.trim();
          return { sku: x.sku, label: `${name} (${x.sku})`, name, retail };
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
  const fulfillLoc = channel?.fulfill_location_id || "";
  const fulfillType = locations.find((l) => l.location_id === fulfillLoc)?.type;
  const lockLoc = offline && fulfillLoc && fulfillType !== "store"; // channel offline dgn lokasi fulfillment khusus (mis. Damage Sales → DAMAGE) → lokasi terkunci, bukan pilih store
  const lockLocName = locations.find((l) => l.location_id === fulfillLoc)?.name || fulfillLoc;
  const activeLoc = lockLoc ? fulfillLoc : (offline ? storeId : (channel?.fulfill_location_id || ""));
  const stockOf = (sku) => (activeLoc && sku && stock[`${activeLoc}|${sku}`] != null) ? stock[`${activeLoc}|${sku}`] : null;

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
  const total = useMemo(() => rows.reduce((a, r) => a + (r.sku ? rowNet(r) : 0), 0), [rows]);

  const locInfo = !channel ? ""
    : lockLoc ? `Channel ${channel.name} → stok berkurang di ${lockLocName} · basis net: ${channel.default_net_basis}`
    : offline ? `Channel toko → stok berkurang di store yang dipilih · basis net: ${channel.default_net_basis}`
    : `Channel online → stok dari ${channel.fulfill_location_id} · basis net: ${channel.default_net_basis}`;

  function buildPayload() {
    const loc = activeLoc;
    const stamp = Date.now();
    let idx = 0;
    return rows
      .filter((r) => r.sku.trim())
      .map((r) => {
        idx++;
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

  // Satu aksi: simpan ke staging + langsung proses batch yang sama jadi penjualan final.
  async function submitSale() {
    if (submitLock.current || busy) return; // double klik tidak akan tercatat 2x
    setSaveMsg(null);

    const payload = buildPayload();
    if (payload.length === 0) {
      setSaveMsg({ type: "err", text: "Tidak ada baris dengan SKU." });
      return;
    }
    const unknown = [...new Set(payload.map((p) => p.raw.sku).filter((s) => !skuMap[s]))];
    if (unknown.length) {
      setSaveMsg({ type: "err", text: "SKU tidak dikenal: " + unknown.join(", ") });
      return;
    }

    // Notifikasi sebelum submit: stok lokasi 0 / tidak cukup (hanya untuk penjualan, bukan retur).
    if (txnType === "sale") {
      const issues = rows
        .filter((r) => r.sku.trim())
        .map((r) => {
          const sku = r.sku.trim();
          const st = stockOf(sku); // null = tidak ada record stok di lokasi ini
          const eff = st == null ? 0 : st;
          const q = Number(r.qty) || 0;
          if (eff <= 0) return `• ${sku} — stok lokasi ${st == null ? "tidak ada (0)" : eff}`;
          if (eff < q) return `• ${sku} — stok ${eff} < qty ${q}`;
          return null;
        })
        .filter(Boolean);
      if (issues.length) {
        const ok = window.confirm(
          "Perhatian — stok lokasi tidak mencukupi:\n\n" +
            issues.join("\n") +
            "\n\nTetap simpan penjualan?"
        );
        if (!ok) return;
      }
    }

    submitLock.current = true;
    setBusy(true);
    try {
      const fileLabel = payload[0].file_label;
      const { data: ins, error: insErr } = await supabase
        .from("cf_sales_staging")
        .insert(payload)
        .select("id");
      if (insErr) throw insErr;

      // Proses HANYA batch ini (pakai file_label-nya) — tidak menyentuh staging lain.
      const { data: pr, error: prErr } = await supabase.rpc("process_sales_staging", {
        p_file_label: fileLabel,
      });
      if (prErr) throw prErr;

      const r = pr || {};
      setSaveMsg({
        type: "ok",
        text:
          `Tersimpan ${ins.length} baris — diproses ${r.processed || 0} jadi penjualan` +
          (r.quarantined ? `, ${r.quarantined} karantina` : "") +
          (r.duplicate ? `, ${r.duplicate} duplikat` : "") +
          ".",
      });
      setRows([emptyRow()]);
    } catch (e) {
      setSaveMsg({ type: "err", text: "Gagal menyimpan penjualan: " + (e.message || e) });
    } finally {
      setBusy(false);
      submitLock.current = false;
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
      <p className="lead">Tambah baris penjualan → simpan langsung jadi penjualan final + gerakan stok.</p>

      <div className="card">
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className={"btn btn-sm " + (txnType === "sale" ? "btn-primary" : "btn-ghost")}
            onClick={() => setTxnType("sale")}>Penjualan</button>
          <button className={"btn btn-sm " + (txnType === "return" ? "btn-primary" : "btn-ghost")}
            onClick={() => setTxnType("return")}>Retur</button>
          {txnType === "return" && (
            <span className="small" style={{ color: "var(--warn)" }}>
              Mode retur — stok kembali masuk &amp; omzet berkurang.
            </span>
          )}
        </div>
        <div className="grid3">
          <div>
            <label>Tanggal</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
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
              {lockLoc ? (
                <input value={lockLocName} readOnly disabled />
              ) : (
                <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  {stores.map((l) => (
                    <option key={l.location_id} value={l.location_id}>{l.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>{locInfo}</p>
      </div>

      <div className="card">
        <div className="section-label">Baris penjualan</div>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ width: "26%" }}>SKU</th>
              <th style={{ width: "22%" }}>Produk</th>
              <th style={{ width: "8%" }} className="num">Stok</th>
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
                <td className="num">{(() => { const st = stockOf(r.sku); if (st == null) return "—"; const low = st <= 0 || st < (Number(r.qty) || 0); return <span style={low ? { color: "var(--bad)", fontWeight: 700 } : {}}>{st}</span>; })()}</td>
                <td><input className="num" type="number" min="1" value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })} /></td>
                <td><input className="num" readOnly value={r.retail} /></td>
                <td><input className="num" type="number" value={r.price} placeholder="0"
                  onChange={(e) => setRow(i, { price: e.target.value })} /></td>
                <td><input className="num" type="number" value={r.disc}
                  onChange={(e) => setRow(i, { disc: e.target.value })} /></td>
                <td className="num">{fmtIDR(r.sku ? rowNet(r) : 0)}</td>
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
          <div>Total net: <span className="total">{fmtIDR(total)}</span></div>
        </div>
      </div>

      <div className="card">
        {allowed ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={submitSale}>
              {busy ? "Menyimpan…" : "Simpan Penjualan"}
            </button>
            {saveMsg && <div className={"small " + saveMsg.type} style={{ marginTop: 12 }}>{saveMsg.text}</div>}
          </>
        ) : (
          <div className="small muted">Role Anda hanya bisa melihat halaman ini. Aksi simpan dinonaktifkan.</div>
        )}
      </div>
    </div>
  );
}
