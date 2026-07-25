export const fmtIDR = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

export const fmtShort = (n) => {
  n = n || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return "Rp " + (n / 1e9).toFixed(1).replace(".", ",") + " M";
  if (a >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(".", ",") + " jt";
  if (a >= 1e3) return "Rp " + Math.round(n / 1e3) + " rb";
  return "Rp " + Math.round(n);
};

export const fmtNum = (n) => (n || 0).toLocaleString("id-ID");

// Nama produk di master sering tersimpan sebagai "<nama> <size> <warna>",
// mis. "Dixy Shirt Sage Green M Sage Green". cleanName memangkas ekor ukuran +
// warna yang berulang sehingga jadi "Dixy Shirt Sage Green".
// Aman dipanggil walau size/warna kosong.
export const cleanName = (raw, size, colour) => {
  let n = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!n) return n;
  const s = String(size ?? "").trim();
  const c = String(colour ?? "").trim();
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 1) warna yang berulang di ekor: "... Sage Green Sage Green" -> "... Sage Green"
  if (c) n = n.replace(new RegExp("(\\b" + esc(c) + ")\\s+" + esc(c) + "$", "i"), "$1");
  // 2) ekor "<size> <warna>" -> buang (mis. " M Sage Green")
  if (s && c) n = n.replace(new RegExp("\\s+" + esc(s) + "\\s+" + esc(c) + "$", "i"), "");
  // 3) sisa ekor ukuran -> buang (mis. " M")
  if (s) n = n.replace(new RegExp("\\s+" + esc(s) + "$", "i"), "");
  return n.trim();
};

export const dShort = (iso) => {
  const m = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.getDate() + " " + m[d.getMonth()];
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
