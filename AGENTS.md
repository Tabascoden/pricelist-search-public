# AGENTS.md

## Branches & deploy
- staging -> staging.search.iirest.ru
- main -> search.iirest.ru

## Rules
- Never commit secrets. `.env` is server-only. Only `.env.example` is allowed in the repo.
- Work only via PRs (no direct pushes to main/staging).
- Keep `/health` stable.
- Keep changes small and focused.
# AGENTS.md

## Project
iirest / Pricelist Search — Flask web app for supplier price-lists:
- upload supplier Excel/CSV
- store items in Postgres
- search & export for orders
- tenders and comparisions

## Environments
### staging
- Branch: `staging`
- Host: `staging.search.iirest.ru`
- Server dir: `/opt/pricelist-search-staging`
- Database: `smartproc_staging`
- DB user: `pricelist_app_staging`

### prod
- Branch: `main`
- Host: `search.iirest.ru`
- Server dir: `/opt/pricelist-search`
- Database: `smartproc`
- DB user: `pricelist_app`

**Important:** stage/prod have different databases. Same code, different `.env` on each server.

## Secrets
- Never commit secrets. `.env` is server-only.
- Only `.env.example` is allowed in the repo.

## DB & migrations
- Migrations live in `db/migrations/*.sql`
- Runner: `scripts/db_migrate.sh` (applies all `*.sql` in sorted order)
- Migrations MUST be idempotent:
  - `CREATE TABLE IF NOT EXISTS`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  - `CREATE INDEX IF NOT EXISTS`
  - constraints guarded by `DO $$ ... IF NOT EXISTS ... $$`

**Note about DB_HOST:**
- App runs in Docker and may use a Docker gateway IP to reach host Postgres.
- When running migrations from the host shell, prefer `DB_HOST=127.0.0.1`:
  `DB_HOST=127.0.0.1 bash scripts/db_migrate.sh`

## 4. Архитектура (высокоуровнево)
- **Backend:** Flask (Python)
- **Frontend:** Jinja (`templates/*`) + `static/*`
- **DB:** PostgreSQL (живет **на хосте**, не в compose сервиса)
- **Запуск:** Docker Compose + Gunicorn в контейнере
- **HTTPS/Reverse proxy:** Traefik (в отдельном compose‑проекте, сервис подключается к его docker‑сети)

Traefik маршрутизирует по `Host`:
- `staging.search.iirest.ru` → контейнер staging (порт 5000)
- `search.iirest.ru` → контейнер prod (порт 5000)

---

## 5. Основные страницы и API
### UI
- `/` — поиск (в некоторых версиях поиск мог жить на `/search`)
- `/cart` — корзина
- `/lists` — поставщики + загрузка прайса
- `/tenders` — список проектов тендера (если модуль включён)
- `/tenders/<id>` — тендерный проект (если модуль включён)

### Диагностика
- `GET /health` → JSON вида `{"db":"ok","status":"ok"}` при успехе.

### API
- `GET /api/suppliers` — список поставщиков
- `POST /api/suppliers` — создать поставщика
- `POST /api/upload/<sup_id>` — загрузка прайса и импорт
- `POST /api/excel_sheets` — список листов Excel (если файл многолистовой)
- `GET /search?q=...&supplier_id=...&limit=...` — поиск по товарам (API/роут поиска)

**Если на корне (`/`) видишь “404 page not found”:**
- это может быть 404 от Traefik (роутер не сматчился по Host),
- либо 404 от приложения (если роут `/` отсутствует в конкретной версии).
Проверяй `/_health?` нет — **проверяй `/health`**, потом `/lists`.

---

## 6. Загрузка прайсов / импорт
Поддерживаемые форматы (зависит от импортера):
- `.xlsx`, `.xlsm` (Excel, через `openpyxl` в `read_only`)
- `.xls` (Excel 97–2003) — поддержка добавлялась/планировалась через `xlrd>=2.0.1`
- `.csv` (если предусмотрено)

## 8. Технологии
- Python 3.11 (образ `python:3.11-slim`)
- Flask + Jinja
- Gunicorn (запуск)
- PostgreSQL (на host)
- `psycopg2` + `execute_values` (bulk insert)
- `openpyxl` (Excel)
- В БД используются расширения (по факту на staging): `pg_trgm`, `unaccent`, плюс FTS‑индексы на `supplier_items`.

---

## 9. Структура проекта (типовая)
- `app.py` — Flask (страницы + API)
- `import_price.py` — импорт прайсов, эвристики колонок, bulk insert
- `Dockerfile`
- `docker-compose.yml`
- `requirements.txt`
- `templates/`: `base.html`, `search.html`, `cart.html`, `lists.html`, (доп. `tenders*.html`)
- `static/`: `ui.css`, `ui.js`
- `.env.example` — пример переменных (без секретов)
- `.gitignore` — игнорит `.env`, `uploads/`, `__pycache__/`, `*.pyc`, `app.py.bak*` и т.п.

---

## 10. Переменные окружения
### PUBLIC (пример для `.env.example`)
```env
DB_HOST=172.18.0.1
DB_PORT=5432
DB_NAME=smartproc_staging
DB_USER=pricelist_app_staging
DB_PASSWORD=CHANGE_ME
UPLOAD_DIR=/app/uploads
```

### Замечание про uploads
В текущем `docker-compose.yml` **может не быть volume** для `UPLOAD_DIR`, значит загруженные файлы окажутся внутри контейнера и пропадут при пересоздании.  
(Если нужно — добавить volume и/или внешний каталог, но это отдельная задача.)

---

## 11. База данных (логика и таблицы)
Минимально используются таблицы:
- `suppliers`
- `supplier_uploads`
- `price_list_files`
- `supplier_items`
- `orders`
- `order_items`

---

