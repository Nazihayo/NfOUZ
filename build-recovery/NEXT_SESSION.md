# NFOUZ — خطة الجلسة القادمة (المحطة 1: اللعبة على المحاكي)

> **تحديث 2026-10-22:** الأجزاء أ إلى د اكتملت، واللعبة فتحت على المحاكي
> بشاشة الدخول العربية (HANDOFF البند 32). **نكمل من هنا:**
> 1. شغّل الخادم: `cd` إلى `backend`، ثم `npm.cmd start` (وليس `npm`).
> 2. شغّل المحاكي من Android Studio ← More Actions ← Virtual Device Manager ← ▶.
> 3. في PowerShell ثانٍ: `cd $env:LOCALAPPDATA\Android\Sdk\platform-tools`
>    ثم `.\adb.exe reverse tcp:3000 tcp:3000` (يجب أن يرد بـ 3000).
> 4. افتح NFOUZ على المحاكي. **المشكلة المفتوحة:** الكتابة في خانات الدخول لا
>    تعمل. اضغط على الخانة: هل تظهر لوحة مفاتيح Android؟ إن لم تظهر، فعّل
>    «keyboard input» في إعدادات الجهاز (Device Manager ← ⋮ ← Edit).
> 5. ثم: موقع وهمي، ثم إنشاء حساب، ثم Onboarding، ثم الخريطة.

كُتبت في 2026-10-20. الهدف أن تعمل اللعبة على محاكي Android على اللابتوب:
تسجيل، ثم Onboarding، ثم الخريطة بالعربية. خطوة واحدة في كل مرة، ولا ننتقل
إلى الخطوة التالية قبل أن تنجح التي قبلها.

مسار المشروع على اللابتوب: `C:\Users\ayoa3\OneDrive\Documents\GitHub\NfOUZ`

## الجزء أ: تأكيد ما أنجزناه (10 دقائق)

1. **GitHub Desktop:** اضغط **Fetch origin**، ثم **Pull**.
   - النتيجة المطلوبة: **No local changes**، وآخر commit في History هو
     «Add the next-session plan» أو أحدث منه.
2. **Unity Hub:** افتح المشروع NfOUZ بالإصدار **6000.0.58f2** فقط. لا تستعمل
   6000.0.84f1 ولا 6.7 LTS.
   - النتيجة المطلوبة: Console بلا أخطاء حمراء.
3. **Test Runner** (Window ← General ← Test Runner):
   - EditMode، ثم Run All: النتيجة المطلوبة **330 من 330**.
   - PlayMode، ثم Run All: النتيجة المطلوبة **9 من 9**.
4. **GitHub Desktop مرة أخرى:** يجب أن يبقى **No local changes**. إن ظهرت
   ملفات، فلا تعمل لها commit، وأرسل صورة.

## الجزء ب: Android Studio والمحاكي (30 إلى 45 دقيقة)

5. التحميل من `developer.android.com/studio`، ثم التثبيت بالخيارات
   الافتراضية، ثم الإعداد الأول: **Standard**، وقبول كل الرخص.
6. **More Actions ← Virtual Device Manager ← +:**
   - الجهاز: **Pixel 7**.
   - النظام: **API 34**، من نوع **Google Play** (أيقونة المتجر)، و**x86_64**.
   - **Finish**، ثم ▶ للتشغيل.
   - النتيجة المطلوبة: هاتف وهمي يقلع إلى شاشة Android.
   - إن ظهر خطأ «Hypervisor»: فعّل **Windows-Hypervisor-Plattform** من
     «Windows-Features aktivieren oder deaktivieren»، ثم أعد التشغيل.

## الجزء ج: الخادم على اللابتوب (10 دقائق)

7. في PowerShell عادي (ليس كمسؤول):
   ```powershell
   cd "C:\Users\ayoa3\OneDrive\Documents\GitHub\NfOUZ\backend"
   npm ci
   npm run migrate
   ```
   - `npm run migrate` يطبّق الترحيلات الجديدة، ومنها 021. إعادة تشغيله آمنة.
   - **إن ظهر خطأ في ترحيل قديم** (مثلاً «already exists»): توقف وأرسل صورة.
     لا تحذف أي جدول ولا قاعدة بيانات.
8. شغّل الخادم، واترك النافذة مفتوحة:
   ```powershell
   npm start
   ```
   - النتيجة المطلوبة: «NFOUZ backend listening on port 3000».
   - تحقق في المتصفح: `http://127.0.0.1:3000/health` يجب أن يعطي حالة سليمة.

## الجزء د: بناء الـAPK (20 إلى 40 دقيقة في أول مرة)

9. Unity Hub ← Installs ← ⚙ بجانب **6000.0.58f2** ← Add modules: تأكد أن
   **Android Build Support** مثبّت، ومعه **OpenJDK** و**Android SDK & NDK
   Tools**.
10. في Unity: **File ← Build Profiles ← Android**.
    - ضع ✓ على **Development Build**.
    - اضغط **Build**، واختر مجلداً **خارج المشروع**، مثلاً `C:\NFOUZ-Builds`،
      باسم `nfouz-dev.apk`.
    - أول بناء بطيء بسبب IL2CPP. انتظر حتى ينتهي.
    - النتيجة المطلوبة: الملف موجود، وسجل البناء يذكر **IL2CPP** (HANDOFF،
      البند 30).

## الجزء هـ: التشغيل على المحاكي (10 دقائق)

11. والمحاكي يعمل، **اسحب ملف `nfouz-dev.apk` وأفلته فوق نافذة المحاكي**،
    فيُثبَّت التطبيق.
    - إن ظهر خطأ `INSTALL_FAILED_NO_MATCHING_ABIS`: توقف وأرسل صورة. قد نحتاج
      مؤقتاً معمارية x86-64 للمحاكي، **دون** رفعها إلى Git.
12. اربط التطبيق بخادم اللابتوب، في نافذة PowerShell ثانية:
    ```powershell
    & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:3000 tcp:3000
    ```
    - بهذا يصل `127.0.0.1:3000` داخل المحاكي إلى خادم اللابتوب، دون تغيير
      الرابط في المشروع.
    - يُعاد هذا الأمر بعد كل إعادة تشغيل للمحاكي.
13. موقع وهمي: في شريط المحاكي الجانبي **⋯ (Extended controls) ← Location**،
    ثم اختر مكاناً في هامبورغ، ثم **Set location**.
14. افتح NFOUZ على المحاكي، وجرّب: إنشاء حساب جديد، ثم Onboarding، ثم الخريطة.
    - **صوّر:** شاشة الدخول، والخريطة، وأي رسالة خطأ.
    - انظر في نافذة الخادم: هل تظهر طلبات `POST /auth/register` و
      `PATCH /player/.../location` برقم 200؟

## قواعد ثابتة
- لا commit لأي ملف في GitHub Desktop قبل مراجعته هنا.
- لا تُرسل ولا تصوّر أي مفتاح أو كلمة سر: ملف `.env`، وملفات Firebase،
  والـApp ID.
- الـAPK ومجلد البناء خارج المشروع، ولا يُرفعان إلى Git.
- لا Sprint 11 ولا ميزات جديدة. الأفكار في `POST_ALPHA_VISION.md` تنتظر
  قرار صاحب المشروع.

## بعد نجاح المحطة 1
- الفحوص البصرية للعربية: `PRE_ALPHA_CHECKLISTS.md` §1.
- المحطة 2 (معركة بين لاعبين): حساب Photon، وFusion 2 SDK، والتعديلات
  الأربعة (`PRE_ALPHA_CHECKLISTS.md` §2)، وجهاز ثانٍ.
