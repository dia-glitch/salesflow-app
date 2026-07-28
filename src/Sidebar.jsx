import { useEffect } from "react";
import { canView } from "./permissions.js";

const GROUPS = [
  {
    title: "Overview",
    items: [
      { k: "dash", label: "Dashboard", icon: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z" },
      { k: "collection", label: "Collection", icon: "M4 5h16v4H4zM4 11h16v8H4z" },
      { k: "restock", label: "Notifikasi Restock", icon: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9ZM13.7 21a2 2 0 01-3.4 0" },
      { k: "ai", label: "Analisa AI", icon: "M12 3l2.1 5.5L20 10l-5.9 1.5L12 17l-2.1-5.5L4 10l5.9-1.5z M18 15l.9 2.3L21 18l-2.1.7L18 21l-.9-2.3L15 18l2.1-.7z" },
    ],
  },
  {
    title: "Sales",
    items: [
      { k: "sales", label: "Penjualan", icon: "M4 6h16M4 12h16M4 18h16" },
      { k: "input", label: "Input sales", icon: "M12 5v14M5 12h14" },
      { k: "upload", label: "Upload sales", icon: "M12 16V4M7 9l5-5 5 5M5 20h14" },
      { k: "logsales", label: "Log Penjualan", icon: "M4 5h16M4 5l1 14h14l1-14M9 9v6M15 9v6" },
      { k: "kol", label: "KOL / Giveaway", icon: "M3 8h18v4H3z M5 12v8h14v-8 M12 8v12 M8.5 8a2.5 2.5 0 110-5C11 3 12 8 12 8 M15.5 8a2.5 2.5 0 100-5C13 3 12 8 12 8" },
      { k: "retur", label: "Retur Customer", icon: "M9 14 4 9l5-5 M20 20v-7a4 4 0 0 0-4-4H4" },
    ],
  },
  {
    title: "Keuangan",
    items: [
      { k: "ar", label: "Penagihan AR", icon: "M5 3h11l4 4v14H5zM16 3v4h4M8 12h8M8 16h5M8 8h3" },
      { k: "wholesale", label: "Direct Purchase", icon: "M3 3h2l2 12h11l2-8H6M9 21a1 1 0 100-2 1 1 0 000 2Zm8 0a1 1 0 100-2 1 1 0 000 2Z" },
      { k: "laporan", label: "Laporan", icon: "M4 4v16h16 M8 14v3 M12 10v7 M16 6v11" },
    ],
  },
  {
    title: "Data",
    items: [
      { k: "skus", label: "SKU Master", icon: "M4 7h16M4 7l1 13h14l1-13M9 7V4h6v3" },
    ],
  },
  {
    title: "Admin panel",
    items: [
      { k: "admin", label: "Admin Panel", icon: "M12 15a3 3 0 100-6 3 3 0 000 6Z M19.4 13a7.5 7.5 0 000-2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 00-1.7-1L15 3.2h-4l-.4 2.4a7.5 7.5 0 00-1.7 1l-2.3-1-2 3.4L4.6 11a7.5 7.5 0 000 2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 001.7 1l.4 2.4h4l.4-2.4a7.5 7.5 0 001.7-1l2.3 1 2-3.4-2-1.5Z" },
      { k: "prefix", label: "Master Prefix", icon: "M4 7V4h16v3 M9 20h6 M12 4v16" },
    ],
  },
  {
    title: "Bantuan",
    items: [
      { k: "panduan", label: "Panduan", icon: "M12 21a9 9 0 100-18 9 9 0 000 18Z M9.5 9.5a2.5 2.5 0 114 2c-1 .75-1.5 1.25-1.5 2.5 M12 17h.01" },
    ],
  },
];

const labelStyle = {
  fontSize: 11, fontWeight: 600, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--faint)", padding: "16px 12px 6px",
};

export default function Sidebar({ tab, setTab, role }) {
  useEffect(() => { document.title = "SALESFLOW · ALEZA"; }, []);
  return (
    <div className="sidebar">
      <div className="brand" style={{ display: "block" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: "var(--faint)" }}>SALESFLOW</div>
        <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, marginTop: 2, color: "var(--ink)" }}>ALEZA</div>
        <div className="small muted" style={{ marginTop: 3 }}>PT Asa Modakreasi Indonesia</div>
      </div>

      {GROUPS.map((g) => {
        const items = g.items.filter((it) => canView(role, it.k));
        if (items.length === 0) return null;
        return (
          <div key={g.title}>
            <div style={labelStyle}>{g.title}</div>
            {items.map((it) => (
              <button
                key={it.k}
                className={"nav" + (tab === it.k ? " active" : "")}
                onClick={() => setTab(it.k)}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={it.icon} />
                </svg>
                {it.label}
              </button>
            ))}
          </div>
        );
      })}

      <div className="foot">
        Master &amp; stok ditarik dari project <b>Production</b> (cf_*)
      </div>
    </div>
  );
}
