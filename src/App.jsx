import { useState, useEffect } from "react";
import Sidebar from "./Sidebar.jsx";
import Dashboard from "./Dashboard.jsx";
import Sales from "./Sales.jsx";
import SkuMaster from "./SkuMaster.jsx";
import CollectionPerf from "./CollectionPerf.jsx";
import InputManual from "./InputManual.jsx";
import UploadFile from "./UploadFile.jsx";
import AdminPanel from "./AdminPanel.jsx";
import DocPrefix from "./DocPrefix.jsx";
import AnalisaAI from "./AnalisaAI.jsx";
import RestockNotif from "./RestockNotif.jsx";
import KolReport from "./KolReport.jsx";
import Penagihan from "./Penagihan.jsx";
import Wholesale from "./Wholesale.jsx";
import Login from "./Login.jsx";
import Panduan from "./Panduan.jsx";
import { hasConfig, supabase } from "./supabaseClient.js";
import { canView, setAccess, hasSalesflowAccess } from "./permissions.js";

export default function App() {
  const [tab, setTab] = useState("dash");
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [accessReady, setAccessReady] = useState(false);

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
    if (!session) { setRole(null); setAccessReady(false); setAccess(new Set(), new Set()); return; }
    let active = true;
    (async () => {
      // role dari user_profiles (dipakai bersama semua app)
      const { data: prof } = await supabase
        .from("user_profiles").select("role").eq("id", session.user.id).maybeSingle();
      if (!active) return;
      const r = prof?.role || null;
      setRole(r);
      // hak akses dari role_access (SUMBER KEBENARAN, app='salesflow')
      const view = new Set(), act = new Set();
      if (r) {
        const { data: rows } = await supabase.schema("public").from("role_access")
          .select("resource, can_view, can_act").eq("app", "salesflow").eq("role", r);
        for (const row of (rows || [])) {
          if (row.can_view) view.add(row.resource);
          if (row.can_act) act.add(row.resource);
        }
      }
      if (!active) return;
      setAccess(view, act);
      setAccessReady(true);
    })();
    return () => { active = false; };
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
  if (!accessReady) return <div className="center-msg">Memuat…</div>;
  if (!hasSalesflowAccess()) {
    return (
      <div className="app">
        <div className="main">
          <div className="card err-card" style={{ textAlign: "center" }}>
            Akun ini tidak punya akses ke SalesFlow. Hubungi admin kalau ini keliru.
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={logout}>Keluar</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          if (view === "restock") return <RestockNotif />;
          if (view === "kol") return <KolReport />;
          if (view === "ar") return <Penagihan role={role} />;
          if (view === "wholesale") return <Wholesale role={role} />;
          if (view === "ai") return <AnalisaAI />;
          if (view === "panduan") return <Panduan />;
          if (view === "admin") return <AdminPanel currentUserId={session.user.id} />;
          if (view === "prefix") return <DocPrefix role={role} />;
          if (view === "upload") return <UploadFile role={role} />;
          if (view === "input") return <InputManual role={role} />;
          return <Dashboard role={role} />;
        })()}
      </div>
    </div>
  );
}
