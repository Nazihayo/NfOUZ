# NFOUZ — خطة الجلسة القادمة

> **تحديث 2026-10-27: المحطة 1 تحققت على هاتف حقيقي.** (HANDOFF، البند 33)
> - **نجرّب على الهاتف من الآن، وليس على المحاكي.** الهاتف: Samsung Galaxy
>   A16.
> - **التشغيل:**
>   1. الخادم: في مجلد `backend`، `npm.cmd start`، في تبويب خاص لا نكتب فيه.
>   2. صِل الهاتف بالكابل، واختر في إشعار USB: **نقل الملفات**.
>   3. في تبويب آخر: `cd $env:LOCALAPPDATA\Android\Sdk\platform-tools`، ثم
>      `.\adb.exe devices` (يجب أن تظهر كلمة `device`)، ثم
>      `.\adb.exe reverse tcp:3000 tcp:3000`.
>   4. بعد كل بناء جديد: `.\adb.exe install -r "C:\nfouz builds\nfouz-dev.apk"`.
> - **قبل أي commit من اللابتوب:** أزل ✓ عن **x86-64** في Player Settings ←
>   Android ← Target Architectures. فعّلناه لتجربة المحاكي فقط.
> - **التالي:** الخريطة (Mapbox): حساب، وSDK، ومفتاح يبقى على اللابتوب فقط.
>   ثم المحطة 2 (Photon) بجهازين.
>
> **تحديث 2026-10-25 (مساءً): نكمل من هنا.**
> - **تم الليلة:** Pull (مع تجاهل مجلد `.utmp`)، والترحيل 022، والخادم
>   الجديد (`/health` سليم)، وبناء APK جديد (25.10، 22:51) وتثبيته. بعد
>   Cold Boot للمحاكي فتحت اللعبة شاشة الدخول العربية.
> - **المفتوح:** الكتابة في خانات الدخول لا تعمل. إعدادات الخانات في المشهد
>   سليمة. ثلاث تجارب بالترتيب:
>   1. اضغط مرة على خانة البريد: هل يظهر مؤشر وامض؟ هل تظهر لوحة مفاتيح
>      Android؟
>   2. والخانة مختارة: `.\adb.exe shell input text "test"`. هل تظهر test؟
>   3. اضغط «إنشاء حساب جديد»: هل تتغير الشاشة؟
> - **دروس الليلة:**
>   - `EADDRINUSE :3000`: خادم قديم ما زال يعمل. اعرضه بالأمر
>     `Get-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess`،
>     وإن كان node فأوقفه بـ `Stop-Process -Id <الرقم>`.
>   - Unity لا يرى المحاكي («No Android devices connected»)، لأن نسخة adb
>     عنده تتعارض مع Android Studio. استعمل **Build** (وليس Build And Run)،
>     ثم اسحب الـAPK فوق المحاكي. بعدها أعد `adb reverse`.
>   - `AccessDeniedException … Library\Bee\Android`: سببه OneDrive. أوقف
>     المزامنة مؤقتاً، وأغلق Unity، ثم
>     `Get-Process java -ErrorAction SilentlyContinue | Stop-Process`، ثم احذف
>     `Library\Bee\Android` (ذاكرة بناء مؤقتة، يعيد Unity صنعها). الحل الدائم:
>     نقل المشروع خارج OneDrive.
>   - شاشة سوداء، ورسائل «System UI isn't responding»، وتعطّل `system_server`
>     في `adb logcat -d -b crash`: المحاكي (API 37) مثقل. الحل: أغلق Unity،
>     ثم Device Manager ← ⋮ ← **Cold Boot Now**. إن تكرر: جهاز جديد على
>     API 35.
>   - فتح اللعبة بالأمر: `.\adb.exe shell monkey -p com.NFOUZ.NFOUZ1 1`.
>
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
>
> **بعد Pull في 2026-10-25 (مهم):** في نافذة الخادم، قبل `npm.cmd start`،
> شغّل `npm.cmd run migrate` مرة واحدة، فيطبّق الترحيل 022 (إيقاف القيادة).
> إن كان في `backend\.env` السطر `NEARBY_MAX_RADIUS_METERS=5000` فغيّره إلى
> `1000`. في اللعبة: الإعدادات فيها زر جديد «أظهرني للاعبين القريبين».
>
> **قبل البناء التالي:** اسحب التحديثات (Fetch ثم Pull). غيّرنا إعداد الإدخال
> إلى «Input Manager (Old)» وثبّتنا IL2CPP. بعد Pull، أعد **Build And Run**،
> ويجب ألا تظهر رسالة «Unsupported Input Handling». وابحث في Console عن كلمة
> IL2CPP.
>
> **إن لم تعمل الكتابة في خانة الدخول (بالترتيب):**
> 1. اضغط على الخانة **بالماوس داخل المحاكي** أولاً. يجب أن تظهر لوحة مفاتيح
>    Android في أسفل الهاتف. اكتب عليها بالماوس، أو بلوحة اللابتوب.
> 2. إن لم تظهر: افتح ⋯ في شريط المحاكي، ثم Settings، ثم General، ثم فعّل
>    «Send keyboard shortcuts to: Virtual device» إن وُجد.
> 3. أو: Device Manager ← ⋮ بجانب الجهاز ← Edit ← Additional settings ←
>    ✓ «Enable keyboard input» ← Finish. أعد تشغيل المحاكي، ثم أعد أمر
>    `adb reverse`.
> 4. إن ظهرت لوحة Android وكتبت عليها ولم يظهر النص في الخانة، فالمشكلة في
>    اللعبة. صوّر الشاشة.

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
