FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

EXPOSE 5000
CMD ["gunicorn","-b","0.0.0.0:5000","app:app","--workers=2","--threads=4","--timeout=60"]
