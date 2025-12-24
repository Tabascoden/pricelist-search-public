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
