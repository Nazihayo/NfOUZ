<div dir="rtl">

# دليل بناء الشخصيات بأدوات مجانية أو رخيصة (Scout ثم Ranger ثم Titan)

**آخر تحديث:** 2026-11-03. **الحالة:** دليل عمل فقط، ولم يُنفَّذ أي خطوة منه بعد. كل ما فيه غير مُختبَر (UNTESTED) حتى تنفذه على اللابتوب وترسل الصور.

**المرجع الرسمي للشكل:** صور Gemini المعتمدة في `art-reference/gemini/approved/` (قرار المالك 2026-10-30). وحين تختلف هذه الصور عن نص `art_bible_v2.md` (مثلاً: معطف البشت للـRanger في النص، وسترة جلد بنية بسحّاب في الصورة) فالصورة المعتمدة هي الهدف، والأرقام التقنية (عدد المثلثات والقوام) تبقى من `art_bible_v2.md` §6.

**الميزانية:** من 0 إلى نحو 150 دولاراً (`council/v3/summary.html` §6).

**مهم قبل أن تبدأ:**
- هذا الدليل **لا يغيّر أي ملف في المشروع**. الربط مع `NetworkPlayer.prefab` في الجزء 9 هو خطة لاحقة تحتاج موافقتك.
- اترك واجهة Blender و Unity **بالإنجليزية** حتى تطابق أسماء القوائم ما هو مكتوب هنا.
- كل خطوة تنتهي بـ **📷 صورة:** أي ما يجب أن يظهر في الصورة التي ترسلها لي للتأكد.
- لا تضع أي كلمة مرور أو مفتاح أو فاتورة في المستودع (CLAUDE.md → Security). ملفات `.blend` الأصلية وإثباتات الرخص تُحفظ **خارج** المستودع، مثلاً في `Dokumente\NFOUZ-Art\`.

---

## 0. ماذا يتوقع الكود الآن من الشخصية؟ (اقرأ هذا أولاً)

فحصتُ الملفات التالية: `Assets/_Project/Prefabs/Networking/NetworkPlayer.prefab` و `Assets/_Project/Scripts/Combat/PlayerCombat.cs` و `BattleManager.cs` و `NetworkPlayerController.cs`.

| السؤال | الجواب من الكود |
|---|---|
| هل يوجد Animator أو أي حركة في الكود؟ | **لا.** لا يوجد أي استدعاء لـ `Animator` أو `SetTrigger` أو أسماء عظام (`HumanBodyBones`) في `Assets/_Project/Scripts`. |
| هل يبحث الكود عن عظام أو أجزاء بالاسم؟ | **لا.** لا يبحث عن `Visual` ولا `Facing` ولا أي عظمة. |
| شكل اللاعب الحالي | الجذر `NetworkPlayer` عليه: `NetworkObject` (Photon Fusion)، و `CharacterController` (ارتفاع 2 م، نصف قطر 0.5 م، المركز y = 1)، و `PlayerCombat`، و `NetworkPlayerController`. تحته ثلاثة أبناء: `Visual` (كبسولة، y = 1)، و `Facing` (مكعب صغير يبيّن الاتجاه الأمامي، y = 1.5، z = 0.45)، و `UsernameLabel`. |
| كيف يتحرك ويلتف؟ | الكود يحرك الجذر مباشرة ويدوّره حول المحور Y (`NetworkedYaw`). المراوغة و Shadow Lunge هما **قفزة فورية في الموضع** وليست حركة متحركة. |
| أحداث يمكن أن تشغّل الحركات لاحقاً | في `PlayerCombat`: `OnDodgeStarted` و `OnDamageTaken` و `OnDeath` و `OnClassAbilityUsed`. لا يوجد حدث للضربة العادية أو الخاصة حتى الآن. |

**النتيجة:** الكود لا ينتظر أي عظام ولا حركات حتى الآن. ربط الحركات بالكود **نظام جديد** يحتاج موافقتك (`art_bible_v2.md` §6 و §7). أما إنتاج النموذج والحركات واستيرادها إلى Unity فهو «إنتاج أصول»، وهذا مسموح في مرحلة Build Recovery.

**ترتيب العمل الصحيح:** إصلاح الكبسولة الوردية (D3 في `STATUS.md`، و `art_bible_v2.md` §7) يأتي قبل كل شيء في هذا الدليل.

---

## 1. الرخص (تم التحقق منها بالبحث في 2026-11-03)

> لم أستطع فتح بعض المواقع مباشرة من بيئة السحابة (docs.meshy.ai و tripo3d.ai و makehumancommunity.org محجوبة هنا)، فاعتمدتُ على نتائج البحث التي تقتبس صفحاتهم الرسمية. **افتح كل رابط بنفسك قبل الاستعمال، والتقط صورة لصفحة الرخصة واحفظها خارج المستودع مع التاريخ.**

| الأداة | التكلفة | الاستعمال التجاري في لعبة | ملاحظات | المصدر |
|---|---|---|---|---|
| **Blender** | مجاني | ✅ نعم. ما تصنعه ملكك؛ رخصة GPL تخص البرنامج نفسه وليس أعمالك | رخص الأصول الخارجية التي تضعها داخله تبقى سارية | [blender.org – Blender is Free Software](https://www.blender.org/?p=658) |
| **MPFB / MakeHuman** (الجسم والوجه) | مجاني | ✅ نعم. النموذج المُصدَّر CC0، والأصول الأساسية (الجسم، الجلد، الأهداف) CC0 | **بعض حزم الملابس والشعر CC-BY** (تحتاج ذكر اسم المؤلف في صفحة Credits)، وبعضها CC0. افحص كل قطعة | [MPFB FAQ – closed-source game](https://static.makehumancommunity.org/mpfb/faq/use_in_closed_source.html)، [MPFB FAQ – selling](https://static.makehumancommunity.org/mpfb/faq/can_i_sell_models.html)، [Asset Packs](https://static.makehumancommunity.org/assets/assetpacks/index.html) |
| **Unity Asset Store** (ملابس، دروع، حركات) | 0–60$ | ✅ نعم مع «Standard Unity Asset Store EULA» إذا كانت القطعة مدمجة داخل اللعبة | ⚠️ لا يجوز بيع الملفات نفسها. ⚠️ بعض الحزم «Restricted Asset» أو لها EULA خاصة؛ اقرأ صفحة كل حزمة. ⚠️ تعديل الحزمة في Blender ثم استعمالها داخل اللعبة مسموح عادة، لكن تأكد أن الحزمة لا تمنع التعديل | [Unity Support – commercial game](https://support.unity.com/hc/en-us/articles/205623589-Can-I-use-assets-from-the-Asset-Store-in-my-commercial-game)، [Asset Store EULA FAQ](https://assetstore.unity.com/browse/eula-faq) |
| **Poly Haven** (قوام قماش ومعدن) | مجاني | ✅ نعم، CC0 بلا ذكر اسم | | [polyhaven.com/license](https://polyhaven.com/license) |
| **ambientCG** (قوام) | مجاني | ✅ على الأغلب CC0 | ⚠️ لم أجد صفحة رخصتهم الرسمية في البحث، فقط مصادر ثانوية. افتح ambientcg.com وتأكد | [دليل ثانوي](https://app.cinevva.com/guides/free-textures-hdris-materials) |
| **Mixamo** (العظام + الحركات) | مجاني بحساب Adobe ID | ✅ نعم، بلا عوائد وبلا ذكر اسم إلزامي | ⚠️ لا يجوز توزيع ملفات الحركات الخام وحدها (مثلاً كحزمة أصول). داخل اللعبة مسموح | [Adobe – Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)، [Adobe Community FAQ](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775) |
| **Meshy** (الأسلحة) | مجاني / Pro نحو 20$ شهرياً | الخطة المجانية: ✅ تجاري **بشرط ذكر Meshy** (CC BY 4.0)، والنموذج يكون عاماً. الخطة المدفوعة: رخصة خاصة بلا ذكر اسم | ⚠️ بعض المواقع الثانوية تقول إن المجاني «غير تجاري»؛ صفحة Meshy الرسمية تقول تجاري مع الذكر. **التوصية: اشترك شهراً واحداً Pro (نحو 20$) وقت صنع الأسلحة**، فتكون الرخصة خاصة وتبقى للنماذج التي صنعتها في ذلك الشهر | [Meshy – Pricing & Credits](https://docs.meshy.ai/en/webapp/pricing)، [Meshy – commercial use](https://intercom.help/meshy/en/articles/16102098-can-i-use-meshy-assets-commercially) |
| **Tripo** (بديل للأسلحة) | مجاني / Pro نحو 12–20$ | ❌ **الخطة المجانية: لا.** دليل Tripo نفسه يقول إن Tripo تحتفظ بكل الحقوق في نماذج المستخدم المجاني (البند 5.2.1). الخطة المدفوعة: ✅ | **لا تستعمل نماذج Tripo المجانية في اللعبة أبداً** | [Tripo – How to use Tripo models commercially](https://www.tripo3d.ai/help/privacy-policy/how-to-use-tripo-models-commercially) |
| **DeepMotion Animate 3D** (تصوير الحركة بالهاتف) | مجاني / مدفوع نحو 15–49$ | ❌ **المجاني: استعمال شخصي غير تجاري.** الرخصة التجارية تحتاج اشتراكاً مدفوعاً | للتجربة فقط. ادفع شهراً واحداً حين تصوّر الحركات النهائية | [DeepMotion – Free Animation Credit Program](https://www.deepmotion.com/post/free-animation-credit-program)، [مقارنة ثانوية](https://www.itechguides.com/compare/deepmotion-animate-3d-vs-rokoko-create/) |
| **Rokoko Vision / Rokoko Create** (تصوير الحركة بالهاتف) | مجاني (نحو 30 ثانية شهرياً) / مدفوع | ⚠️ **غير واضح.** شروط الاستعمال الرسمية قديمة (2022)، ومعظم المصادر الثانوية تقول «غير تجاري» | للتجربة فقط حتى تكتب لـ support@rokoko.com وتحصل على جواب مكتوب | [Rokoko – Terms of Use](https://docs.rokoko.com/rkk-vision-documentation/legal/terms-of-use)، [Rokoko Pricing](https://rokoko.com/pricing/) |

**مخاوف رخص يجب أن تعرفها:**
1. **Tripo المجاني و DeepMotion المجاني لا يصلحان للعبة تجارية.** ورخصة Rokoko المجاني غير واضحة.
2. **أي قطعة CC-BY** (بعض ملابس MakeHuman، و Meshy المجاني) تحتاج سطراً في صفحة Credits داخل اللعبة. احتفظ بجدول: اسم القطعة، المؤلف، الرخصة، الرابط، التاريخ.
3. **صور Gemini كمدخل لـ Meshy:** الصور مرجع داخلي. شروط Google لمخرجات Gemini لم أتحقق منها في هذا البحث، وحقوق المؤلف على المحتوى المولَّد بالذكاء الاصطناعي غير محسومة قانونياً في كل الدول. هذا سؤال للمحامي ضمن قائمة الأسئلة القانونية الموجودة.
4. الأسعار تتغير. الأرقام أعلاه من نتائج بحث، وليست عروض أسعار.

**الميزانية المقترحة (ضمن 150$):** Meshy Pro شهر واحد ≈ 20$ + حزمة Asset Store للدروع/الملابس 0–60$ + شهر واحد DeepMotion أو Rokoko مدفوع ≈ 15–20$ (فقط إذا احتجت حركات خاصة) = نحو 35–100$.

---

## 2. التثبيت على اللابتوب (Windows بالألمانية)

### 2.1 Blender
1. افتح المتصفح واذهب إلى `https://www.blender.org/download/lts/`.
2. حمّل أحدث نسخة **LTS** لنظام Windows (ملف `.msi`). ⚠️ قبل التحميل افتح صفحة MPFB وتأكد أن هذه النسخة مدعومة؛ إذا لم يعمل MPFB لاحقاً، ثبّت Blender 4.5 LTS بدلاً منها.
3. افتح مجلد **Downloads** في **Datei-Explorer**، وانقر مرتين على الملف.
4. إذا ظهرت نافذة زرقاء «Der Computer wurde durch Windows geschützt»: اضغط **Weitere Informationen** ثم **Trotzdem ausführen** (فقط لأن الملف من blender.org).
5. نافذة «Möchten Sie zulassen, dass…»: اضغط **Ja**. ثم Next → Next → Install → Finish.
6. افتح Blender. اضغط في أي مكان لإغلاق شاشة البداية.
7. القائمة العلوية **Edit → Preferences → Interface**: تأكد أن **Language** = English.
8. ⚠️ اكتب الأرقام العشرية في Blender بنقطة (`0.5`) وليس بفاصلة ألمانية (`0,5`).

