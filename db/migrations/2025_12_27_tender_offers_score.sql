-- add missing column used by tenders select/cart
ALTER TABLE public.tender_offers
  ADD COLUMN IF NOT EXISTS score numeric;
