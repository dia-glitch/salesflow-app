-- ============================================================================
-- SALESFLOW · Modul Pesanan Langsung / Wholesale (bisa pre-order)
-- Jalankan sekali di Supabase (SQL editor). Semua tabel prefix sf_.
-- Keputusan: diskon MANUAL per baris · revenue & potong stok SAAT KIRIM
-- (fulfillment) · customer master baru · partial fulfillment & pembayaran.
-- ============================================================================

-- ---- Master customer wholesale -------------------------------------------
create table if not exists sf_customers (
  id            uuid primary key default gen_random_uuid(),
  code          text,
  name          text not null,
  contact       text,
  address       text,
  payment_term  text,                 -- catatan term (mis. 'DP 50%', 'NET 30')
  is_active     boolean not null default true,
  created_at    timestamptz default now()
);

-- ---- Header order ---------------------------------------------------------
create table if not exists sf_do_orders (
  id                  uuid primary key default gen_random_uuid(),
  order_no            text unique not null,          -- DO-YYYYMMDD-xxx
  customer_id         uuid references sf_customers(id),
  order_date          date not null default current_date,
  fulfill_location_id text not null,                 -- default WH-Main (cf_locations)
  status              text not null default 'draft', -- draft|confirmed|partial|fulfilled|cancelled
  subtotal            numeric(16,2) not null default 0,  -- sum retail*qty
  discount            numeric(16,2) not null default 0,  -- total potongan (subtotal - total)
  total               numeric(16,2) not null default 0,  -- nilai jual wholesale
  note                text,
  created_at          timestamptz default now(),
  created_by          uuid references user_profiles(id)
);

-- ---- Baris order ----------------------------------------------------------
create table if not exists sf_do_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references sf_do_orders(id) on delete cascade,
  sku           text not null,
  product_name  text,
  qty_order     numeric(12,2) not null,
  qty_fulfilled numeric(12,2) not null default 0,     -- terisi saat kirim
  retail_price  numeric(14,2) not null default 0,
  unit_price    numeric(14,2) not null default 0,      -- harga wholesale final / unit (manual)
  line_total    numeric(16,2) not null default 0       -- unit_price * qty_order
);
create index if not exists idx_do_lines_order on sf_do_order_lines(order_id);

-- ---- Invoice (Full / DP) --------------------------------------------------
create table if not exists sf_do_invoices (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references sf_do_orders(id) on delete cascade,
  invoice_no   text unique not null,
  type         text not null default 'full',   -- full | dp
  total        numeric(16,2) not null default 0,
  dp_amount    numeric(16,2) not null default 0,
  paid_amount  numeric(16,2) not null default 0,
  balance      numeric(16,2) not null default 0,
  status       text not null default 'issued',  -- issued|dp_paid|paid|submitted|cancelled
  due_date     date,
  submitted_at timestamptz,
  created_at   timestamptz default now()
);
create index if not exists idx_do_inv_order on sf_do_invoices(order_id);

-- ---- Histori pembayaran ---------------------------------------------------
create table if not exists sf_do_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid references sf_do_invoices(id) on delete cascade,
  amount      numeric(16,2) not null,
  paid_at     date not null default current_date,
  method      text,                     -- transfer|cash|dll
  kind        text not null default 'settlement', -- dp | settlement
  note        text,
  created_at  timestamptz default now()
);
create index if not exists idx_do_pay_inv on sf_do_payments(invoice_id);

-- ---- Channel direct_purchase (fallback — biasanya sudah dibuat di master) --
-- Salin default_net_basis dari channel yang sudah ada supaya tipe/enumnya valid.
insert into cf_sales_channels (channel_id, name, kind, fulfill_location_id, default_net_basis)
select 'direct_purchase', 'Direct Purchase', 'offline',
       (select location_id from cf_locations where type = 'wh_main' order by location_id limit 1),
       (select default_net_basis from cf_sales_channels order by channel_id limit 1)
on conflict (channel_id) do nothing;

