-- ============================================================================
-- SALESFLOW · Tambah kolom FORMAT nomor (bagian setelah prefix) di master prefix.
-- Token yang didukung: {YY} {YYYY} {MM} {DD} {STORE} {SEQ} {SEQ:3} {DOC}
--   {SEQ:n} = nomor urut dengan n digit (mis. {SEQ:3} -> 001)
--   {STORE} = kode store (khusus AR konsinyasi)
--   {DOC}   = nomor dokumen sumber (khusus invoice = prefix + no order/AR)
-- Jalankan sekali di Supabase SQL editor. Aman diulang.
-- ============================================================================
alter table sf_doc_prefixes add column if not exists number_format text;

update sf_doc_prefixes set number_format = '-{YY}{MM}{DD}-{SEQ:3}' where key = 'wholesale_order' and coalesce(number_format,'') = '';
update sf_doc_prefixes set number_format = '-{STORE}-{SEQ:3}'      where key = 'consign_ar'      and coalesce(number_format,'') = '';
update sf_doc_prefixes set number_format = '{DOC}'                 where key in ('inv_dp','inv_ln','inv_full') and coalesce(number_format,'') = '';
