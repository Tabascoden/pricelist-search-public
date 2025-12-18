#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
import math
import os
import re
import shutil
from datetime import datetime
from decimal import Decimal
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
    Workbook = None


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
        if isinstance(v, Decimal): return float(v)
        return v

    def _scalar(row, key=None):
        if row is None: return None
        if isinstance(row, dict):
            if key and key in row: return row[key]
            return next(iter(row.values()))
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

    def ensure_schema_compare(conn):
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS categories (id serial PRIMARY KEY, name text, code text UNIQUE, parent_id int REFERENCES categories(id));")
            cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_normalized text, ADD COLUMN IF NOT EXISTS base_unit text, ADD COLUMN IF NOT EXISTS base_qty numeric(12,6), ADD COLUMN IF NOT EXISTS price_per_unit numeric(12,4), ADD COLUMN IF NOT EXISTS category_id int REFERENCES categories(id);")
        conn.commit()
        
    def get_category_map(conn) -> Dict[str, int]:
        with conn.cursor() as cur:
            cur.execute("SELECT id, code FROM categories;")
            rows = cur.fetchall()
        return {code: cid for cid, code in rows}

    def normalize_category_value(val: Optional[str]) -> Optional[str]:
        if val is None: return None
        v = str(val).strip().lower()
        if not v: return None
        if "fresh" in v or "свеж" in v: return "fresh"
        if "консерв" in v or "марин" in v: return "canned"
        if "замороз" in v or "frozen" in v: return "frozen"
        return v if v in ("fresh", "canned", "frozen") else None

    # --- ROUTES ---

    @app.route("/", methods=["GET"])
    @app.route("/ui", methods=["GET"])
    def page_search():
        return render_template("search.html", title=APP_TITLE, active="search")

    @app.route("/cart", methods=["GET"])
    def page_cart():
        return render_template("cart.html", title=f"{APP_TITLE} — Заявка", active="cart")

    @app.route("/lists", methods=["GET"])
    def page_lists():
        return render_template("lists.html", title=f"{APP_TITLE} — Прайсы", active="lists")

    @app.route("/tenders", methods=["GET"])
    def page_tenders():
        return render_template("tenders.html", title=f"{APP_TITLE} — Тендеры", active="tenders")

    @app.route("/tenders/<int:project_id>", methods=["GET"])
    def page_tender_detail(project_id: int):
        return render_template("tender_project.html", title=f"{APP_TITLE} — Тендер #{project_id}", active="tenders", project_id=project_id)

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    # --- API SUPPLIERS ---

    @app.route("/api/suppliers", methods=["GET"])
    def api_suppliers():
        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT s.id, s.name, su.last_uploaded_at, su.last_filename, COALESCE(pl.rows_imported, 0) AS rows_imported FROM suppliers s LEFT JOIN supplier_uploads su ON su.supplier_id = s.id LEFT JOIN LATERAL (SELECT rows_imported FROM price_list_files WHERE supplier_id = s.id ORDER BY id DESC LIMIT 1) pl ON TRUE ORDER BY s.name;")
                rows = cur.fetchall()
        return jsonify({"suppliers": [dict(r) for r in rows]})

    @app.route("/api/suppliers", methods=["POST"])
    def api_create_supplier():
        name = request.json.get("name")
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO suppliers(name) VALUES (%s) RETURNING id;", (name,))
                sid = cur.fetchone()[0]
            conn.commit()
        return jsonify({"id": sid, "name": name})
        
    @app.route("/api/suppliers/<int:supplier_id>", methods=["DELETE"])
    def api_delete_supplier(supplier_id: int):
        stored_path = None
        sup_dir = os.path.join(UPLOAD_DIR, str(supplier_id))
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 FROM suppliers WHERE id=%s;", (supplier_id,))
                    if not cur.fetchone():
                        return jsonify({"error": "supplier not found"}), 404
                    
                    # Проверка зависимостей (order_items)
                    cur.execute("""
                        SELECT count(*)::int FROM order_items oi 
                        JOIN supplier_items si ON si.id = oi.supplier_item_id 
                        WHERE si.supplier_id = %s;
                    """, (supplier_id,))
                    cnt = _scalar(cur.fetchone())
                    if cnt and cnt > 0:
                        return jsonify({"error": "supplier has order_items", "details": f"Нельзя удалить: есть позиции в заказах ({cnt})."}), 409

                    cur.execute("SELECT storage_path FROM supplier_uploads WHERE supplier_id=%s;", (supplier_id,))
                    r = cur.fetchone()
                    if r: stored_path = r[0]

                    # Удаляем всё связанное
                    cur.execute("DELETE FROM supplier_items WHERE supplier_id=%s;", (supplier_id,))
                    cur.execute("DELETE FROM price_list_files WHERE supplier_id=%s;", (supplier_id,))
                    cur.execute("DELETE FROM supplier_uploads WHERE supplier_id=%s;", (supplier_id,))
                    cur.execute("DELETE FROM suppliers WHERE id=%s;", (supplier_id,))
                conn.commit()

            _safe_remove(stored_path)
            _safe_rmtree(sup_dir)
            return jsonify({"status": "ok", "supplier_id": supplier_id})
        except Exception as e:
            return jsonify({"error": "internal error", "details": str(e)}), 500

    @app.route("/api/upload/<int:supplier_id>", methods=["POST"])
    def api_upload(supplier_id: int):
        f = request.files["file"]
        path = os.path.join(UPLOAD_DIR, secure_filename(f.filename))
        f.save(path)
        res = import_price.import_price_file(supplier_id, path, f.filename)
        return jsonify({"status": "ok", "count": res["imported"]})

    # --- API TENDERS & SEARCH ---

    @app.route("/search", methods=["GET"])
    def search():
        q = (request.args.get("q") or "").strip()
        limit = int(request.args.get("limit") or 60)
        supplier_id = request.args.get("supplier_id")
        sort = request.args.get("sort") or "rank"
        
        params = {"limit": limit}
        where = ["si.is_active IS TRUE"]
        
        if supplier_id:
            where.append("si.supplier_id = %(sid)s")
            params["sid"] = supplier_id

        # Сортировка
        if sort == "rank":
            order_by = "rank DESC, similarity DESC, si.price ASC NULLS LAST"
        elif sort == "price_asc":
            order_by = "si.price ASC NULLS LAST, rank DESC"
        elif sort == "price_desc":
            order_by = "si.price DESC NULLS LAST, rank DESC"
        elif sort == "ppu_asc":
            order_by = "si.price_per_unit ASC NULLS LAST, rank DESC"
        else:
            order_by = "rank DESC"

        if q:
            # Умный поиск: по частям слов + схожесть
            words = [f"{w}:*" for w in q.split() if len(w) > 1]
            params["ts_query"] = " & ".join(words) if words else f"{q}:*"
            params["q"] = q
            
            sql = f"""
                SELECT si.id, si.supplier_id, s.name AS supplier_name, si.name_raw, si.unit, si.price, 
                       si.base_unit, si.base_qty, si.price_per_unit,
                       ts_rank_cd(to_tsvector('russian', si.name_raw), to_tsquery('russian', %(ts_query)s)) AS rank,
                       similarity(si.name_raw, %(q)s) AS similarity
                FROM supplier_items si
                JOIN suppliers s ON s.id = si.supplier_id
                WHERE {" AND ".join(where)}
                  AND (to_tsvector('russian', si.name_raw) @@ to_tsquery('russian', %(ts_query)s) OR si.name_raw ILIKE '%%' || %(q)s || '%%' OR similarity(si.name_raw, %(q)s) > 0.15)
                ORDER BY {order_by} LIMIT %(limit)s;
            """
        else:
            order_by = {
                "rank": "si.id DESC",
                "price_asc": "si.price ASC NULLS LAST",
                "price_desc": "si.price DESC NULLS LAST",
                "ppu_asc": "si.price_per_unit ASC NULLS LAST",
            }.get(sort, "si.id DESC")
            
            sql = f"SELECT si.id, si.supplier_id, s.name AS supplier_name, si.name_raw, si.unit, si.price, si.base_unit, si.base_qty, si.price_per_unit, 0 as rank, 0.0 as similarity FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id WHERE {' AND '.join(where)} ORDER BY {order_by} LIMIT %(limit)s;"

        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Включаем pg_trgm для similarity
                cur.execute("SET pg_trgm.similarity_threshold = 0.15;")
                cur.execute(sql, params)
                rows = cur.fetchall()
        return jsonify({"items": [{k: _json_safe(v) for k, v in dict(r).items()} for r in rows]})
        
    @app.route("/api/tenders", methods=["GET"])
    def api_tenders_list():
        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT tp.id, tp.title, tp.created_at, (SELECT count(*) FROM tender_items ti WHERE ti.project_id = tp.id) AS items_count FROM tender_projects tp ORDER BY tp.created_at DESC, tp.id DESC;")
                rows = cur.fetchall()
        return jsonify({"projects": [dict(r) for r in rows]})

    @app.route("/api/tenders", methods=["POST"])
    def api_tenders_create():
        upload = request.files.get("file")
        title = (request.form.get("title") or upload.filename or "Тендер").strip()
        try:
            with db_connect() as conn:
                ensure_schema_compare(conn)
                cat_map = get_category_map(conn)
                df = pd.read_excel(upload.stream)
                
                # Поиск колонок (упрощенно)
                cols = {str(c).strip().lower(): i for i, c in enumerate(df.columns)}
                idx_name = next((cols[k] for k in ["наименование", "name", "товар", "product"] if k in cols), None)
                if idx_name is None: return jsonify({"error": "Колонка 'Наименование' не найдена"}), 400
                idx_qty = next((cols[k] for k in ["кол-во", "qty", "количество"] if k in cols), None)
                idx_unit = next((cols[k] for k in ["ед", "unit", "ед."] if k in cols), None)
                
                with conn.cursor() as cur:
                    cur.execute("INSERT INTO tender_projects(title) VALUES (%s) RETURNING id;", (title,))
                    pid = _scalar(cur.fetchone(), "id")
                    
                    items = []
                    for i, row in enumerate(df.itertuples(index=False), start=1):
                        row_list = list(row)
                        name_val = str(row_list[idx_name]).strip()
                        if not name_val: continue
                        qty_val = float(row_list[idx_qty]) if idx_qty is not None and idx_qty < len(row_list) and row_list[idx_qty] else None
                        unit_val = str(row_list[idx_unit]).strip() if idx_unit is not None and idx_unit < len(row_list) else None
                        items.append((pid, i, name_val, qty_val, unit_val))
                    
                    if items:
                        psycopg2.extras.execute_values(cur, "INSERT INTO tender_items(project_id, row_no, name_input, qty, unit_input) VALUES %s", items)
                conn.commit()
            return jsonify({"project": {"id": pid}})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/tenders/<int:project_id>", methods=["GET"])
    def api_tenders_get(project_id: int):
        # (Упрощенная загрузка, полная версия была в оригинале, восстанавливаю базовую)
        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM tender_projects WHERE id=%s;", (project_id,))
                proj = cur.fetchone()
                if not proj: return jsonify({"error": "not found"}), 404
                cur.execute("SELECT * FROM tender_items WHERE project_id=%s ORDER BY row_no;", (project_id,))
                items = [dict(r) for r in cur.fetchall()]
                # Подгрузка офферов
                cur.execute("SELECT * FROM tender_offers WHERE tender_item_id IN (SELECT id FROM tender_items WHERE project_id=%s);", (project_id,))
                offers = [dict(r) for r in cur.fetchall()]
        
        # Сборка
        off_map = {}
        for o in offers:
            off_map.setdefault(o['tender_item_id'], []).append({k:_json_safe(v) for k,v in o.items()})
        
        proj_dict = dict(proj)
        proj_dict['items'] = []
        for it in items:
            it_dict = {k:_json_safe(v) for k,v in it.items()}
            it_dict['offers'] = off_map.get(it['id'], [])
            proj_dict['items'].append(it_dict)
            
        return jsonify({"project": proj_dict})

    @app.route("/api/tenders/<int:project_id>", methods=["DELETE"])
    def api_tenders_delete(project_id: int):
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM tender_projects WHERE id=%s;", (project_id,))
            conn.commit()
        return jsonify({"status": "ok"})

    @app.route("/api/tenders/items/<int:item_id>/select", methods=["POST"])
    def api_tenders_select(item_id: int):
        data = request.json
        supplier_item_id = int(data['supplier_item_id'])
        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM supplier_items WHERE id=%s", (supplier_item_id,))
                si = cur.fetchone()
                if not si: return jsonify({"error": "item not found"}), 404
                
                # Создаем/обновляем оффер
                cur.execute("""
                    INSERT INTO tender_offers (tender_item_id, offer_type, supplier_id, supplier_item_id, supplier_name, name_raw, unit, price, base_unit, base_qty, price_per_unit, category_id)
                    VALUES (%s, 'selected', %s, %s, (SELECT name FROM suppliers WHERE id=%s), %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id;
                """, (item_id, si['supplier_id'], si['id'], si['supplier_id'], si['name_raw'], si['unit'], si['price'], si['base_unit'], si['base_qty'], si['price_per_unit'], si['category_id']))
                offer_id = cur.fetchone()[0]
                
                # Привязываем к тендерной позиции
                cur.execute("UPDATE tender_items SET selected_offer_id=%s WHERE id=%s;", (offer_id, item_id))
            conn.commit()
        return jsonify({"status": "ok", "offer_id": offer_id})

    @app.route("/api/tenders/items/<int:item_id>/finalize", methods=["POST"])
    def api_tenders_finalize(item_id: int):
        offer_id = request.json.get('offer_id')
        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE tender_offers SET offer_type='final' WHERE id=%s AND tender_item_id=%s;", (offer_id, item_id))
                cur.execute("UPDATE tender_items SET selected_offer_id=%s WHERE id=%s;", (offer_id, item_id))
            conn.commit()
        return jsonify({"status": "ok"})

    @app.route("/api/tenders/<int:project_id>/export", methods=["POST"])
    def api_tenders_export(project_id: int):
        # Упрощенный экспорт, так как Workbook может не быть
        return jsonify({"error": "Export not implemented fully in recovery mode"}), 501

    @app.route("/export", methods=["POST"])
    def export_order():
        items = request.json.get("items", [])
        out = BytesIO()
        df = pd.DataFrame(items)
        df.to_excel(out, index=False)
        out.seek(0)
        return send_file(out, mimetype="application/vnd.ms-excel", as_attachment=True, download_name="order.xlsx")

    return app

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