-- ---- RLS ------------------------------------------------------------------
alter table sf_customers        enable row level security;
alter table sf_do_orders        enable row level security;
alter table sf_do_order_lines   enable row level security;
alter table sf_do_invoices      enable row level security;
alter table sf_do_payments      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sf_customers','sf_do_orders','sf_do_order_lines','sf_do_invoices','sf_do_payments']
  loop
    execute format('drop policy if exists %I_all on %I', t, t);
    execute format('create policy %I_all on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- ---- Akses menu (role_access, app='salesflow') ----------------------------
insert into role_access (app, role, resource, can_view, can_act) values
  ('salesflow','admin',    'wholesale_order', true, true),
  ('salesflow','finance',  'wholesale_order', true, true),
  ('salesflow','md_sales', 'wholesale_order', true, true),
  ('salesflow','manager',  'wholesale_order', true, false),
  ('salesflow','director', 'wholesale_order', true, false),
  ('salesflow','bi_sales', 'wholesale_order', true, false),
  ('salesflow','admin',    'wholesale_customer', true, true),
  ('salesflow','finance',  'wholesale_customer', true, true),
  ('salesflow','md_sales', 'wholesale_customer', true, true)
on conflict (app, role, resource) do update
  set can_view = excluded.can_view, can_act = excluded.can_act;

-- ============================================================================
-- RPC fulfillment: potong stok WH-Main -> tulis cf_sales_fact + cf_stock_movements
-- p_lines: jsonb array [{ "line_id": "...", "qty": 3 }, ...]
-- Boleh partial. Revenue diakui di sini (bukan saat invoice).
-- ============================================================================
create or replace function public.sf_do_fulfill(p_order_id uuid, p_lines jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  o        record;
  ln       record;
  item     jsonb;
  v_line   uuid;
  v_qty    numeric;
  v_onhand numeric;
  v_cogm   numeric;
  v_basis  cf_net_basis;   -- net_basis di cf_sales_fact bertipe enum cf_net_basis
  v_fact   bigint;
  v_ship   int := 0;
begin
  select * into o from sf_do_orders where id = p_order_id;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  if o.status = 'cancelled' then raise exception 'Order sudah dibatalkan'; end if;

  select default_net_basis into v_basis from cf_sales_channels where channel_id = 'direct_purchase';

  for item in select * from jsonb_array_elements(p_lines)
  loop
    v_line := (item->>'line_id')::uuid;
    v_qty  := coalesce((item->>'qty')::numeric, 0);
    if v_qty <= 0 then continue; end if;

    select * into ln from sf_do_order_lines where id = v_line and order_id = p_order_id;
    if not found then raise exception 'Baris order tidak valid'; end if;
    if v_qty > (ln.qty_order - ln.qty_fulfilled) then
      raise exception 'Qty kirim (%) > sisa order utk SKU %', v_qty, ln.sku;
    end if;

    select coalesce(qty, 0) into v_onhand
      from v_cf_stock_on_hand where sku = ln.sku and location_id = o.fulfill_location_id;
    if coalesce(v_onhand, 0) < v_qty then
      raise exception 'Stok % di % kurang (ada %, butuh %)', ln.sku, o.fulfill_location_id, coalesce(v_onhand,0), v_qty;
    end if;

    select coalesce(crp.cogm_final, crp.cogm) into v_cogm
      from sku_items si left join cogm_retail_prices crp on crp.spk_id = si.spk_id
      where si.sku = ln.sku limit 1;

    insert into cf_sales_fact
      (txn_date, channel_id, location_id, sku, qty, retail_price, sale_at_price,
       discount, net_amount, net_basis, commission, source_txn_id)
    values
      (current_date, 'direct_purchase', o.fulfill_location_id, ln.sku, v_qty,
       ln.retail_price, ln.unit_price,
       greatest(ln.retail_price - ln.unit_price, 0) * v_qty,
       ln.unit_price * v_qty, v_basis, 0,
       o.order_no || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6))
    returning id into v_fact;

    insert into cf_stock_movements
      (type, sku, location_id, qty, unit_cogm, ref_type, ref_id, note)
    values
      ('sale_online', ln.sku, o.fulfill_location_id, -v_qty, v_cogm,
       'wholesale', v_fact::text, o.order_no);

    update sf_do_order_lines set qty_fulfilled = qty_fulfilled + v_qty where id = v_line;
    v_ship := v_ship + 1;
  end loop;

  update sf_do_orders set status = case
    when (select bool_and(qty_fulfilled >= qty_order) from sf_do_order_lines where order_id = p_order_id) then 'fulfilled'
    when (select bool_or(qty_fulfilled > 0)            from sf_do_order_lines where order_id = p_order_id) then 'partial'
    else status end
  where id = p_order_id;

  return jsonb_build_object('shipped_lines', v_ship);
end
$function$;
