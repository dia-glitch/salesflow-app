-- ============================================================================
-- SALESFLOW · Rapikan nomor invoice Direct Purchase lama ke format baru.
--   DP         → INV/DP/<order_no>
--   Pelunasan  → INV/LN/<order_no>
--   Full       → INV/<order_no>
-- Dijalankan SEKALI di Supabase SQL editor (project production).
-- Aman: hanya mengubah invoice_no, tidak menyentuh id / pembayaran / relasi.
-- ============================================================================

-- (opsional) cek dulu hasilnya sebelum commit:
--   select i.invoice_no as lama,
--          case lower(i.type)
--            when 'dp' then 'INV/DP/' || o.order_no
--            when 'settlement' then 'INV/LN/' || o.order_no
--            else 'INV/' || o.order_no end as baru,
--          i.type, o.order_no
--   from sf_do_invoices i join sf_do_orders o on o.id = i.order_id
--   order by o.order_no, i.created_at;

update sf_do_invoices i
set invoice_no = case lower(i.type)
     when 'dp'         then 'INV/DP/' || o.order_no
     when 'settlement' then 'INV/LN/' || o.order_no
     else                   'INV/'    || o.order_no
   end
from sf_do_orders o
where o.id = i.order_id
  and coalesce(lower(i.status), '') <> 'cancelled'
  and i.invoice_no is distinct from case lower(i.type)
     when 'dp'         then 'INV/DP/' || o.order_no
     when 'settlement' then 'INV/LN/' || o.order_no
     else                   'INV/'    || o.order_no
   end;
