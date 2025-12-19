-- Tenders module schema
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS tender_projects (
  id serial PRIMARY KEY,
  title text,
  created_at timestamptz DEFAULT now()
);

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

ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS name_raw text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS unit_raw text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS selected_offer_id int;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS category_id int REFERENCES categories(id);
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS name_input text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS unit_input text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS qty numeric(12,3);
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS row_no int;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS project_id int REFERENCES tender_projects(id) ON DELETE CASCADE;

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
  chosen_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS project_id int REFERENCES tender_projects(id) ON DELETE CASCADE;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS tender_item_id int REFERENCES tender_items(id) ON DELETE CASCADE;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS offer_type text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS supplier_id int REFERENCES suppliers(id);
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS supplier_item_id int REFERENCES supplier_items(id);
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
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tender_offers_project_item_chosen ON tender_offers(project_id, tender_item_id, chosen_at DESC);
