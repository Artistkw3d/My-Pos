# استخدام Python 3.11 slim (خفيف جداً)
FROM python:3.11-slim

# تعيين مجلد العمل
WORKDIR /app

# إنشاء مستخدم غير root للأمان + تنصيب gosu
RUN groupadd -r posapp && useradd -r -g posapp -d /app -s /sbin/nologin posapp \
    && apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

# نسخ ملفات المتطلبات أولاً (للاستفادة من cache)
COPY requirements.txt .

# تنصيب المكتبات المطلوبة
RUN pip install --no-cache-dir -r requirements.txt

# نسخ جميع ملفات التطبيق
COPY server.py .
COPY setup_database.py .
COPY frontend/ ./frontend/
COPY db_modules/ ./db_modules/

# نسخ سكريبت البدء
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# إنشاء المجلدات اللازمة وتعيين الصلاحيات
RUN mkdir -p /app/database/backups /app/database/tenants \
    && chown -R posapp:posapp /app

# فتح المنفذ 5000
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/version')" || exit 1

# استخدام entrypoint لإصلاح الصلاحيات ثم التشغيل كمستخدم غير root
ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh", "-c", "python setup_database.py && gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 120 server:app"]
