#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse

import csv
import os
import re
import sys
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

import pandas as pd

from search_text import generate_supplier_name_search


NAME_KEYS = ["наименование", "наименованиетовара", "товар", "описание", "позиция", "product", "item", "название"]
CODE_KEYS = ["код", "кодтовара", "артикул", "art", "sku", "код1с", "штрихкод", "баркод"]
UNIT_KEYS = ["ед", "едизм", "единицаизмерения", "единица", "unit", "едиз", "упак", "уп", "шт", "кг", "л", "литр"]
PRICE_KEYS = ["цена", "ценабезндс", "ценасндс", "ценаруб", "стоимость", "price", "отпускнаяцена", "сумма", "руб"]

KNOWN_UNITS = {"шт", "штука", "штук", "кг", "г", "гр", "л", "литр", "литров", "уп", "упак", "кор", "коробка"}


def normalize_name(name_raw: str) -> str:
    if name_raw is None:
        return ""
    text = str(name_raw).lower()
    text = text.replace("ё", "е")
    text = text.strip()
    text = re.sub(r"[^a-zа-я0-9\s\.\,\-\/]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def detect_category(name_raw: str) -> Optional[str]:
    if not name_raw:
        return None
    lowered = str(name_raw).lower()
    if re.search(r"консерв|марин|солен|вялен|в рассоле|в собственном соку", lowered):
        return "canned"
    if re.search(r"замороз|frozen", lowered):
        return "frozen"
    # базовый дефолт
    return "fresh"


def compute_unit_metrics(name_raw: str, unit_raw: Optional[str], price: Optional[Decimal]):
    unit_norm = (unit_raw or "").strip().lower().replace(".", "")
    name_lower = str(name_raw or "").lower()
    price_per_unit = None
    base_unit = None
    base_qty = None

    if unit_norm in {"кг", "kg"}:
        base_unit = "kg"
        base_qty = Decimal("1")
    elif unit_norm in {"л", "л", "литр", "литров", "l"}:
        base_unit = "l"
        base_qty = Decimal("1")
    elif unit_norm in {"мл", "ml"}:
        base_unit = "l"
        base_qty = Decimal("0.001")
    elif unit_norm in {"шт", "штука", "штук", "уп", "упак", "кор", "коробка"}:
        patterns = [
            (r"(\d+[\,\.]?\d*)\s*(кг)", "kg", Decimal("1")),
            (r"(\d+[\,\.]?\d*)\s*(г|гр|грам)", "kg", Decimal("0.001")),
            (r"(\d+[\,\.]?\d*)\s*(л|литр|литров)", "l", Decimal("1")),
            (r"(\d+[\,\.]?\d*)\s*(ml|мл)", "l", Decimal("0.001")),
        ]
        for pattern, b_unit, multiplier in patterns:
            m = re.search(pattern, name_lower)
            if m:
                try:
                    val = Decimal(m.group(1).replace(",", "."))
                    base_unit = b_unit
                    base_qty = (val * multiplier).quantize(Decimal("0.000001"))
                    break
                except Exception:
                    continue

    if base_qty and price:
        try:
            if base_qty > 0:
                price_per_unit = (price / base_qty).quantize(Decimal("0.0001"))
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

            CREATE TABLE IF NOT EXISTS tender_projects (
              id serial PRIMARY KEY,
              title text,
              created_at timestamptz DEFAULT now()
            );
            """
        )
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_normalized text;")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_search text;")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_unit text;")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_qty numeric(12,6);")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS price_per_unit numeric(12,4);")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_id int REFERENCES categories(id);")
        cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_path text;")
        cur.execute(
            """
            INSERT INTO categories(name, code)
            SELECT * FROM (VALUES
                ('Свежие продукты', 'fresh'),
                ('Консервы/маринады', 'canned'),
                ('Заморозка', 'frozen')
            ) AS s(name, code)
            WHERE NOT EXISTS (SELECT 1 FROM categories WHERE code = s.code);
            """
        )
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
    v = str(value).strip()
    if not v:
        return None
    v = v.replace(" ", "")
    v = v.replace("руб", "").replace("р.", "").replace("р", "")
    v = v.replace(",", ".")
    v = re.sub(r"[^0-9\.]", "", v)
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
            key = key.strip()
            if not key:
                continue
            if len(key) <= 3:
                if h == key or h.startswith(key):
                    return i
            else:
                if h == key or key in h:
                    return i
    return None


def detect_columns_by_header(headers) -> Dict[str, Optional[int]]:
    result = {"name": None, "code": None, "unit": None, "price": None}
    if not headers:
        return result
    norm_headers = [normalize_header(h) for h in headers]
    taken = set()

    idx = match_header_field(NAME_KEYS, taken, norm_headers)
    if idx is not None:
        result["name"] = idx
        taken.add(idx)

    idx = match_header_field(PRICE_KEYS, taken, norm_headers)
    if idx is not None:
        result["price"] = idx
        taken.add(idx)

    idx = match_header_field(CODE_KEYS, taken, norm_headers)
    if idx is not None:
        result["code"] = idx
        taken.add(idx)

    idx = match_header_field(UNIT_KEYS, taken, norm_headers)
    if idx is not None:
        result["unit"] = idx
        taken.add(idx)

    return result


def detect_columns_by_sample(rows, col_map) -> Dict[str, Optional[int]]:
    if not rows:
        return col_map

    col_count = max(len(r) for r in rows)

    if col_map.get("name") is None:
        avg_len = []
        for idx in range(col_count):
            vals = [str(r[idx]) for r in rows if idx < len(r) and r[idx] not in (None, "")]
            if not vals:
                avg_len.append((idx, 0))
            else:
                avg = sum(len(v.strip()) for v in vals) / len(vals)
                avg_len.append((idx, avg))
        avg_len.sort(key=lambda x: x[1], reverse=True)
        if avg_len and avg_len[0][1] > 3:
            col_map["name"] = avg_len[0][0]

    if col_map.get("price") is None:
        candidates = []
        for idx in range(col_count):
            vals = [str(r[idx]) for r in rows if idx < len(r)]
            if not vals:
                continue
            num_cnt = sum(1 for v in vals if is_number_like(v))
            ratio = num_cnt / len(vals)
            if ratio >= 0.5:
                nums = [float(str(v).replace(",", ".").replace(" ", "")) for v in vals if is_number_like(v)]
                avg_val = sum(nums) / len(nums) if nums else 0
                candidates.append((idx, ratio, avg_val))
        if candidates:
            candidates.sort(key=lambda x: (x[1], x[2]), reverse=True)
            col_map["price"] = candidates[0][0]

    if col_map.get("unit") is None:
        best_idx = None
        best_score = 0
        for idx in range(col_count):
            vals = [str(r[idx]) for r in rows if idx < len(r)]
            if not vals:
                continue
            score = sum(1 for v in vals if is_unit_like(v))
            if score > best_score and score > 0:
                best_score = score
                best_idx = idx
        if best_idx is not None:
            col_map["unit"] = best_idx

    if col_map.get("code") is None:
        best_idx = None
        best_score = 0
        for idx in range(col_count):
            vals = [str(r[idx]) for r in rows if idx < len(r)]
            if not vals:
                continue
            score = 0
            for v in vals:
                v = v.strip()
                if 2 <= len(v) <= 24 and re.match(r"^[0-9A-Za-zА-Яа-я\-_/\.]+$", v):
                    score += 1
            if score > best_score:
                best_score = score
                best_idx = idx
        if best_idx is not None:
            col_map["code"] = best_idx

    return col_map


def _clean_row(row) -> List[str]:
    vals = [("" if v is None else str(v)) for v in row]
    while vals and vals[-1] == "":
        vals.pop()
    return vals


def load_from_csv(file_path) -> Tuple[Optional[List[str]], List[List[str]]]:
    encoding = guess_encoding(file_path)
    with open(file_path, "r", encoding=encoding, newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,|\t")
        except csv.Error:
            dialect = csv.excel
            dialect.delimiter = ";"

        try:
            has_header = csv.Sniffer().has_header(sample)
        except csv.Error:
            has_header = True

        reader = csv.reader(f, dialect)
        rows_raw = [list(row) for row in reader]

    rows_clean = []
    for row in rows_raw:
        row = _clean_row(row)
        if any(str(c).strip() for c in row):
            rows_clean.append(row)

    if not rows_clean:
        return None, []

    if has_header:
        headers = rows_clean[0]
        data_rows = rows_clean[1:]
    else:
        headers = None
        data_rows = rows_clean

    return headers, data_rows


def _detect_header(first_row: List[str]) -> bool:
    norm_first = [normalize_header(c) for c in first_row]
    tokens = NAME_KEYS + PRICE_KEYS + CODE_KEYS + UNIT_KEYS
    return any(any(key in h for key in tokens) for h in norm_first)


def _find_header_row(rows: List[List[str]], scan_limit: int = 80):
    """
    Ищем строку-шапку в первых scan_limit строках.
    Шапка должна содержать хотя бы 'наименование' и 'цена'.
    Возвращаем: (headers, data_rows, header_index)
    """

    def has_any(norm_row, keys):
        for cell in norm_row:
            if not cell:
                continue
            for k in keys:
                if k in cell:
                    return True
        return False

    best_idx = None
    for i, row in enumerate(rows[:scan_limit]):
        norm = [normalize_header(c) for c in row]
        has_name = has_any(norm, NAME_KEYS)
        has_price = has_any(norm, PRICE_KEYS)
        if has_name and has_price:
            best_idx = i
            break

    if best_idx is None:
        return None, rows, None

    return rows[best_idx], rows[best_idx + 1 :], best_idx


def _excel_engine_for_ext(ext: str) -> str:
    ext = ext.lower()
    if ext in (".xlsx", ".xlsm"):
        return "openpyxl"
    if ext == ".xls":
        return "xlrd"
    raise ValueError(f"Unsupported Excel extension: {ext}")


def list_excel_sheets(path: str) -> List[str]:
    ext = os.path.splitext(path)[1].lower()
    if ext not in (".xlsx", ".xlsm", ".xls"):
        return []

    engine = _excel_engine_for_ext(ext)
    with open(path, "rb") as f:
        data = BytesIO(f.read())

    try:
        with pd.ExcelFile(data, engine=engine) as xls:
            return list(xls.sheet_names)
    except Exception as e:
        raise RuntimeError(f"Не удалось прочитать листы из файла: {e}") from e


def _looks_like_text_data(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            sample = f.read(4096)
    except OSError:
        return False

    if b"\x00" in sample:
        return False

    decoded = None
    for enc in ("utf-8-sig", "utf-8", "cp1251", "latin1"):
        try:
            decoded = sample.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    if decoded is None:
        return False

    if "\n" not in decoded and "\r" not in decoded:
        return False

    return any(d in decoded for d in (",", ";", "\t", "|"))


def load_excel_rows(file_path: str, ext: str, target_sheets: Optional[List[str]] = None):
    ext = ext.lower()
    if ext not in (".xlsx", ".xlsm", ".xls"):
        raise ValueError(f"Unsupported Excel extension: {ext}")

    engine = _excel_engine_for_ext(ext)

    with open(file_path, "rb") as f:
        data_buf = BytesIO(f.read())

    with pd.ExcelFile(data_buf, engine=engine) as xls:
        if target_sheets:
            sheets = [s for s in target_sheets if s in xls.sheet_names]
        else:
            sheets = list(xls.sheet_names)

        if not sheets:
            return

        data = pd.read_excel(
            xls,
            sheet_name=sheets if len(sheets) != 1 else sheets[0],
            engine=engine,
            dtype=object,
            header=None,   # важно: не выбрасываем первую строку как "header"
        )
        if not isinstance(data, dict):
            data = {sheets[0]: data}

    for sname, df in data.items():
        if df is None:
            yield sname, []
            continue

        df = df.where(df.notna(), None)
        rows_raw = df.values.tolist()
        rows = []
        for r in rows_raw:
            row = _clean_row(r)
            if any(str(v).strip() for v in row):
                rows.append(row)
        yield sname, rows


def import_price_file(
    supplier_id: int,
    file_path: str,
    original_filename: Optional[str] = None,
    sheet_mode: str = "all",
    sheet_names: Optional[List[str]] = None,
) -> Dict[str, object]:
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Файл не найден: {file_path}")

    ext = os.path.splitext(file_path)[1].lower()
    if original_filename is None:
        original_filename = os.path.basename(file_path)
    if not ext and original_filename:
        ext = os.path.splitext(original_filename)[1].lower()

    stats: List[Dict[str, object]] = []
    total_imported = 0

    conn = connect_db()
    try:
        with conn.cursor() as cur:
            # поставщик должен существовать
            cur.execute("SELECT 1 FROM suppliers WHERE id=%s;", (supplier_id,))
            if not cur.fetchone():
                raise RuntimeError(f"Поставщик id={supplier_id} не найден")

            ensure_schema_compare(conn)

            # 1 поставщик = 1 прайс -> удаляем старое
            cur.execute("DELETE FROM supplier_items WHERE supplier_id=%s;", (supplier_id,))
            cur.execute("DELETE FROM price_list_files WHERE supplier_id=%s;", (supplier_id,))

            # регистрируем файл
            cur.execute(
                """
                INSERT INTO price_list_files (supplier_id, file_name, status, rows_imported)
                VALUES (%s, %s, 'importing', 0)
                RETURNING id;
                """,
                (supplier_id, original_filename),
            )
            file_id = cur.fetchone()[0]
            conn.commit()

        category_map = fetch_category_map(conn)

        def insert_batch(batch: List[Tuple]):
            nonlocal total_imported
            if not batch:
                return
            with conn.cursor() as cur2:
                execute_values(
                    cur2,
                    """
                    INSERT INTO supplier_items
                      (supplier_id, price_list_file_id, external_code, name_raw, unit, price, currency, is_active,
                       name_normalized, name_search, base_unit, base_qty, price_per_unit, category_id)
                    VALUES %s
                    """,
                    batch,
                    page_size=1000,
                )
            total_imported += len(batch)

        def process_rows(sheet_label: str, headers: Optional[List[str]], rows_iter):
            imported = 0
            skipped = 0

            col_map = detect_columns_by_header(headers) if headers else {"name": None, "code": None, "unit": None, "price": None}

            # набираем sample для уточнения
            sample_rows = []
            buffer_rows = []
            for _ in range(60):
                try:
                    r = next(rows_iter)
                    buffer_rows.append(r)
                    sample_rows.append(r)
                except StopIteration:
                    break

            col_map = detect_columns_by_sample(sample_rows[:50], col_map)
            if col_map["name"] is None or col_map["price"] is None:
                stats.append(
                    {
                        "sheet": sheet_label,
                        "imported": 0,
                        "skipped": 0,
                        "reason": "columns_not_detected",
                        "map": col_map,
                    }
                )
                return

            batch: List[Tuple] = []

            def row_to_tuple(row: List[str]) -> Optional[Tuple]:
                def get(idx):
                    if idx is None or idx >= len(row):
                        return None
                    v = row[idx]
                    v = "" if v is None else str(v).strip()
                    return v or None

                name_raw = get(col_map["name"])
                if not name_raw:
                    return None

                price_val = parse_price(get(col_map["price"]))
                if price_val is None:
                    return None

                code_raw = get(col_map["code"])
                unit_raw = get(col_map["unit"])

                name_norm = normalize_name(name_raw)
                name_search = generate_supplier_name_search(name_raw, unit_raw) or name_norm
                base_unit, base_qty, price_per_unit = compute_unit_metrics(name_raw, unit_raw, price_val)
                category_code = detect_category(name_raw)
                category_id = category_map.get(category_code) if category_code else None

                return (
                    supplier_id,
                    file_id,
                    code_raw,
                    name_raw,
                    unit_raw,
                    price_val,
                    "RUB",
                    True,
                    name_norm,
                    name_search,
                    base_unit,
                    base_qty,
                    price_per_unit,
                    category_id,
                )

            # сначала отрабатываем буфер
            for r in buffer_rows:
                tpl = row_to_tuple(r)
                if tpl is None:
                    skipped += 1
                    continue
                batch.append(tpl)
                imported += 1
                if len(batch) >= 1000:
                    insert_batch(batch)
                    conn.commit()
                    batch.clear()

            # затем поток
            for r in rows_iter:
                tpl = row_to_tuple(r)
                if tpl is None:
                    skipped += 1
                    continue
                batch.append(tpl)
                imported += 1
                if len(batch) >= 1000:
                    insert_batch(batch)
                    conn.commit()
                    batch.clear()

            if batch:
                insert_batch(batch)
                conn.commit()

            stats.append({"sheet": sheet_label, "imported": imported, "skipped": skipped, "reason": "ok", "map": col_map})

        # --- Excel ---
        if ext in (".xlsx", ".xlsm", ".xls"):
            try:
                available = list_excel_sheets(file_path)

                if sheet_mode == "selected" and sheet_names:
                    target = [s for s in sheet_names if s in available]
                else:
                    target = available  # auto = все листы

                for sname, rows in load_excel_rows(file_path, ext, target):
                    if not rows:
                        stats.append({"sheet": sname, "imported": 0, "skipped": 0, "reason": "empty"})
                        continue

                    headers, data_rows, header_idx = _find_header_row(rows)
                    process_rows(sname, headers, iter(data_rows))
            except Exception:
                if _looks_like_text_data(file_path):
                    headers, rows = load_from_csv(file_path)
                    if not rows:
                        stats.append({"sheet": "CSV (fallback)", "imported": 0, "skipped": 0, "reason": "empty"})
                    else:
                        process_rows("CSV (fallback)", headers, iter(rows))
                else:
                    raise

        # --- CSV ---
        else:
            headers, rows = load_from_csv(file_path)
            if not rows:
                stats.append({"sheet": "CSV", "imported": 0, "skipped": 0, "reason": "empty"})
            else:
                def rows_iter():
                    for r in rows:
                        yield r

                process_rows("CSV", headers, iter(rows_iter()))

        # финализация file record
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE price_list_files
                   SET status='imported',
                       rows_imported=%s,
                       error_message=NULL
                 WHERE id=%s
                """,
                (total_imported, file_id),
            )
            conn.commit()

        return {"imported": total_imported, "file_id": file_id, "stats": stats}

    except Exception as e:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE price_list_files SET status='error', error_message=%s WHERE supplier_id=%s ORDER BY id DESC LIMIT 1",
                    (str(e), supplier_id),
                )
                conn.commit()
        except Exception:
            pass
        raise
    finally:
        conn.close()


def main():
    p = argparse.ArgumentParser(description="Импорт прайса (CSV/XLSX) в supplier_items (bulk insert)")
    p.add_argument("--supplier", type=int, required=True, help="ID поставщика из suppliers")
    p.add_argument("--file", required=True, help="Путь к файлу прайса")
    p.add_argument("--sheet_mode", default="all", choices=["all", "selected"])
    p.add_argument("--sheets", default="", help="Список листов через запятую (если sheet_mode=selected)")
    args = p.parse_args()

    sheet_names = [s.strip() for s in (args.sheets or "").split(",") if s.strip()] or None
    res = import_price_file(
        supplier_id=args.supplier,
        file_path=args.file,
        original_filename=os.path.basename(args.file),
        sheet_mode=args.sheet_mode,
        sheet_names=sheet_names,
    )
    print(res)


if __name__ == "__main__":
    main()
