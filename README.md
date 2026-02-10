# 📦 نظام POS القديم النظيف

---

## ✅ ما هذا؟

**هذا نظامك القديم - نظيف 100% بدون الميزات السبعة!**

---

## 📋 الميزات الموجودة:

```
✅ المنتجات (إضافة، تعديل، حذف، بحث متقدم)
✅ الفواتير (بيع، طباعة، تصدير Excel/PDF)
✅ المخزون (إدارة، توزيع، تتبع)
✅ الفروع (عزل كامل بين الفروع)
✅ المستخدمين (صلاحيات، أدوار)
✅ التقارير (مبيعات، أرباح، مخزون)
✅ المحاسبة (ربع سنوي، نصف سنوي، سنوي)
✅ نظام التكاليف الديناميكي
✅ PWA Offline Support
✅ العملاء (CRM بسيط)
✅ الحضور والانصراف
✅ المصروفات

❌ بدون نظام الولاء
❌ بدون نظام المرتجعات
❌ بدون نظام الموردين
❌ بدون نظام الكوبونات
❌ بدون حالة الطلب
❌ بدون العمليات الإضافية
❌ بدون حماية تسجيل الخروج
```

---

## 📁 الهيكل:

```
OLD_POS_CLEAN/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── server.py (1,891 سطر)
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── accounting.html
│   ├── manifest.json
│   ├── sw.js
│   ├── localdb.js
│   ├── sync-manager.js
│   └── products-search.js
├── database/
│   └── pos.db
└── static/
```

---

## 🚀 التثبيت:

### الخطوة 1: حذف النظام القديم

```bash
ssh admin@192.168.8.21

# حذف المجلد القديم
rm -rf /volume1/docker/pos

# إيقاف الكونتينر
docker stop pos 2>/dev/null
docker rm pos 2>/dev/null
docker rmi pos_pos-system 2>/dev/null
```

### الخطوة 2: رفع النظام الجديد

```
1. فك ضغط: OLD_POS_CLEAN.zip
2. ارفع مجلد OLD_POS_CLEAN/ كامل إلى السيرفر
3. غيّر اسم المجلد من OLD_POS_CLEAN إلى pos
4. المسار النهائي: /volume1/docker/pos/
```

### الخطوة 3: البناء والتشغيل

```bash
cd /volume1/docker/pos

# بناء من الصفر
docker-compose build --no-cache

# تشغيل
docker-compose up -d

# التحقق
docker-compose ps
docker-compose logs pos | tail -50
```

### الخطوة 4: مسح Cache المتصفح

```
1. Ctrl + Shift + Delete
2. Clear All Data
3. Close Browser تماماً
4. Open: http://192.168.8.21:5000
5. Ctrl + Shift + R (10 مرات)
```

---

## 🔐 تسجيل الدخول:

```
Username: admin
Password: admin
```

---

## ✅ التحقق:

بعد التثبيت، تحقق من:

```bash
# Logs نظيفة؟
docker-compose logs pos | grep ERROR
# يجب: لا شيء

# الكونتينر يعمل؟
docker-compose ps
# يجب: Up

# الواجهة تعمل؟
# افتح: http://192.168.8.21:5000
# يجب: صفحة Login تظهر
```

---

## 📊 قاعدة البيانات:

```
الجداول الموجودة:
- attendance_log
- branch_stock
- branches
- categories
- customers (CRM بسيط فقط)
- damaged_items
- damaged_stock
- employees
- expenses
- inventory
- invoice_items
- invoices
- products
- settings
- system_log
- users

❌ لا توجد جداول الميزات السبعة
```

---

## 🔧 استكشاف الأخطاء:

### خطأ: لا يفتح الموقع

```bash
# تحقق من Logs
docker-compose logs pos | tail -100

# تحقق من البورت
netstat -tulpn | grep 5000

# أعد التشغيل
docker-compose restart
```

### خطأ: قاعدة البيانات

```bash
# تحقق من pos.db
ls -lh /volume1/docker/pos/database/pos.db

# يجب: ~150 KB
```

### خطأ: الواجهة بيضاء

```bash
# امسح Cache
Ctrl + Shift + Delete → All Time

# أغلق المتصفح تماماً
# افتح جديد
# Ctrl + Shift + R
```

---

## 📝 ملاحظات:

1. **البورت:** 5000 (ليس 8080)
2. **التنسيق:** style.css (ليس styles.css)
3. **PWA:** يعمل Offline
4. **الصلاحيات:** نظام كامل للصلاحيات
5. **الفروع:** عزل كامل بين الفروع

---

## ⚙️ الإعدادات:

- **المنطقة الزمنية:** Asia/Kuwait
- **العملة:** دينار كويتي (KWD)
- **اللغة:** العربية
- **الاتجاه:** RTL

---

## 🎯 الخلاصة:

```
✅ نظام نظيف بدون الميزات السبعة
✅ كل الملفات موجودة
✅ الهيكل صحيح
✅ قاعدة بيانات نظيفة
✅ Docker ready
✅ جاهز للتثبيت فوراً
```

---

**🚀 ثبته الحين واستمتع بنظام نظيف ومستقر!** ✅
