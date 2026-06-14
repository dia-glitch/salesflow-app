import { useState } from "react";

const ICON = {
  dash: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z",
  collection: "M4 5h16v4H4zM4 11h16v8H4z",
  restock: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9ZM13.7 21a2 2 0 01-3.4 0",
  ai: "M12 3l2.1 5.5L20 10l-5.9 1.5L12 17l-2.1-5.5L4 10l5.9-1.5z M18 15l.9 2.3L21 18l-2.1.7L18 21l-.9-2.3L15 18l2.1-.7z",
  penjualan: "M4 6h16M4 12h16M4 18h16",
  input: "M12 5v14M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  kol: "M3 8h18v4H3z M5 12v8h14v-8 M12 8v12 M8.5 8a2.5 2.5 0 110-5C11 3 12 8 12 8 M15.5 8a2.5 2.5 0 100-5C13 3 12 8 12 8",
  sku: "M4 7h16M4 7l1 13h14l1-13M9 7V4h6v3",
  admin: "M12 15a3 3 0 100-6 3 3 0 000 6Z M19.4 13a7.5 7.5 0 000-2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 00-1.7-1L15 3.2h-4l-.4 2.4a7.5 7.5 0 00-1.7 1l-2.3-1-2 3.4L4.6 11a7.5 7.5 0 000 2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 001.7 1l.4 2.4h4l.4-2.4a7.5 7.5 0 001.7-1l2.3 1 2-3.4-2-1.5Z",
};

// Warna badge per PIC (sumber kebenaran sekaligus dipakai di legenda)
const PIC = {
  "View": { bg: "#fff", fg: "#7C7568", border: "1px solid #E7E0D2" },
  "BI Sales": { bg: "#E7EEF3", fg: "#305A73" },
  "Marketing": { bg: "#F7ECD4", fg: "#8A5E12" },
  "BI Creative Mktg": { bg: "#F1E1D8", fg: "#9A3D22" },
  "Admin": { bg: "#EEEDFE", fg: "#3C3489" },
};

const GUIDE = [
  {
    key: "ov", label: "Overview",
    cards: [
      { n: "01", icon: "dash", name: "Dashboard", pic: "View",
        desc: "Ringkasan berbagai metric penjualan dalam satu layar.",
        points: ["Sales Overview", "Product & Margin Overview", "Channel Overview", "Trend & Target Sales"] },
      { n: "02", icon: "collection", name: "Collection", pic: "View",
        desc: "Performa penjualan per collection." },
      { n: "03", icon: "restock", name: "Notifikasi Restock", pic: "View",
        desc: "Rekomendasi restock — Distribusi & Restock Produksi — berdasarkan data performa penjualan." },
      { n: "04", icon: "ai", name: "Analisa AI", pic: "View",
        desc: "Chat & analisa data dibantu Claude AI yang terhubung di sini." },
    ],
  },
  {
    key: "sl", label: "Sales",
    cards: [
      { n: "01", icon: "penjualan", name: "Penjualan", pic: "View",
        desc: "Master data semua penjualan harian yang sudah masuk sistem (dari input manual maupun upload). Bisa difilter, dicari, dan diekspor untuk rekap." },
      { n: "02", icon: "input", name: "Input Sales", pic: "BI Sales",
        desc: "Input penjualan manual, satu per satu. Cocok untuk koreksi atau transaksi jumlah sedikit.",
        points: ["Pilih channel & store", "Pilih produk per SKU", "Isi qty, harga jual, diskon"] },
      { n: "03", icon: "upload", name: "Upload Sales", pic: "BI Sales",
        desc: "Input penjualan massal sekaligus lewat file. Unduh template, isi, lalu upload — tiap baris divalidasi sebelum disimpan.",
        points: ["Download template", "Upload CSV / XLSX", "Validasi otomatis tiap baris"] },
      { n: "04", icon: "kol", name: "KOL / Giveaway", pic: "Marketing",
        desc: "Catat produk yang keluar untuk KOL/influencer atau giveaway — barang keluar tanpa nilai jual, agar stok tetap akurat & terpisah dari penjualan." },
    ],
  },
  {
    key: "da", label: "Data & Admin",
    cards: [
      { n: "01", icon: "sku", name: "SKU Master", pic: "BI Creative Mktg",
        desc: "Master data produk dengan identifikasi lengkap. View-only, kecuali bagian foto: wajib di-upload dengan foto real product saat produk akan launch.",
        points: ["Identifikasi produk lengkap", "Foto real product (wajib saat launch)"] },
      { n: "02", icon: "admin", name: "Admin Panel", pic: "Admin", soon: true,
        desc: "Kelola user & role akses." },
    ],
  },
];

function Ic({ d }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function GuideCard({ c }) {
  const p = PIC[c.pic] || PIC["View"];
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8, ...(c.soon ? { background: "#FAF7F0", borderStyle: "dashed" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 600, color: "var(--accent)" }}>{c.n}</span>
        <span style={{ color: "var(--sub)", display: "flex" }}><Ic d={ICON[c.icon]} /></span>
        <span style={{ fontSize: 14.5, fontWeight: 500 }}>{c.name}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", background: p.bg, color: p.fg, border: p.border || "none" }}>{c.pic}</span>
      </div>
      <div className="small muted" style={{ lineHeight: 1.55 }}>
        {c.desc}{c.soon && <span style={{ color: "var(--faint)" }}> — detail menyusul</span>}
      </div>
      {c.points && (
        <ul style={{ listStyle: "none", margin: "2px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          {c.points.map((pt, i) => (
            <li key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, color: "var(--ink)", lineHeight: 1.4 }}>
              <span style={{ flex: "none", width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", marginTop: 6 }} />
              <span>{pt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Panduan() {
  const [tab, setTab] = useState("ov");
  const active = GUIDE.find((g) => g.key === tab) || GUIDE[0];
  return (
    <div>
      <h1 className="title">Panduan penggunaan</h1>
      <p className="lead">SALESFLOW · ringkasan tiap menu per kelompok.</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {GUIDE.map((g) => (
          <button key={g.key} onClick={() => setTab(g.key)}
            style={{
              fontFamily: "inherit", fontSize: 13, padding: "7px 14px", borderRadius: 999, cursor: "pointer",
              border: tab === g.key ? "1px solid var(--accent)" : "1px solid var(--line)",
              background: tab === g.key ? "var(--accent)" : "#fff",
              color: tab === g.key ? "#fff" : "var(--sub)",
            }}>
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid2">
        {active.cards.map((c) => <GuideCard key={c.n} c={c} />)}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 16, fontSize: 11, color: "var(--sub)" }}>
        {Object.entries(PIC).map(([k, v]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: v.bg, border: v.border || "none", display: "inline-block" }} />{k}
          </span>
        ))}
      </div>
    </div>
  );
}
