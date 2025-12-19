-- db/migrations/2024_06_09_tenders.sql
-- Tenders module schema (idempotent)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Projects
CREATE TABLE IF NOT EXISTS tender_projects (
  id serial PRIMARY KEY,
  title text,
  created_at timestamptz DEFAULT now()
);

-- 2) Items
CREATE TABLE IF NOT EXISTS tender_items (
  id serial PRIMARY KEY,
  project_id int REFERENCES tender_projects(id) ON DELETE CASCADE,
  row_no int,
  name_input text,
  qty numeric(12,3),
  unit_input text,
  name_raw text,
  unit_raw text,
  category_id int,
  selected_offer_id int,
  created_at timestamptz DEFAULT now()
);

-- add missing columns (safe for old installs)
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS project_id int;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS row_no int;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS name_input text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS qty numeric(12,3);
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS unit_input text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS name_raw text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS unit_raw text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS category_id int;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS selected_offer_id int;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- defaults for existing columns
ALTER TABLE tender_items ALTER COLUMN created_at SET DEFAULT now();

-- FK: tender_items.project_id -> tender_projects
DO $$
BEGIN
  IF to_regclass('public.tender_items') IS NOT NULL
     AND to_regclass('public.tender_projects') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'tender_items_project_id_fkey'
     )
  THEN
    ALTER TABLE public.tender_items
      ADD CONSTRAINT tender_items_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.tender_projects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- FK: tender_items.category_id -> categories (optional: only if categories exists)
DO $$
BEGIN
  IF to_regclass('public.tender_items') IS NOT NULL
     AND to_regclass('public.categories') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'tender_items_category_id_fkey'
     )
  THEN
    ALTER TABLE public.tender_items
      ADD CONSTRAINT tender_items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id);
  END IF;
END $$;

-- 3) Offers
CREATE TABLE IF NOT EXISTS tender_offers (
  id serial PRIMARY KEY,
  project_id int REFERENCES tender_projects(id) ON DELETE CASCADE,
  tender_item_id int REFERENCES tender_items(id) ON DELETE CASCADE,
  offer_type text,
  supplier_id int REFERENCES suppliers(id),
  supplier_item_id int REFERENCES supplier_items(id),
  supplier_name text,
  item_name text,
  name_raw text,
  unit text,
  price numeric(12,4),
  base_unit text,
  base_qty numeric(12,6),
  price_per_unit numeric(12,4),
  score numeric,
  category_id int,
  chosen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- add missing columns (safe)
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS project_id int;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS tender_item_id int;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS offer_type text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS supplier_id int;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS supplier_item_id int;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS supplier_name text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS item_name text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS name_raw text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS price numeric(12,4);
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS base_unit text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS base_qty numeric(12,6);
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS price_per_unit numeric(12,4);
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS score numeric;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS category_id int;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS chosen_at timestamptz;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- defaults for existing columns
ALTER TABLE tender_offers ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE tender_offers ALTER COLUMN chosen_at SET DEFAULT now();

-- Ensure key FKs exist (idempotent)
DO $$
BEGIN
  IF to_regclass('public.tender_offers') IS NOT NULL
     AND to_regclass('public.tender_projects') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'tender_offers_project_id_fkey'
     )
  THEN
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.tender_projects(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.tender_offers') IS NOT NULL
     AND to_regclass('public.tender_items') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'tender_offers_tender_item_id_fkey'
     )
  THEN
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_tender_item_id_fkey
      FOREIGN KEY (tender_item_id) REFERENCES public.tender_items(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.tender_offers') IS NOT NULL
     AND to_regclass('public.suppliers') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'tender_offers_supplier_id_fkey'
     )
  THEN
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.tender_offers') IS NOT NULL
     AND to_regclass('public.supplier_items') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'tender_offers_supplier_item_id_fkey'
     )
  THEN
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_supplier_item_id_fkey
      FOREIGN KEY (supplier_item_id) REFERENCES public.supplier_items(id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.tender_offers') IS NOT NULL
     AND to_regclass('public.categories') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'tender_offers_category_id_fkey'
     )
  THEN
    ALTER TABLE public.tender_offers
      ADD CONSTRAINT tender_offers_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id);
  END IF;
END $$;

-- Indexes for fast "last chosen offer" lookup
CREATE INDEX IF NOT EXISTS idx_tender_offers_project_item_chosen
  ON tender_offers(project_id, tender_item_id, chosen_at DESC);

CREATE INDEX IF NOT EXISTS idx_tender_items_project_rowno
  ON tender_items(project_id, row_no);
