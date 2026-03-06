# استخدام Python 3.11 slim
FROM python:3.11-slim

# إنشاء مستخدم غير root بـ UID ثابت (1001) عشان يطابق الـ host
RUN groupadd -r -g 1001 appgroup && \
    useradd -r -u 1001 -g appgroup -m -d /app appuser

# مجلد العمل
WORKDIR /app

# نسخ المتطلبات وتنصيبها
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# نسخ باقي الملفات
COPY server.py .
COPY setup_database.py .
COPY frontend/ ./frontend/
COPY database/ ./database/

# إنشاء المجلدات + تغيير الملكية للمستخدم appuser
RUN mkdir -p /app/database/backups && \
    chown -R appuser:appgroup /app

# التبديل إلى المستخدم غير الـ root
USER appuser

EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/version')" || exit 1

# تشغيل setup_database ثم gunicorn كـ appuser
CMD ["sh", "-c", "python setup_database.py && gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 120 server:app"]
