-- ============================================================================
-- SALESFLOW · cek kenapa Dashboard menampilkan revenue Juni
-- Chart "Revenue bulanan" membaca SEMUA cf_sales_fact (tak terpengaruh filter).
-- Jadi kalau ada bar di Juni, berarti ADA baris ber-txn_date Juni di tabel.
-- Jalankan bagian 1 & 2 dulu (SELECT, aman). Bagian 3 (DELETE) baru dipakai
-- KALAU sudah yakin itu data test yang mau dibuang.
-- ============================================================================

-- 1) Ringkas per bulan (2026)
select to_char(txn_date,'YYYY-MM') as bulan,
       count(*) as baris,
       sum(qty) as qty,
       sum(net_amount) as net
from cf_sales_fact
where txn_date >= '2026-01-01' and txn_date < '2027-01-01'
group by 1 order by 1;

-- 2) Detail baris Juni 2026 (lihat SKU / channel / source_txn_id)
select id, txn_date, channel_id, location_id, sku, qty, sale_at_price, net_amount, source_txn_id, staging_id
from cf_sales_fact
where txn_date >= '2026-06-01' and txn_date < '2026-07-01'
order by txn_date, id;

-- ============================================================================
-- 3) (OPSIONAL) Hapus data penjualan Juni 2026 — HANYA kalau memang data test.
--    Buang tanda komentar /* ... */ setelah yakin dari hasil query 2 di atas.
--    Ini juga membersihkan stock movement terkait supaya stok tidak ikut kacau.
-- ============================================================================
/*
with del as (
  select id from cf_sales_fact
  where txn_date >= '2026-06-01' and txn_date < '2026-07-01'
)
delete from cf_stock_movements
 where ref_type in ('sales_fact','sales_return')
   and ref_id in (select id::text from del);

delete from cf_sales_fact
 where txn_date >= '2026-06-01' and txn_date < '2026-07-01';
*/
