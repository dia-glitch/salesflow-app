import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";

const ROLES = ["admin", "bi", "md_sales", "finance", "manager", "director", "rnd", "store_ops"];
const ROLE_LABEL = {
  admin: "Admin", bi: "BI", md_sales: "MD Sales", finance: "Finance",
  manager: "Manager", director: "Director", rnd: "RnD", store_ops: "Store Ops",
};

export default function AdminPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError("");
    const { data, error } = await supabase
      .from("profiles").select("id,email,full_name,role").order("email", { ascending: true });
    if (error) setError(error.message);
    else setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => (r.email || "").toLowerCase().includes(s) || (r.full_name || "").toLowerCase().includes(s));
  }, [rows, q]);

  async function save(id) {
    setSaving(true);
    const { error } = await supabase.from("profiles")
      .update({ role: draft, updated_at: new Date().toISOString() }).eq("id", id);
    setSaving(false);
    if (error) { alert("Gagal menyimpan role: " + error.message); return; }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, role: draft } : r)));
    setEditId("");
  }

  if (loading) return <div className="center-msg">Memuat user…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;

  return (
    <div>
      <h1 className="title">Admin Panel</h1>
      <p className="lead">Kelola role &amp; akses user · Invite user baru via Supabase Dashboard → Auth → Users.</p>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 18px", flexWrap: "wrap" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600 }}>Users ({fmt(rows.length)})</div>
          <input placeholder="Cari nama atau email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr style={{ background: "var(--paper)" }}>
                <th style={{ padding: "10px 18px" }}>Nama</th>
                <th style={{ padding: "10px 18px" }}>Email</th>
                <th style={{ padding: "10px 18px" }}>Role</th>
                <th style={{ padding: "10px 18px", textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} className="center-msg">Tidak ada user.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "12px 18px", fontWeight: 500 }}>{r.full_name || "—"}</td>
                  <td style={{ padding: "12px 18px" }} className="muted">{r.email}</td>
                  <td style={{ padding: "12px 18px" }}>
                    {editId === r.id ? (
                      <select value={draft} onChange={(e) => setDraft(e.target.value)}>
                        {ROLES.map((x) => (<option key={x} value={x}>{ROLE_LABEL[x]}</option>))}
                      </select>
                    ) : (
                      <span className="pill" style={{ background: "var(--paper)", color: "var(--sub)" }}>{ROLE_LABEL[r.role] || r.role}</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 18px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {editId === r.id ? (
                      <>
                        <button className="btn btn-primary" disabled={saving} onClick={() => save(r.id)}>{saving ? "…" : "Simpan"}</button>
                        <button className="btn btn-ghost" style={{ marginLeft: 6 }} onClick={() => setEditId("")}>Batal</button>
                      </>
                    ) : (
                      <button className="btn btn-ghost" onClick={() => { setEditId(r.id); setDraft(r.role); }}>Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
        <span className="small">
          Untuk mengundang user baru: <b>Supabase Dashboard → Authentication → Users → Invite user</b>.
          Role bisa diset di sini setelah user menerima undangan & login pertama kali.
        </span>
      </div>
    </div>
  );
}

const fmt = (n) => new Intl.NumberFormat("id-ID").format(n);
