import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, Tooltip, Legend } from "recharts";
import { supabase } from "./supabaseClient.js";
import { fmtShort, fmtNum, fmtIDR } from "./format.js";
import { canAct } from "./permissions.js";
import ProductTab from "./ProductTab.jsx";
import ChannelOverview from "./ChannelOverview.jsx";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const achColor = (pct) => pct >= 100 ? "var(--good)" : pct >= 70 ? "var(--warn)" : "var(--bad)";
const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const fmtMonthShort = (mm) => { const [y, mo] = mm.split("-").map(Number); return MONTHS_ID[mo - 1] + " " + String(y).slice(2); };

export default function Dashboard({ role }) {
  const [section, setSection] = useState("sales");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fact, setFact] = useState([]);
  const [chMap, setChMap] = useState({});
  const [locMap, setLocMap] = useState({});
  const [stores, setStores] = useState([]);
  const [targetsRaw, setTargetsRaw] = useState([]);

  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(String(new Date().getFullYear()));

  // modal target
  const [showT, setShowT] = useState(false);
  const [mMonth, setMMonth] = useState(thisMonth());
  const [mDraft, setMDraft] = useState({});
  const [savingT, setSavingT] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  async function load() {
    setLoading(true); setError("");
    try {
      const [f, ch, loc, tg] = await Promise.all([
        supabase.from("cf_sales_fact").select("txn_date,channel_id,location_id,qty,net_amount").neq("channel_id", "KOL"),
        supabase.from("cf_sales_channels").select("channel_id,name,kind"),
        supabase.from("cf_locations").select("location_id,name,type"),
        supabase.from("sales_targets").select("month,target_key,target_amount"),
      ]);
      for (const r of [f, ch, loc, tg]) if (r.error) throw r.error;
      const cm = {}; (ch.data || []).forEach((c) => (cm[c.channel_id] = c));
      const lm = {}; (loc.data || []).forEach((l) => (lm[l.location_id] = l.name));
      setFact(f.data || []); setChMap(cm); setLocMap(lm);
      setStores((loc.data || []).filter((l) => l.type === "store"));
      setTargetsRaw(tg.data || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const period = useMemo(() => {
    const [yy, mm] = month.split("-").map(Number);
    const dim = new Date(yy, mm, 0).getDate();
    const now = new Date();
    let elapsed;
    if (yy === now.getFullYear() && mm === now.getMonth() + 1) elapsed = now.getDate();
    else if (new Date(yy, mm - 1, 1) < new Date(now.getFullYear(), now.getMonth(), 1)) elapsed = dim;
    else elapsed = 0;
    return { yy, mm, dim, start: `${month}-01`, end: `${month}-${String(dim).padStart(2, "0")}`, elapsed };
  }, [month]);

  const targetMap = useMemo(() => {
    const m = {};
    targetsRaw.filter((t) => t.month === month).forEach((t) => (m[t.target_key] = Number(t.target_amount) || 0));
    return m;
  }, [targetsRaw, month]);

  const inMonth = useMemo(
    () => fact.filter((r) => r.txn_date >= period.start && r.txn_date <= period.end),
    [fact, period]
  );

  const m = useMemo(() => {
    let sale = 0, qty = 0, onlineActual = 0;
    const byGroup = { Online: 0, Offline: 0 };
    const byLoc = {}, byDay = {}, storeActual = {};
    inMonth.forEach((r) => {
      const net = Number(r.net_amount) || 0;
      const q = (Number(r.qty) || 0) * (net < 0 ? -1 : 1);
      sale += net; qty += q;
      const off = (chMap[r.channel_id] || {}).kind === "offline";
      byGroup[off ? "Offline" : "Online"] += net;
      if (off) storeActual[r.location_id] = (storeActual[r.location_id] || 0) + net;
      else onlineActual += net;
      const ln = locMap[r.location_id] || r.location_id;
      byLoc[ln] = (byLoc[ln] || 0) + net;
      const day = Number(r.txn_date.slice(8, 10));
      byDay[day] = (byDay[day] || 0) + net;
    });
    const daily = [];
    for (let d = 1; d <= period.dim; d++) daily.push({ d, v: byDay[d] || 0 });
    const avgDaily = period.elapsed > 0 ? sale / period.elapsed : 0;
    return { sale, qty, onlineActual, storeActual, byGroup, byLoc, daily, avgDaily, projection: avgDaily * period.dim };
  }, [inMonth, chMap, locMap, period]);

  // baris target yang SUDAH disubmit (target>0) untuk bulan terpilih
  const targetRows = useMemo(() => {
    const rows = [];
    if ((targetMap.ONLINE || 0) > 0)
      rows.push({ key: "ONLINE", label: "Online (marketplace + reseller)", target: targetMap.ONLINE, actual: m.onlineActual });
    stores.forEach((s) => {
      const t = targetMap[s.location_id] || 0;
      if (t > 0) rows.push({ key: s.location_id, label: s.name, target: t, actual: m.storeActual[s.location_id] || 0 });
    });
    return rows;
  }, [targetMap, stores, m]);

  const totalTarget = useMemo(() => targetRows.reduce((a, r) => a + r.target, 0), [targetRows]);
  const achievement = totalTarget > 0 ? (m.sale / totalTarget) * 100 : null;

  // Tren penjualan per bulan (semua data)
  const monthly = useMemo(() => {
    const by = {};
    fact.forEach((r) => {
      const mm = (r.txn_date || "").slice(0, 7);
      if (!mm) return;
      by[mm] = (by[mm] || 0) + (Number(r.net_amount) || 0);
    });
    return Object.entries(by).map(([mm, v]) => ({ mm, v })).sort((a, b) => (a.mm < b.mm ? -1 : 1));
  }, [fact]);

  const monthlyChart = useMemo(
    () => monthly.slice(-12).map((x) => ({ ...x, label: fmtMonthShort(x.mm) })),
    [monthly]
  );

  // Bulan lalu (relatif ke bulan terpilih) untuk perbandingan naik/turun
  const mom = useMemo(() => {
    const [yy, mm] = month.split("-").map(Number);
    const pd = new Date(yy, mm - 2, 1);
    const prevKey = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    const prev = (monthly.find((x) => x.mm === prevKey) || {}).v || 0;
    const cur = m.sale;
    const diff = cur - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : null;
    return { prevKey, prev, cur, diff, pct };
  }, [monthly, month, m.sale]);

  // Daftar tahun yang ada di data (untuk filter card tahunan)
  const years = useMemo(() => {
    const s = new Set(fact.map((r) => (r.txn_date || "").slice(0, 4)).filter(Boolean));
    s.add(String(new Date().getFullYear()));
    return [...s].sort().reverse();
  }, [fact]);

  // Data per bulan untuk tahun terpilih (total + online + offline) — independen dari filter bulan
  const yearData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({ label: MONTHS_ID[i], total: 0, online: 0, offline: 0 }));
    fact.forEach((r) => {
      const d = r.txn_date || "";
      if (d.slice(0, 4) !== String(year)) return;
      const mo = Number(d.slice(5, 7)) - 1;
      if (mo < 0 || mo > 11) return;
      const net = Number(r.net_amount) || 0;
      const off = (chMap[r.channel_id] || {}).kind === "offline";
      months[mo].total += net;
      months[mo][off ? "offline" : "online"] += net;
    });
    return months;
  }, [fact, chMap, year]);

  function draftFor(mm) {
    const map = {};
    targetsRaw.filter((t) => t.month === mm).forEach((t) => (map[t.target_key] = Number(t.target_amount) || 0));
    const d = { ONLINE: map.ONLINE ?? "" };
    stores.forEach((s) => (d[s.location_id] = map[s.location_id] ?? ""));
    return d;
  }
  function openModal() {
    setMMonth(month); setMDraft(draftFor(month)); setSaveMsg(null); setShowT(true);
  }
  function changeModalMonth(v) { setMMonth(v); setMDraft(draftFor(v)); }

  async function submitTargets() {
    setSavingT(true); setSaveMsg(null);
    try {
      const rows = [
        { month: mMonth, target_key: "ONLINE", target_amount: Number(mDraft.ONLINE) || 0 },
        ...stores.map((s) => ({ month: mMonth, target_key: s.location_id, target_amount: Number(mDraft[s.location_id]) || 0 })),
      ];
      const { error } = await supabase.from("sales_targets").upsert(rows, { onConflict: "month,target_key" });
      if (error) throw error;
      const tg = await supabase.from("sales_targets").select("month,target_key,target_amount");
      if (!tg.error) setTargetsRaw(tg.data || []);
      setMonth(mMonth);          // tampilkan bulan yang baru disubmit
      setShowT(false);
    } catch (e) {
      setSaveMsg({ type: "err", text: "Gagal menyimpan: " + (e.message || e) });
    } finally { setSavingT(false); }
  }

  if (loading) return <div className="center-msg">Memuat data…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;

  const grpTotal = (m.byGroup.Online + m.byGroup.Offline) || 1;
  const locMax = Math.max(...Object.values(m.byLoc), 1);

  return (
    <div>
      <h1 className="title">Dashboard</h1>
      <div style={{ display: "flex", gap: 8, margin: "0 0 18px", borderBottom: "1px solid var(--line)" }}>
        <TabBtn active={section === "sales"} onClick={() => setSection("sales")}>Sales Overview</TabBtn>
        <TabBtn active={section === "product"} onClick={() => setSection("product")}>Produk &amp; Margin</TabBtn>
        <TabBtn active={section === "channel"} onClick={() => setSection("channel")}>Channel Overview</TabBtn>
        <TabBtn active={section === "trend"} onClick={() => setSection("trend")}>Tren &amp; Target</TabBtn>
      </div>

      {section === "product" ? (
        <ProductTab />
      ) : section === "channel" ? (
        <ChannelOverview />
      ) : section === "trend" ? (
        <>
          <div className="card">
            <div style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
              <div>
                <label>Bulan</label>
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
              <button className="btn btn-ghost" onClick={load}>Muat ulang</button>
            </div>
          </div>

          <div className="grid3" style={{ marginBottom: 16 }}>
            <KPI l={"Total " + month} v={fmtShort(m.sale)} />
            <KPI l={"Bulan lalu (" + mom.prevKey + ")"} v={fmtShort(mom.prev)} />
            <KPI l="vs bulan lalu"
              v={(mom.diff >= 0 ? "▲ " : "▼ ") + fmtShort(Math.abs(mom.diff))}
              d={mom.pct == null ? "tidak ada data bulan lalu" : (mom.diff >= 0 ? "naik " : "turun ") + Math.abs(Math.round(mom.pct)) + "% dari bulan lalu"}
              color={mom.diff >= 0 ? "var(--good)" : "var(--bad)"} />
          </div>

          <div className="card">
            <div className="section-label">Tren penjualan bulanan (12 bulan terakhir)</div>
            <div style={{ height: 230, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChart} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#A8A192" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => fmtShort(v)} labelFormatter={(l) => l}
                    cursor={{ fill: "rgba(0,0,0,.04)" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E7E0D2" }} />
                  <Bar dataKey="v" radius={[5, 5, 0, 0]}>
                    {monthlyChart.map((x) => (<Cell key={x.mm} fill={x.mm === month ? "#BC4B2B" : "#D9CBB6"} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Bar tersorot = bulan dipilih · nilai = total penjualan net per bulan.</p>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="section-label">Sales target — {month}</div>
              {canAct(role, "target") && <button className="btn btn-ghost btn-sm" onClick={openModal}>+ Set target</button>}
            </div>
            {targetRows.length === 0 ? (
              <p className="small muted" style={{ marginTop: 10 }}>
                Belum ada target untuk bulan ini.{canAct(role, "target") ? <> Klik <b>+ Set target</b> untuk mengisinya.</> : null}
              </p>
            ) : (
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Target</th>
                    <th className="num">Target bulanan</th>
                    <th className="num">Actual</th>
                    <th className="num">Achievement</th>
                    <th style={{ width: "28%" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {targetRows.map((r) => {
                    const pct = r.target > 0 ? (r.actual / r.target) * 100 : null;
                    return (
                      <tr key={r.key}>
                        <td>{r.label}</td>
                        <td className="num">{fmtIDR(r.target)}</td>
                        <td className="num">{fmtIDR(r.actual)}</td>
                        <td className="num" style={{ color: pct == null ? "var(--faint)" : achColor(pct) }}>
                          {pct == null ? "—" : Math.round(pct) + "%"}
                        </td>
                        <td>
                          <div className="track"><div className="fill"
                            style={{ width: Math.min(100, pct || 0) + "%", background: pct == null ? "var(--line)" : achColor(pct) }} /></div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtIDR(totalTarget)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtIDR(m.sale)}</td>
                    <td className="num" style={{ fontWeight: 600, color: achievement == null ? "var(--faint)" : achColor(achievement) }}>
                      {achievement == null ? "—" : Math.round(achievement) + "%"}
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <div style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
              <div>
                <label>Bulan</label>
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
              <button className="btn btn-ghost" onClick={load}>Muat ulang</button>
              <span className="small muted" style={{ marginLeft: "auto" }}>
                {fmtNum(inMonth.length)} transaksi · {period.elapsed} dari {period.dim} hari berjalan
              </span>
            </div>
          </div>

          <div className="grid4" style={{ marginBottom: 16 }}>
            <KPI l="Total sale (bulan ini)" v={fmtShort(m.sale)} />
            <KPI l="Qty terjual" v={fmtNum(m.qty)} />
            <KPI l="Run-rate akhir bulan" v={fmtShort(m.projection)}
              d={`rata-rata ${fmtShort(m.avgDaily)}/hari × ${period.dim} hari`} />
            <KPI l="Achievement vs target"
              v={achievement == null ? "—" : Math.round(achievement) + "%"}
              d={totalTarget > 0 ? `target ${fmtShort(totalTarget)}` : "belum ada target"}
              color={achievement == null ? undefined : achColor(achievement)} />
          </div>

          <div className="card">
            <div className="section-label">Daily sales — {month}</div>
            <div style={{ height: 170, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={m.daily} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#BC4B2B" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#BC4B2B" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#A8A192" }} interval={2}
                    axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => fmtShort(v)} labelFormatter={(l) => "Tgl " + l}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E7E0D2" }} />
                  <Area type="monotone" dataKey="v" stroke="#BC4B2B" strokeWidth={2} fill="url(#dg)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid2">
            <div className="card">
              <div className="section-label">Online vs Offline</div>
              <div style={{ marginTop: 12 }}>
                <GBar nm="Online (marketplace + web)" val={m.byGroup.Online} total={grpTotal} color="#3D6B8A" />
                <GBar nm="Offline (toko fisik)" val={m.byGroup.Offline} total={grpTotal} color="#BC4B2B" />
              </div>
            </div>

            <div className="card">
              <div className="section-label">Sales per lokasi</div>
              <div style={{ marginTop: 12 }}>
                {Object.entries(m.byLoc).length === 0 ? (
                  <p className="small muted">Belum ada penjualan bulan ini.</p>
                ) : (
                  Object.entries(m.byLoc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => (
                    <div className="bar" key={k}>
                      <div className="row"><span className="nm">{k}</span><span className="rt">{fmtShort(v)}</span></div>
                      <div className="track"><div className="fill" style={{ width: (v / locMax) * 100 + "%", background: "#3F7D58" }} /></div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div className="section-label">Revenue bulanan {year} (month-on-month)</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <span className="small muted">Tahun</span>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  {years.map((y) => (<option key={y} value={y}>{y}</option>))}
                </select>
              </label>
            </div>
            <div style={{ height: 230, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearData} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#A8A192" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => fmtShort(v)} cursor={{ fill: "rgba(0,0,0,.04)" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E7E0D2" }} />
                  <Bar dataKey="total" name="Total" fill="#BC4B2B" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Total penjualan net per bulan sepanjang {year}. Tidak terpengaruh filter bulan di atas.</p>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div className="section-label">Kontribusi Online vs Offline per bulan — {year}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <span className="small muted">Tahun</span>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  {years.map((y) => (<option key={y} value={y}>{y}</option>))}
                </select>
              </label>
            </div>
            <div style={{ height: 230, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearData} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#A8A192" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ContribTooltip />} cursor={{ fill: "rgba(0,0,0,.04)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="online" name="Online" stackId="a" fill="#3D6B8A" />
                  <Bar dataKey="offline" name="Offline" stackId="a" fill="#BC4B2B" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Bar bertumpuk: biru = online, terracotta = offline. Sepanjang {year}.</p>
          </div>

        </>
      )}

      {showT && (
        <div onClick={() => setShowT(false)} style={{
          position: "fixed", inset: 0, background: "rgba(33,30,24,.38)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 480, maxHeight: "85vh", overflow: "auto", margin: 0 }}>
            <h2 style={{ fontFamily: "var(--serif)", fontSize: 19, margin: "0 0 4px" }}>Set sales target</h2>
            <p className="small muted" style={{ marginTop: 0 }}>Pilih bulan, lalu isi target. Online digabung; toko per store.</p>

            <label style={{ marginTop: 8 }}>Bulan target</label>
            <input type="month" value={mMonth} onChange={(e) => changeModalMonth(e.target.value)} />

            <div className="section-label" style={{ marginTop: 18 }}>Online</div>
            <div style={{ marginTop: 6 }}>
              <label>Online (semua marketplace + reseller)</label>
              <input type="number" placeholder="0" value={mDraft.ONLINE ?? ""}
                onChange={(e) => setMDraft((d) => ({ ...d, ONLINE: e.target.value }))} />
            </div>

            <div className="section-label" style={{ marginTop: 18 }}>Per store</div>
            <div style={{ marginTop: 6, display: "grid", gap: 10 }}>
              {stores.length === 0 ? (
                <p className="small muted">Tidak ada store terdaftar (cf_locations type=store).</p>
              ) : stores.map((s) => (
                <div key={s.location_id}>
                  <label>{s.name}</label>
                  <input type="number" placeholder="0" value={mDraft[s.location_id] ?? ""}
                    onChange={(e) => setMDraft((d) => ({ ...d, [s.location_id]: e.target.value }))} />
                </div>
              ))}
            </div>

            <div className="foot">
              {saveMsg && <span className={"small " + saveMsg.type}>{saveMsg.text}</span>}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowT(false)}>Batal</button>
                <button className="btn btn-primary btn-sm" disabled={savingT} onClick={submitTargets}>Submit target</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TabBtn = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    background: "none", border: "none", padding: "8px 4px", marginBottom: -1,
    fontFamily: "var(--sans)", fontSize: 14, cursor: "pointer",
    color: active ? "var(--accent)" : "var(--sub)", fontWeight: active ? 600 : 400,
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  }}>{children}</button>
);

const KPI = ({ l, v, d, color }) => (
  <div className="card kpi" style={{ margin: 0 }}>
    <p className="l">{l}</p>
    <p className="v" style={{ color }}>{v}</p>
    {d && <p className="d muted">{d}</p>}
  </div>
);

const GBar = ({ nm, val, total, color }) => {
  const pct = (val / total) * 100;
  return (
    <div className="bar">
      <div className="row">
        <span className="nm">{nm}</span>
        <span className="rt">{fmtShort(val)} · <b style={{ color }}>{Math.round(pct)}%</b></span>
      </div>
      <div className="track"><div className="fill" style={{ width: Math.min(100, pct) + "%", background: color }} /></div>
    </div>
  );
};

function ContribTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const get = (k) => Number(payload.find((p) => p.dataKey === k)?.value || 0);
  const online = get("online"), offline = get("offline");
  const total = online + offline;
  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return (
    <div style={{ fontSize: 12, background: "#fff", border: "1px solid #E7E0D2", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color: "#3D6B8A" }}>Online: {fmtShort(online)} · {pct(online)}%</div>
      <div style={{ color: "#BC4B2B" }}>Offline: {fmtShort(offline)} · {pct(offline)}%</div>
      <div className="muted" style={{ marginTop: 3 }}>Total: {fmtShort(total)}</div>
    </div>
  );
}
