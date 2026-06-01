import { useState } from "react";
import { supabase } from "./supabaseClient.js";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) { setErr("Login gagal: " + error.message); setBusy(false); }
    // sukses → App mendeteksi sesi otomatis & menampilkan aplikasi
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--paper)", padding: 24 }}>
      <div className="card" style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: "var(--faint)" }}>SALESFLOW</div>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05, marginTop: 2, color: "var(--ink)" }}>ALEZA</div>
          <div className="small muted" style={{ marginTop: 3 }}>PT Asa Modakreasi Indonesia</div>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" required style={{ width: "100%" }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>Password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              autoComplete="current-password" required style={{ width: "100%" }} />
          </div>
          {err && <div className="err-card" style={{ marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Masuk…" : "Masuk"}
          </button>
        </form>

        <p className="small muted" style={{ marginTop: 14 }}>
          Akun dibuat oleh admin. Belum punya akses? Hubungi admin SalesFlow.
        </p>
      </div>
    </div>
  );
}
