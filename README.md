# SalesFlow · Aleza

Aplikasi input penjualan + dashboard, terhubung ke project Supabase **Production** (tabel `cf_*`).

## Cara menjalankan

1. Edit **`.env.local`**, isi URL & anon key Supabase Anda:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...
   ```
2. Pasang dependency & jalankan:
   ```bash
   npm install
   npm run dev
   ```
3. Buka alamat yang muncul (mis. `http://localhost:5173`).

> Setiap kali mengubah `.env.local`, hentikan dev server (Ctrl+C) lalu `npm run dev` lagi.

## Struktur

- `src/supabaseClient.js` — koneksi Supabase.
- `src/InputManual.jsx` — input penjualan manual multi-baris → `cf_sales_staging`, lalu proses via RPC `process_sales_staging`.
- `src/Dashboard.jsx` — metrik dari `cf_sales_fact`.
- `src/Sidebar.jsx`, `src/App.jsx` — kerangka aplikasi.

Logika data (staging → fact → stock movement) berada di RPC `process_sales_staging()` di database.
