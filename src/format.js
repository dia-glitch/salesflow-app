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

export const dShort = (iso) => {
  const m = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.getDate() + " " + m[d.getMonth()];
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
