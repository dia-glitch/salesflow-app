-- ============================================================================
-- SALESFLOW · Penagihan AR (invoice mingguan konsinyasi berbasis margin)
-- Jalankan sekali di Supabase (SQL editor). Semua tabel prefix sf_.
-- ============================================================================

-- ---- Aturan margin (bisa diedit dari app / SQL) ---------------------------
-- Non-discount: margin store berdasarkan tier harga jual (sale-at-price).
-- Lookup: ambil tier dengan min_price TERBESAR yang <= sale price.
create table if not exists sf_margin_price_tiers (
  id          serial primary key,
  min_price   numeric(14,2) not null,   -- batas bawah (inklusif) tier
  label       text,                     -- teks tampil
  margin_pct  numeric(5,2) not null
);

-- Discount: margin store berdasarkan level diskon (dibulatkan ke tier terdekat).
create table if not exists sf_margin_disc_tiers (
  disc_pct    int primary key,          -- 10,20,30,40,50
  margin_pct  numeric(5,2) not null
);

-- seed (idempotent)
insert into sf_margin_price_tiers (min_price, label, margin_pct) values
  (0,          '< Rp 150.000',        20),
  (150000,     '150.000 – 300.000',   25),
  (300000.01,  '>300.000 – 500.000',  28),
  (500000.01,  '>500.000 – 900.000',  30),
  (900000.01,  '>900.000',            32)
on conflict do nothing;

insert into sf_margin_disc_tiers (disc_pct, margin_pct) values
  (10,25),(20,25),(30,18),(40,10),(50,10)
on conflict (disc_pct) do nothing;

-- ---- Invoice AR ------------------------------------------------------------
create table if not exists sf_ar_invoices (
  id                uuid primary key default gen_random_uuid(),
  location_id       text not null,                 -- store (cf_locations.location_id)
  period_start      date not null,                 -- Senin
  period_end        date not null,                 -- Minggu
  status            text not null default 'draft', -- 'draft' | 'submitted'
  total_sale        numeric(16,2) not null default 0,
  total_margin      numeric(16,2) not null default 0,  -- margin store
  total_ar          numeric(16,2) not null default 0,  -- payment to Aleza
  n_lines           int not null default 0,
  created_at        timestamptz default now(),
  submitted_at      timestamptz,
  submitted_by      uuid references user_profiles(id)
);
-- satu invoice per store per minggu
create unique index if not exists uq_ar_store_period on sf_ar_invoices(location_id, period_start);

create table if not exists sf_ar_invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid references sf_ar_invoices(id) on delete cascade,
  sku           text,
  product_name  text,
  qty           numeric(12,2) not null,
  retail_price  numeric(14,2) not null default 0,
  sale_price    numeric(14,2) not null default 0,   -- sale-at-price (per unit)
  sale_amount   numeric(16,2) not null default 0,   -- nilai penjualan baris (net_amount)
  disc_pct      numeric(5,2),                        -- null = harga normal
  margin_kind   text,                                -- 'tier' | 'disc'
  margin_pct    numeric(5,2) not null default 0,
  margin_store  numeric(16,2) not null default 0,
  ar_amount     numeric(16,2) not null default 0,
  is_return     boolean not null default false
);
create index if not exists idx_ar_lines_inv on sf_ar_invoice_lines(invoice_id);

-- ---- RLS -------------------------------------------------------------------
alter table sf_margin_price_tiers enable row level security;
alter table sf_margin_disc_tiers  enable row level security;
alter table sf_ar_invoices        enable row level security;
alter table sf_ar_invoice_lines   enable row level security;

drop policy if exists sf_mpt_all on sf_margin_price_tiers;
drop policy if exists sf_mdt_all on sf_margin_disc_tiers;
create policy sf_mpt_all on sf_margin_price_tiers for all to authenticated using (true) with check (true);
create policy sf_mdt_all on sf_margin_disc_tiers  for all to authenticated using (true) with check (true);

drop policy if exists sf_inv_sel on sf_ar_invoices;
drop policy if exists sf_inv_ins on sf_ar_invoices;
drop policy if exists sf_inv_upd on sf_ar_invoices;
create policy sf_inv_sel on sf_ar_invoices for select to authenticated using (true);
create policy sf_inv_ins on sf_ar_invoices for insert to authenticated with check (true);
create policy sf_inv_upd on sf_ar_invoices for update to authenticated using (true) with check (true);

drop policy if exists sf_line_sel on sf_ar_invoice_lines;
drop policy if exists sf_line_ins on sf_ar_invoice_lines;
drop policy if exists sf_line_del on sf_ar_invoice_lines;
create policy sf_line_sel on sf_ar_invoice_lines for select to authenticated using (true);
create policy sf_line_ins on sf_ar_invoice_lines for insert to authenticated with check (true);
create policy sf_line_del on sf_ar_invoice_lines for delete to authenticated using (true);

-- ---- Akses menu (role_access, app='salesflow', resource='penagihan_ar') ----
-- Lihat: admin, finance, manager, director, bi_sales · Aksi (submit): admin, finance.
insert into role_access (app, role, resource, can_view, can_act) values
  ('salesflow','admin',    'penagihan_ar', true, true),
  ('salesflow','finance',  'penagihan_ar', true, true),
  ('salesflow','manager',  'penagihan_ar', true, false),
  ('salesflow','director', 'penagihan_ar', true, false),
  ('salesflow','bi_sales', 'penagihan_ar', true, false)
on conflict (app, role, resource) do update
  set can_view = excluded.can_view, can_act = excluded.can_act;