📷 صورة: نافذة Blender مفتوحة ورقم النسخة ظاهر أسفل يمين الشاشة.

### 2.2 MPFB (إضافة MakeHuman داخل Blender)
1. في Blender: **Edit → Preferences → Get Extensions**.
2. أول مرة سيسألك: **Allow Online Access** → اضغطه.
3. في خانة البحث اكتب `MPFB` واضغط **Install**.
4. إذا لم يظهر MPFB في البحث: حمّل ملف zip من صفحة MPFB على `static.makehumancommunity.org` (قسم MPFB → Download)، ثم في **Get Extensions** اضغط السهم الصغير أعلى اليمين ← **Install from Disk…** واختر ملف zip **بدون فك الضغط**.
5. أغلق Preferences. اضغط على مفتاح **N** فوق المشهد ثلاثي الأبعاد: يجب أن يظهر تبويب **MPFB** على الحافة اليمنى.

📷 صورة: تبويب MPFB ظاهر في اللوحة الجانبية.

### 2.3 أصول MakeHuman الأساسية (الجلد والعيون والشعر)
1. افتح `https://static.makehumancommunity.org/assets/assetpacks/index.html`.
2. حمّل **makehuman system assets** (إلزامي). اختيارياً: حزم الشعر والحواجب والملابس.
3. **قبل كل حزمة:** اقرأ رخصتها على صفحتها (CC0 أو CC-BY) واكتبها في جدول الرخص.
4. لا تفك الضغط. في Blender: تبويب **MPFB → Apply assets → Library settings → Asset packs → Load pack from zip file** واختر الملف.

