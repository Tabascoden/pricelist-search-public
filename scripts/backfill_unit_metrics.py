#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
from decimal import Decimal

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

import psycopg2.extras

import import_price


def _normalize_decimal(value: Decimal, places: str) -> Decimal:
    return value.quantize(Decimal(places))


def main() -> int:
    conn = import_price.connect_db()
    updated = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name_raw, unit, price, base_unit, base_qty, price_per_unit
                FROM supplier_items;
                """
            )
            rows = cur.fetchall()

        updates = []
        for row in rows:
            item_id, name_raw, unit_raw, price, base_unit, base_qty, price_per_unit = row
            new_base_unit, new_base_qty, new_ppu = import_price.compute_unit_metrics(
                name_raw, unit_raw, price
            )

            current_base_qty = base_qty
            current_ppu = price_per_unit
            if current_base_qty is not None:
                current_base_qty = _normalize_decimal(Decimal(current_base_qty), "0.000001")
            if current_ppu is not None:
                current_ppu = _normalize_decimal(Decimal(current_ppu), "0.0001")
            if new_base_qty is not None:
                new_base_qty = _normalize_decimal(Decimal(new_base_qty), "0.000001")
            if new_ppu is not None:
                new_ppu = _normalize_decimal(Decimal(new_ppu), "0.0001")

            if (
                new_base_unit != base_unit
                or new_base_qty != current_base_qty
                or new_ppu != current_ppu
            ):
                updates.append((new_base_unit, new_base_qty, new_ppu, item_id))

        if updates:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    UPDATE supplier_items
                    SET base_unit = data.base_unit,
                        base_qty = data.base_qty,
                        price_per_unit = data.price_per_unit
                    FROM (VALUES %s) AS data(base_unit, base_qty, price_per_unit, id)
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
