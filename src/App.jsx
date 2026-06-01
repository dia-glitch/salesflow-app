import { useState, useEffect } from "react";
import Sidebar from "./Sidebar.jsx";
import Dashboard from "./Dashboard.jsx";
import Sales from "./Sales.jsx";
import SkuMaster from "./SkuMaster.jsx";
import CollectionPerf from "./CollectionPerf.jsx";
import InputManual from "./InputManual.jsx";
import UploadFile from "./UploadFile.jsx";
import AdminPanel from "./AdminPanel.jsx";
import Login from "./Login.jsx";
import { hasConfig, supabase } from "./supabaseClient.js";
import { canView } from "./permissions.js";

export default function App() {
  const [tab, setTab] = useState("dash");
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    if (!hasConfig) { setReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) { setRole(null); return; }
    supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => setRole(data?.role || "manager"));
  }, [session]);

  async function logout() { await supabase.auth.signOut(); }

  if (!hasConfig) {
    return (
      <div className="app">
        <div className="main">
          <div className="card err-card">
            Konfigurasi belum lengkap. Isi <code>.env.local</code> dengan
            <code>VITE_SUPABASE_URL</code> &amp; <code>VITE_SUPABASE_ANON_KEY</code>,
            lalu jalankan ulang <code>npm run dev</code>.
          </div>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="center-msg">Memuat…</div>;
  if (!session) return <Login />;

  return (
    <div className="app">
      <Sidebar tab={tab} setTab={setTab} role={role} />
      <div className="main">
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <span className="small muted">{session.user.email}{role ? " · " + role : ""}</span>
          <button className="btn btn-ghost" onClick={logout}>Keluar</button>
        </div>
        {(() => {
          const view = canView(role, tab) ? tab : "dash";
          if (view === "dash") return <Dashboard role={role} />;
          if (view === "sales") return <Sales role={role} />;
          if (view === "skus") return <SkuMaster role={role} />;
          if (view === "collection") return <CollectionPerf />;
          if (view === "admin") return <AdminPanel currentUserId={session.user.id} />;
          if (view === "upload") return <UploadFile role={role} />;
          if (view === "input") return <InputManual role={role} />;
          return <Dashboard role={role} />;
        })()}
      </div>
    </div>
  );
}
