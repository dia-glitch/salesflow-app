import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { canAct } from "./permissions.js";
import { renderNumber } from "./prefixes.js";

export default function DocPrefix({ role }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});   // key -> {prefix, number_format}
  const [savingKey, setSavingKey] = useState("");
  const [err, setErr] = useState("");
  const canEdit = canAct(role, "doc_prefix");

  async function load() {
    const { data, error } = await supabase.from("sf_doc_prefixes").select("*").order("key");
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
    const d = {}; (data || []).forEach((r) => (d[r.key] = { prefix: r.prefix || "", number_format: r.number_format || "" })); setDraft(d);
  }
  useEffect(() => { load(); }, []);

  async function save(key) {
    setSavingKey(key); setErr("");
    const dr = draft[key] || {};
    const { error } = await supabase.from("sf_doc_prefixes").update({ prefix: (dr.prefix || "").trim(), number_format: (dr.number_format || "").trim() || null, updated_at: new Date().toISOString() }).eq("key", key);
    setSavingKey("");
    if (error) { setErr("Gagal: " + error.message); return; }
    load();
  }

  function preview(key) {
    const dr = draft[key] || {};
    const isAr = key === "consign_ar";
    const isInv = key.startsWith("inv_");
    if (isInv) return renderNumber(dr.prefix, dr.number_format, { doc: (draft.wholesale_order?.prefix || "DO") + "-260722-001" });
    return renderNumber(dr.prefix, dr.number_format, { date: new Date(), store: isAr ? "ACH" : undefined, seq: 1 });
  }

  if (rows === null) return <div className="center-msg">Memuat…</div>;

  return (
    <div>
      <h1 className="title">Master Prefix Dokumen</h1>
      <p className="lead">Prefix &amp; format penomoran dokumen yang dibuat sistem — tersimpan di DB, tidak hardcode. Berlaku untuk dokumen baru; nomor lama tidak berubah.</p>
      {err && <div className="card err-card">{err}</div>}
      {!canEdit && <div className="card" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}><span className="small">Mode lihat saja — hanya admin yang bisa mengubah.</span></div>}

      <div className="card" style={{ padding: "12px 16px", marginBottom: 12 }}>
        <div className="small muted">Token format (bagian setelah prefix): <b>{"{YY}"}</b>/<b>{"{YYYY}"}</b> tahun · <b>{"{MM}"}</b> bulan · <b>{"{DD}"}</b> tanggal · <b>{"{STORE}"}</b> kode store · <b>{"{SEQ:3}"}</b> nomor urut 3 digit · <b>{"{DOC}"}</b> no dokumen sumber (invoice). Wajib ada <b>{"{SEQ}"}</b> pada order &amp; AR agar nomornya urut.</div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr>
              <th style={{ padding: "10px 16px" }}>Dokumen</th>
              <th style={{ padding: "10px 16px" }}>Prefix</th>
              <th style={{ padding: "10px 16px" }}>Format nomor</th>
              <th style={{ padding: "10px 16px" }}>Contoh</th>
              {canEdit && <th style={{ padding: "10px 16px" }}></th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const dr = draft[r.key] || {};
                const isInv = r.key.startsWith("inv_");
                const changed = (dr.prefix ?? "") !== (r.prefix || "") || (dr.number_format ?? "") !== (r.number_format || "");
                return (
                  <tr key={r.key}>
                    <td style={{ padding: "12px 16px" }}><b>{r.label || r.key}</b><div className="muted small mono">{r.key}</div></td>
                    <td style={{ padding: "12px 16px" }}>
                      {canEdit
                        ? <input value={dr.prefix ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: { ...d[r.key], prefix: e.target.value } }))} style={{ width: 110, fontFamily: "monospace" }} />
                        : <span className="mono">{r.prefix}</span>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {canEdit && !isInv
                        ? <input value={dr.number_format ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: { ...d[r.key], number_format: e.target.value } }))} style={{ width: 180, fontFamily: "monospace" }} />
                        : <span className="mono muted">{isInv ? "{DOC}" : r.number_format}</span>}
                      {isInv && <div className="muted small">otomatis = prefix + no dokumen</div>}
                    </td>
                    <td style={{ padding: "12px 16px" }} className="mono">{preview(r.key)}</td>
                    {canEdit && <td style={{ padding: "12px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-primary" disabled={savingKey === r.key || !changed} onClick={() => save(r.key)}>{savingKey === r.key ? "…" : "Simpan"}</button>
                    </td>}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={canEdit ? 5 : 4} className="center-msg">Master prefix belum ada — jalankan sql/sf_doc_prefixes.sql &amp; sf_doc_prefixes_format.sql.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ background: "var(--paper)", marginTop: 12 }}>
        <span className="small muted">Yang dinomori otomatis oleh sistem: <b>Order Direct Purchase</b>, <b>Invoice DP/Pelunasan/Full</b>, dan <b>No. AR Konsinyasi</b>. Penjualan channel lain (offline/marketplace) memakai ID dari sumbernya (impor), jadi tidak dinomori di sini. Butuh channel tertentu dinomori sistem? beri tahu channel &amp; formatnya.</span>
      </div>
    </div>
  );
}
