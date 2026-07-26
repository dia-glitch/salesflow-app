-- ============================================================================
-- SALESFLOW · Master data PREFIX dokumen (tidak hardcode; persisten di DB).
-- Dipakai lintas app (SalesFlow + FINFLOW) untuk penomoran:
--   wholesale_order : DO-YYMMDD-001
--   consign_ar      : AR-<kodestore>-001
--   inv_dp          : INV/DP/<order_no>
--   inv_ln          : INV/LN/<order_no>
--   inv_full        : INV/<no_dokumen>  (invoice full wholesale & invoice AR di FINFLOW)
-- Jalankan sekali di Supabase SQL editor. Aman diulang.
-- ============================================================================
create table if not exists sf_doc_prefixes (
  key        text primary key,
  prefix     text not null,
  label      text,
  pattern    text,                 -- contoh format (informasional)
  updated_at timestamptz default now()
);

insert into sf_doc_prefixes (key, prefix, label, pattern) values
  ('wholesale_order', 'DO',      'No. Order Direct Purchase',            'DO-YYMMDD-001'),
  ('consign_ar',      'AR',      'No. AR Konsinyasi',                    'AR-<kodestore>-001'),
  ('inv_dp',          'INV/DP/', 'Invoice DP (wholesale)',               'INV/DP/DO-YYMMDD-001'),
  ('inv_ln',          'INV/LN/', 'Invoice Pelunasan (wholesale)',        'INV/LN/DO-YYMMDD-001'),
  ('inv_full',        'INV/',    'Invoice Full / Invoice AR (finance)',  'INV/<no_dokumen>')
on conflict (key) do nothing;

alter table sf_doc_prefixes enable row level security;
drop policy if exists sf_doc_prefixes_sel on sf_doc_prefixes;
drop policy if exists sf_doc_prefixes_upd on sf_doc_prefixes;
create policy sf_doc_prefixes_sel on sf_doc_prefixes for select to authenticated using (true);
create policy sf_doc_prefixes_upd on sf_doc_prefixes for all    to authenticated using (true) with check (true);

-- akses edit (SalesFlow admin) & baca (semua) — juga dibaca FINFLOW (app='finance')
insert into role_access (app, role, resource, can_view, can_act) values
  ('salesflow','admin',  'doc_prefix', true, true),
  ('salesflow','finance','doc_prefix', true, false)
on conflict (app, role, resource) do update
  set can_view = excluded.can_view, can_act = excluded.can_act;
