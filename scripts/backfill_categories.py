#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

import psycopg2.extras

import import_price


def main() -> int:
    conn = import_price.connect_db()
    updated = 0
    try:
        category_map = import_price.fetch_category_map(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name_raw, unit, category_id
                FROM supplier_items;
                """
            )
            rows = cur.fetchall()

        updates = []
        for item_id, name_raw, unit_raw, category_id in rows:
            category_code = import_price.detect_category(name_raw, unit_raw)
            next_id = category_map.get(category_code) if category_code else None
            if next_id != category_id:
                updates.append((next_id, item_id))

        if updates:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    UPDATE supplier_items
                    SET category_id = data.category_id
                    FROM (VALUES %s) AS data(category_id, id)
                    WHERE supplier_items.id = data.id;
                    """,
                    updates,
                )
            updated = len(updates)
        conn.commit()
    finally:
        conn.close()
    print(f"Updated {updated} rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