📷 صورة: رسالة نجاح التحميل أو قائمة الأصول بعد التحميل.

### 2.4 الحسابات المجانية
1. **Mixamo:** افتح `https://www.mixamo.com` وسجّل دخولاً بـ Adobe ID (مجاني، بلا اشتراك).
2. **Meshy:** أنشئ حساباً على `https://www.meshy.ai` الآن، لكن لا تدفع حتى تصل إلى الجزء 8.
3. **Unity Asset Store:** سجّل دخولاً بحساب Unity نفسه الذي في Unity Hub.

⚠️ لا تحفظ كلمات المرور في أي ملف داخل مجلد المشروع.

### 2.5 مجلد العمل (خارج المستودع)
أنشئ في **Datei-Explorer → Dokumente** مجلداً `NFOUZ-Art` وفيه: `Scout` و `Ranger` و `Titan` و `Weapons` و `Licences`.

📷 صورة: المجلدات الخمسة.

---

## 3. الميزانية التقنية لهاتف Galaxy A16 (من `art_bible_v2.md` §6)

| الأصل | LOD0 مثلثات | LOD1 | LOD2 | القوام (ASTC 6×6 على Android) | العظام |
|---|---|---|---|---|---|
| Scout | 15–18 ألف | 8 آلاف | 3 آلاف | BaseColor 2048²، Normal 2048²، Mask 1024² (R معدن، G ظل AO، A نعومة)، Emission 512² | Humanoid، نحو 55–65 عظمة مع أصابع مبسطة |
| Ranger | 18–22 ألف | 10 آلاف | 4 آلاف | نفسها | + سلسلتان للمعطف (لاحقاً، بلا محاكاة قماش) |
| Titan | 20–25 ألف | 11 ألف | 4.5 ألف | نفسها | Humanoid بأكتاف عريضة |
| كل سلاح | 3–6 آلاف | 1.5 ألف | 600 | أطلس واحد 2048² مشترك لكل الأسلحة + Emission 512² | نقطة الارتكاز عند المقبض، +Z للأمام |

قواعد إضافية:
- **مادة واحدة (Material) لكل بطل** في النسخة النهائية. للتجربة الأولى مقبول أكثر من مادة، والدمج في الجزء 4.10.
- الشعر بطريقة **Alpha Clip** فقط، وليس شفافاً (Alpha Blend).
- الأطوال: Scout 1.72 م، Ranger 1.84 م، Titan 1.95 م.
- عظام Mixamo «Standard Skeleton» = 65 عظمة مع الأصابع، وهذا داخل الحد.
- الحركات 30 إطاراً في الثانية، وبدون Root Motion.

---

## 4. بناء Scout في Blender بـ MPFB (الشخصية الأولى)

**المرجع:** `scout-portrait.jpg` و `scout-turnaround.jpg`. ما يظهر فيهما: امرأة رياضية نحيفة، شعر أسود قصير (bob) بغرّة جانبية، سترة softshell رمادية مزرقة بقلنسوة، لفاع رقبة رمادي محبوك، صدرية حمل (plate carrier) زيتونية، قفازات بلا أصابع، بنطال كارغو زيتوني، واقيات ركبة، حزام فخذ عليه غمد الخنجر، سماعة أذن صغيرة، حذاء عسكري.

### 4.1 ملف جديد
1. **File → New → General**. اضغط على المكعب، ثم **X → Delete**.
2. **File → Save As…** ← `Dokumente\NFOUZ-Art\Scout\scout_v01.blend`.

