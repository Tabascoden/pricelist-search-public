-- Fix comparator FK constraints to ON DELETE SET NULL (idempotent)
-- Safe to run multiple times

DO $$
BEGIN
  -- categories.parent_id -> SET NULL
  IF to_regclass('public.categories') IS NOT NULL THEN
    ALTER TABLE public.categories
      DROP CONSTRAINT IF EXISTS categories_parent_id_fkey;

    ALTER TABLE public.categories
      ADD CONSTRAINT categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;

  -- supplier_items.category_id -> SET NULL
  IF to_regclass('public.supplier_items') IS NOT NULL THEN
    -- только если колонка существует (на всякий случай)
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='supplier_items' AND column_name='category_id'
    ) THEN
      ALTER TABLE public.supplier_items
        DROP CONSTRAINT IF EXISTS supplier_items_category_id_fkey;

      ALTER TABLE public.supplier_items
        ADD CONSTRAINT supplier_items_category_id_fkey
        FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
    END IF;
  END IF;

  -- tender_items.category_id + selected_offer_id -> SET NULL
  IF to_regclass('public.tender_items') IS NOT NULL THEN
    ALTER TABLE public.tender_items
      DROP CONSTRAINT IF EXISTS tender_items_category_id_fkey;

    ALTER TABLE public.tender_items
      ADD CONSTRAINT tender_items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

    ALTER TABLE public.tender_items
      DROP CONSTRAINT IF EXISTS tender_items_selected_offer_id_fkey;

    -- tender_offers может ещё не существовать, поэтому проверим
    IF to_regclass('public.tender_offers') IS NOT NULL THEN
      ALTER TABLE public.tender_items
        ADD CONSTRAINT tender_items_selected_offer_id_fkey
        FOREIGN KEY (selected_offer_id) REFERENCES public.tender_offers(id) ON DELETE SET NULL;
    END IF;
  END IF;

  -- tender_offers.supplier_id / supplier_item_id / category_id -> SET NULL
  IF to_regclass('public.tender_offers') IS NOT NULL THEN
    ALTER TABLE public.tender_offers
      DROP CONSTRAINT IF EXISTS tender_offers_supplier_id_fkey;
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

    ALTER TABLE public.tender_offers
      DROP CONSTRAINT IF EXISTS tender_offers_supplier_item_id_fkey;
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_supplier_item_id_fkey
      FOREIGN KEY (supplier_item_id) REFERENCES public.supplier_items(id) ON DELETE SET NULL;

    ALTER TABLE public.tender_offers
      DROP CONSTRAINT IF EXISTS tender_offers_category_id_fkey;
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;
END $$;
