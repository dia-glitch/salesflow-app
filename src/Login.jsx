import { useState } from "react";
import { supabase } from "./supabaseClient.js";

const LOGO = "data:image/png;base64,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";
const C = "#A84238";
const ART = '<path d=\"M28 42 h44 l5 42 a4 4 0 0 1-4 4 H27 a4 4 0 0 1-4-4z\"/><path d=\"M39 42 v-6 a11 11 0 0 1 22 0 v6\"/>';

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
      if (error) setErr(error.message);
      setBusy(false);
  }
  async function forgot() {
    if (!email.trim()) { setErr("Isi email dulu untuk kirim link reset."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setErr(error ? error.message : ""); setInfo(error ? "" : "Link reset password sudah dikirim ke email kamu (jika terdaftar).");
  }

  const L = { display: "block", fontSize: 12, fontWeight: 700, color: "#56565E", marginBottom: 6 };
  const INP = { width: "100%", border: "1px solid #E2E2E4", borderRadius: 12, padding: "12px 14px", fontSize: 14, marginBottom: 16, outline: "none", background: "#FBFBFC", fontFamily: "inherit" };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#EEF0F3", padding: 16, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", color: "#0B0B0D" }}>
      <div className="lg-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: "100%", maxWidth: 860, minHeight: 520, background: "#fff", borderRadius: 22, overflow: "hidden", boxShadow: "0 20px 60px rgba(20,20,30,.14)" }}>
        <div className="lg-panel" style={{ position: "relative", background: C, color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", padding: "52px 46px" }}>
          <div style={{ position: "absolute", left: -44, bottom: -30, width: 360, height: 360, opacity: .13 }} dangerouslySetInnerHTML={{ __html: '<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' + ART + '</svg>' }} />
          <div style={{ width: 64, height: 64, borderRadius: 15, background: "rgba(255,255,255,.16)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
            <img src={LOGO} alt="" style={{ width: 44, height: 44 }} />
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.5px", position: "relative" }}>SalesFlow</div>
          <div style={{ fontSize: 14.5, opacity: .92, marginTop: 8, maxWidth: 260, lineHeight: 1.5, position: "relative" }}>Penjualan & channel</div>
        </div>
        <form onSubmit={submit} style={{ padding: "52px 48px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 30 }}>
            <img src={LOGO} alt="" style={{ width: 38, height: 38, borderRadius: 9 }} />
            <div><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".16em", color: "#8A8A93" }}>SALESFLOW</div><div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, marginTop: 1 }}>ALEZA</div></div>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px" }}>Masuk</h1>
          <p style={{ color: "#6a6a72", fontSize: 13.5, margin: "0 0 24px" }}>Isi email &amp; password untuk masuk ke akun kamu.</p>
          {err && <div style={{ background: "#FCE7EB", color: "#B4232E", fontSize: 12.5, padding: "9px 12px", borderRadius: 9, marginBottom: 14 }}>{err}</div>}
          {info && <div style={{ background: "#E7F6EC", color: "#166534", fontSize: 12.5, padding: "9px 12px", borderRadius: 9, marginBottom: 14 }}>{info}</div>}
          <label style={L}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={INP} placeholder="nama@email.com" />
          <label style={L}>Password</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={INP} placeholder="••••••••" />
          <a onClick={forgot} style={{ fontSize: 12.5, fontWeight: 600, color: C, cursor: "pointer", marginBottom: 20, display: "inline-block" }}>Lupa password?</a>
          <button type="submit" disabled={busy} style={{ width: "100%", border: "none", borderRadius: 12, padding: 13, fontSize: 14.5, fontWeight: 700, color: "#fff", background: C, cursor: "pointer", opacity: busy ? .7 : 1 }}>{busy ? "Masuk…" : "Masuk"}</button>
        </form>
      </div>
      <style>{`@media(max-width:760px){.lg-grid{grid-template-columns:1fr!important}.lg-panel{display:none!important}}`}</style>
    </div>
  );
}