📷 صورة: مشهد فارغ واسم الملف في أعلى النافذة.

### 4.2 الجسم
1. **N → MPFB → New human → From scratch**.
2. في قسم **Phenotype** (أو Main): **Gender** = 0% (أنثى)، **Age** ≈ 25–30 سنة، **Muscle** ≈ 55–60%، **Weight** ≈ 40–45%، **Proportions** نحو القيم المثالية.
3. **الطول:** حرّك **Height** ثم تحقق: اختر الجسم، اضغط **N** ← تبويب **Item** ← **Dimensions Z** يجب أن يكون **1.72 m** تقريباً (± 0.02).
4. احفظ (**Ctrl+S**).

📷 صورة: الجسم من الأمام وقيمة Dimensions Z ظاهرة.

### 4.3 الوجه نحو صورة Gemini
1. افتح `scout-portrait.jpg` بجانب Blender (Windows: **Win + ←** و **Win + →** لتقسيم الشاشة).
2. في MPFB **Model** ← أقسام **face** و **eyes** و **nose** و **mouth** و **chin** و **cheek**: غيّر قليلاً في كل مرة.
3. ما نبحث عنه من الصورة: عينان لوزيتان، أنف مستقيم صغير، شفاه متوسطة، فك ناعم، وجه بيضاوي. استعمل أيضاً مزج الأصول العرقية في قسم Phenotype برفق حتى يقترب الوجه من الصورة.
4. قاعدة: **لا تجعل أي ملمح مبالغاً فيه.** الهدف إنسان بالغ حقيقي (`art_bible_v2.md` §1).
5. للمقارنة: اضغط **Numpad 1** (منظر أمامي) ثم **Numpad 3** (جانبي).

📷 صورة: الوجه من الأمام بجانب صورة Gemini.

### 4.4 الجلد والعيون والشعر
1. **MPFB → Apply assets → Skins**: اختر جلداً من system assets يناسب الصورة.
2. **Eyes**: لون بني داكن.
3. **Eyebrows**: رفيعة داكنة. **Eyelashes**: اختياري، لأنها تزيد المثلثات والشفافية.
4. **Hair**: اختر شعراً قصيراً من نوع bob. اكتب رخصته في جدول الرخص.
5. لاحقاً في Unity نجعل مادة الشعر **Alpha Clipping** (الجزء 7.4).

📷 صورة: الرأس بالشعر من الأمام والجانب.

### 4.5 الملابس (قطع مجانية CC0 أو من Asset Store)
**الطريقة الأسهل للمبتدئ:** ابدأ بملابس MakeHuman، لأن MPFB يلبسها للجسم تلقائياً.
1. **MPFB → Apply assets → Clothes**: اختر بنطالاً واسعاً، سترة أو قميصاً بأكمام طويلة، وحذاءً.
2. ابحث في حزم الملابس عن قلنسوة/hoodie أو سترة قريبة من الصورة.
3. **الألوان** حسب الصورة ولوحة `art_bible_v2.md` §2:
   - السترة: رمادي مزرق داكن (قريب من gunmetal `#2F343C`).
   - البنطال والصدرية: زيتوني `#3A4032`.
   - الأحزمة: desert tan `#6C5E45`.
   - طريقة التغيير: اختر القطعة ← تبويب **Material** (الكرة الحمراء في اليمين) ← **Base Color**.
4. **القطع غير الموجودة في MakeHuman** (الصدرية، واقيات الركبة، حزام الفخذ، الغمد):
   - Unity Asset Store: ابحث عن `tactical vest`، `plate carrier`، `knee pads`، `military gear free`. اختر حزمة «Free» أو رخيصة، واقرأ قسم License في صفحتها.
   - لإدخالها إلى Blender: في Unity صدّرها بإضافة **FBX Exporter**، أو استعمل ملف FBX إن كان موجوداً داخل الحزمة. ثم في Blender: **File → Import → FBX (.fbx)**.
   - حرّكها وكبّرها حتى تجلس على الجسم: اختر القطعة، ثم **G** (تحريك)، **S** (تكبير)، **R** (تدوير).
   - ⚠️ لا تضف عظاماً أو تعديلات أوزان؛ Mixamo سيصنع العظام للجميع في الجزء 6.
5. احفظ نسخة جديدة: **File → Save As…** ← `scout_v02.blend`.

📷 صورة: الشخصية كاملة من الأمام والجانب والخلف بجانب `scout-turnaround.jpg`.

### 4.6 حذف الجسم المخفي تحت الملابس
توفير مثلثات ومنع ظهور الجلد من خلال القماش:
1. ملابس MakeHuman تخفي الجسم تحتها تلقائياً عادة (خاصية delete group). تحقق من ذلك بالتدوير حول الشخصية.
2. لما تحت قطع Asset Store: اختر الجسم ← **Tab** (وضع Edit) ← اضغط **3** (اختيار الوجوه) ← اختر الوجوه المغطاة تماماً بالصدرية أو واقيات الركبة ← **X → Faces** ← **Tab** للخروج.
3. لا تحذف الوجوه قرب المفاصل (المرفق، الركبة، الكتف) حتى لا تظهر فجوات حين تتحرك.

📷 صورة: الشخصية بعد الحذف من زاوية الكتف.

### 4.7 حساب المثلثات
1. أعلى يمين المشهد: سهم **Viewport Overlays** ← فعّل **Statistics**.
2. اقرأ رقم **Triangles** أعلى يسار المشهد (مع اختيار كل أجزاء الشخصية، **A**).
3. الهدف: **15,000–18,000**.
4. إذا كان أكثر:
   - في MPFB ابحث عن خيار **Proxy / Topology** أقل كثافة للجسم إن كان متاحاً.
   - أو اختر القطعة الأكثر كثافة ← تبويب **Modifiers** (المفتاح الأزرق) ← **Add Modifier → Generate → Decimate** ← **Ratio** مثلاً `0.5`. ابدأ بالملابس قبل الوجه واليدين.
   - احذف الرموش إذا لزم.

