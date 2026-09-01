# ZOMURUD Shop v2

هذه نسخة Full-Stack محلية لمتجر الزمرد، بدون Manus وبدون بوابة دفع أو شركة شحن.

## التشغيل على الكمبيوتر

1. ثبّت Node.js 20 أو أحدث.
2. افتح Terminal داخل مجلد المشروع.
3. نفّذ:
   npm install
   npm start
4. افتح:
   http://localhost:3000
5. لوحة الإدارة:
   http://localhost:3000/admin.html

قاعدة البيانات SQLite يتم إنشاؤها تلقائيًا باسم `zomurud.db`.

## ما يعمل

- متجر Frontend حقيقي
- منتجات من قاعدة بيانات
- تصنيفات
- بحث وفرز
- صفحة تفاصيل المنتج
- سلة
- Wishlist
- Checkout بدون دفع
- إنشاء طلب وحفظه في SQLite
- Admin Dashboard
- إضافة منتجات
- حذف/إخفاء المنتجات
- عرض الطلبات
- تغيير حالة الطلب
- إحصائيات أساسية

## ما لم يتم ربطه بعد

- Payment Gateway
- Shipping API
- تسجيل دخول حقيقي وصلاحيات Admin production
- رفع صور مباشر إلى Storage
- Email/SMS/WhatsApp automation
- SEO متقدم
- Domain/Hosting

قبل الإطلاق العام يجب إضافة المصادقة الحقيقية للوحة الإدارة وحماية API وHTTPS والنسخ الاحتياطي.
