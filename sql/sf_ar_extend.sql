-- ============================================================================
-- SALESFLOW · Penagihan AR — tambah nomor AR (ar_no) untuk dokumen cetak.
-- Jalankan sekali di Supabase (SQL editor). Aman diulang (idempotent).
-- Invoice lama (ar_no null) tetap valid; nomor terisi saat disimpan/submit ulang.
-- ============================================================================
alter table sf_ar_invoices add column if not exists ar_no text;

-- ar_no unik (NULL boleh berulang di Postgres, jadi invoice lama tak terganggu)
create unique index if not exists uq_ar_no on sf_ar_invoices(ar_no);