📷 صورة: رقم Triangles ظاهر.

### 4.8 وضعية T أو A
الجسم من MPFB يكون في وضعية A تقريباً. هذا يكفي لـ Mixamo. لا تحرّك الذراعين.

### 4.9 التجهيز للتصدير
1. اختر كل قطعة واحدة واحدة، ثم في **Modifiers** اضغط السهم ← **Apply** لكل modifier (Decimate وغيره).
2. ⚠️ MPFB قد يضيف عظاماً (armature) أو أجساماً مساعدة (helpers). **احذف أي Armature** (اخترها في **Outliner** أعلى اليمين ← **X**)، لأن Mixamo يريد نموذجاً بلا عظام.
3. اختر كل الأجزاء (**A**) ← **Ctrl+J** لدمجها في جسم واحد (Mixamo يتعامل مع جسم واحد بشكل أفضل).
4. **Object → Apply → All Transforms**.
5. تأكد أن القدمين على الأرض (Z = 0) وأن الشخصية تنظر نحو **-Y** في Blender (المنظر الأمامي **Numpad 1** يُظهر الوجه).
6. احفظ `scout_v03_premixamo.blend`.

📷 صورة: Outliner فيه جسم واحد فقط، ورقم Triangles.

### 4.10 (لاحقاً) مادة واحدة وقوام 2048
للتجربة الأولى في Unity، عدة مواد مقبولة. قبل اعتماد Scout نهائياً (`art_bible_v2.md` §10) يجب دمج القوام في مادة واحدة (bake إلى أطلس 2048²). هذه خطوة تقنية أصعب، وسنعملها معاً بتعليمات منفصلة بعد أن تنجح التجربة الأولى.

---

## 5. تصدير FBX من Blender (إلى Mixamo)

1. اختر الجسم المدمج.
2. **File → Export → FBX (.fbx)**.
3. في يمين نافذة الحفظ:
   - **Include → Limit to: Selected Objects** ✅
   - **Object Types:** اختر **Mesh** فقط.
   - **Transform → Scale:** `1.00`، **Apply Scalings:** `FBX All`، **Forward:** `-Z Forward`، **Up:** `Y Up`، **Apply Unit** ✅.
   - **Geometry → Smoothing:** `Face`. **Apply Modifiers** ✅.
   - **Armature:** (لا يوجد الآن) لكن **Add Leaf Bones** ❌ دائماً.
   - **Path Mode:** `Copy` ثم اضغط زر الصندوق الصغير بجانبه (**Embed Textures**) حتى يصبح أزرق.
4. اسم الملف: `scout_for_mixamo.fbx` في `Dokumente\NFOUZ-Art\Scout\`. اضغط **Export FBX**.
5. حجم الملف: إذا تجاوز نحو 40 ميغابايت فقد يرفضه Mixamo (تقارير مستخدمين، ليس حداً رسمياً). قلّل القوام أو المثلثات.

📷 صورة: إعدادات التصدير قبل الضغط على Export.

---

## 6. Mixamo: العظام التلقائية والحركات

### 6.1 رفع الشخصية
1. `https://www.mixamo.com` ← **Upload Character** ← اسحب `scout_for_mixamo.fbx`.
2. شاشة **Auto-Rigger**: ضع الدوائر الملونة: الذقن، المعصمين، المرفقين، الركبتين، والحوض (Groin).
3. **Use Symmetry** ✅. **Skeleton LOD:** `Standard Skeleton (65)` (مع الأصابع، داخل حد 55–65).
4. **Next** وانتظر. إذا ظهرت مشكلة في الوجه أو الشعر بعد الحركة، جرّب مرة أخرى مع وضع الدوائر بدقة أكبر.

📷 صورة: الدوائر على الجسم قبل Next، ثم الشخصية بعد التركيب.

### 6.2 تنزيل الشخصية نفسها (مرة واحدة)
1. بدون اختيار أي حركة (T-pose)، اضغط **Download**.
2. **Format:** `FBX for Unity(.fbx)`، **Pose:** `T-pose`، **Skin:** `With Skin`.
3. احفظ باسم `Scout.fbx`.

### 6.3 الحركات الأولى (7 حركات)
لكل حركة: ابحث بالكلمة، شاهدها، ثم **Download** بهذه الإعدادات:
**Format:** `FBX for Unity(.fbx)`، **Skin:** `Without Skin`، **Frames per Second:** `30`، **Keyframe Reduction:** `none`.

| # | الحاجة | كلمات البحث في Mixamo | إعداد مهم | اسم الملف |
|---|---|---|---|---|
| 1 | وقوف (Idle) | `idle`، `fighting idle`، `breathing idle` | — | `Scout@Idle.fbx` |
| 2 | جري | `running`، `run` | ✅ **In Place** (حتى لا تتحرك الشخصية من مكانها؛ الكود هو الذي يحركها) | `Scout@Run.fbx` |
| 3 | ضربة خفيفة | `stabbing`، `knife`، `slash` | الخنجر بقبضة معكوسة إن وُجد | `Scout@AttackLight.fbx` |
| 4 | ضربة قوية (Shadow Lunge) | `lunge`، `sword slash`، `stab` | | `Scout@AttackHeavy.fbx` |
| 5 | مراوغة | `dodge`، `roll`، `dodging` | ✅ **In Place** إن وُجد الخيار | `Scout@Dodge.fbx` |
| 6 | تلقّي ضربة | `hit reaction`، `receive hit` | | `Scout@Hit.fbx` |
| 7 | سقوط (KO) | `knocked out`، `falling back death`، `dying` | بلا دم (قرار 12+) | `Scout@KO.fbx` |

⚠️ الأسماء في Mixamo قد تتغير؛ أرسل صورة لاسم الحركة التي اخترتها.
⚠️ Mixamo يعطي حركات عامة. توقيت الضربة المعتمد (`art_bible_v2.md` §6): Shadow Dagger ضربة الاتصال عند **0.12 ث**، Shadow Lunge عند **0.25 ث**، المراوغة **0.3 ث**. سنقصّ الحركة في Unity لتقترب من هذا (الجزء 7.5).

