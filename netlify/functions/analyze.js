// Netlify Function: /.netlify/functions/analyze
// Menerima metrik ringkas + pertanyaan dari frontend, memanggil Claude API,
// mengembalikan teks analisis. API key TIDAK pernah sampai ke browser.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPA_URL = process.env.VITE_SUPABASE_URL;
  const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY belum diset di Netlify." }) };
  }

  // 1) Pengaman: wajib user yang sedang login (verifikasi token ke Supabase)
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: "Tidak terautentikasi." }) };
  }
  try {
    const who = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SUPA_KEY, authorization: `Bearer ${token}` },
    });
    if (!who.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: "Sesi tidak valid. Silakan login ulang." }) };
    }
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: "Gagal memverifikasi sesi." }) };
  }

  // 2) Ambil payload dari frontend
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  const question = String(body.question || "").slice(0, 2000);
  const data = body.data || {};

  const system = [
    "Anda adalah analis merchandising & penjualan untuk brand fashion Indonesia 'Aleza' (PT Asa Modakreasi Indonesia).",
    "Anda diberi DATA RINGKAS (agregat) dari aplikasi SalesFlow: penjualan per channel/store, target vs aktual, sell-through per koleksi, best/slow movers, margin, tren bulanan, dan produk yang mungkin bermasalah.",
    "Tugas Anda: memberi analisis yang TAJAM, KONKRET, dan BISA DITINDAKLANJUTI untuk tim merchandising/penjualan.",
    "Pedoman:",
    "- Selalu rujuk angka spesifik dari data saat memberi klaim (mis. 'Store Aceh 93% dari target').",
    "- Prioritaskan rekomendasi aksi: markdown/clearance, restock, alokasi stok, fokus channel/store, timing koleksi.",
    "- Tandai anomali: margin negatif, sell-through sangat rendah pada produk lama, channel jauh di bawah target, lonjakan/penurunan tak wajar.",
    "- Jujur soal keterbatasan data; kalau data kurang untuk suatu kesimpulan, katakan dan sebutkan data apa yang diperlukan.",
    "- Jawab dalam Bahasa Indonesia, ringkas dan berpoin. Hindari basa-basi.",
    "- Ini saran analitis, bukan keputusan final; keputusan tetap di tangan tim.",
  ].join("\n");

  const userMsg = question
    ? `DATA RINGKAS (JSON):\n${JSON.stringify(data)}\n\nPERTANYAAN: ${question}`
    : `DATA RINGKAS (JSON):\n${JSON.stringify(data)}\n\nBuat output dengan 3 bagian:\n1) Ringkasan performa periode ini (3-5 poin).\n2) Rekomendasi aksi konkret (markdown/clearance, restock, fokus channel/store) — urut prioritas.\n3) Anomali / produk bermasalah yang perlu dicek.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Model cepat (Haiku) agar selesai dalam batas waktu function Netlify (~10 dtk).
        // Bisa diganti ke Sonnet/Opus bila timeout function dinaikkan. Lihat docs.claude.com/en/docs/about-claude/models
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const j = await resp.json();
    if (!resp.ok) {
      const msg = (j && j.error && j.error.message) || "Gagal memanggil Claude API.";
      return { statusCode: 502, body: JSON.stringify({ error: msg }) };
    }
    const text = (j.content || [])
      .map((c) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Kesalahan tak terduga." }) };
  }
};
