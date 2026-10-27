# NFOUZ — تركيب خريطة Mapbox (الإصدار 3)

> **القرار (2026-10-27):** اختار صاحب المشروع مكتبة **Mapbox Unity SDK
> v3** الكاملة، لأن طموح اللعبة عالمي، ولاعبوها بهواتف قوية. الإصدار 2
> (`AbstractMap`) الذي كُتب له الكود أولاً متوقف عن التطوير.
>
> **ما يشترطه الإصدار 3 (من README المكتبة، v3.2.0):**
> - نظام الرسم **URP**: مشروعنا يستعمل حالياً نظام الرسم الافتراضي.
> - حزم تُضاف تلقائياً: `com.unity.render-pipelines.universal`،
>   `com.unity.nuget.newtonsoft-json`، `com.unity.burst`،
>   `com.unity.inputsystem`، `com.unity.cloud.gltfast`،
>   `com.unity.meshopt.decompress` (تجريبية).
> - Unity 6 مدعوم **«بأفضل جهد»**. الإصدار المستهدف رسمياً هو 2022.3. قد
>   تظهر مشاكل، ونحلّها واحدة واحدة.
>
> **ما جهزناه في السحابة:** `MapboxManager.cs` مكتوب للإصدار 3، ومربوط
> بخدمة الـ GPS (`GPSLocationService.OnLocationUpdated`)، فالخريطة تتبع
> نفس الموقع الذي يصل إلى الخادم. يُبنى الكود في 5 إعدادات، منها إعداد
> فيه `MAPBOX_SDK_AVAILABLE`، مقابل نسخة من تواقيع v3.2.0.
>
> **قواعد ثابتة:**
> - لا commit في GitHub Desktop قبل أن نراجع قائمة الملفات معاً.
> - مفتاح Mapbox (`pk.`) يبقى على اللابتوب فقط. لا يُرسل في المحادثة، ولا
>   يُصوَّر، ولا يُرفع إلى Git.
> - إن ظهر خطأ أحمر، توقّف وأرسل صورة. لا تحذف ملفات.

## المرحلة أ: تحويل المشروع إلى URP (جلسة واحدة)

1. GitHub Desktop: Fetch ثم Pull. يجب أن يظهر **No local changes**.
2. Unity (6000.0.58f2): **Window ← Package Manager ← Unity Registry**،
   ابحث عن **Universal RP**، ثم **Install**. يختار Unity الإصدار المناسب
   له تلقائياً.
3. في نافذة Project: افتح `Assets/_Project`، ثم زر الماوس الأيمن، ثم
   **Create ← Folder** باسم `Settings`. داخله: زر الماوس الأيمن، ثم
   **Create ← Rendering ← URP Asset (with Universal Renderer)**. يظهر
   ملفان.
4. **Edit ← Project Settings ← Graphics:** في **Default Render Pipeline**
   اختر ملف URP الذي صنعته.
5. **Project Settings ← Quality:** لكل مستوى جودة، ضع الملف نفسه في
   **Render Pipeline Asset**.
6. **Window ← Rendering ← Render Pipeline Converter:** اختر **Built-in to
   URP**، وضع ✓ على **Material Upgrade**، ثم **Initialize And Convert**.
7. **التحقق:** افتح مشهدي Login وMainMap، واضغط Play.
   - يجب أن تبقى الواجهة العربية كما هي.
   - أي شيء **وردي** معناه مادة لم تتحوّل. صوّره وأرسله.
8. ابنِ APK، وثبّته على الهاتف، وتأكد أن الدخول والشاشة الرئيسية يعملان.
9. GitHub Desktop: أرسل لي صورة قائمة الملفات المتغيرة **قبل** أي commit.

## المرحلة ب: تركيب مكتبة Mapbox والمفتاح

1. **Package Manager ← + ← Add package from git URL:**
   `https://github.com/mapbox/mapbox-unity-sdk.git#v3.2.0`
   - يحتاج git، وهو يعمل أصلاً عندك (مكتبة RTLTMPro تُركَّب بالطريقة
     نفسها).
   - **إن سأل Unity عن «enable the new input system backends»:** اختر
     **No**. مشروعنا يبقى على «Input Manager (Old)».
2. **Mapbox ← Setup:** الصق مفتاحك `pk.` هناك.
   - يُحفظ في `Assets/Resources/Mapbox/MapboxConfiguration.txt`.
   - هذا الملف **مستثنى** في `.gitignore` (`**/MapboxConfiguration.txt`).
   - تحقق: **يجب ألا يظهر** في قائمة GitHub Desktop.
3. **Package Manager ← Mapbox Unity SDK ← Samples:** استورد
   **LocationBasedGame**.
4. **Project Settings ← Player ← Android ← Other Settings:**
   - **Scripting Define Symbols:** أضف `MAPBOX_SDK_AVAILABLE`.
   - **Managed Stripping Level:** `Minimal` أو `Low`.
5. إعدادات Gradle لـ Android: ملفنا `mainTemplate.gradle` فيه إعدادات
   Firebase، وملف Mapbox فيه مكتباته. **أدمجهما أنا في السحابة** عندما
   نصل إلى هذه الخطوة، ثم تسحبهما (Pull). لا تنسخ مجلد `Plugins` من
   المكتبة فوق مجلدنا.

## المرحلة ج: الخريطة في مشهد MainMap

1. افتح `MainMap`. احذف الكائن **MapboxMapObject_Placeholder**، وهو
   السطح البيج المؤقت.
2. من `Assets/Samples/Mapbox Unity SDK/…/LocationBasedGame` اسحب
   **LocationBasedMap.prefab** إلى المشهد، في الموضع (0, 0, 0).
3. **Managers ← MapboxManager:** اسحب **LocationBasedMap** إلى الحقل
   **Map**. أما حقل **Gps Location Service** فمربوط أصلاً.
4. **Main Camera:**
   - Position: (0, 500, -500).
   - Rotation: (43, 0, 0).
   - Field of View: 77.
   - Far Clip Plane: 5000.

   هذه هي قيم مثال Mapbox.
5. احفظ المشهد، ثم Play في المحرر. في المحرر تظهر الخريطة في موقع
   تجريبي، وعلى الهاتف تتبع موقعك.

## المرحلة د: الهاتف

1. ابنِ APK، وثبّته، ثم `adb reverse tcp:3000 tcp:3000`.
2. المتوقع:
   - تظهر خريطة حقيقية حولك.
   - تتحرك معك كل 5 ثوانٍ تقريباً.
   - الواجهة فوقها كما هي.
3. **حدّ معروف:** علامات اللاعبين القريبين يُعاد وضعها مع كل استعلام
   (حوالي 6 ثوانٍ). بعد أن تتحرك الخريطة، قد تتأخر العلامات حتى الاستعلام
   التالي.
