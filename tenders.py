import os
import re
import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path

from flask import Blueprint, render_template, request, jsonify, current_app, send_file
from werkzeug.utils import secure_filename

import psycopg2
from psycopg2.extras import RealDictCursor


tenders_bp = Blueprint("tenders", __name__)

ALLOWED_EXT = {".xlsx"}  # тендер обычно в xlsx
MAX_UPLOAD_MB = 20


# ---------------- DB helpers ----------------
def db_conn():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        cursor_factory=RealDictCursor,
    )


def q_all(sql, params=None):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            return cur.fetchall()


def q_one(sql, params=None):
    rows = q_all(sql, params)
    return rows[0] if rows else None


def exec_sql(sql, params=None, returning=False):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            row = cur.fetchone() if returning else None
        conn.commit()
    return row


# ---------------- parsing helpers ----------------
def norm_text(s: str) -> str:
    if s is None:
        return ""
    s = str(s).lower().replace("ё", "е")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT


def parse_tender_xlsx(filepath: Path):
    """
    Очень практичный парсер:
    - ищет строку заголовков по словам типа "наименование/товар" и "количество"
    - вытаскивает (name, qty, unit?) построчно ниже
    """
    from openpyxl import load_workbook

    wb = load_workbook(filepath, read_only=True, data_only=True)
    ws = wb.active

    header_row_idx = None
    header = []
    rows = list(ws.iter_rows(values_only=True))
    for i, r in enumerate(rows[:50]):  # заголовки обычно в первых 50 строках
        line = " ".join([norm_text(x) for x in r if x is not None])
        if ("наимен" in line or "товар" in line or "номенклат" in line) and ("кол" in line or "qty" in line):
            header_row_idx = i
            header = [norm_text(x) for x in r]
            break

    if header_row_idx is None:
        raise ValueError("Не нашёл строку заголовков в XLSX (нет колонок Наименование/Количество).")

    def find_col(keys):
        for idx, col in enumerate(header):
            for k in keys:
                if k in col:
                    return idx
        return None

    c_name = find_col(["наимен", "товар", "номенклат", "name", "item"])
    c_qty = find_col(["кол", "qty", "кол-во", "колич"])
    c_unit = find_col(["ед", "едизм", "ед.изм", "unit"])

    if c_name is None or c_qty is None:
        raise ValueError("В заголовках не найдены колонки Наименование и/или Количество.")

    parsed = []
    for r in rows[header_row_idx + 1 :]:
        name = r[c_name] if c_name < len(r) else None
        qty = r[c_qty] if c_qty < len(r) else None
        unit = r[c_unit] if (c_unit is not None and c_unit < len(r)) else None

        if name is None:
            continue
        name_str = str(name).strip()
        if not name_str:
            continue

        try:
            qty_val = float(str(qty).replace(",", ".")) if qty is not None and str(qty).strip() else 1.0
        except Exception:
            qty_val = 1.0

        parsed.append({"name_raw": name_str, "qty": qty_val, "unit_raw": str(unit).strip() if unit else ""})

    return parsed


# ---------------- helpers ----------------
def snapshot_offer(project_id: int, item_id: int, supplier_item_id: int):
    return exec_sql(
        """
        INSERT INTO tender_offers
        (project_id, tender_item_id, supplier_item_id,
         supplier_name, item_name, price, price_per_unit, score)
        SELECT
            %(pid)s, %(tid)s, si.id,
            s.name, si.name_raw, si.price, si.price_per_unit,
            similarity(coalesce(si.name_normalized, si.name_raw), unaccent(lower(ti.name_raw)))
        FROM supplier_items si
        JOIN suppliers s ON s.id = si.supplier_id
        JOIN tender_items ti ON ti.id = %(tid)s AND ti.project_id = %(pid)s
        WHERE si.id = %(sid)s
        RETURNING id, supplier_name, item_name, price, price_per_unit, score, chosen_at
        """,
        {"pid": project_id, "tid": item_id, "sid": supplier_item_id},
        returning=True,
    )


