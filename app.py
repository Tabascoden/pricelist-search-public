#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
import math
import os
import re
import shutil
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import psycopg2
import psycopg2.extras
from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

import import_price
import pandas as pd

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
except Exception:
    Workbook = None  # fallback на CSV


APP_TITLE = os.getenv("APP_TITLE", "iirest")


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates")
    app.config["JSON_AS_ASCII"] = False
    app.url_map.strict_slashes = False

    max_mb = int(os.getenv("MAX_UPLOAD_MB", "50"))
    app.config["MAX_CONTENT_LENGTH"] = max_mb * 1024 * 1024

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
    TENDERS_UPLOAD_DIR = os.path.join(UPLOAD_DIR, "tenders")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(TENDERS_UPLOAD_DIR, exist_ok=True)

    def db_connect():
        return psycopg2.connect(
            host=os.getenv("DB_HOST", "127.0.0.1"),
            port=int(os.getenv("DB_PORT", "5432")),
            dbname=os.getenv("DB_NAME", "smartproc"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD", ""),
            connect_timeout=5,
            options="-c statement_timeout=12000",
        )

    def _json_safe(v):
        if isinstance(v, Decimal):
            return float(v)
        return v

    def _scalar(row, key=None):
        if row is None:
            return None
        if isinstance(row, dict):
            if key and key in row:
                return row[key]
            if len(row) == 1:
                return next(iter(row.values()))
            raise KeyError(f"Expected key '{key}' in row {row.keys()}")
        return row[0]

    def _safe_remove(path: Optional[str]):
        try:
            if path and os.path.isfile(path) and os.path.exists(path):
                os.remove(path)
        except Exception:
            pass

    def _safe_rmtree(path: Optional[str]):
        try:
            if path and os.path.isdir(path) and os.path.exists(path):
                shutil.rmtree(path, ignore_errors=True)
        except Exception:
            pass

    def run_migrations():
        if os.getenv("AUTO_MIGRATE") != "1":
            return

        migrations_dir = Path(BASE_DIR) / "db" / "migrations"
        if not migrations_dir.is_dir():
            app.logger.info("Migrations dir not found, skipping auto-migrate")
            return

        lock_key = 726332019
        try:
            with db_connect() as conn:
                conn.autocommit = False
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS schema_migrations(
                          filename text PRIMARY KEY,
                          applied_at timestamptz DEFAULT now()
                        );
                        """
                    )
                    cur.execute("SELECT pg_advisory_lock(%s);", (lock_key,))

                try:
                    with conn.cursor() as cur:
                        cur.execute("SELECT filename FROM schema_migrations;")
                        applied = {row[0] for row in cur.fetchall()}

                    for path in sorted(migrations_dir.glob("*.sql"), key=lambda p: p.name):
                        fname = path.name
                        if fname in applied:
                            app.logger.info("Migration %s already applied, skipping", fname)
                            continue

                        sql = path.read_text(encoding="utf-8")
                        try:
                            with conn.cursor() as cur:
                                cur.execute(sql)
                                cur.execute(
                                    "INSERT INTO schema_migrations(filename) VALUES (%s);",
                                    (fname,),
                                )
                            conn.commit()
                            app.logger.info("Applied migration %s", fname)
                        except Exception:
                            conn.rollback()
                            app.logger.exception("Failed to apply migration %s", fname)
                            raise
                finally:
                    with conn.cursor() as cur:
                        cur.execute("SELECT pg_advisory_unlock(%s);", (lock_key,))
                    conn.commit()
        except Exception:
            app.logger.exception("Auto-migrate failed")

    def ensure_schema(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS supplier_uploads (
                  supplier_id integer PRIMARY KEY,
                  last_uploaded_at timestamptz NOT NULL,
                  last_filename text,
                  storage_path text
                );
                """
            )
            # доп. колонки (безопасно)
            cur.execute("ALTER TABLE supplier_uploads ADD COLUMN IF NOT EXISTS last_sheet_mode text;")
            cur.execute("ALTER TABLE supplier_uploads ADD COLUMN IF NOT EXISTS last_sheets text;")
        conn.commit()

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

                CREATE TABLE IF NOT EXISTS category_rules (
                  id serial PRIMARY KEY,
                  category_id int REFERENCES categories(id),
                  pattern text
                );

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
                  category_id int REFERENCES categories(id),
                  selected_offer_id int
                );

                CREATE TABLE IF NOT EXISTS tender_offers (
                  id serial PRIMARY KEY,
                  tender_item_id int REFERENCES tender_items(id) ON DELETE CASCADE,
                  offer_type text,
                  supplier_id int REFERENCES suppliers(id),
                  supplier_item_id int REFERENCES supplier_items(id),
                  supplier_name text,
                  name_raw text,
                  unit text,
                  price numeric(12,4),
                  base_unit text,
                  base_qty numeric(12,6),
                  price_per_unit numeric(12,4),
                  category_id int REFERENCES categories(id),
                  created_at timestamptz DEFAULT now()
                );
                """
            )

            cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_normalized text;")
            cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_unit text;")
            cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS base_qty numeric(12,6);")
            cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS price_per_unit numeric(12,4);")
            cur.execute(
                "ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_id int REFERENCES categories(id);"
            )
            cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS category_path text;")

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_supplier_items_name_norm_trgm
                  ON supplier_items USING gin (coalesce(name_normalized, name_raw) gin_trgm_ops);
                """
            )

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

    def get_category_map(conn) -> Dict[str, int]:
        ensure_schema_compare(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT id, code FROM categories;")
            rows = cur.fetchall()
        return {code: cid for cid, code in rows}

    def normalize_category_value(val: Optional[str]) -> Optional[str]:
        if val is None:
            return None
        v = str(val).strip().lower()
        if not v:
            return None
        mapper = {
            "fresh": "fresh",
            "свеж": "fresh",
            "консерв": "canned",
            "марин": "canned",
            "солен": "canned",
            "вялен": "canned",
            "замороз": "frozen",
            "frozen": "frozen",
        }
        for k, code in mapper.items():
            if k in v:
                return code
        return v if v in ("fresh", "canned", "frozen") else None

    # пробуем подготовить схему на старте
    try:
        run_migrations()
        with db_connect() as conn:
            ensure_schema(conn)
            ensure_schema_compare(conn)
    except Exception:
        pass

    # ---------------- Pages ----------------
    @app.route("/", methods=["GET"])
    @app.route("/ui", methods=["GET"])
    def page_search():
        return render_template("search.html", title=APP_TITLE, active="search")

    @app.route("/cart", methods=["GET"])
    def page_cart():
        return render_template("cart.html", title=f"{APP_TITLE} — Корзина", active="cart")

    @app.route("/lists", methods=["GET"])
    def page_lists():
        return render_template("lists.html", title=f"{APP_TITLE} — Поставщики", active="lists")

    @app.route("/tenders", methods=["GET"])
    def page_tenders():
        return render_template("tenders.html", title=f"{APP_TITLE} — Тендеры", active="tenders")

    @app.route("/tenders/<int:project_id>", methods=["GET"])
    def page_tender_detail(project_id: int):
        return render_template(
            "tender_project.html", title=f"{APP_TITLE} — Тендер #{project_id}", active="tenders", project_id=project_id
        )

    @app.route("/favicon.ico", methods=["GET"])
    def favicon():
        return ("", 204)

    # ---------------- Health ----------------
    @app.route("/health", methods=["GET"])
    def health():
        try:
            with db_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("select 1;")
                    cur.fetchone()
            return jsonify({"status": "ok", "db": "ok"})
        except Exception as e:
            return jsonify({"status": "ok", "db": "error", "details": str(e)}), 200

    # ---------------- API: suppliers ----------------
    @app.route("/api/suppliers", methods=["GET"])
    def api_suppliers():
        try:
            with db_connect() as conn:
                ensure_schema(conn)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT
                          s.id,
                          s.name,
                          su.last_uploaded_at,
                          su.last_filename,
                          su.last_sheet_mode,
                          su.last_sheets,
                          COALESCE(pl.rows_imported, 0) AS rows_imported
                        FROM suppliers s
                        LEFT JOIN supplier_uploads su ON su.supplier_id = s.id
                        LEFT JOIN LATERAL (
                          SELECT rows_imported
                          FROM price_list_files
                          WHERE supplier_id = s.id
                          ORDER BY id DESC
                          LIMIT 1
                        ) pl ON TRUE
                        ORDER BY s.name NULLS LAST, s.id;
                        """
                    )
                    rows = cur.fetchall()
            suppliers = [{k: _json_safe(v) for k, v in dict(r).items()} for r in rows]
            return jsonify({"suppliers": suppliers})
        except Exception as e:
            app.logger.exception("Failed to create tender project")
            return jsonify(
                {"error": "failed to create tender project", "details": str(e)}
            ), 500

    @app.route("/api/suppliers", methods=["POST"])
    def api_create_supplier():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        try:
            with db_connect() as conn:
                ensure_schema(conn)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute("INSERT INTO suppliers(name) VALUES (%s) RETURNING id, name;", (name,))
                    row = cur.fetchone()
                conn.commit()
            return jsonify({"supplier": dict(row)})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    # ---------------- API: tenders ----------------
    def _calc_offer_totals(offer: Dict[str, Any], tender_qty: Optional[Any]):
        total_price = None
        packs_needed = None

        try:
            qty = float(tender_qty)
        except Exception:
            qty = None

        try:
            base_qty = float(offer.get("base_qty")) if offer.get("base_qty") is not None else None
        except Exception:
            base_qty = None

        try:
            ppu = float(offer.get("price_per_unit")) if offer.get("price_per_unit") is not None else None
        except Exception:
            ppu = None

        try:
            price_val = float(offer.get("price")) if offer.get("price") is not None else None
        except Exception:
            price_val = None

        if qty is not None and base_qty and base_qty > 0:
            packs_needed = math.ceil(qty / base_qty)

        if qty is not None and ppu is not None:
            total_price = ppu * qty
        elif packs_needed is not None and price_val is not None:
            total_price = packs_needed * price_val

        return total_price, packs_needed

    def _load_project(conn, project_id: int):
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, title, created_at FROM tender_projects WHERE id=%s;",
                (project_id,),
            )
            project = cur.fetchone()
            if not project:
                return None

            cur.execute(
                """
                SELECT ti.id, ti.project_id, ti.row_no, ti.name_input, ti.qty, ti.unit_input, ti.category_id, ti.selected_offer_id
                FROM tender_items ti
                WHERE ti.project_id=%s
                ORDER BY ti.row_no ASC, ti.id ASC;
                """,
                (project_id,),
            )
            items = [dict(r) for r in cur.fetchall()]

            cur.execute(
                """
                SELECT toff.*
                FROM tender_offers toff
                WHERE toff.tender_item_id = ANY(%s)
                ORDER BY CASE WHEN toff.offer_type='selected' THEN 0 WHEN toff.offer_type='final' THEN 1 ELSE 2 END,
                         toff.price_per_unit ASC NULLS LAST,
                         toff.id DESC;
                """,
                ([it["id"] for it in items] or [0],),
            )
            offers = [dict(r) for r in cur.fetchall()]
        offers_by_item: Dict[int, List[Dict[str, Any]]] = {}
        for off in offers:
            offers_by_item.setdefault(off["tender_item_id"], []).append(off)
        for it in items:
            enriched_offers: List[Dict[str, Any]] = []
            for off in offers_by_item.get(it["id"], []):
                total_price, packs_needed = _calc_offer_totals(off, it.get("qty"))
                enriched = dict(off)
                if total_price is not None:
                    enriched["total_price"] = total_price
                if packs_needed is not None:
                    enriched["packs_needed"] = packs_needed
                enriched["tender_qty"] = it.get("qty")
                enriched_offers.append(enriched)
            it["offers"] = enriched_offers
        project_dict = dict(project)
        project_dict["items"] = items
        return project_dict

    @app.route("/api/tenders", methods=["GET"])
    def api_tenders_list():
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT tp.id, tp.title, tp.created_at,
                          (SELECT count(*) FROM tender_items ti WHERE ti.project_id = tp.id) AS items_count
                        FROM tender_projects tp
                        ORDER BY tp.created_at DESC, tp.id DESC;
                        """
                    )
                    rows = cur.fetchall()
            return jsonify({"projects": [dict(r) for r in rows]})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    @app.route("/api/tenders", methods=["POST"])
    def api_tenders_create():
        upload = request.files.get("file")
        if not upload:
            return jsonify({"error": "file is required"}), 400
        title = (request.form.get("title") or upload.filename or "Тендер").strip() or "Тендер"
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                category_map = get_category_map(conn)
                df = pd.read_excel(upload.stream)
                cols = {str(c).strip().lower(): idx for idx, c in enumerate(df.columns)}

                def pick(*names):
                    for n in names:
                        if n in cols:
                            return cols[n]
                    return None

                idx_name = pick("наименование", "name", "товар", "product")
                if idx_name is None:
                    return jsonify({"error": "Колонка 'Наименование' не найдена"}), 400
                idx_qty = pick("кол-во", "количество", "qty", "quantity")
                idx_unit = pick("ед", "единица", "unit", "ед.")
                idx_cat = pick("категория", "category")

                with conn.cursor() as cur:
                    cur.execute("INSERT INTO tender_projects(title) VALUES (%s) RETURNING id;", (title,))
                    pid = _scalar(cur.fetchone(), "id")

                    items_to_insert = []
                    for i, row in enumerate(df.itertuples(index=False), start=1):
                        row_list = list(row)
                        name_val = str(row_list[idx_name]).strip() if idx_name is not None else ""
                        if not name_val:
                            continue
                        qty_val = None
                        if idx_qty is not None and idx_qty < len(row_list):
                            try:
                                qty_val = float(row_list[idx_qty]) if row_list[idx_qty] not in (None, "") else None
                            except Exception:
                                qty_val = None
                        unit_val = None
                        if idx_unit is not None and idx_unit < len(row_list):
                            unit_val = str(row_list[idx_unit]).strip() or None
                        cat_val = None
                        if idx_cat is not None and idx_cat < len(row_list):
                            cat_val = normalize_category_value(row_list[idx_cat])
                        category_id = category_map.get(cat_val) if cat_val else None
                        items_to_insert.append((pid, i, name_val, qty_val, unit_val, category_id))

                    if items_to_insert:
                        psycopg2.extras.execute_values(
                            cur,
                            """
                            INSERT INTO tender_items(project_id, row_no, name_input, qty, unit_input, category_id)
                            VALUES %s
                            """,
                            items_to_insert,
                        )
                    conn.commit()

                with db_connect() as conn2:
                    proj = _load_project(conn2, pid)
                return jsonify({"project": proj})
        except Exception as e:
            app.logger.exception("Failed to create tender project")
            return jsonify(
                {"error": "failed to create tender project", "details": str(e)}
            ), 500

    @app.route("/api/tenders/<int:project_id>", methods=["GET"])
    def api_tenders_get(project_id: int):
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                proj = _load_project(conn, project_id)
            if not proj:
                return jsonify({"error": "not found"}), 404
            proj["items"] = [
                {k: _json_safe(v) for k, v in it.items()} if isinstance(it, dict) else it for it in proj.get("items", [])
            ]
            for it in proj.get("items", []):
                if isinstance(it, dict) and "offers" in it:
                    it["offers"] = [{k: _json_safe(v) for k, v in off.items()} for off in it["offers"]]
            return jsonify({"project": proj})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    @app.route("/api/tenders/<int:project_id>", methods=["DELETE"])
    def api_tenders_delete(project_id: int):
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM tender_projects WHERE id=%s RETURNING id;", (project_id,))
                    if not cur.fetchone():
                        return jsonify({"error": "not found"}), 404
                conn.commit()
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    def _snapshot_offer(row: Dict[str, Any], supplier_name: str, category_id: Optional[int]):
        return {
            "supplier_id": row.get("supplier_id"),
            "supplier_item_id": row.get("id"),
            "supplier_name": supplier_name,
            "name_raw": row.get("name_raw"),
            "unit": row.get("unit"),
            "price": row.get("price"),
            "base_unit": row.get("base_unit"),
            "base_qty": row.get("base_qty"),
            "price_per_unit": row.get("price_per_unit"),
            "category_id": category_id or row.get("category_id"),
        }

    @app.route("/api/tenders/items/<int:item_id>/select", methods=["POST"])
    def api_tenders_select(item_id: int):
        data = request.get_json(silent=True) or {}
        supplier_item_id = data.get("supplier_item_id")
        tender_item_id = data.get("tender_item_id")
        project_id = data.get("project_id")
        row_no = data.get("row_no")

        if tender_item_id is None:
            return jsonify({"error": "tender_item_id is required"}), 400
        if supplier_item_id is None:
            return jsonify({"error": "supplier_item_id is required"}), 400
        if project_id is None:
            return jsonify({"error": "project_id is required"}), 400

        try:
            supplier_item_id = int(supplier_item_id)
            tender_item_id = int(tender_item_id)
            project_id = int(project_id)
        except Exception:
            return jsonify({"error": "invalid ids"}), 400

        if item_id != tender_item_id:
            return jsonify({"error": "path tender item mismatch"}), 400

        try:
            row_no = int(row_no) if row_no is not None else None
        except Exception:
            row_no = None
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id, project_id, row_no, qty, unit_input, category_id, name_input
                        FROM tender_items
                        WHERE id=%s AND project_id=%s;
                        """,
                        (tender_item_id, project_id),
                    )
                    item = cur.fetchone()
                    if not item and row_no is not None:
                        cur.execute(
                            """
                            SELECT id, project_id, row_no, qty, unit_input, category_id, name_input
                            FROM tender_items
                            WHERE project_id=%s AND row_no=%s
                            ORDER BY id ASC
                            LIMIT 1;
                            """,
                            (project_id, row_no),
                        )
                        item = cur.fetchone()
                        if item:
                            tender_item_id = item["id"]
                    if not item:
                        return jsonify({"error": "tender item not found"}), 404

                    cur.execute(
                        """
                        SELECT si.id, si.supplier_id, s.name AS supplier_name, si.name_raw, si.unit, si.price, si.base_unit, si.base_qty,
                               si.price_per_unit, si.category_id, coalesce(si.name_normalized, si.name_raw) AS norm
                        FROM supplier_items si
                        JOIN suppliers s ON s.id = si.supplier_id
                        WHERE si.id=%s;
                        """,
                        (supplier_item_id,),
                    )
                    base = cur.fetchone()
                    if not base:
                        return jsonify({"error": "supplier item not found"}), 404

                    snap = _snapshot_offer(base, base["supplier_name"], item.get("category_id"))

                    cur.execute(
                        "SELECT id FROM tender_offers WHERE tender_item_id=%s AND supplier_item_id=%s LIMIT 1;",
                        (tender_item_id, supplier_item_id),
                    )
                    existing_selected = cur.fetchone()

                    if existing_selected:
                        cur.execute(
                            """
                            UPDATE tender_offers
                            SET offer_type='selected', supplier_id=%(supplier_id)s, supplier_name=%(supplier_name)s,
                                name_raw=%(name_raw)s, unit=%(unit)s, price=%(price)s, base_unit=%(base_unit)s,
                                base_qty=%(base_qty)s, price_per_unit=%(price_per_unit)s, category_id=%(category_id)s
                            WHERE id=%(id)s
                            RETURNING id;
                            """,
                            {"id": existing_selected["id"], **snap},
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO tender_offers
                              (tender_item_id, offer_type, supplier_id, supplier_item_id, supplier_name, name_raw, unit, price, base_unit, base_qty, price_per_unit, category_id)
                            VALUES (%(item_id)s, 'selected', %(supplier_id)s, %(supplier_item_id)s, %(supplier_name)s, %(name_raw)s, %(unit)s,
                                    %(price)s, %(base_unit)s, %(base_qty)s, %(price_per_unit)s, %(category_id)s)
                            RETURNING id;
                            """,
                            {"item_id": tender_item_id, **snap},
                        )
                    selected_id = _scalar(cur.fetchone(), "id")

                    params = {
                        "category_id": item.get("category_id") or base.get("category_id"),
                        "norm": base.get("norm"),
                        "item_id": base["id"],
                    }
                    where = ["si.is_active IS TRUE", "si.id <> %(item_id)s"]
                    if params["category_id"]:
                        where.append("si.category_id = %(category_id)s")
                    sql_alt = f"""
                        SELECT si.id, si.supplier_id, s.name AS supplier_name, si.name_raw, si.unit, si.price, si.base_unit, si.base_qty,
                               si.price_per_unit, si.category_id
                        FROM supplier_items si
                        JOIN suppliers s ON s.id = si.supplier_id
                        WHERE {' AND '.join(where)}
                        ORDER BY si.price_per_unit ASC NULLS LAST, si.id DESC
                        LIMIT 15;
                    """
                    cur.execute(sql_alt, params)
                    alts = cur.fetchall()
                    alt_ids: List[int] = []
                    for alt in alts:
                        snap_alt = _snapshot_offer(alt, alt["supplier_name"], item.get("category_id"))
                        cur.execute(
                            "SELECT id FROM tender_offers WHERE tender_item_id=%s AND supplier_item_id=%s LIMIT 1;",
                            (tender_item_id, alt["id"]),
                        )
                        existing_alt = cur.fetchone()
                        if existing_alt:
                            cur.execute(
                                """
                                UPDATE tender_offers
                                SET offer_type='alternative', supplier_id=%(supplier_id)s, supplier_name=%(supplier_name)s,
                                    name_raw=%(name_raw)s, unit=%(unit)s, price=%(price)s, base_unit=%(base_unit)s,
                                    base_qty=%(base_qty)s, price_per_unit=%(price_per_unit)s, category_id=%(category_id)s
                                WHERE id=%(id)s
                                RETURNING id;
                                """,
                                {"id": existing_alt["id"], **snap_alt},
                            )
                        else:
                            cur.execute(
                                """
                                INSERT INTO tender_offers
                                  (tender_item_id, offer_type, supplier_id, supplier_item_id, supplier_name, name_raw, unit, price, base_unit, base_qty, price_per_unit, category_id)
                                VALUES (%(item_id)s, 'alternative', %(supplier_id)s, %(supplier_item_id)s, %(supplier_name)s, %(name_raw)s, %(unit)s,
                                        %(price)s, %(base_unit)s, %(base_qty)s, %(price_per_unit)s, %(category_id)s)
                                RETURNING id;
                                """,
                                {"item_id": tender_item_id, **snap_alt},
                            )
                        alt_ids.append(_scalar(cur.fetchone(), "id"))

                    cur.execute(
                        """
                        DELETE FROM tender_offers
                        WHERE tender_item_id=%s AND offer_type='alternative' AND id <> ALL(%s);
                        """,
                        (tender_item_id, alt_ids or [0]),
                    )

                    cur.execute(
                        "UPDATE tender_items SET selected_offer_id=%s WHERE id=%s;",
                        (selected_id, tender_item_id),
                    )
                conn.commit()
            return jsonify({"ok": True, "selected_offer_id": selected_id})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    @app.route("/api/tenders/items/<int:item_id>/offers", methods=["GET"])
    def api_tenders_offers(item_id: int):
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                cur.execute(
                    """
                    SELECT ti.project_id, ti.id, ti.name_input FROM tender_items ti WHERE ti.id=%s;
                    """,
                    (item_id,),
                )
                item = cur.fetchone()
                if not item:
                    return jsonify({"error": "not found"}), 404
                cur.execute(
                    "SELECT * FROM tender_offers WHERE tender_item_id=%s ORDER BY created_at DESC;",
                    (item_id,),
                )
                offers = [dict(r) for r in cur.fetchall()]
            return jsonify({"item": dict(item), "offers": offers})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    @app.route("/api/tenders/items/<int:item_id>/finalize", methods=["POST"])
    def api_tenders_finalize(item_id: int):
        data = request.get_json(silent=True) or {}
        offer_id = data.get("offer_id")
        if not offer_id:
            return jsonify({"error": "offer_id is required"}), 400
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT project_id FROM tender_items WHERE id=%s;",
                        (item_id,),
                    )
                    row = cur.fetchone()
                    if not row:
                        return jsonify({"error": "not found"}), 404
                    cur.execute(
                        "UPDATE tender_offers SET offer_type='final' WHERE id=%s AND tender_item_id=%s;",
                        (offer_id, item_id),
                    )
                    cur.execute(
                        "UPDATE tender_items SET selected_offer_id=%s WHERE id=%s;",
                        (offer_id, item_id),
                    )
                conn.commit()
            return jsonify({"status": "ok"})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    @app.route("/api/tenders/<int:project_id>/export", methods=["POST"])
    def api_tenders_export(project_id: int):
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                proj = _load_project(conn, project_id)
                if not proj:
                    return jsonify({"error": "not found"}), 404
                rows: List[List[Any]] = []
                for it in proj.get("items", []):
                    final_offer = None
                    for off in it.get("offers", []):
                        if off.get("offer_type") == "final" or off.get("id") == it.get("selected_offer_id"):
                            final_offer = off
                            break
                    rows.append([it.get("row_no"), it.get("name_input"), it.get("qty"), it.get("unit_input"), it.get("category_id"), final_offer])

                headers = [
                    "№ строки",
                    "Номенклатура",
                    "Кол-во",
                    "Ед.",
                    "Категория",
                    "Поставщик",
                    "Товар",
                    "Ед. прайса",
                    "Цена",
                    "Базовая ед.",
                    "Баз. кол-во",
                    "Цена за баз. ед.",
                    "Сумма",
                ]

                if Workbook is None:
                    out = BytesIO()
                    writer = csv.writer(out)
                    writer.writerow(headers)
                    for r in rows:
                        offer = r[5] or {}
                        sum_val = None
                        try:
                            if r[2] and offer.get("price_per_unit") and offer.get("base_qty"):
                                sum_val = float(r[2]) * float(offer.get("price_per_unit")) * float(offer.get("base_qty"))
                        except Exception:
                            sum_val = None
                        writer.writerow(
                            [
                                r[0],
                                r[1],
                                r[2],
                                r[3],
                                r[4],
                                offer.get("supplier_name"),
                                offer.get("name_raw"),
                                offer.get("unit"),
                                offer.get("price"),
                                offer.get("base_unit"),
                                offer.get("base_qty"),
                                offer.get("price_per_unit"),
                                sum_val,
                            ]
                        )
                    out.seek(0)
                    return send_file(out, mimetype="text/csv", as_attachment=True, download_name="tender.csv")

                wb = Workbook()
                ws = wb.active
                ws.title = "Тендер"
                ws.append(headers)
                for c in ws[1]:
                    c.font = Font(bold=True)
                    c.alignment = Alignment(vertical="center")
                for r in rows:
                    offer = r[5] or {}
                    sum_val = None
                    try:
                        if r[2] and offer.get("price_per_unit") and offer.get("base_qty"):
                            sum_val = float(r[2]) * float(offer.get("price_per_unit")) * float(offer.get("base_qty"))
                    except Exception:
                        sum_val = None
                    ws.append(
                        [
                            r[0],
                            r[1],
                            r[2],
                            r[3],
                            r[4],
                            offer.get("supplier_name"),
                            offer.get("name_raw"),
                            offer.get("unit"),
                            offer.get("price"),
                            offer.get("base_unit"),
                            offer.get("base_qty"),
                            offer.get("price_per_unit"),
                            sum_val,
                        ]
                    )
                bio = BytesIO()
                wb.save(bio)
                bio.seek(0)
                return send_file(
                    bio,
                    mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    as_attachment=True,
                    download_name=f"tender_{project_id}.xlsx",
                )
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    @app.route("/api/suppliers/<int:supplier_id>", methods=["DELETE"])
    def api_delete_supplier(supplier_id: int):
        stored_path = None
        sup_dir = os.path.join(UPLOAD_DIR, str(supplier_id))
        try:
            with db_connect() as conn:
                ensure_schema(conn)

                with conn.cursor() as cur:
                    cur.execute("SELECT 1 FROM suppliers WHERE id=%s;", (supplier_id,))
                    if not cur.fetchone():
                        return jsonify({"error": "supplier not found"}), 404

                # запрет на удаление, если есть позиции в заказах
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT count(*)::int
                        FROM order_items oi
                        JOIN supplier_items si ON si.id = oi.supplier_item_id
                        WHERE si.supplier_id = %s;
                        """,
                        (supplier_id,),
                    )
                    cnt = _scalar(cur.fetchone())
                    if cnt and cnt > 0:
                        return jsonify(
                            {
                                "error": "supplier has order_items",
                                "details": f"Нельзя удалить: есть позиции в заказах ({cnt}).",
                            }
                        ), 409

                with conn.cursor() as cur:
                    cur.execute("SELECT storage_path FROM supplier_uploads WHERE supplier_id=%s;", (supplier_id,))
                    r = cur.fetchone()
                    if r:
                        stored_path = r[0]

                # чистим зависимости (1 поставщик = 1 прайс)
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM supplier_items WHERE supplier_id=%s;", (supplier_id,))
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM price_list_files WHERE supplier_id=%s;", (supplier_id,))
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM supplier_uploads WHERE supplier_id=%s;", (supplier_id,))
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM suppliers WHERE id=%s;", (supplier_id,))

                conn.commit()

            _safe_remove(stored_path)
            _safe_rmtree(sup_dir)
            return jsonify({"status": "ok", "supplier_id": supplier_id})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    # ---------------- API: list sheets ----------------
    @app.route("/api/sheets", methods=["POST"])
    def api_sheets():
        if "file" not in request.files:
            return jsonify({"error": "file is required"}), 400
        f = request.files["file"]
        if not f or not f.filename:
            return jsonify({"error": "empty filename"}), 400

        raw_filename = os.path.basename(f.filename or "")
        ext = os.path.splitext(raw_filename)[1].lower()
        if ext not in (".xlsx", ".xlsm", ".xls"):
            return jsonify({"error": "unsupported format", "details": "Неподдерживаемый формат. Загрузите .xlsx или .xls"}), 400

        name = f"upload_{uuid4().hex}{ext}"

        tmp_path = os.path.join(UPLOAD_DIR, f"__tmp_sheets__{os.getpid()}_{name}")
        f.save(tmp_path)
        try:
            sheets = import_price.list_excel_sheets(tmp_path)
            return jsonify({"sheets": sheets})
        except Exception as e:
            return jsonify({"error": "failed to read sheets", "details": str(e)}), 400
        finally:
            _safe_remove(tmp_path)

    # ---------------- API: upload (auto / selected sheets) ----------------
    @app.route("/api/upload/<int:supplier_id>", methods=["POST"])
    def api_upload(supplier_id: int):
        if "file" not in request.files:
            return jsonify({"error": "file is required"}), 400
        f = request.files["file"]
        if not f or not f.filename:
            return jsonify({"error": "empty filename"}), 400

        sheet_mode = (request.form.get("sheet_mode") or "all").strip()
        sheets_raw = (request.form.get("sheets") or "").strip()

        # sheets можно передавать CSV строкой или JSON-массивом
        sheet_names: List[str] = []
        if sheets_raw:
            try:
                j = json.loads(sheets_raw)
                if isinstance(j, list):
                    sheet_names = [str(x).strip() for x in j if str(x).strip()]
                else:
                    sheet_names = [s.strip() for s in sheets_raw.split(",") if s.strip()]
            except Exception:
                sheet_names = [s.strip() for s in sheets_raw.split(",") if s.strip()]

        raw_filename = os.path.basename(f.filename or "")
        ext = os.path.splitext(raw_filename)[1].lower()
        allowed_exts = {".xlsx", ".xlsm", ".xls", ".csv"}
        if ext not in allowed_exts:
            return jsonify({"error": "unsupported format", "details": "Неподдерживаемый формат. Загрузите .xlsx или .xls"}), 400

        original = raw_filename or f"upload_{uuid4().hex}{ext}"

        # куда сохраняем
        sup_dir = os.path.join(UPLOAD_DIR, str(supplier_id))
        os.makedirs(sup_dir, exist_ok=True)

        storage_name = f"upload_{uuid4().hex}{ext}"
        dst_path = os.path.join(sup_dir, secure_filename(storage_name))
        base, ext = os.path.splitext(dst_path)
        i = 1
        while os.path.exists(dst_path):
            dst_path = f"{base}({i}){ext}"
            i += 1

        f.save(dst_path)

        old_path = None
        try:
            with db_connect() as conn:
                ensure_schema(conn)
                with conn.cursor() as cur:
                    cur.execute("SELECT storage_path FROM supplier_uploads WHERE supplier_id=%s;", (supplier_id,))
                    r = cur.fetchone()
                    if r:
                        old_path = r[0]

            # импорт в БД
            result = import_price.import_price_file(
                supplier_id=supplier_id,
                file_path=dst_path,
                original_filename=original,
                sheet_mode=sheet_mode,
                sheet_names=sheet_names,
            )

            # записываем мету
            with db_connect() as conn:
                ensure_schema(conn)
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO supplier_uploads (supplier_id, last_uploaded_at, last_filename, storage_path, last_sheet_mode, last_sheets)
                        VALUES (%s, NOW(), %s, %s, %s, %s)
                        ON CONFLICT (supplier_id) DO UPDATE SET
                          last_uploaded_at = EXCLUDED.last_uploaded_at,
                          last_filename = EXCLUDED.last_filename,
                          storage_path = EXCLUDED.storage_path,
                          last_sheet_mode = EXCLUDED.last_sheet_mode,
                          last_sheets = EXCLUDED.last_sheets;
                        """,
                        (
                            supplier_id,
                            original,
                            dst_path,
                            sheet_mode,
                            ",".join(sheet_names) if sheet_names else None,
                        ),
                    )
                conn.commit()

            # удаляем старый файл (по требованию: 1 файл на поставщика)
            if old_path and os.path.abspath(old_path) != os.path.abspath(dst_path):
                _safe_remove(old_path)

            return jsonify(
                {
                    "status": "ok",
                    "supplier_id": supplier_id,
                    "filename": original,
                    **result,
                }
            )
        except Exception as e:
            app.logger.exception("Failed to import upload for supplier %s", supplier_id)
            # если импорт упал — файл оставляем (чтобы можно было скачать/проверить), но можно удалить:
            # _safe_remove(dst_path)
            return jsonify({"error": "upload/import failed", "details": "Ошибка загрузки: не удалось прочитать файл"}), 500

    # ---------------- Search ----------------
    @app.route("/search", methods=["GET"])
    def search():
        q = (request.args.get("q") or "").strip()
        supplier_id = (request.args.get("supplier_id") or "").strip()
        sort = (request.args.get("sort") or "rank").strip()
        limit = request.args.get("limit") or "60"
        category_ids_raw = request.args.get("category_ids") or request.args.get("category_id")

        try:
            limit_i = int(limit)
        except Exception:
            limit_i = 60
        limit_i = max(1, min(limit_i, 300))

        params: Dict[str, Any] = {"limit": limit_i}
        where = ["si.is_active IS TRUE"]

        if category_ids_raw:
            try:
                cids = [int(c) for c in str(category_ids_raw).split(",") if str(c).strip()]
            except Exception:
                cids = []
            if cids:
                params["category_ids"] = tuple(cids)
                where.append("si.category_id = ANY(%(category_ids)s)")

        if supplier_id:
            params["supplier_id"] = int(supplier_id)
            where.append("si.supplier_id = %(supplier_id)s")

        # whitelist сортировки
        if sort not in ("rank", "price_asc", "price_desc", "ppu_asc"):
            sort = "rank"

        if q:
            params["q"] = q
            order_by = {
                "rank": "rank DESC, si.price ASC NULLS LAST, si.id DESC",
                "price_asc": "si.price ASC NULLS LAST, rank DESC, si.id DESC",
                "price_desc": "si.price DESC NULLS LAST, rank DESC, si.id DESC",
                "ppu_asc": "si.price_per_unit ASC NULLS LAST, rank DESC, si.id DESC",
            }[sort]

            sql = f"""
                SELECT
                  si.id,
                  si.supplier_id,
                  s.name AS supplier_name,
                  si.name_raw,
                  si.unit,
                  si.price,
                  si.base_unit,
                  si.base_qty,
                  si.price_per_unit,
                  si.category_id,
                  ts_rank(to_tsvector('russian', si.name_raw),
                          websearch_to_tsquery('russian', %(q)s)) AS rank
                FROM supplier_items si
                JOIN suppliers s ON s.id = si.supplier_id
                WHERE {" AND ".join(where)}
                  AND (
                    to_tsvector('russian', si.name_raw) @@ websearch_to_tsquery('russian', %(q)s)
                    OR si.name_raw ILIKE '%%' || %(q)s || '%%'
                  )
                ORDER BY {order_by}
                LIMIT %(limit)s;
            """
        else:
            order_by = {
                "rank": "si.id DESC",
                "price_asc": "si.price ASC NULLS LAST, si.id DESC",
                "price_desc": "si.price DESC NULLS LAST, si.id DESC",
                "ppu_asc": "si.price_per_unit ASC NULLS LAST, si.id DESC",
            }[sort]

            sql = f"""
                SELECT
                  si.id,
                  si.supplier_id,
                  s.name AS supplier_name,
                  si.name_raw,
                  si.unit,
                  si.price,
                  si.base_unit,
                  si.base_qty,
                  si.price_per_unit,
                  si.category_id,
                  0.0::float AS rank
                FROM supplier_items si
                JOIN suppliers s ON s.id = si.supplier_id
                WHERE {" AND ".join(where)}
                ORDER BY {order_by}
                LIMIT %(limit)s;
            """

        try:
            with db_connect() as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(sql, params)
                    rows = cur.fetchall()
            items = [{k: _json_safe(v) for k, v in dict(r).items()} for r in rows]
            return jsonify({"q": q, "items": items})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    # ---------------- Export order to XLSX/CSV ----------------
    @app.route("/export", methods=["POST"])
    def export_order():
        data = request.get_json(silent=True) or {}
        items = data.get("items") or []

        def round_money(value: float) -> int:
            return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

        # нормализация входа
        norm: List[Dict[str, Any]] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            supplier = (it.get("supplier_name") or it.get("supplier") or "").strip() or "—"
            name = (it.get("name_raw") or it.get("name") or "").strip()
            if not name:
                continue
            unit = (it.get("unit") or "").strip()
            try:
                qty = float(it.get("qty") or 0) or 0.0
            except Exception:
                qty = 0.0
            try:
                price = float(it.get("price") or 0) or 0.0
            except Exception:
                price = 0.0
            if qty <= 0:
                continue
            norm.append(
                {
                    "supplier_name": supplier,
                    "name_raw": name,
                    "unit": unit,
                    "qty": qty,
                    "price": price,
                }
            )

        if not norm:
            return ("empty", 400)

        norm.sort(key=lambda x: (x["supplier_name"], x["name_raw"]))

        headers = ["Поставщик", "Товар", "Кол-во", "Ед.", "Цена, руб", "Сумма, руб"]

        if Workbook is None:
            # CSV fallback
            import csv
            import io

            out = BytesIO()
            wrapper = io.TextIOWrapper(out, encoding="utf-8", newline="")
            w = csv.writer(wrapper, delimiter=";")
            w.writerow(headers)
            for it in norm:
                s = round_money(it["price"] * it["qty"])
                price = round_money(it["price"])
                w.writerow([it["supplier_name"], it["name_raw"], it["qty"], it["unit"], price, s])
            wrapper.flush()
            out.seek(0)
            return send_file(out, mimetype="text/csv; charset=utf-8", as_attachment=True, download_name="zakaz.csv")

        wb = Workbook()
        ws = wb.active
        ws.title = "Заявка"

        ws.append(headers)
        for c in ws[1]:
            c.font = Font(bold=True)
            c.alignment = Alignment(vertical="center")
        ws.freeze_panes = "A2"

        for it in norm:
            s = round_money(it["price"] * it["qty"])
            price = round_money(it["price"])
            ws.append([it["supplier_name"], it["name_raw"], it["qty"], it["unit"], price, s])

        widths = [22, 60, 10, 10, 14, 14]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[chr(64 + i)].width = w

        bio = BytesIO()
        wb.save(bio)
        bio.seek(0)
        return send_file(
            bio,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name="zakaz.xlsx",
        )

    # ---------------- 404 ----------------
    @app.errorhandler(404)
    def _not_found(_e):
        p = request.path or ""
        if p.startswith("/api/") or p in ("/search", "/health", "/export"):
            return jsonify({"error": "not found"}), 404
        return render_template("search.html", title=APP_TITLE, active="search"), 200

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
