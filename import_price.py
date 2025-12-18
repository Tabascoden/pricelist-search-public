#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import csv
import os
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import BytesIO
from typing import Dict, List, Optional, Tuple, Any

import psycopg2
from psycopg2.extras import execute_values
import pandas as pd

# Ключевые слова для поиска колонок
NAME_KEYS = ["наименование", "наименованиетовара", "товар", "описание", "позиция", "product", "item", "название", "номенклатура"]
CODE_KEYS = ["код", "кодтовара", "артикул", "art", "sku", "код1с", "штрихкод", "баркод"]
UNIT_KEYS = ["ед", "едизм", "единицаизмерения", "единица", "unit", "едиз", "упак", "уп", "шт", "кг", "л", "литр"]
PRICE_KEYS = ["цена", "ценабезндс", "ценасндс", "ценаруб", "стоимость", "price", "отпускнаяцена", "сумма", "руб"]

KNOWN_UNITS = {"шт", "штука", "штук", "кг", "г", "гр", "л", "литр", "литров", "уп", "упак", "кор", "коробка", "бут", "бутылка"}


def normalize_name(name_raw: str) -> str:
    if name_raw is None:
        return ""
    text = str(name_raw).lower()
    text = text.replace("ё", "е")
    text = re.sub(r"[^a-zа-я0-9\s\.\,\%\*\-\/]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def detect_category(name_raw: str) -> Optional[str]:
    if not name_raw:
        return None
    lowered = str(name_raw).lower()
    if re.search(r"консерв|марин|солен|вялен|в рассоле|в собственном соку|томатная паста", lowered):
        return "canned"
    if re.search(r"замороз|frozen|с/м|свежеморож", lowered):
        return "frozen"
    if re.search(r"овощи|фрукты|зелень|ягоды|салат", lowered):
        return "fresh"
    return "fresh"


def compute_unit_metrics(name_raw: str, unit_raw: Optional[str], price: Optional[Decimal]) -> Tuple[Optional[str], Optional[Decimal], Optional[Decimal]]:
    unit_norm = (unit_raw or "").strip().lower().replace(".", "")
    name_lower = str(name_raw or "").lower().replace(",", ".")
    
    price_per_unit = None
    base_unit = None
    base_qty = None

    if unit_norm in {"кг", "kg", "килограмм"}:
        base_unit = "kg"
        base_qty = Decimal("1")
    elif unit_norm in {"л", "литр", "l", "литров"}:
        base_unit = "l"
        base_qty = Decimal("1")
    
    if base_qty is None:
        patterns = [
            (r"(\d+)\s*[xх\*]\s*(\d+[\.]?\d*)\s*(кг|kg|г|гр|g|грам)", "weight"),
            (r"(\d+[\.]?\d*)\s*(кг|kg|г|гр|g|грам)", "weight"),
            (r"(\d+)\s*[xх\*]\s*(\d+[\.]?\d*)\s*(л|l|литр|ml|мл|миллилитр)", "volume"),
            (r"(\d+[\.]?\d*)\s*(л|l|литр|ml|мл|миллилитр)", "volume"),
        ]

        for pattern, p_type in patterns:
            m = re.search(pattern, name_lower)
            if m:
                try:
                    if len(m.groups()) == 3:
                        multiplier = Decimal(m.group(1))
                        val = Decimal(m.group(2))
                        unit_str = m.group(3)
                    else:
                        multiplier = Decimal("1")
                        val = Decimal(m.group(1))
                        unit_str = m.group(2)

                    if p_type == "weight":
                        base_unit = "kg"
                        if unit_str in {"г", "гр", "g", "грам"}:
                            base_qty = (multiplier * val * Decimal("0.001"))
                        else:
                            base_qty = (multiplier * val)
                    else:
                        base_unit = "l"
                        if unit_str in {"ml", "мл", "миллилитр"}:
                            base_qty = (multiplier * val * Decimal("0.001"))
                        else:
                            base_qty = (multiplier * val)
                    break
                except Exception:
                    continue

    if base_qty is None:
        if unit_norm in {"шт", "штука", "штук", "уп", "упак", "кор", "коробка"}:
            base_unit = "pcs"
            base_qty = Decimal("1")

    if base_qty and price and base_qty > 0:
        try:
            price_per_unit = (price / base_qty).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            base_qty = base_qty.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        except Exception:
            price_per_unit = None

    return base_unit, base_qty, price_per_unit


def connect_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "smartproc"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
        connect_timeout=8,
        options="-c statement_timeout=600000",
    )