# ---------------- UI pages ----------------
@tenders_bp.get("/tenders")
def tenders_list_page():
    projects = q_all(
        """
        SELECT id, title, created_at
        FROM tender_projects
        ORDER BY created_at DESC
        """
    )
    return render_template("tenders.html", projects=projects, active="tenders")


@tenders_bp.get("/tenders/<int:project_id>")
def tender_project_page(project_id: int):
    project = q_one("SELECT id, title, created_at FROM tender_projects WHERE id=%(id)s", {"id": project_id})
    if not project:
        return render_template("404.html"), 404

    items = q_all(
        """
        SELECT ti.id, ti.name_raw, ti.qty, ti.unit_raw,
               toff.id AS offer_id,
               toff.supplier_name, toff.item_name, toff.price_per_unit, toff.price, toff.score
        FROM tender_items ti
        LEFT JOIN LATERAL (
            SELECT id, supplier_name, item_name, price_per_unit, price, score
            FROM tender_offers
            WHERE tender_item_id = ti.id
            ORDER BY chosen_at DESC
            LIMIT 1
        ) toff ON TRUE
        WHERE ti.project_id = %(pid)s
        ORDER BY ti.id
        """,
        {"pid": project_id},
    )
    return render_template("tender_project.html", project=project, items=items, active="tenders")


# ---------------- API ----------------
@tenders_bp.post("/api/tenders")
def api_create_tender():
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        title = f"Тендер {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    row = exec_sql(
        """
        INSERT INTO tender_projects (title)
        VALUES (%(title)s)
        RETURNING id, title, created_at
        """,
        {"title": title},
        returning=True,
    )
    return jsonify({"ok": True, "project": row})


@tenders_bp.post("/api/tenders/<int:project_id>/upload")
def api_upload_tender(project_id: int):
    # простая защита от больших файлов
    if request.content_length and request.content_length > MAX_UPLOAD_MB * 1024 * 1024:
        return jsonify({"ok": False, "error": f"Файл слишком большой (> {MAX_UPLOAD_MB}MB)"}), 400

    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "Файл не выбран"}), 400
    if not allowed_file(f.filename):
        return jsonify({"ok": False, "error": "Нужен .xlsx"}), 400

    upload_dir = Path(os.environ.get("UPLOAD_DIR", "/app/uploads"))
    upload_dir.mkdir(parents=True, exist_ok=True)

    fname = secure_filename(f.filename)
    save_as = upload_dir / f"tender_{project_id}_{uuid.uuid4().hex}_{fname}"
    f.save(save_as)

    try:
        rows = parse_tender_xlsx(save_as)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    # вставка в tender_items
    with db_conn() as conn:
        with conn.cursor() as cur:
            # удалить старые строки (или можно не удалять — на твой выбор)
            cur.execute("DELETE FROM tender_items WHERE project_id=%(pid)s", {"pid": project_id})

            cur.execute(
                """
                INSERT INTO tender_items (project_id, name_raw, qty, unit_raw)
                SELECT %(pid)s, x.name_raw, x.qty, x.unit_raw
                FROM jsonb_to_recordset(%(payload)s::jsonb) AS x(name_raw text, qty numeric, unit_raw text)
                """,
                {"pid": project_id, "payload": str(rows).replace("'", '"')},
            )
        conn.commit()

    return jsonify({"ok": True, "inserted": len(rows)})


@tenders_bp.get("/api/tenders/<int:project_id>/items/<int:item_id>/offers")
def api_get_offers(project_id: int, item_id: int):
    limit = int(request.args.get("limit", "25"))
    limit = max(5, min(limit, 100))

    item = q_one(
        "SELECT id, name_raw FROM tender_items WHERE id=%(id)s AND project_id=%(pid)s",
        {"id": item_id, "pid": project_id},
    )
    if not item:
        return jsonify({"ok": False, "error": "Строка тендера не найдена"}), 404

    # Важно: здесь опора на supplier_items.name_normalized + pg_trgm similarity + price_per_unit
    offers = q_all(
        """
        SELECT
            si.id AS supplier_item_id,
            s.id AS supplier_id,
            s.name AS supplier_name,
            si.name_raw AS item_name,
            si.base_unit,
            si.base_qty,
            si.price,
            si.price_per_unit,
            similarity(coalesce(si.name_normalized, si.name_raw), unaccent(lower(%(q)s))) AS score
        FROM supplier_items si
        JOIN suppliers s ON s.id = si.supplier_id
        WHERE si.price_per_unit IS NOT NULL
          AND similarity(coalesce(si.name_normalized, si.name_raw), unaccent(lower(%(q)s))) > 0.20
        ORDER BY score DESC, si.price_per_unit ASC
        LIMIT %(limit)s
        """,
        {"q": item["name_raw"], "limit": limit},
    )

    return jsonify({"ok": True, "offers": offers})


