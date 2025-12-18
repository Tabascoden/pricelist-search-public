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

    def ensure_schema_compare(conn):
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS categories (id serial PRIMARY KEY, name text, code text UNIQUE, parent_id int REFERENCES categories(id));")
            cur.execute("ALTER TABLE supplier_items ADD COLUMN IF NOT EXISTS name_normalized text, ADD COLUMN IF NOT EXISTS base_unit text, ADD COLUMN IF NOT EXISTS base_qty numeric(12,6), ADD COLUMN IF NOT EXISTS price_per_unit numeric(12,4), ADD COLUMN IF NOT EXISTS category_id int REFERENCES categories(id);")
        conn.commit()

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

    @app.route("/api/upload/<int:supplier_id>", methods=["POST"])
    def api_upload(supplier_id: int):
        f = request.files["file"]
        path = os.path.join(UPLOAD_DIR, secure_filename(f.filename))
        f.save(path)
        res = import_price.import_price_file(supplier_id, path, f.filename)
        return jsonify({"status": "ok", "count": res["imported"]})

    @app.route("/search", methods=["GET"])
    def search():
        q = (request.args.get("q") or "").strip()
        limit = int(request.args.get("limit") or 60)
        supplier_id = request.args.get("supplier_id")
        
        params = {"limit": limit}
        where = ["si.is_active IS TRUE"]
        
        if supplier_id:
            where.append("si.supplier_id = %(sid)s")
            params["sid"] = supplier_id

        if q:
            # Умный поиск: по частям слов + схожесть
            words = [f"{w}:*" for w in q.split() if len(w) > 1]
            params["ts_query"] = " & ".join(words) if words else f"{q}:*"
            params["q"] = q
            
            sql = f"""
                SELECT si.id, si.supplier_id, s.name AS supplier_name, si.name_raw, si.unit, si.price, 
                       si.base_unit, si.base_qty, si.price_per_unit,
                       ts_rank_cd(to_tsvector('russian', si.name_raw), to_tsquery('russian', %(ts_query)s)) AS rank
                FROM supplier_items si
                JOIN suppliers s ON s.id = si.supplier_id
                WHERE {" AND ".join(where)}
                  AND (to_tsvector('russian', si.name_raw) @@ to_tsquery('russian', %(ts_query)s) OR si.name_raw ILIKE '%%' || %(q)s || '%%')
                ORDER BY rank DESC, si.price ASC LIMIT %(limit)s;
            """
        else:
            sql = f"SELECT si.id, si.supplier_id, s.name AS supplier_name, si.name_raw, si.unit, si.price, si.base_unit, si.base_qty, si.price_per_unit, 0 as rank FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id WHERE {' AND '.join(where)} ORDER BY si.id DESC LIMIT %(limit)s;"

        with db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        return jsonify({"items": [{k: _json_safe(v) for k, v in dict(r).items()} for r in rows]})

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
