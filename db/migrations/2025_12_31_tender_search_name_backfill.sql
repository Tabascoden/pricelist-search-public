UPDATE tender_items
SET search_name = trim(regexp_replace(replace(lower(name_input), 'ё', 'е'), '[^a-z0-9а-я%\s]+', ' ', 'g'))
WHERE search_name IS NULL OR search_name = '';