@tenders_bp.post("/api/tenders/<int:project_id>/items/<int:item_id>/select")
def api_select_offer(project_id: int, item_id: int):
    data = request.get_json(force=True, silent=True) or {}
    supplier_item_id = data.get("supplier_item_id")
    if not supplier_item_id:
        return jsonify({"ok": False, "error": "supplier_item_id обязателен"}), 400

    row = snapshot_offer(project_id, item_id, supplier_item_id)
    if not row:
        return jsonify({"ok": False, "error": "Оффер не найден"}), 404
    return jsonify({"ok": True, "selected": row})


@tenders_bp.post("/api/tenders/<int:project_id>/autopick")
def api_autopick(project_id: int):
    items = q_all(
        "SELECT id, name_raw FROM tender_items WHERE project_id=%(pid)s ORDER BY id",
        {"pid": project_id},
    )
    total_selected = 0
    for item in items:
        offer = q_one(
            """
            SELECT si.id AS supplier_item_id
            FROM supplier_items si
            JOIN suppliers s ON s.id = si.supplier_id
            WHERE si.price_per_unit IS NOT NULL
              AND similarity(coalesce(si.name_normalized, si.name_raw), unaccent(lower(%(q)s))) > 0.20
            ORDER BY si.price_per_unit ASC NULLS LAST, similarity(coalesce(si.name_normalized, si.name_raw), unaccent(lower(%(q)s))) DESC
            LIMIT 1
            """,
            {"q": item["name_raw"]},
        )
        if not offer:
            continue
        row = snapshot_offer(project_id, item["id"], offer["supplier_item_id"])
        if row:
            total_selected += 1

    return jsonify({"ok": True, "selected": total_selected, "items": len(items)})


@tenders_bp.get("/api/tenders/<int:project_id>/export")
def api_export(project_id: int):
    project = q_one("SELECT id, title FROM tender_projects WHERE id=%(id)s", {"id": project_id})
    if not project:
        return jsonify({"ok": False, "error": "Проект не найден"}), 404

    items = q_all(
        """
        SELECT ti.id, ti.name_raw, ti.qty, ti.unit_raw,
               toff.supplier_name, toff.item_name, toff.price_per_unit, toff.price
        FROM tender_items ti
        LEFT JOIN LATERAL (
            SELECT supplier_name, item_name, price_per_unit, price
            FROM tender_offers
            WHERE tender_item_id = ti.id
            ORDER BY chosen_at DESC
            LIMIT 1
        ) toff ON TRUE
        WHERE ti.project_id = %(pid)s
        ORDER BY ti.id
        """,
        {"pid": project_id},
    )

    try:
        from openpyxl import Workbook
    except Exception:
        return jsonify({"ok": False, "error": "openpyxl недоступен"}), 500

    wb = Workbook()
    ws = wb.active
    ws.title = "Тендер"
    ws.append(["Позиция", "Кол-во", "Ед.", "Поставщик", "Товар", "Цена/ед.", "Сумма"])

    for row in items:
        qty = row.get("qty") or 0
        price_per_unit = row.get("price_per_unit")
        line_total = None
        try:
            if price_per_unit is not None:
                line_total = float(price_per_unit) * float(qty)
        except Exception:
            line_total = None

        ws.append(
            [
                row.get("name_raw"),
                qty,
                row.get("unit_raw"),
                row.get("supplier_name"),
                row.get("item_name"),
                price_per_unit,
                line_total,
            ]
        )

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    fname = f"tender_{project_id}.xlsx"
    return send_file(
        bio,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=fname,
    )
