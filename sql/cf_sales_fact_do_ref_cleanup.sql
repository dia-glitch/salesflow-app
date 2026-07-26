-- ============================================================================
-- SALESFLOW · Rapikan No. Order (source_txn_id) penjualan Direct Purchase LAMA.
-- Lama : DO-DO-20260725-1771-<32 hex>   (dobel "DO-" + uuid panjang)
-- Baru : DO-20260725-1771-<6 hex>       (single "DO-" + suffix pendek)
-- Jalankan sekali di Supabase SQL editor. Hanya menyentuh baris direct_purchase
-- yang berawalan "DO-DO-".
-- ============================================================================

-- (opsional) cek dulu:
--   select source_txn_id as lama,
--          regexp_replace(regexp_replace(source_txn_id,'^DO-DO-','DO-'),
--                         '([0-9a-fA-F]{6})[0-9a-fA-F]{26}$','\1') as baru
--   from cf_sales_fact
--   where channel_id = 'direct_purchase' and source_txn_id ~ '^DO-DO-';

update cf_sales_fact
set source_txn_id = regexp_replace(
      regexp_replace(source_txn_id, '^DO-DO-', 'DO-'),
      '([0-9a-fA-F]{6})[0-9a-fA-F]{26}$', '\1'
    )
where channel_id = 'direct_purchase'
  and source_txn_id ~ '^DO-DO-';