def fetch_category_map(conn) -> Dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("SELECT id, code FROM categories;")
        rows = cur.fetchall()
    return {code: cid for cid, code in rows}


def ensure_schema_compare(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS categories (
              id serial PRIMARY KEY,
              name text,
              code text UNIQUE,
              parent_id int REFERENCES categories(id)
            );
            """
        )
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_normalized text;")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_unit text;")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_qty numeric(12,6);")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS price_per_unit numeric(12,4);")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_id int REFERENCES categories(id);")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_path text;")
    conn.commit()


def normalize_header(text: str) -> str:
    if text is None:
        return ""
    text = str(text).strip().lower()
    text = re.sub(r"[\s\.\,\;\:\-\_\/\\]+", "", text)
    return text


def guess_encoding(path: str) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1251", "latin1"):
        try:
            with open(path, "r", encoding=enc) as f:
                f.read(4096)
            return enc
        except UnicodeDecodeError:
            continue
        except OSError:
            break
    return "utf-8"


def parse_price(value) -> Optional[Decimal]:
    if value is None:
        return None
    v = str(value).strip().lower()
    if not v:
        return None
    v = re.sub(r"[^0-9\.\,]", "", v.replace(" ", ""))
    v = v.replace(",", ".")
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def is_number_like(s) -> bool:
    if s is None:
        return False
    s = str(s).strip().replace(" ", "").replace(",", ".")
    return bool(re.match(r"^-?\d+(\.\d+)?$", s))


def is_unit_like(s) -> bool:
    if s is None:
        return False
    s_norm = str(s).strip().lower().replace(".", "")
    if not s_norm:
        return False
    if s_norm in KNOWN_UNITS:
        return True
    return 1 <= len(s_norm) <= 5


def match_header_field(field_keys, taken, norm_headers):
    for i, h in enumerate(norm_headers):
        if i in taken or not h:
            continue
        for key in field_keys:
            if key in h:
                return i
    return None


def detect_columns_by_header(headers) -> Dict[str, Optional[int]]:
    result = {"name": None, "code": None, "unit": None, "price": None}
    if not headers:
        return result
    norm_headers = [normalize_header(h) for h in headers]
    taken = set()
    for field, keys in [("name", NAME_KEYS), ("price", PRICE_KEYS), ("code", CODE_KEYS), ("unit", UNIT_KEYS)]:
        idx = match_header_field(keys, taken, norm_headers)
        if idx is not None:
            result[field] = idx
            taken.add(idx)
    return result


def detect_columns_by_sample(rows, col_map) -> Dict[str, Optional[int]]:
    if not rows:
        return col_map
    col_count = max(len(r) for r in rows)
    if col_map.get("name") is None:
        for idx in range(col_count):
            vals = [str(r[idx]) for r in rows if idx < len(r) and r[idx]]
            if vals and sum(len(v) for v in vals)/len(vals) > 10:
                col_map["name"] = idx
                break
    if col_map.get("price") is None:
        for idx in range(col_count):
            vals = [str(r[idx]) for r in rows if idx < len(r)]
            if vals and sum(1 for v in vals if is_number_like(v))/len(vals) > 0.5:
                col_map["price"] = idx
                break
    return col_map


def _clean_row(row) -> List[str]:
    return [("" if v is None else str(v)) for v in row]


def load_from_csv(file_path) -> Tuple[Optional[List[str]], List[List[str]]]:
    encoding = guess_encoding(file_path)
    with open(file_path, "r", encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=";")
        rows = [list(row) for row in reader]
    if not rows:
        return None, []
    return rows[0], rows[1:]


def _find_header_row(rows: List[List[str]], scan_limit: int = 80):
    for i, row in enumerate(rows[:scan_limit]):
        norm = [normalize_header(c) for c in row]
        if any(k in norm for k in NAME_KEYS) and any(k in norm for k in PRICE_KEYS):
            return row, rows[i+1:], i
    return None, rows, None


def list_excel_sheets(path: str) -> List[str]:
    with pd.ExcelFile(path) as xls:
        return list(xls.sheet_names)


def load_excel_rows(file_path: str, ext: str, target_sheets: Optional[List[str]] = None):
    with pd.ExcelFile(file_path) as xls:
        sheets = target_sheets if target_sheets else xls.sheet_names
        for sname in sheets:
            df = pd.read_excel(xls, sheet_name=sname, header=None)
            yield sname, df.where(df.notna(), None).values.tolist()


def import_price_file(supplier_id: int, file_path: str, original_filename: Optional[str] = None, sheet_mode: str = "all", sheet_names: Optional[List[str]] = None):
    conn = connect_db()
    try:
        with conn.cursor() as cur:
            ensure_schema_compare(conn)
            cur.execute("DELETE FROM supplier_items WHERE supplier_id=%s;", (supplier_id,))
            cur.execute("INSERT INTO price_list_files (supplier_id, file_name, status, rows_imported) VALUES (%s, %s, 'importing', 0) RETURNING id;", (supplier_id, original_filename or os.path.basename(file_path)))
            file_id = cur.fetchone()[0]
        
        category_map = fetch_category_map(conn)
        total_imported = 0
        ext = os.path.splitext(file_path)[1].lower()

        def process_rows(rows_iter):
            nonlocal total_imported
            rows = list(rows_iter)
            headers, data_rows, _ = _find_header_row(rows)
            col_map = detect_columns_by_header(headers)
            col_map = detect_columns_by_sample(data_rows[:50], col_map)
            
            if col_map["name"] is None or col_map["price"] is None:
                return

            batch = []
            for row in data_rows:
                if col_map["name"] >= len(row): continue
                name_raw = str(row[col_map["name"]]).strip() if row[col_map["name"]] else None
                if not name_raw: continue
                
                if col_map["price"] >= len(row): continue
                price_val = parse_price(row[col_map["price"]])
                if price_val is None: continue
                
                unit_raw = str(row[col_map["unit"]]).strip() if col_map["unit"] is not None and col_map["unit"] < len(row) and row[col_map["unit"]] else None
                code_raw = str(row[col_map["code"]]).strip() if col_map["code"] is not None and col_map["code"] < len(row) and row[col_map["code"]] else None
                
                name_norm = normalize_name(name_raw)
                base_unit, base_qty, price_per_unit = compute_unit_metrics(name_raw, unit_raw, price_val)
                cat_id = category_map.get(detect_category(name_raw))

                batch.append((supplier_id, file_id, code_raw, name_raw, unit_raw, price_val, "RUB", True, name_norm, base_unit, base_qty, price_per_unit, cat_id))
                if len(batch) >= 1000:
                    with conn.cursor() as cur:
                        execute_values(cur, "INSERT INTO supplier_items (supplier_id, price_list_file_id, external_code, name_raw, unit, price, currency, is_active, name_normalized, base_unit, base_qty, price_per_unit, category_id) VALUES %s", batch)
                    total_imported += len(batch)
                    batch = []
            
            if batch:
                with conn.cursor() as cur:
                    execute_values(cur, "INSERT INTO supplier_items (supplier_id, price_list_file_id, external_code, name_raw, unit, price, currency, is_active, name_normalized, base_unit, base_qty, price_per_unit, category_id) VALUES %s", batch)
                total_imported += len(batch)

        if ext in (".xlsx", ".xls"):
            for sname, rows in load_excel_rows(file_path, ext, sheet_names if sheet_mode=="selected" else None):
                process_rows(rows)
        else:
            _, rows = load_from_csv(file_path)
            process_rows(rows)

        with conn.cursor() as cur:
            cur.execute("UPDATE price_list_files SET status='imported', rows_imported=%s WHERE id=%s", (total_imported, file_id))
        conn.commit()
        return {"imported": total_imported}
    finally:
        conn.close()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--supplier", type=int, required=True)
    p.add_argument("--file", required=True)
    args = p.parse_args()
    print(import_price_file(args.supplier, args.file))
