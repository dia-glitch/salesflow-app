-- ============================================================================
-- SALESFLOW · tambah order_ref (no order marketplace) ke pipeline penjualan.
-- Prasyarat: alter table cf_sales_fact add column if not exists order_ref text;
-- Fungsi process_sales_staging diupdate untuk menyalin raw->>'order_ref' ke fact.
-- (identik dengan versi lama + 3 baris bertanda >>> ORDER_REF)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_sales_staging(p_file_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s            record;
  r            jsonb;
  ch           record;
  v_sku        text;
  v_channel    text;
  v_location   text;
  v_qty        integer;
  v_ttype      text;
  v_src        text;
  v_txn_date   date;
  v_retail     numeric;
  v_saleprice  numeric;
  v_discount   numeric;
  v_commission numeric;
  v_net        numeric;
  v_fact_net   numeric;
  v_cogm       numeric;
  v_fact_id    bigint;
  v_mtype      cf_movement_type;
  v_move_qty   integer;
  v_order_ref  text;                                    -- >>> ORDER_REF
  v_ok  int := 0;
  v_bad int := 0;
  v_dup int := 0;
begin
  if auth.uid() is not null and coalesce(app_role(), '') not in ('bi','md_sales','admin') then
    raise exception 'Tidak punya izin memproses penjualan (role: %)', coalesce(app_role(), '-');
  end if;
  for s in
    select * from cf_sales_staging
    where processed = false
      and (p_file_label is null or file_label = p_file_label)
    order by id
  loop
    r         := s.raw;
    v_src     := r->>'source_txn_id';
    v_sku     := r->>'sku';
    v_channel := r->>'channel_id';
    v_ttype   := coalesce(r->>'txn_type', 'sale');
    begin
      v_txn_date   := (r->>'txn_date')::date;
      v_qty        := (r->>'qty')::int;
      v_retail     := nullif(r->>'retail_price','')::numeric;
      v_saleprice  := nullif(r->>'sale_at_price','')::numeric;
      v_discount   := coalesce(nullif(r->>'discount','')::numeric, 0);
      v_commission := coalesce(nullif(r->>'commission','')::numeric, 0);
      v_order_ref  := nullif(r->>'order_ref','');       -- >>> ORDER_REF
      if v_ttype not in ('sale','return') then
        raise exception 'Tipe % tidak didukung', v_ttype;
      end if;
      if v_sku is null or not exists (select 1 from sku_items where sku = v_sku) then
        raise exception 'SKU tidak dikenal: %', coalesce(v_sku, '(kosong)');
      end if;
      select * into ch from cf_sales_channels where channel_id = v_channel;
      if not found then
        raise exception 'Channel tidak dikenal: %', coalesce(v_channel, '(kosong)');
      end if;
      if ch.kind = 'offline' then
        v_location := r->>'location_id';
      else
        v_location := coalesce(r->>'location_id', ch.fulfill_location_id);
      end if;
      if v_location is null or not exists (select 1 from cf_locations where location_id = v_location) then
        raise exception 'Lokasi tidak dikenal: %', coalesce(v_location, '(kosong)');
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Qty tidak valid: %', coalesce(v_qty::text, '(kosong)');
      end if;
      if v_saleprice is null then
        raise exception 'Harga jual kosong';
      end if;
      if exists (select 1 from cf_sales_fact where channel_id = v_channel and source_txn_id = v_src) then
        v_dup := v_dup + 1;
        update cf_sales_staging set processed = true where id = s.id;
        continue;
      end if;
      v_net := v_saleprice * v_qty - v_discount;
      if ch.default_net_basis = 'after_commission' then
        v_net := v_net - v_commission;
      end if;
      select coalesce(crp.cogm_final, crp.cogm)
        into v_cogm
        from sku_items si
        left join cogm_retail_prices crp on crp.spk_id = si.spk_id
        where si.sku = v_sku
        limit 1;
      if v_ttype = 'return' then
        v_fact_net := -v_net;
        v_mtype    := 'return_in'::cf_movement_type;
        v_move_qty := v_qty;
      else
        v_fact_net := v_net;
        v_mtype    := (case when ch.kind = 'offline' then 'sale_store' else 'sale_online' end)::cf_movement_type;
        v_move_qty := -v_qty;
      end if;
      insert into cf_sales_fact
        (txn_date, channel_id, location_id, sku, qty, retail_price, sale_at_price,
         discount, net_amount, net_basis, commission, order_ref, source_txn_id, staging_id)   -- >>> ORDER_REF
      values
        (v_txn_date, v_channel, v_location, v_sku, v_qty, v_retail, v_saleprice,
         v_discount, v_fact_net, ch.default_net_basis, v_commission, v_order_ref, v_src, s.id) -- >>> ORDER_REF
      returning id into v_fact_id;
      insert into cf_stock_movements
        (type, sku, location_id, qty, unit_cogm, ref_type, ref_id, note)
      values
        (v_mtype, v_sku, v_location, v_move_qty, v_cogm,
         case when v_ttype = 'return' then 'sales_return' else 'sales_fact' end,
         v_fact_id::text, s.source);
      update cf_sales_staging set processed = true where id = s.id;
      v_ok := v_ok + 1;
    exception when others then
      insert into cf_sales_quarantine
        (source, channel_id, seller_sku, sale_at_price, qty, source_txn_id, problem, staging_id)
      values
        (s.source, v_channel, v_sku, v_saleprice, v_qty, v_src, SQLERRM, s.id);
      update cf_sales_staging set processed = true where id = s.id;
      v_bad := v_bad + 1;
    end;
  end loop;
  return jsonb_build_object('processed', v_ok, 'quarantined', v_bad, 'duplicate', v_dup);
end $function$
