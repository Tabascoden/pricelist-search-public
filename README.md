# Pricelist Search

Flask-based service for uploading supplier price lists, searching the catalog, and exporting selections.

Supported upload formats: Excel `.xlsx` and legacy Excel 97–2003 `.xls` files, plus CSV.

## Requirements
- Python 3.10+
- PostgreSQL 12+
- A configured `.env` file (see `.env.example`).
- `xlrd` is used to read legacy `.xls` uploads.

## Local development
1. Create and activate a virtual environment.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Configure environment variables by copying `.env.example` to `.env` and updating database credentials.
4. Run the application:
   ```bash
   python app.py
   ```
5. Open `http://localhost:5000` to access the UI. The `/health` endpoint should respond with a 200 when the database is reachable.

## Docker
To run the service with Docker Compose:
```bash
docker-compose up --build
```

## Testing
Add tests as needed and run them with your preferred test runner (for example, `python -m pytest`).
