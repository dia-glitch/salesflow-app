import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { canAct } from "./permissions.js";

const EMPTY = { key: "", prefix: "", label: "", pattern: "" };

export default function DocPrefix({ role }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [savingKey, setSavingKey] = useState("");
  const [err, setErr] = useState("");
  const [nf, setNf] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const canEdit = canAct(role, "doc_prefix");

  async function load() {
    const { data, error } = await supabase.from("sf_doc_prefixes").select("*").order("key");
    if (error) { setErr(error.message); setRows([]); return; }
    setRows(data || []);
    const d = {}; (data || []).forEach((r) => (d[r.key] = r.prefix)); setDraft(d);
  }
  useEffect(() => { load(); }, []);

  async function save(key) {
    setSavingKey(key); setErr("");
    const { error } = await supabase.from("sf_doc_prefixes").update({ prefix: (draft[key] || "").trim(), updated_at: new Date().toISOString() }).eq("key", key);
    setSavingKey("");
    if (error) { setErr("Gagal: " + error.message); return; }
    load();
  }

  async function addRow() {
    const key = nf.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!key) { setErr("Isi kode/key dulu."); return; }
    if (!nf.prefix.trim()) { setErr("Isi prefix dulu."); return; }
    if ((rows || []).some((r) => r.key === key)) { setErr(`Key "${key}" sudah ada.`); return; }
    setAdding(true); setErr("");
    const { error } = await supabase.from("sf_doc_prefixes").insert({ key, prefix: nf.prefix.trim(), label: nf.label.trim() || null, pattern: nf.pattern.trim() || null });
    setAdding(false);
    if (error) { setErr("Gagal tambah: " + error.message); return; }
    setNf({ ...EMPTY }); load();
  }

  async function delRow(key) {
    setErr("");
    const { error } = await supabase.from("sf_doc_prefixes").delete().eq("key", key);
    if (error) { setErr("Gagal hapus: " + error.message); return; }
    load();
  }

  if (rows === null) return <div className="center-msg">Memuat…</div>;
  const cols = canEdit ? 4 : 3;

  return (
    <div>
      <h1 className="title">Master Prefix Dokumen</h1>
      <p className="lead">Prefix penomoran (order, AR, invoice, channel lain) — tersimpan di DB, tidak hardcode. Bisa tambah/edit/hapus. Berlaku untuk dokumen baru; nomor lama tidak berubah.</p>
      {err && <div className="card err-card">{err}</div>}
      {!canEdit && <div className="card" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}><span className="small">Mode lihat saja — hanya admin yang bisa mengubah prefix.</span></div>}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr>
              <th style={{ padding: "10px 18px" }}>Dokumen</th>
              <th style={{ padding: "10px 18px" }}>Prefix</th>
              <th style={{ padding: "10px 18px" }}>Contoh</th>
              {canEdit && <th style={{ padding: "10px 18px" }}></th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ padding: "12px 18px" }}><b>{r.label || r.key}</b><div className="muted small mono">{r.key}</div></td>
                  <td style={{ padding: "12px 18px" }}>
                    {canEdit
                      ? <input value={draft[r.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} style={{ width: 150, fontFamily: "monospace" }} />
                      : <span className="mono">{r.prefix}</span>}
                  </td>
                  <td style={{ padding: "12px 18px" }} className="muted small mono">{r.pattern || "—"}</td>
                  {canEdit && <td style={{ padding: "12px 18px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-primary" disabled={savingKey === r.key || (draft[r.key] || "").trim() === r.prefix} onClick={() => save(r.key)}>{savingKey === r.key ? "…" : "Simpan"}</button>
                    <button className="btn btn-ghost" style={{ marginLeft: 6 }} onClick={() => delRow(r.key)}>Hapus</button>
                  </td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={cols} className="center-msg">Master prefix belum ada — jalankan sql/sf_doc_prefixes.sql.</td></tr>}
              {canEdit && (
                <tr style={{ background: "var(--paper)" }}>
                  <td style={{ padding: "12px 18px" }}>
                    <input value={nf.label} onChange={(e) => setNf((s) => ({ ...s, label: e.target.value }))} placeholder="Nama dokumen (mis. Order Offline)" style={{ width: 220 }} />
                    <input value={nf.key} onChange={(e) => setNf((s) => ({ ...s, key: e.target.value }))} placeholder="key (mis. offline_order)" style={{ width: 220, marginTop: 6, fontFamily: "monospace" }} />
                  </td>
                  <td style={{ padding: "12px 18px" }}>
                    <input value={nf.prefix} onChange={(e) => setNf((s) => ({ ...s, prefix: e.target.value }))} placeholder="mis. OFF-" style={{ width: 150, fontFamily: "monospace" }} />
                  </td>
                  <td style={{ padding: "12px 18px" }}>
                    <input value={nf.pattern} onChange={(e) => setNf((s) => ({ ...s, pattern: e.target.value }))} placeholder="contoh (opsional)" style={{ width: 170, fontFamily: "monospace" }} />
                  </td>
                  <td style={{ padding: "12px 18px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-primary" disabled={adding} onClick={addRow}>{adding ? "…" : "+ Tambah"}</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