احفظ كل الملفات في `Dokumente\NFOUZ-Art\Scout\mixamo\`.

📷 صورة: قائمة الملفات الثمانية في Datei-Explorer.

### 6.4 (اختياري) حركات خاصة بالهاتف
- صوّر نفسك بالهاتف: كاميرا ثابتة، الجسم كاملاً، إضاءة جيدة، ملابس غير فضفاضة، 5–15 ثانية.
- ارفع الفيديو إلى DeepMotion Animate 3D أو Rokoko Vision، وصدّر FBX.
- ⚠️ **الخطط المجانية للتجربة فقط** (الجزء 1). الحركة التي تدخل اللعبة يجب أن تُعاد معالجتها وأنت في شهر مدفوع، أو بعد جواب مكتوب من Rokoko.

---

## 7. الاستيراد إلى Unity (6000.0.58f2)

> هذا إنتاج أصول فقط. لا نضيف أي سكربت ولا نغيّر `NetworkPlayer.prefab` في هذا الجزء.

### 7.1 المجلدات
1. افتح المشروع في Unity Hub.
2. في **Project** ← `Assets/_Project/Art/` ← زر يمين ← **Create → Folder** ← `Characters` ← وداخله `Scout`.
3. اسحب `Scout.fbx` وملفات الحركات السبعة من Datei-Explorer إلى مجلد `Scout`.

📷 صورة: الملفات داخل نافذة Project.

### 7.2 إعداد عظام Scout (Humanoid)
1. اختر `Scout.fbx` ← **Inspector** ← تبويب **Rig**.
2. **Animation Type:** `Humanoid`. **Avatar Definition:** `Create From This Model`. ← **Apply**.
3. اضغط **Configure…**: يجب أن تكون كل العظام **خضراء**. إن ظهر أحمر، صوّره وأرسله.
4. اضغط **Done**.
5. تبويب **Model**: **Scale Factor** = 1. اسحب `Scout.fbx` إلى المشهد مؤقتاً، واختر الجسم ← تأكد أن الطول نحو 1.72 م (قارن بمكعب **GameObject → 3D Object → Cube** حجمه 1 م). ثم احذف الاثنين من المشهد **دون حفظ المشهد**.

📷 صورة: شاشة Configure والعظام خضراء.

### 7.3 إعداد الحركات
لكل ملف `Scout@….fbx`:
1. **Rig → Animation Type:** `Humanoid`. **Avatar Definition:** `Copy From Other Avatar` ← **Source:** `ScoutAvatar` (من `Scout.fbx`). ← **Apply**.
2. تبويب **Animation**:
   - **Loop Time** ✅ فقط لـ Idle و Run.
   - **Root Transform Rotation → Bake Into Pose** ✅.
   - **Root Transform Position (Y) → Bake Into Pose** ✅.
   - **Root Transform Position (XZ) → Bake Into Pose** ✅ (الكود هو الذي يحرّك اللاعب، وليس الحركة).
   - ← **Apply**.

📷 صورة: تبويب Animation لملف Run.

### 7.4 المواد (URP)
1. اختر `Scout.fbx` ← تبويب **Materials** ← **Extract Materials…** ← اختر مجلد `Scout`.
2. كل مادة: **Shader** = `Universal Render Pipeline/Lit`. اسحب صور القوام إلى **Base Map** و **Normal Map**.
3. مادة الشعر والرموش: **Surface Type** = `Opaque` + **Alpha Clipping** ✅ (**Threshold** ≈ 0.5). لا تستعمل Transparent.
4. ⚠️ لا تترك أي مادة `Default-Material` (هذه سبب اللون الوردي).

📷 صورة: الشخصية في المشهد بلا لون وردي.

### 7.5 Animator Controller (للمعاينة فقط)
1. في مجلد `Scout`: زر يمين ← **Create → Animation → Animator Controller** ← الاسم `Scout_Preview`.
2. انقر مرتين ← نافذة **Animator** ← اسحب الحركات السبع إليها. أول حركة تسحبها (Idle) تصبح البرتقالية (الافتراضية).
3. **لا تضف Parameters أو Transitions تعتمد على الكود.** ربط الحركات بالقتال نظام جديد يحتاج موافقتك.
4. للمعاينة: اختر أي حركة ← في أسفل **Inspector** اضغط ▶ في نافذة المعاينة. إن ظهرت الكبسولة بدل Scout، اسحب `Scout.fbx` إلى نافذة المعاينة.
5. **توقيت الضربة:** في تبويب **Animation** للحركة، حرّك **Start/End** حتى تأتي لحظة الاتصال قرب القيمة المعتمدة (0.12 ث للضربة الخفيفة، 0.25 ث لـ Lunge). اكتب لي الإطار الذي اخترته.
6. على أي شخصية في مشهد تجريبي: مكوّن **Animator** ← **Apply Root Motion** ❌.

📷 صورة: نافذة Animator والحركات السبع داخلها.

### 7.6 الضغط للهاتف
1. اختر كل صور القوام ← **Inspector** ← تبويب Android (أيقونة الروبوت) ← **Override for Android** ✅ ← **Format:** `ASTC 6x6 block` ← **Max Size:** 2048 (Mask 1024، Emission 512) ← **Apply**.
2. صور Normal: **Texture Type** = `Normal map`.

📷 صورة: إعداد Android لصورة BaseColor.

### 7.7 لا ترفع شيئاً بعد
لا تعمل commit لهذه الملفات حتى نراجع الصور معاً، ونتأكد من الرخص، ونقرر متى ندخلها المستودع. ملفات `.blend` لا تدخل المستودع أبداً (تبقى في `Dokumente\NFOUZ-Art`).

---

## 8. الأسلحة (Meshy أو Tripo)

**المراجع:** `shadow-dagger.jpg` (نصل J-curve على شكل الخنجر، حافة بنفسجية مضيئة، خلية طاقة عند الواقي)، و `ranger-rifle-ar7-ember.jpg` (خطوط ومخزن بلون كهرماني)، وصورة مطرقة Titan (مكبس، قلب برتقالي ساخن). ⚠️ ورقة مطرقة Titan **غير محفوظة** في `approved/` (رأيتها في الدردشة فقط)؛ احفظها هناك أولاً، أو استعمل `titan-portrait.jpg`.

⚠️ **ملاحظة كود:** الأسلحة الموجودة في الكود (`WeaponDatabase`) هي Pulse Blade و Shadow Dagger و Titan Hammer و Influence Cannon. **AR-7 Ember ليس في الكود.** نصنعه كشكل للبندقية المعتمدة في الصورة، لكن هل هو شكل Influence Cannon أم سلاح آخر؟ هذا قرارك، ولا نضيفه كسلاح جديد في الكود خلال Build Recovery.

### 8.1 الرخصة أولاً
- **Meshy:** اشترك شهراً واحداً **Pro** (نحو 20$) في يوم صنع الأسلحة. النماذج التي تصنعها خلال الاشتراك تبقى برخصة خاصة.
- **Tripo:** فقط باشتراك مدفوع. **لا تستعمل Tripo المجاني**.
- احفظ صورة لصفحة الاشتراك وتاريخه في `Dokumente\NFOUZ-Art\Licences\` (ليس في المستودع).

### 8.2 التوليد
1. Meshy ← **Image to 3D** ← ارفع صورة السلاح. الأفضل: صورة جانبية للسلاح وحده على خلفية فارغة (قصّها من الورقة المعتمدة بأداة **Ausschneiden und skizzieren** في Windows).
2. إذا كان الخيار متاحاً: **Target Polycount** ≈ 5,000 (أو **Remesh** بعد التوليد)، و **Topology:** Triangle، و **PBR** ✅.
3. اختر أفضل نتيجة من 4. **Download → FBX** (أو GLB).

📷 صورة: النموذج في Meshy قبل التنزيل.

### 8.3 التنظيف في Blender
1. **File → Import → FBX** (أو glTF).
2. **Statistics:** الهدف **3,000–6,000** مثلث. إن كان أكثر: **Decimate**.
3. **الطول الحقيقي** (Dimensions في **N → Item**): الخنجر **0.4 م**، المطرقة **1.4 م**، المدفع/البندقية **1.2 م**، Pulse Blade **1.1 م**.
4. **نقطة الارتكاز عند المقبض:** ضع المؤشر الثلاثي الأبعاد على المقبض (**Shift + زر يمين**) ← **Object → Set Origin → Origin to 3D Cursor**. ثم حرّك السلاح حتى يكون المقبض عند (0,0,0).
5. **الاتجاه:** رأس السلاح للأمام. صدّر بنفس إعدادات الجزء 5 (**-Z Forward**, **Y Up**) فيصبح رأسه نحو **+Z** في Unity. تحقق من ذلك في Unity.
6. **الضوء (Emission):** الحافة البنفسجية للخنجر، والخطوط الكهرمانية للبندقية، والقلب البرتقالي للمطرقة (`#FF7A2E`). هذه تصبح **Emission Map** 512² لاحقاً.
7. احفظ `.blend` في `Dokumente\NFOUZ-Art\Weapons\`.

📷 صورة: السلاح مع Dimensions ورقم Triangles.

### 8.4 في Unity
1. ضعه في `Assets/_Project/Art/Weapons/` (مجلد جديد).
2. **Rig → Animation Type:** `None`.
3. مادة URP/Lit، وفعّل **Emission** للأجزاء المضيئة.
4. (لاحقاً) أطلس واحد 2048² لكل الأسلحة الأربعة.

---

## 9. لاحقاً: كيف تحلّ Scout محل الكبسولة في `NetworkPlayer.prefab`

> ⚠️ **لا تنفّذ هذا الجزء الآن.** يحتاج: (1) إصلاح الكبسولة الوردية أولاً، (2) موافقتك، (3) مراجعة الصور. هنا الخطة فقط.

**الخطة البسيطة (شخصية واحدة للجميع):**
1. افتح `Assets/_Project/Prefabs/Networking/NetworkPlayer.prefab` (نقر مزدوج).
2. اسحب `Scout.fbx` إلى **Hierarchy** كابن مباشر للجذر `NetworkPlayer` (وليس تحت `Visual`).
3. **Position** = (0, 0, 0). القدمان عند y = 0، وهذا يطابق `CharacterController` (المركز y = 1، الارتفاع 2 م؛ Scout بطول 1.72 م يدخل فيه).
4. **Rotation** = (0, 0, 0): الوجه نحو +Z، مثل المكعب `Facing`.
5. اختر `Visual` ← أطفئ **Mesh Renderer** فقط (المربع بجانب اسمه). **لا تحذف** `Visual` ولا تغيّر أي مكوّن على الجذر (`NetworkObject` و `CharacterController` و `PlayerCombat` و `NetworkPlayerController`).
6. على Scout: **Animator** ← **Controller:** `Scout_Preview` ← **Apply Root Motion** ❌ ← **Culling Mode:** `Cull Update Transforms`.
7. احفظ الـprefab من داخل Unity، ثم شغّل EditMode و PlayMode وتجربة الجهازين قبل commit.

**ما يحتاج كوداً جديداً وموافقتك (ليس جزءاً من هذا الدليل):**
- **شخصية مختلفة لكل فئة:** prefab واحد بـ `Visual` واحد لا يستطيع أن يُظهر Scout أو Ranger أو Titan حسب `NetworkedClass`. يحتاج «presenter» صغيراً يُظهر واحداً من ثلاثة أبناء (`art_bible_v2.md` §7).
- **تشغيل الحركات عند القتال:** ربط `OnDodgeStarted` و `OnDamageTaken` و `OnDeath` بالـAnimator، وإضافة أحداث للضربة العادية والخاصة (غير موجودة الآن). ويجب أن تبقى النتائج محسومة في الخادم؛ الحركة شكل فقط.
- **فحص يقرأ الملف:** حسب CLAUDE.md، أي تعديل للـprefab يحتاج فحصاً في `backend/tests/unity/` (مثلاً: لا `fileID: 10303`، و `Apply Root Motion` = 0).

---

## 10. Ranger (جسم الرجل المشترك)

**الفكرة الموفِّرة:** جسم رجل واحد في MPFB للـRanger و Titan. الحركات تُشارك بينهما لأن كليهما Humanoid في Unity.

**المرجع:** `ranger-portrait.jpg` و `ranger-turnaround.jpg`: رجل نحيف طويل، لحية مشذبة، سترة جلد بنية بسحّاب، عدسة عين (eyepiece) وسماعة رأس، حافظة على الفخذ.

1. **الجسم الأساسي للرجل:** **MPFB → New human → From scratch** ← **Gender** = 100%، **Age** ≈ 30–35، **Muscle** ≈ 60%، **Weight** ≈ 45%. احفظه `male_base.blend` في `Dokumente\NFOUZ-Art\`. **هذا هو الجسم المشترك.**
2. **File → Save As** ← `Ranger\ranger_v01.blend`. اضبط الطول حتى **Dimensions Z = 1.84 m**.
3. الوجه واللحية المشذبة حسب الصورة (أقسام face، و beard من حزمة beards CC0).
4. الملابس: سترة بنية (`#2A1F19` تقريباً، أو بني جلدي من الصورة) من MakeHuman أو Asset Store (ابحث `leather jacket`). العدسة والسماعة قطعتان صغيرتان من Asset Store أو مكعبات بسيطة مشكلة في Blender.
5. **المثلثات: 18,000–22,000.**
6. كرّر الأجزاء 4.6 إلى 7.4 بنفس الطريقة (ملف `Ranger.fbx`).
7. **الحركات:** حمّل من Mixamo فقط ما يختلف عن Scout: وقوف بسلاح (`rifle idle`)، جري بسلاح (`rifle run`، **In Place**)، ضربة خفيفة = إطلاق (`firing rifle`)، ضربة قوية = إطلاق مشحون (`shooting`). المراوغة والضربة والسقوط يمكن نسخها من Scout (**Copy From Other Avatar** ← `RangerAvatar`).
8. التوقيت المعتمد للمدفع: ضربة **0.25 ث**، Charged Pulse **0.65 ث**.
9. لاحقاً: سلسلتا عظام للمعطف إن صار معطفاً طويلاً (ليس في صورة Gemini الحالية).

