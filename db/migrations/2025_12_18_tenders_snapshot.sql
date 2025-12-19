-- Ensure tender tables have columns for simplified snapshot flow
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS name_raw text;
ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS unit_raw text;

ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS project_id int;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS item_name text;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS score numeric;
ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS chosen_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF to_regclass('public.tender_offers') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname='tender_offers_project_id_fkey'
    ) THEN
      ALTER TABLE public.tender_offers
        ADD CONSTRAINT tender_offers_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.tender_projects(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tender_offers_project_item ON tender_offers(project_id, tender_item_id, chosen_at DESC);
