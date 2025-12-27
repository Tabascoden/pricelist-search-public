ALTER TABLE tender_items
  ADD COLUMN IF NOT EXISTS star_supplier_item_id INT NULL;

CREATE INDEX IF NOT EXISTS tender_items_star_supplier_item_id_idx
  ON tender_items(star_supplier_item_id);
