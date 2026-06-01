import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { fmtShort, fmtNum } from "./format.js";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function AnalisaAI() {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(thisMonth());

  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [answerErr, setAnswerErr] = useState("");
  const [question, setQuestion] = useState("");

  const [me, setMe] = useState(null);
  const [history, setHistory] = useState([]);
  const [viewLabel, setViewLabel] = useState("");

  async function loadHistory() {
    const { data } = await supabase
      .from("ai_analyses")
      .select("id,created_at,created_email,period,kind,question,answer")
      .order("created_at", { ascending: false })
      .limit(50);
    setHistory(data || []);
  }
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data?.user || null));
    loadHistory();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const [fact, ch, loc, items, prods, prices, stock, targets] = await Promise.all([
          supabase.from("cf_sales_fact").select("sku,qty,net_amount,txn_date,channel_id,location_id"),
          supabase.from("cf_sales_channels").select("channel_id,name,kind"),
          supabase.from("cf_locations").select("location_id,name,type"),
          supabase.from("sku_items").select("sku,spk_id").limit(10000),
          supabase.from("sku_products").select("spk_id,product_code,product_name_system,collection_code"),
          supabase.from("cogm_retail_prices").select("spk_id,cogm,cogm_final"),
          supabase.from("v_cf_stock_on_hand").select("sku,location_id,qty"),
          supabase.from("sales_targets").select("month,target_key,target_amount"),
        ]);
        for (const r of [fact, ch, loc, items, prods, prices, stock, targets]) if (r.error) throw r.error;
        setRaw({
          fact: fact.data || [], ch: ch.data || [], loc: loc.data || [], items: items.data || [],
          prods: prods.data || [], prices: prices.data || [], stock: stock.data || [], targets: targets.data || [],
        });
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Bangun ringkasan agregat (angka saja, bukan data mentah) untuk dikirim ke AI
  const summary = useMemo(() => {
    if (!raw) return null;
    const chMap = {}; raw.ch.forEach((c) => (chMap[c.channel_id] = c));
    const locMap = {}; raw.loc.forEach((l) => (locMap[l.location_id] = l));
    const prodBy = {}; raw.prods.forEach((p) => (prodBy[p.spk_id] = p));
    const priceBy = {}; raw.prices.forEach((p) => (priceBy[p.spk_id] = p));
    const sellable = new Set(raw.loc.filter((l) => ["wh_main", "wh_online", "store"].includes(l.type)).map((l) => l.location_id));

    const sku = {};
    raw.items.forEach((it) => {
      const p = prodBy[it.spk_id] || {}; const pr = priceBy[it.spk_id] || {};
      sku[it.sku] = { coll: p.collection_code || "—", code: p.product_code || it.sku,
        name: p.product_name_system || it.sku, cogm: Number(pr.cogm_final ?? pr.cogm ?? 0) || 0 };
    });

    // Stok terkini per sku (lokasi jual)
    const stockBy = {};
    raw.stock.forEach((s) => { if (sellable.has(s.location_id)) stockBy[s.sku] = (stockBy[s.sku] || 0) + (Number(s.qty) || 0); });

    // Agregasi all-time per sku
    const soldBy = {}, revBy = {}, cogmBy = {};
    raw.fact.forEach((r) => {
      const net = Number(r.net_amount) || 0;
      const q = (Number(r.qty) || 0) * (net < 0 ? -1 : 1);
      soldBy[r.sku] = (soldBy[r.sku] || 0) + q;
      revBy[r.sku] = (revBy[r.sku] || 0) + net;
      cogmBy[r.sku] = (cogmBy[r.sku] || 0) + (sku[r.sku]?.cogm || 0) * q;
    });

    // Bulan terpilih
    let mSale = 0, mQty = 0, mTxn = new Set(), mOnline = 0, mOffline = 0;
    const storeSales = {};
    raw.fact.forEach((r) => {
      if ((r.txn_date || "").slice(0, 7) !== month) return;
      const net = Number(r.net_amount) || 0;
      mSale += net; mQty += Number(r.qty) || 0; mTxn.add(r.channel_id + "|" + r.txn_date + "|" + r.sku);
      const off = (chMap[r.channel_id] || {}).kind === "offline";
      if (off) { mOffline += net; storeSales[r.location_id] = (storeSales[r.location_id] || 0) + net; }
      else mOnline += net;
    });

    // Target bulan terpilih
    const tgt = raw.targets.filter((t) => t.month === month);
    const onlineTarget = tgt.filter((t) => t.target_key === "ONLINE").reduce((a, t) => a + Number(t.target_amount || 0), 0);
    const storeTargets = {};
    tgt.forEach((t) => { if (t.target_key !== "ONLINE") storeTargets[t.target_key] = Number(t.target_amount || 0); });
    const totalTarget = tgt.reduce((a, t) => a + Number(t.target_amount || 0), 0);

    const stores = [...new Set([...Object.keys(storeSales), ...Object.keys(storeTargets)])].map((id) => ({
      store: locMap[id]?.name || id,
      sales: Math.round(storeSales[id] || 0),
      target: Math.round(storeTargets[id] || 0),
      achievement_pct: storeTargets[id] ? Math.round(((storeSales[id] || 0) / storeTargets[id]) * 100) : null,
    })).sort((a, b) => b.sales - a.sales);

    // Tren bulanan (12 terakhir)
    const byMonth = {};
    raw.fact.forEach((r) => { const mm = (r.txn_date || "").slice(0, 7); if (mm) byMonth[mm] = (byMonth[mm] || 0) + (Number(r.net_amount) || 0); });
    const trend = Object.entries(byMonth).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-12)
      .map(([m, v]) => ({ month: m, total: Math.round(v) }));

    // Per koleksi (all-time)
    const collAgg = {};
    Object.keys(sku).forEach((k) => {
      const c = sku[k].coll;
      collAgg[c] = collAgg[c] || { sold: 0, stock: 0, rev: 0, cogm: 0 };
      collAgg[c].sold += soldBy[k] || 0; collAgg[c].stock += stockBy[k] || 0;
      collAgg[c].rev += revBy[k] || 0; collAgg[c].cogm += cogmBy[k] || 0;
    });
    const collections = Object.entries(collAgg).map(([code, a]) => ({
      collection: code, sold: a.sold, stock: a.stock,
      sell_through_pct: (a.sold + a.stock) > 0 ? Math.round((a.sold / (a.sold + a.stock)) * 100) : 0,
      margin_pct: a.rev > 0 ? Math.round(((a.rev - a.cogm) / a.rev) * 100) : null,
    })).sort((a, b) => b.sold - a.sold).slice(0, 12);

    // Movers per product_code (all-time)
    const codeAgg = {};
    Object.keys(sku).forEach((k) => {
      const c = sku[k].code;
      codeAgg[c] = codeAgg[c] || { name: sku[k].name, sold: 0, stock: 0 };
      codeAgg[c].sold += soldBy[k] || 0; codeAgg[c].stock += stockBy[k] || 0;
    });
    const movers = Object.entries(codeAgg).map(([code, a]) => ({
      product: a.name, sold: a.sold,
      sell_through_pct: (a.sold + a.stock) > 0 ? Math.round((a.sold / (a.sold + a.stock)) * 100) : 0,
      stock: a.stock,
    }));
    const best = [...movers].filter((m) => m.sold > 0).sort((a, b) => b.sell_through_pct - a.sell_through_pct).slice(0, 5);
    const slow = [...movers].sort((a, b) => a.sell_through_pct - b.sell_through_pct).slice(0, 5);

    const allRev = Object.values(revBy).reduce((a, v) => a + v, 0);
    const allCogm = Object.values(cogmBy).reduce((a, v) => a + v, 0);

    return {
      period: month,
      bulan_ini: {
        total_penjualan: Math.round(mSale), qty: mQty, baris_transaksi: mTxn.size,
        total_target: Math.round(totalTarget),
        achievement_pct: totalTarget > 0 ? Math.round((mSale / totalTarget) * 100) : null,
        online: { nilai: Math.round(mOnline), pct: mSale > 0 ? Math.round((mOnline / mSale) * 100) : 0, target: Math.round(onlineTarget) },
        offline: { nilai: Math.round(mOffline), pct: mSale > 0 ? Math.round((mOffline / mSale) * 100) : 0 },
        per_store: stores,
      },
      tren_bulanan: trend,
      margin_keseluruhan_pct: allRev > 0 ? Math.round(((allRev - allCogm) / allRev) * 100) : null,
      per_koleksi: collections,
      best_movers: best,
      slow_movers: slow,
    };
  }, [raw, month]);

  async function callAnalyze(q) {
    setBusy(true); setAnswerErr("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch("/.netlify/functions/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q || "", data: summary }),
      });
      const j = await res.json();
      if (!res.ok) { setAnswerErr(j.error || "Gagal memanggil AI."); }
      else {
        setAnswer(j.text || "(kosong)");
        setViewLabel("");
        // simpan ke riwayat
        try {
          await supabase.from("ai_analyses").insert({
            created_by: me?.id || null,
            created_email: me?.email || null,
            period: month,
            kind: q ? "question" : "report",
            question: q || null,
            answer: j.text || "",
            data_snapshot: summary,
          });
          loadHistory();
        } catch (_) { /* gagal simpan tidak menghentikan tampilan hasil */ }
      }
    } catch (e) {
      setAnswerErr(e.message || "Kesalahan jaringan.");
    } finally {
      setBusy(false);
    }
  }

  function openSaved(h) {
    setAnswer(h.answer || "");
    setAnswerErr("");
    setBusy(false);
    const when = new Date(h.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    setViewLabel(`Riwayat · ${h.kind === "question" ? "Tanya" : "Analisa"} ${h.period || ""} · ${when}`);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
  async function deleteSaved(id) {
    if (!confirm("Hapus item riwayat ini?")) return;
    const { error } = await supabase.from("ai_analyses").delete().eq("id", id);
    if (error) { alert("Gagal hapus: " + error.message); return; }
    setHistory((h) => h.filter((x) => x.id !== id));
  }

  if (loading) return <div className="center-msg">Memuat data…</div>;
  if (error) return <div className="card err-card">Gagal memuat: {error}</div>;

  return (
    <div>
      <h1 className="title">Analisa AI</h1>
      <p className="lead">Ringkasan, rekomendasi aksi, deteksi anomali & tanya-jawab berbasis data SalesFlow. Ditenagai Claude.</p>

      <div className="card">
        <div style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label>Bulan analisis</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={() => { setQuestion(""); callAnalyze(""); }}>
            {busy ? "Menganalisa…" : "Buat analisa " + month}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Yang dikirim ke AI hanya angka agregat (penjualan/target per channel & store, tren, sell-through, margin, best/slow movers) — bukan data customer atau transaksi mentah.
        </p>
      </div>

      <div className="card">
        <div className="section-label">Tanya bebas tentang data</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input style={{ flex: 1, minWidth: 240 }} placeholder="mis. Koleksi mana yang perlu di-markdown bulan ini?"
            value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && question.trim() && !busy) callAnalyze(question.trim()); }} />
          <button className="btn btn-ghost" disabled={busy || !question.trim()} onClick={() => callAnalyze(question.trim())}>
            Tanya
          </button>
        </div>
      </div>

      {(busy || answer || answerErr) && (
        <div className="card">
          <div className="section-label">Hasil analisa</div>
          {viewLabel && <div className="small muted" style={{ marginTop: 4 }}>{viewLabel}</div>}
          {busy ? (
            <p className="muted" style={{ marginTop: 10 }}>Sedang berpikir…</p>
          ) : answerErr ? (
            <div className="err-card" style={{ marginTop: 10 }}>{answerErr}</div>
          ) : (
            <div style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{answer}</div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="section-label">Riwayat analisa</span>
          <span className="small muted">{fmtNum(history.length)} tersimpan</span>
        </div>
        {history.length === 0 ? (
          <p className="small muted" style={{ marginTop: 10 }}>Belum ada riwayat. Hasil analisa akan otomatis tersimpan di sini.</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {history.map((h) => {
              const when = new Date(h.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
              const title = h.kind === "question" ? (h.question || "Pertanyaan") : `Analisa bulanan ${h.period || ""}`;
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                  <span className="pill" style={{ background: "var(--paper)", color: "var(--sub)", flexShrink: 0 }}>
                    {h.kind === "question" ? "Tanya" : "Analisa"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
                    <div className="small muted">{when}{h.created_email ? " · " + h.created_email : ""}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => openSaved(h)}>Buka</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteSaved(h.id)} title="Hapus" style={{ color: "var(--bad)" }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
