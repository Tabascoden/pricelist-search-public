UPDATE tender_items
SET qty = NULL
WHERE qty::text = 'NaN';

UPDATE tender_items
SET unit_input = NULL
WHERE unit_input IS NOT NULL AND lower(unit_input) = 'nan';
