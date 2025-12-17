-- Comparator schema migration (safe + idempotent)
-- Creates: categories, category_rules, tender_projects, tender_items, tender_offers
-- Extends: supplier_items with normalization / unit metrics / category fields

-- ================
-- Categories
-- ================
CREATE TABLE IF NOT EXISTS categories (
    id        serial PRIMARY KEY,
    name      text,
    code      text,
    parent_id int
);

-- If categories existed earlier without code
ALTER TABLE categories ADD COLUMN IF NOT EXISTS code text;

-- Keep code reasonably unique (multiple NULL allowed in Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS categories_code_key ON categories(code);

-- Parent FK (safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_parent_id_fkey'
  ) THEN
    ALTER TABLE categories
      ADD CONSTRAINT categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ================
-- Category rules (future use)
-- ================
CREATE TABLE IF NOT EXISTS category_rules (
    id          serial PRIMARY KEY,
    category_id int REFERENCES categories(id) ON DELETE CASCADE,
    pattern     text
);

-- ================
-- Tender projects and related tables
-- ================
CREATE TABLE IF NOT EXISTS tender_projects (
    id         serial PRIMARY KEY,
    title      text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tender_items (
    id               serial PRIMARY KEY,
    project_id        int REFERENCES tender_projects(id) ON DELETE CASCADE,
    row_no            int,
    name_input        text,
    qty               numeric(12,3),
    unit_input        text,
    category_id       int REFERENCES categories(id) ON DELETE SET NULL,
    selected_offer_id int
);

CREATE TABLE IF NOT EXISTS tender_offers (
    id             serial PRIMARY KEY,
    tender_item_id int REFERENCES tender_items(id) ON DELETE CASCADE,
    offer_type     text,
    supplier_id    int REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_item_id int REFERENCES supplier_items(id) ON DELETE SET NULL,
    supplier_name  text,
    name_raw       text,
    unit           text,
    price          numeric(12,4),
    base_uom       text,
    base_qty       numeric(14,6),
    price_per_unit numeric(14,6),
    category_id    int REFERENCES categories(id) ON DELETE SET NULL,
    created_at     timestamptz DEFAULT now()
);

-- Optional FK for selected_offer_id (safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='tender_items_selected_offer_id_fkey'
  ) THEN
    ALTER TABLE tender_items
      ADD CONSTRAINT tender_items_selected_offer_id_fkey
      FOREIGN KEY (selected_offer_id) REFERENCES tender_offers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Helpful indexes for tenders
CREATE INDEX IF NOT EXISTS idx_tender_items_project_id ON tender_items(project_id);
CREATE INDEX IF NOT EXISTS idx_tender_offers_item_id  ON tender_offers(tender_item_id);

-- ================
-- Extend supplier_items (safe)
-- ================
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_normalized text;

-- Unit metrics (names match what у тебя уже видно в \d supplier_items)
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS uom_type text;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_uom text;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_qty numeric(14,6);
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS price_per_unit numeric(14,6);
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS pack_uom text;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS pack_qty numeric(14,6);

-- Categories on items
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_id int;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_path text;

-- supplier_items.category_id FK with ON DELETE SET NULL (safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='supplier_items_category_id_fkey'
  ) THEN
    ALTER TABLE supplier_items
      ADD CONSTRAINT supplier_items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for search on normalized name (requires pg_trgm; у вас он уже есть)
CREATE INDEX IF NOT EXISTS idx_supplier_items_name_norm_trgm
  ON supplier_items USING gin (coalesce(name_normalized, name_raw) gin_trgm_ops);

-- ================
-- Seed minimal categories (idempotent, no crashes)
-- 1) update code if category already exists by name
-- 2) insert missing by name
-- ================
WITH seed(name, code) AS (
  VALUES
    ('Свежие продукты', 'fresh'),
    ('Консервы/маринады', 'canned'),
    ('Заморозка', 'frozen')
),
upd AS (
  UPDATE categories c
     SET code = s.code
    FROM seed s
   WHERE c.name = s.name
     AND (c.code IS NULL OR c.code = '')
  RETURNING c.id
)
INSERT INTO categories(name, code)
SELECT s.name, s.code
  FROM seed s
 WHERE NOT EXISTS (
   SELECT 1 FROM categories c WHERE c.name = s.name
 );
