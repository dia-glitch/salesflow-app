-- ============================================================================
-- SALESFLOW · Perbaiki No. Order (source_txn_id) untuk penjualan Direct Purchase.
-- Sebelumnya: 'DO-' + order_no + '-' + uuid32  →  "DO-DO-20260725-1771-<32 char>"
--            (dobel "DO-" + terlalu panjang).
-- Sekarang  : order_no + '-' + 6 char          →  "DO-20260725-1771-a1b2c3"
-- Jalankan sekali di Supabase SQL editor. Baris penjualan lama tidak berubah.
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
  v_basis  cf_net_basis;
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
