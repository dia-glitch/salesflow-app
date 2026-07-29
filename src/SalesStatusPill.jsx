import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

/* Indikator status input sales di header (tampil di semua page).
 * Hijau = sudah ada input/upload hari ini · Kuning = belum. Klik → Log Penjualan. */

const isToday = (iso) => {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const who = (email) => (email ? email.split("@")[0] : null);

export default function SalesStatusPill({ setTab }) {
  const [last, setLast] = useState(undefined); // undefined = loading, null = belum ada

  async function load() {
    const { data } = await supabase.from("cf_sales_staging").select("imported_at,input_by").order("imported_at", { ascending: false }).limit(1);
    setLast(data && data[0] ? data[0] : null);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    const f = () => load();
    window.addEventListener("focus", f);
    return () => { clearInterval(t); window.removeEventListener("focus", f); };
  }, []);

  if (last === undefined) return null;
  const done = last && isToday(last.imported_at);
  const c = done ? "var(--good)" : "var(--warn)";
  const bg = done ? "var(--good-soft)" : "var(--warn-soft)";
  const byTxt = last && last.input_by ? who(last.input_by) : null;
  const label = done
    ? `Sales hari ini ✓ · update ${fmtWhen(last.imported_at)}${byTxt ? " · " + byTxt : ""}`
    : last
      ? `Belum ada input sales hari ini · terakhir ${fmtWhen(last.imported_at)}${byTxt ? " oleh " + byTxt : ""}`
      : "Belum ada input sales";

  return (
    <button onClick={() => setTab && setTab("logsales")} title="Buka Log Penjualan"
      style={{ display: "inline-flex", alignItems: "center", gap: 7, background: bg, color: c, border: "none", borderRadius: 999, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", maxWidth: "60vw", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }} />
      {label}
    </button>
  );
}
