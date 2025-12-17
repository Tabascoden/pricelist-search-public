-- Comparator schema migration (safe + idempotent)
-- Creates: categories, category_rules, tender_projects, tender_items, tender_offers
-- Extends: supplier_items with normalization / unit metrics / category fields
-- Notes:
--  - no secrets here
--  - safe to run multiple times

-- -----------------------------
-- 1) Categories
-- -----------------------------
CREATE TABLE IF NOT EXISTS public.categories (
    id        serial PRIMARY KEY,
    name      text,
    code      text,
    parent_id int
);

-- In case table existed раньше без колонок
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS parent_id int;

-- Unique by code (nullable ok). If constraint/index already exists -> IF NOT EXISTS will skip.
-- (Если уже есть constraint categories_code_key, индекс с таким именем уже существует.)
CREATE UNIQUE INDEX IF NOT EXISTS categories_code_key
  ON public.categories(code)
  WHERE code IS NOT NULL;

-- Parent FK (safe / idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'categories_parent_id_fkey'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.categories(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------
-- 2) Category rules (future use)
-- -----------------------------
CREATE TABLE IF NOT EXISTS public.category_rules (
    id          serial PRIMARY KEY,
    category_id int REFERENCES public.categories(id) ON DELETE CASCADE,
    pattern     text
);

-- -----------------------------
-- 3) Tenders
-- -----------------------------
CREATE TABLE IF NOT EXISTS public.tender_projects (
    id         serial PRIMARY KEY,
    title      text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tender_items (
    id               serial PRIMARY KEY,
    project_id        int REFERENCES public.tender_projects(id) ON DELETE CASCADE,
    row_no            int,
    name_input        text,
    qty               numeric(12,3),
    unit_input        text,
    category_id       int REFERENCES public.categories(id) ON DELETE SET NULL,
    selected_offer_id int
);

CREATE TABLE IF NOT EXISTS public.tender_offers (
    id               serial PRIMARY KEY,
    tender_item_id   int REFERENCES public.tender_items(id) ON DELETE CASCADE,
    offer_type       text,
    supplier_id      int REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_item_id int REFERENCES public.supplier_items(id) ON DELETE SET NULL,
    supplier_name    text,
    name_raw         text,
    unit             text,
    price            numeric(12,4),
    base_unit        text,
    base_qty         numeric(14,6),
    price_per_unit   numeric(14,6),
    category_id      int REFERENCES public.categories(id) ON DELETE SET NULL,
    created_at       timestamptz DEFAULT now()
);

-- selected_offer_id FK (must be after tender_offers exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tender_items_selected_offer_id_fkey'
  ) THEN
    ALTER TABLE public.tender_items
      ADD CONSTRAINT tender_items_selected_offer_id_fkey
      FOREIGN KEY (selected_offer_id) REFERENCES public.tender_offers(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_tender_items_project_id
  ON public.tender_items(project_id);

CREATE INDEX IF NOT EXISTS idx_tender_offers_item_id
  ON public.tender_offers(tender_item_id);

-- -----------------------------
-- 4) Extend supplier_items
-- -----------------------------
ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS name_normalized text;

-- держим оба варианта названий, чтобы не ломаться на разных версиях кода
ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS base_unit text;
ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS base_uom  text;

ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS base_qty numeric(14,6);
ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS price_per_unit numeric(14,6);

ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS uom_type  text;
ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS pack_uom  text;
ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS pack_qty  numeric(14,6);

ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS category_id int;
ALTER TABLE public.supplier_items ADD COLUMN IF NOT EXISTS category_path text;

-- FK supplier_items.category_id -> categories (safe / idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supplier_items_category_id_fkey'
  ) THEN
    ALTER TABLE public.supplier_items
      ADD CONSTRAINT supplier_items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Trigram index только если pg_trgm установлен
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_supplier_items_name_norm_trgm
      ON public.supplier_items USING gin (coalesce(name_normalized, name_raw) gin_trgm_ops)
    ';
  END IF;
END $$;

-- -----------------------------
-- 5) Seed minimal categories (safe even if rerun)
-- -----------------------------
-- 5.1) If rows exist by name, add code (doesn't require uniqueness)
UPDATE public.categories SET code = 'fresh'
  WHERE name = 'Свежие продукты' AND (code IS NULL OR code = '');
UPDATE public.categories SET code = 'canned'
  WHERE name = 'Консервы/маринады' AND (code IS NULL OR code = '');
UPDATE public.categories SET code = 'frozen'
  WHERE name = 'Заморозка' AND (code IS NULL OR code = '');

-- 5.2) Insert if missing by name (won't trip unique(name) if it exists)
INSERT INTO public.categories(name, code)
SELECT 'Свежие продукты', 'fresh'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Свежие продукты');

INSERT INTO public.categories(name, code)
SELECT 'Консервы/маринады', 'canned'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Консервы/маринады');

INSERT INTO public.categories(name, code)
SELECT 'Заморозка', 'frozen'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Заморозка');
