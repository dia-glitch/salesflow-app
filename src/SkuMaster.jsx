import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtIDR, fmtNum } from "./format.js";
import { canAct } from "./permissions.js";

// ambang umur produk (hari sejak launch) — silakan sesuaikan
const AGE_RULES = [
  { key: "Baru", max: 30, color: "var(--good)", soft: "var(--good-soft)" },
  { key: "Evergreen", max: 90, color: "var(--online)", soft: "#E2ECF2" },
  { key: "Old", max: 180, color: "var(--warn)", soft: "var(--warn-soft)" },
  { key: "Clearance", max: Infinity, color: "var(--bad)", soft: "var(--bad-soft)" },
];
const ageInfo = (days) => {
  if (days == null) return { key: "—", color: "var(--faint)", soft: "var(--paper)" };
  return AGE_RULES.find((r) => days <= r.max) || AGE_RULES[AGE_RULES.length - 1];
};
const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export default function SkuMaster({ role }) {
  const canEditImg = canAct(role, "sku");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [coll, setColl] = useState("all");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState("code");

  const [imgMap, setImgMap] = useState({});
  const [uploadingCode, setUploadingCode] = useState("");
  const fileRef = useRef(null);
  const pendingCode = useRef("");

  function pickImage(code) {
    pendingCode.current = code;
    if (fileRef.current) { fileRef.current.value = ""; fileRef.current.click(); }
  }
  async function onImageFile(e) {
    const file = e.target.files?.[0];
    const code = pendingCode.current;
    if (!file || !code) return;
    setUploadingCode(code);
    try {
      const safe = code.replace(/[^A-Za-z0-9_-]/g, "-");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${safe}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
      if (up.error) throw up.error;
      const url = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from("product_images")
        .upsert({ product_code: code, image_url: url, updated_at: new Date().toISOString() });
      if (error) throw error;
      setImgMap((m) => ({ ...m, [code]: url }));
    } catch (err) {
      alert("Gagal upload gambar: " + (err.message || err));
    } finally {
      setUploadingCode("");
    }
  }

  async function load() {
    setLoading(true); setError("");
    try {
      const [items, prods, prices, spks, stock, imgs] = await Promise.all([
        supabase.from("sku_items").select("sku,spk_id,size_label,product_name_system,colour_lv2,qty").limit(10000),
        supabase.from("sku_products").select("spk_id,spk_number,product_code,product_name_system,collection_code,category_lv1,category_lv2,colour,colour_lv2"),
        supabase.from("cogm_retail_prices").select("spk_id,cogm,cogm_final,retail_price"),
        supabase.from("spk_orders").select("id,spk_number,launch_date,total_qty"),
        supabase.from("v_cf_stock_on_hand").select("sku,qty"),
        supabase.from("product_images").select("product_code,image_url"),
      ]);
      for (const r of [items, prods, prices, spks, stock, imgs]) if (r.error) throw r.error;
      const im = {}; (imgs.data || []).forEach((x) => (im[x.product_code] = x.image_url));
      setImgMap(im);

      const prodBy = {}; (prods.data || []).forEach((p) => (prodBy[p.spk_id] = p));
      const priceBy = {}; (prices.data || []).forEach((p) => (priceBy[p.spk_id] = p));
      const spkById = {}; const spkByNo = {};
      (spks.data || []).forEach((s) => { spkById[s.id] = s; if (s.spk_number) spkByNo[s.spk_number] = s; });
      const stockBy = {};
      (stock.data || []).forEach((s) => { stockBy[s.sku] = (stockBy[s.sku] || 0) + (Number(s.qty) || 0); });

      const out = (items.data || []).map((it) => {
        const p = prodBy[it.spk_id] || {};
        const pr = priceBy[it.spk_id] || {};
        const spk = spkById[it.spk_id] || spkByNo[p.spk_number] || {};
        const launch = spk.launch_date || null;
        const age = daysSince(launch);
        const size = it.size_label || "";
        let nm = p.product_name_system || it.product_name_system || "";
        if (size && nm.toUpperCase().endsWith(" " + size.toUpperCase())) {
          nm = nm.slice(0, nm.length - size.length - 1).trim();
        }
        return {
          sku: it.sku,
          name: nm,
          qty: stockBy[it.sku] || 0,
          product_code: p.product_code || "",
          collection: p.collection_code || "—",
          cat1: p.category_lv1 || "",
          cat2: p.category_lv2 || "",
          colour: p.colour || p.colour_lv2 || it.colour_lv2 || "",
          size: it.size_label || "",
          retail: pr.retail_price ?? null,
          cogm: Number(pr.cogm_final ?? pr.cogm ?? 0) || null,
          launch,
          age,
        };
      });
      setRows(out);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const collections = useMemo(
    () => [...new Set(rows.map((r) => r.collection).filter(Boolean))].sort(),
    [rows]
  );
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.cat1).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (coll !== "all" && r.collection !== coll) return false;
      if (cat !== "all" && r.cat1 !== cat) return false;
      if (needle) {
        const hay = (r.sku + " " + r.name + " " + r.product_code).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const byNum = (a, b, k) => (b[k] ?? -1) - (a[k] ?? -1);
    out = [...out].sort((a, b) => {
      if (sort === "code") return (a.product_code + a.size).localeCompare(b.product_code + b.size);
      if (sort === "age_desc") return byNum(a, b, "age");
      if (sort === "age_asc") return -byNum(a, b, "age");
      if (sort === "cogm") return byNum(a, b, "cogm");
      if (sort === "retail") return byNum(a, b, "retail");
      return 0;
    });
    return out;
  }, [rows, q, coll, cat, sort]);

  const summary = useMemo(() => {
    const codes = new Set(filtered.map((r) => r.product_code).filter(Boolean));
    const dist = { Baru: 0, Evergreen: 0, Old: 0, Clearance: 0, "—": 0 };
    let withLaunch = 0;
    filtered.forEach((r) => {
      const k = ageInfo(r.age).key;
      dist[k] = (dist[k] || 0) + (Number(r.qty) || 0);
      if (r.launch) withLaunch++;
    });
    return { sku: filtered.length, codes: codes.size, colls: new Set(filtered.map((r) => r.collection)).size, dist, withLaunch };
  }, [filtered]);

  function downloadCSV() {
    const data = filtered.map((r) => ({
      sku: r.sku, product_name_system: r.name, product_code: r.product_code,
      collection: r.collection, category_lv1: r.cat1, category_lv2: r.cat2,
      colour: r.colour, size: r.size, stok: r.qty, retail: r.retail, cogm: r.cogm,
      launch_date: r.launch || "", umur_hari: r.age ?? "", kategori_umur: ageInfo(r.age).key,
    }));
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const lines = [headers.join(","), ...data.map((row) => headers.map((h) => csvCell(row[h])).join(","))];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sku_master.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="center-msg">Memuat master SKU…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}<div className="spacer" />
    <span className="small">Pastikan SQL izin baca (v_cf_sku_master / sku_products / spk_orders) sudah dijalankan.</span></div>;

  const distMax = Math.max(...Object.values(summary.dist), 1);

  return (
    <div>
      <h1 className="title">SKU Master</h1>
      <p className="lead">Data master produk per SKU · harga, COGM, launch date &amp; umur produk.</p>

      <div className="grid4" style={{ marginBottom: 16 }}>
        <KPI l="Total SKU" v={fmtNum(summary.sku)} />
        <KPI l="Product code" v={fmtNum(summary.codes)} />
        <KPI l="Koleksi" v={fmtNum(summary.colls)} />
        <KPI l="Punya launch date" v={summary.sku ? Math.round((summary.withLaunch / summary.sku) * 100) + "%" : "—"} />
      </div>

      <div className="card">
        <div className="section-label">Distribusi umur produk (stok terkini, pcs)</div>
        <div style={{ marginTop: 12 }}>
          {AGE_RULES.map((r) => (
            <div className="bar" key={r.key}>
              <div className="row">
                <span className="nm">
                  <span className="pill" style={{ background: r.soft, color: r.color, marginRight: 8 }}>{r.key}</span>
                  {r.key === "Baru" ? "≤30 hari" : r.key === "Evergreen" ? "31–90" : r.key === "Old" ? "91–180" : ">180 hari"}
                </span>
                <span className="rt">{fmtNum(summary.dist[r.key] || 0)} pcs</span>
              </div>
              <div className="track"><div className="fill" style={{ width: ((summary.dist[r.key] || 0) / distMax) * 100 + "%", background: r.color }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="grid4" style={{ alignItems: "end" }}>
          <div style={{ gridColumn: "span 2" }}>
            <label>Cari</label>
            <input placeholder="SKU, nama produk, product code…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label>Koleksi</label>
            <select value={coll} onChange={(e) => setColl(e.target.value)}>
              <option value="all">Semua koleksi</option>
              {collections.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label>Kategori</label>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="all">Semua kategori</option>
              {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label>Urutkan</label>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="code">Product code</option>
              <option value="age_desc">Umur terlama</option>
              <option value="age_asc">Umur terbaru</option>
              <option value="cogm">COGM tertinggi</option>
              <option value="retail">Retail tertinggi</option>
            </select>
          </div>
          <button className="btn btn-ghost" onClick={load}>Muat ulang</button>
          <button className="btn btn-primary" onClick={downloadCSV} disabled={filtered.length === 0}>Unduh CSV</button>
          <span className="small muted" style={{ marginLeft: "auto" }}>{fmtNum(filtered.length)} SKU</span>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onImageFile} />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr style={{ background: "var(--paper)" }}>
                <th style={{ padding: "10px 12px" }}>Img</th>
                {["SKU","Produk","Product code","Koleksi","Kategori","Colour","Size"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px" }}>{h}</th>
                ))}
                <th style={{ padding: "10px 12px" }} className="num">Retail</th>
                <th style={{ padding: "10px 12px" }} className="num">COGM</th>
                <th style={{ padding: "10px 12px" }} className="num">Stok</th>
                <th style={{ padding: "10px 12px" }}>Launch</th>
                <th style={{ padding: "10px 12px" }}>Umur</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={13} className="center-msg">Tidak ada SKU pada filter ini.</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const ai = ageInfo(r.age);
                  const img = imgMap[r.product_code];
                  return (
                    <tr key={r.sku}>
                      <td style={{ padding: "6px 12px" }}>
                        <button onClick={() => canEditImg && pickImage(r.product_code)}
                          title={canEditImg ? "Upload/ganti gambar" : "Hanya BI/MD Sales/Admin yang bisa ubah gambar"}
                          disabled={!canEditImg}
                          style={{ width: 40, height: 40, padding: 0, border: "1px solid var(--line)", borderRadius: 7,
                            background: img ? `center/cover no-repeat url(${img})` : "var(--paper)",
                            color: "var(--faint)", fontSize: 16, cursor: canEditImg ? "pointer" : "default", overflow: "hidden" }}>
                          {uploadingCode === r.product_code ? "…" : img ? "" : (canEditImg ? "+" : "")}
                        </button>
                      </td>
                      <td style={{ padding: "9px 12px", fontWeight: 500 }}>{r.sku}</td>
                      <td style={{ padding: "9px 12px" }}>{r.name}</td>
                      <td style={{ padding: "9px 12px", fontSize: 12 }} className="muted">{r.product_code}</td>
                      <td style={{ padding: "9px 12px" }}>
                        {r.collection !== "—" ? <span className="pill" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{r.collection}</span> : <span className="muted">—</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }} className="muted">{[r.cat1, r.cat2].filter(Boolean).join(" · ") || "—"}</td>
                      <td style={{ padding: "9px 12px" }} className="muted">{r.colour || "—"}</td>
                      <td style={{ padding: "9px 12px" }}>{r.size ? <span className="pill" style={{ background: "var(--paper)", color: "var(--sub)" }}>{r.size}</span> : "—"}</td>
                      <td style={{ padding: "9px 12px" }} className="num muted">{r.retail != null ? fmtIDR(r.retail) : "—"}</td>
                      <td style={{ padding: "9px 12px" }} className="num">{r.cogm ? fmtIDR(r.cogm) : "—"}</td>
                      <td style={{ padding: "9px 12px", fontWeight: 500, color: r.qty < 0 ? "var(--bad)" : undefined }} className="num">{fmtNum(r.qty)}</td>
                      <td style={{ padding: "9px 12px" }} className="muted">{r.launch || "—"}</td>
                      <td style={{ padding: "9px 12px" }}>
                        {r.age == null ? <span className="muted">—</span> : (
                          <span className="pill" style={{ background: ai.soft, color: ai.color }}>{r.age} hr · {ai.key}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {filtered.length > 500 && (
        <p className="small muted">Menampilkan 500 SKU pertama; Unduh CSV memuat semua {fmtNum(filtered.length)}.</p>
      )}
    </div>
  );
}

const KPI = ({ l, v }) => (
  <div className="card kpi" style={{ margin: 0 }}>
    <p className="l">{l}</p>
    <p className="v">{v}</p>
  </div>
);
