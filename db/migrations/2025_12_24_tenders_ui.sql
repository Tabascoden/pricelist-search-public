-- хранить выбранных поставщиков для проекта
CREATE TABLE IF NOT EXISTS tender_project_suppliers (
  project_id int REFERENCES tender_projects(id) ON DELETE CASCADE,
  supplier_id int REFERENCES suppliers(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_tps_project_id ON tender_project_suppliers(project_id);

-- (опционально) чтобы "Собрать заказ(ы)" создавал 1 заказ на поставщика и это было видно в orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_id int REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tender_project_id int REFERENCES tender_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_tender_project_id ON orders(tender_project_id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tender_item_id int REFERENCES tender_items(id) ON DELETE SET NULL;

-- фиксировать исходное название и источник выбора номенклатуры
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS name_original text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS name_source_supplier_item_id int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='tender_items_name_source_supplier_item_id_fkey'
  ) THEN
    ALTER TABLE tender_items
      ADD CONSTRAINT tender_items_name_source_supplier_item_id_fkey
      FOREIGN KEY (name_source_supplier_item_id) REFERENCES supplier_items(id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE tender_items
SET name_original = name_input
WHERE name_original IS NULL;