📷 صورة: Ranger كاملاً بجانب `ranger-turnaround.jpg`، ورقم Triangles.

---

## 11. Titan (نفس جسم الرجل، أضخم)

**المرجع:** `titan-portrait.jpg` و `titan-turnaround.jpg`: رجل ضخم، لحية كاملة، خوذة مفتوحة الوجه بخطوط برتقالية، درع رمادي داكن بأكتاف زيتونية، شبكة صدر (مشربية) يتوهج خلفها لون برتقالي، أحزمة وجيوب، واقيات ساق.

1. افتح `male_base.blend` ← **Save As** ← `Titan\titan_v01.blend`.
2. **Muscle** ≈ 85–90%، **Weight** ≈ 60–65%، الطول **Dimensions Z = 1.95 m**، أكتاف أعرض.
3. لحية كاملة (حزمة beards CC0).
4. **الدرع:** من Asset Store (ابحث `sci-fi armor`، `heavy soldier`، `power armor modular`). اقرأ الرخصة. اللون gunmetal `#1A1E26`/`#2F343C` والأكتاف olive `#3A4032`.
5. **شبكة الصدر:** لوح بسيط في Blender بنقش مشربية، وخلفه مادة Emission برتقالية `#FF7A2E`.
6. **حذف الجسم تحت الدرع (4.6) مهم جداً هنا**، فالدرع يغطي معظم الجسم.
7. **المثلثات: 20,000–25,000.**
8. Mixamo: ضع دوائر الأكتاف بدقة لأن الدروع العريضة قد تربك التركيب. إن تشوهت الأكتاف عند الحركة، أرسل صورة.
9. **الحركات:** ضربة ثقيلة بالمطرقة (`great sword slash`، `hammer`، `two hand attack`)، وضربة الأرض (`ground slam`، `jump attack`)، ووقوف ثقيل (`great sword idle`). الباقي ينسخ من Scout أو Ranger.
10. التوقيت المعتمد للمطرقة: ضربة **0.55 ث**، Ground Break **0.75 ث**.
11. ملاحظة: حارس الإنقاذ (Rescue Guard NPC) سيعيد استعمال عظام Titan لاحقاً.

📷 صورة: Titan كاملاً بجانب `titan-turnaround.jpg`، ورقم Triangles.

---

## 12. قائمة التحقق قبل اعتماد أي شخصية (من `art_bible_v2.md` §10)
- [ ] الطول والنِّسَب صحيحة، والظل الأسود يُقرأ بحجم 64 بكسل ومن كاميرا المعركة.
- [ ] ألوان من اللوحة فقط. لون الفصيل لا يظهر على الجسم.
- [ ] الميزانية: المثلثات، القوام، العظام. مادة واحدة لكل بطل (بعد الجزء 4.10).
- [ ] URP/Lit فقط. لا `Default-Material`.
- [ ] جدول الرخص كامل لكل قطعة (المؤلف، الرخصة، الرابط، التاريخ)، ومحفوظ خارج المستودع، وأسطر Credits جاهزة لقطع CC-BY.
- [ ] لا كلمات مرور، ولا فواتير، ولا مفاتيح في المستودع.
- [ ] الحالة في `STATUS.md`: «PARTIAL» حتى يعمل على الهاتف بـ 30 إطاراً في الثانية، مع صورة دليل.

</div>
