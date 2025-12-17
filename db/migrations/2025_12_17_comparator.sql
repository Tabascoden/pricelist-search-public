-- Comparator schema migration (safe + idempotent)

-- Categories
CREATE TABLE IF NOT EXISTS categories (
    id serial PRIMARY KEY,
    name text NOT NULL,
    code text UNIQUE,
    parent_id int
);

ALTER TABLE categories ADD COLUMN IF NOT EXISTS code text;
CREATE UNIQUE INDEX IF NOT EXISTS categories_code_key ON categories(code);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_key ON categories(name);

-- Parent link with safe delete
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='categories_parent_id_fkey') THEN
    ALTER TABLE categories
      ADD CONSTRAINT categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Category rules (future use)
CREATE TABLE IF NOT EXISTS category_rules (
    id serial PRIMARY KEY,
    category_id int REFERENCES categories(id) ON DELETE CASCADE,
    pattern text
);

-- Tender projects and related tables
CREATE TABLE IF NOT EXISTS tender_projects (
    id serial PRIMARY KEY,
    title text NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tender_items (
    id serial PRIMARY KEY,
    project_id int REFERENCES tender_projects(id) ON DELETE CASCADE,
    row_no int,
    name_input text NOT NULL,
    qty numeric(12,3),
    unit_input text,
    category_id int REFERENCES categories(id) ON DELETE SET NULL,
    selected_offer_id int
);

CREATE TABLE IF NOT EXISTS tender_offers (
    id serial PRIMARY KEY,
    tender_item_id int REFERENCES tender_items(id) ON DELETE CASCADE,
    offer_type text,
    supplier_id int REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_item_id int REFERENCES supplier_items(id) ON DELETE SET NULL,
    supplier_name text,
    name_raw text,
    unit text,
    price numeric(12,4),
    base_unit text,
    base_qty numeric(12,6),
    price_per_unit numeric(12,4),
    category_id int REFERENCES categories(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now()
);

-- Optional FK for selected_offer_id (safe)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tender_items_selected_offer_id_fkey') THEN
    ALTER TABLE tender_items
      ADD CONSTRAINT tender_items_selected_offer_id_fkey
      FOREIGN KEY (selected_offer_id) REFERENCES tender_offers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Additional columns on supplier_items
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_normalized text;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_unit text;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_qty numeric(12,6);
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS price_per_unit numeric(12,4);
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_id int;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_path text;

-- supplier_items.category_id FK with ON DELETE SET NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_items_category_id_fkey') THEN
    ALTER TABLE supplier_items
      ADD CONSTRAINT supplier_items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for search on normalized name (requires pg_trgm; у вас он уже есть)
CREATE INDEX IF NOT EXISTS idx_supplier_items_name_norm_trgm
  ON supplier_items USING gin (coalesce(name_normalized, name_raw) gin_trgm_ops);

-- Helpful indexes for tenders
CREATE INDEX IF NOT EXISTS idx_tender_items_project_id ON tender_items(project_id);
CREATE INDEX IF NOT EXISTS idx_tender_offers_item_id ON tender_offers(tender_item_id);

-- Seed minimal categories (upsert)
INSERT INTO categories(name, code)
VALUES
    ('Свежие продукты', 'fresh'),
    ('Консервы/маринады', 'canned'),
    ('Заморозка', 'frozen')
ON CONFLICT DO NOTHING;
