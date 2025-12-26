CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_search text;
ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(name_search, ''))) STORED;

UPDATE supplier_items
SET name_search = COALESCE(name_normalized, name_raw)
WHERE name_search IS NULL OR name_search = '';

CREATE INDEX IF NOT EXISTS supplier_items_name_search_tsv_gin
  ON supplier_items USING GIN (name_search_tsv);

CREATE INDEX IF NOT EXISTS supplier_items_name_search_trgm_gin
  ON supplier_items USING GIN (name_search gin_trgm_ops);

CREATE INDEX IF NOT EXISTS supplier_items_supplier_id_idx
  ON supplier_items (supplier_id);

CREATE INDEX IF NOT EXISTS supplier_items_supplier_category_idx
  ON supplier_items (supplier_id, category_id);
