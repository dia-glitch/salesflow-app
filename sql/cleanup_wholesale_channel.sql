-- ============================================================================
-- Hapus channel duplikat 'WHOLESALE' (dipakai sementara), gabung ke 'direct_purchase'.
-- WHOLESALE tak bisa dihapus langsung karena cf_sales_fact masih mereferensikannya.
-- Jalankan berurutan di Supabase SQL editor.
-- ============================================================================

-- 1) Pindahkan semua penjualan lama dari channel WHOLESALE -> direct_purchase
update cf_sales_fact set channel_id = 'direct_purchase' where channel_id = 'WHOLESALE';

-- 2) Hapus channel WHOLESALE (sekarang tidak ada baris yang mereferensikan)
delete from cf_sales_channels where channel_id = 'WHOLESALE';

-- (Opsional) verifikasi: pastikan tidak ada lagi WHOLESALE
-- select channel_id, count(*) from cf_sales_fact group by 1 order by 1;
