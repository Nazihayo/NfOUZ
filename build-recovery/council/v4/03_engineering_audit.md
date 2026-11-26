# NFOUZ — تدقيق هندسي (Council v4، المدير التقني / المدقّق الهندسي)

> **الحالة: تقرير تدقيق فقط.** لم يُغيَّر أي ملف غير هذا. لم يُقرأ أي ملف أسرار.
> كُتب في 2026-11-26 على الفرع الحالي، آخر commit في السحابة `64a967d`.
> كود C# المكتوب في السحابة **غير مُترجَم (UNCOMPILED)** حتى يترجمه اللابتوب.
> commits اللابتوب غير المرفوعة (سجلات D12 المؤقتة، إصلاح مواد URP `289d726`) **لم أرها**.
> كلمات الحالة حسب `CLAUDE.md`: VERIFIED / PARTIAL / FAILED / BLOCKED.

---

## 0. الخلاصة

| السؤال | الجواب |
|---|---|
| هل اللعبة قابلة للعب؟ | **لا.** معركة الجهازين تتصل (D8 VERIFIED) لكن لا حركة ولا ضرر (D12 FAILED). |
| جودة الخادم؟ | **جيدة لمرحلة Alpha.** منطق محكم، معاملات (transactions)، توقيع HMAC، 498 اختباراً تمر. |
| جودة عميل Unity؟ | **متوسطة.** الشبكة تعمل، لكن القتال مبني على `Update()` ومؤقّتات محلية، والعميل يثق ببيانات اللاعب الآخر. |
| أكبر خطر تقني | سلطة الـHost (D9) + ثغرة جديدة: **العميل يرسل صحته وفئته بنفسه بلا حد أعلى** (§5، B1). |
| أكبر خطر تشغيلي | **مطوّر واحد + لابتوب واحد** هو الوحيد الذي يترجم Unity، وعليه commits غير مرفوعة. |
| «منافسة GTA 6»؟ | غير واقعي تقنياً ولا مالياً لفريق فرد+AI. الواقعي: **لعبة موقع جغرافي متينة بقتال قصير ممتع**، بجودة «تجارية صغيرة». |

### تحقق الحزمة اليوم

| الفحص | الحالة | الدليل |
|---|---|---|
| `backend npm test` | **VERIFIED** (سحابة، 2026-11-26) | 36 suites / 498 tests passed، 4.1 s |
| اختبارات قاعدة البيانات `test:contract:db` | BLOCKED | تحتاج Postgres؛ غير موجودة في CI |
| ترجمة Unity لـ`64a967d` | BLOCKED هنا | آخر ترجمة VERIFIED كانت `e77d87a` على اللابتوب |
| معركة جهازين حقيقية | FAILED | `STATUS.md` E3/E4/E5 |

---

## 1. نقاط القوة (بدليل)

| # | القوة | الدليل |
|---|---|---|
| S1 | كل مسار «أنا» يأخذ الهوية من رمز Firebase، لا من الجسم | `backend/src/middleware/auth.middleware.js:28-32`، `controllers/player.controller.js:14` |
| S2 | نتيجة المعركة موقّعة HMAC-SHA256 بسر لكل معركة، مقارنة آمنة زمنياً | `utils/battleResultSignature.js:50-74` |
| S3 | تحقق كامل من النتيجة: هوية، غرفة، nonce، event_seq، عمر، حدود، تناقضات | `services/battle.service.js:505-598` |
| S4 | تطبيق النتيجة ذري داخل معاملة واحدة مع حارس `WHERE status='in_progress'` | `battle.service.js:623-736` |
| S5 | السر يُعاد للمهاجم فقط، ولا يظهر في `GET /battle` | `controllers/battle.controller.js:64`، تعليق :221 |
| S6 | مدى التحدي يُحسب من مواقع الخادم المخزنة فقط | `battle.service.js:131-150` |
| S7 | إخفاء الموقع الدقيق بعد 50 م (خلايا خشنة ضد التثليث) | `services/location.service.js` (`EXACT_LOCATION_WITHIN_METERS`) |
| S8 | الإنقاذ: النتيجة يقرّرها الخادم مسبقاً، رمز لمرة واحدة | `services/rescue.service.js:269-281` |
| S9 | دورة حياة المعارك كسولة بلا مجدول، مع قواعد واضحة | `utils/battleLifecycle.js:12-41`، `repositories/battle.repository.js:216-243` |
| S10 | اختبارات نصية لأصول Unity (مشاهد/prefabs/ProjectSettings) تعمل في CI | `backend/tests/unity/*.test.js`، `.github/workflows/backend-tests.yml` |
| S11 | خطاف pre-push يمنع الدفع إذا فشلت الاختبارات | `.claude/hooks/pre-push-tests.sh` |
| S12 | انضباط توثيق نادر: كل خلل بجذر ودليل | `build-recovery/STATUS.md` (D1–D12) |
| S13 | حدود سرعة وسلامة القيادة (لا تحدٍّ أثناء القيادة) | `battle.service.js:222-232`، `utils/playerSafety.js` |

---

## 2. نقاط الضعف (بدليل)

### 2.1 عميل Unity / القتال

| # | الضعف | الدليل | الأثر |
|---|---|---|---|
| W1 | الحركة بلا حد للساحة | `Networking/NetworkPlayerController.cs:327` يضيف للموقع بلا `ClampToArena`؛ الحد موجود فقط في الاندفاع `Combat/PlayerCombat.cs:505,627` و`Constants.cs:70` (15 م) | جزء من D12: اللاعب يخرج من الساحة |
| W2 | منطق القتال والمؤقتات في `Update()` بـ`Time.deltaTime` لا في tick الشبكة | `Combat/BattleManager.cs:135-175`، `PlayerCombat.cs:200-290` | كل جهاز يحسب نهاية الوقت وحده (سبب Overtime في D11/E5)؛ لا يصلح لـlag compensation أو Server Mode |
| W3 | `Render()` لا يعمل interpolation فعلي، يكتب الحالة الخام | `NetworkPlayerController.cs:339-345` | تقطيع للخصم البعيد على شبكة الهاتف (غير مُقاس) |
| W4 | صحة الخصم من جدول الفئة الأساسي، وصحتي من الجلسة | `BattleManager.cs:470-479` | D11: نسب مختلفة على الجهازين |
| W5 | المادة الافتراضية (وردية تحت URP) في prefab اللاعب | `Prefabs/Networking/NetworkPlayer.prefab:67,334` (`fileID: 10303`) | D12؛ الإصلاح `289d726` على اللابتوب فقط |
| W6 | لا Animator، لا صوت، لا ردّ فعل ضربة | لا يوجد في `Scripts/` | لا «إحساس» قتال حتى لو عملت الحركة |
| W7 | الإدخال بنظام Input القديم فقط | `ProjectSettings.asset:776` `activeInputHandler: 0`، `TouchStick.cs:28` | مقبول الآن؛ يجب ألا يُبدَّل لـInput System دون نقل `TouchStick` |
| W8 | الكود الإنتاجي يعتمد على تجميع أمثلة Mapbox | `Nfouz.Runtime.asmdef:9` `MapboxExamples`، `Map/MapboxManager.cs:6` | ترقية Mapbox قد تكسر البناء |
| W9 | سجل Fusion بمستوى INFO و145 `Debug.Log` في بناء Android | `ProjectSettings.asset:679` `FUSION_LOGLEVEL_INFO` | كلفة CPU/GC على A16 (غير مُقاس) |
| W10 | لا تقارير أعطال ولا تحليلات | لا `Crashlytics/Analytics/Sentry` في `Scripts/` | لا نعرف معدل الأعطال ولا سلوك اللاعبين |

### 2.2 الخادم / العمليات

| # | الضعف | الدليل | الأثر |
|---|---|---|---|
| W11 | `rate limit` في الذاكرة | `middleware/rateLimit.middleware.js:23` (store افتراضي) | يتعطل مع أكثر من نسخة خادم |
| W12 | مسارات كثيرة بلا حد معدل (`resolve`, `ready`, `inventory/*`, `quests/claim`, `rescue/*`, `friends/accept`) | `routes/*.js` | إغراق رخيص؛ council backend M6 مفتوح |
| W13 | `keepAliveTimeout` غير مضبوط (افتراضي Node 5 s) مع استطلاع كل 5 s | `server.js:20` | **فرضية** لـD10 (`CurlError 52`)، غير مثبتة |
| W14 | SSL لقاعدة البيانات بلا تحقق من الشهادة | `config/database.js:15` `rejectUnauthorized: false` | عرضة لـMITM في الإنتاج |
| W15 | لا `statement_timeout` في المجمع | `config/database.js:13-19` | استعلام عالق يستهلك الاتصالات |
| W16 | الاستطلاع (polling) بدل WebSocket | `incomingChallengeLimiter` (5 s)، `SosPolling.cs` | كلفة وتأخير عند التوسع |
| W17 | لا أداة إدارة: لا حظر حسابات، لا مراجعة `pending_review` | لا `banned` في `src/` أو `migrations/` | لا يمكن معاقبة غشاش أو مراجعة نتيجة |
| W18 | CI: لا lint، لا اختبارات DB، لا بناء Unity، لا `npm audit` | `.github/workflows/backend-tests.yml` | أخطاء SQL لا تُكتشف إلا يدوياً |
| W19 | منشّئ الترحيل لا يلف الملف والسجل في معاملة واحدة | `scripts/run-migrations.js:36-40` | مخفَّف: 22 من 23 ملفاً فيها `BEGIN` |

---

## 3. أعلى المخاطر

### 3.1 للوصول إلى Alpha قابلة للعب

| # | الخطر | الاحتمال | الأثر | التخفيف |
|---|---|---|---|---|
| R1 | D12 يبقى بلا جذر لأن لا سجل للإدخال | عالٍ | يوقف كل شيء | السجلات المؤقتة على اللابتوب + فحص Inspector (§4.1) |
| R2 | commits اللابتوب تضيع (قرص، سرقة) | متوسط | أسابيع عمل | دفعها اليوم لفرع |
| R3 | كود سحابي غير مترجم يتراكم (`BattleVisualSetup.cs`) | عالٍ | انكسار عند الدمج | ترجمة كل دفعة سحابية على اللابتوب قبل التالية |
| R4 | D11 (الصحة المخزنة للحسابات القديمة) | مؤكَّد | نتائج خاطئة | قرار backfill + مصدر واحد لـMaxHealth |
| R5 | أداء A16 غير مقاس إطلاقاً | — | قد لا تُلعب | جلسة Profiler على Development build |

### 3.2 للإطلاق القابل للتوسع

| # | الخطر | التفصيل |
|---|---|---|
| R6 | **الغش عبر الـHost** (D9) | المهاجم = Host = يملك السر ويقرّر الضرر. مقبول لـAlpha فقط؛ لا جوائز قبل الخوادم المخصصة |
| R7 | **الغش عبر العميل** (B1 أدناه) | العميل يعلن صحته وفئته؛ لا يحتاج أن يكون Host |
| R8 | **الهروب يمحو الخسارة** | الانسحاب → `forfeited` بلا Influence (`battleLifecycle.js:13-17`)؛ council H3 مفتوح ينتظر قراراً |
| R9 | **تزييف GPS** | الحد الوحيد 300 km/h (`location.service.js:11`)؛ لا كشف mock location، لا Play Integrity/App Attest |
| R10 | Photon بلا Custom Authentication | أي عميل بـApp ID (يُستخرج من الـAPK) يستطيع الاتصال؛ اسم الغرفة UUID يقلل الخطر فقط |
| R11 | التوسع الأفقي | rate limit في الذاكرة، polling، لا Redis |
| R12 | Bus factor = 1 | لا CI لـUnity، لا نسخ احتياطي موثق لقاعدة البيانات، لا runbook |
| R13 | الكلفة | خوادم Fusion مخصصة + Mapbox + Photon CCU تنمو مع اللاعبين؛ الأرقام في `v3/05_tech_roadmap.md` §3.4 و§4.4 تقديرية |
| R14 | الامتثال | سيلفي/بيومتري (v3 §2.5)، موقع قاصرين، GDPR (المالك في ألمانيا): يحتاج رأياً قانونياً |

---

## 4. ماذا تعني «المنافسة مع أقوى الألعاب» تقنياً

| المتطلب | ما تفعله الألعاب الكبيرة | وضعنا | الواقعي لفرد + AI |
|---|---|---|---|
| سلطة الخادم | خوادم مخصصة تشغّل المحاكاة | Host Mode | **Fusion Server Mode headless في Beta** (Photon أو Edgegap/Hathora)، جهد كبير لكنه ممكن |
| مكافحة الغش | خادم + كشف + حظر + سلامة الجهاز | توقيع + حدود تقريبية | Server Mode + Play Integrity/App Attest + حظر + مراجعة `pending_review` |
| معدل الأعطال | < 0.5% جلسات، ANR < 0.47% (حد Google Play) | غير مقاس | Crashlytics (Firebase موجود أصلاً) — جهد صغير |
| الأداء | 60 fps ثابت | غير مقاس | 30 fps ثابت على A16 للمعركة هدف معقول (v3 §1.2) |
| الحركة | prediction + interpolation + lag comp | لا interpolation حقيقي، المؤقتات محلية | نقل القتال لـ`FixedUpdateNetwork` + `NetworkTransform`/Hitboxes من Fusion |
| Live-ops | لوحات إدارة، Remote Config، أحداث، A/B | لا شيء | Firebase Remote Config + لوحة إدارة صغيرة + جدول أحداث |
| التحليلات | قمع كامل، احتفاظ D1/D7/D30 | لا شيء | Firebase Analytics/GA4 + أحداث مسماة، جهد صغير |
| العمليات | مراقبة، تنبيهات، نشر آلي | تشغيل محلي | خادم مُدار (Cloud Run/Render/Fly) + Postgres مُدار + uptime alerts |
| الرسوميات «GTA 6» | مئات الفنانين، سنوات | كبسولات | **غير ممكن.** الممكن: «شبه واقعي مصقول» في الشاشات الثابتة، و30 fps في المعركة |

**الحكم الصادق:** لا يمكن مجاراة GTA 6 في الحجم أو الرسوميات. يمكن المنافسة في
**الفكرة** (قتال الشارع الحقيقي، عربي أولاً) و**الثبات** (لا أعطال، لا غش ظاهر).
هذا يتطلب أن يكون الأساس الهندسي متيناً قبل أي ميزة جديدة.

---

## 5. أخطاء حقيقية وجدتها (تقرير فقط، لم أصلح شيئاً)

| # | الخطأ | الدليل | الخطورة | يقين |
|---|---|---|---|---|
| **B1** | **العميل يحدد صحته وفئته بنفسه.** `RPC_SetProfile` يقبل أي `health > 0` وأي فئة معروفة، بلا حد أعلى وبلا مقارنة بالخادم. عميل معدَّل (Scout 80) يعلن 150 صحة أو فئة Titan. عند نهاية الوقت يفوز بالنسبة 150/80. الخادم لا يعلّم إلا ≥ 160 (`battle.service.js:464-480`، حد عام لا لكل لاعب) | `NetworkPlayerController.cs:235,240-259`؛ `BattleManager.cs:478` يأخذ MaxHealth الخصم من جدول الفئة المعلنة | عالية (غش من غير الـHost) | عالٍ من قراءة الكود؛ غير مُجرَّب |
| B2 | الحركة لا تُقيَّد بالساحة | `NetworkPlayerController.cs:327` | متوسطة | مؤكد (معروف ضمن D12) |
| B3 | النتيجة تُقبل بلا تحقق أن الطرفين «جاهزان» | لا فحص `attacker_ready/defender_ready` في `resolveBattle` (`battle.service.js:505-520`) | متوسطة | مؤكد؛ council backend M1 مفتوح |
| B4 | الانسحاب يلغي الخسارة | `battleLifecycle.js:13-17`، `battle.repository.js:228` | متوسطة (اقتصاد) | مؤكد؛ H3 ينتظر قراراً |
| B5 | مهمة «المسافة» تُحتسب أثناء القيادة وحتى 300 km/h، وارتجاف GPS يُحتسب أيضاً | `location.service.js:59,70` (لا شرط على `fastMovementAt`) | منخفضة–متوسطة (يناقض روح السلامة) | مؤكد في الكود؛ هل هو مقصود؟ يحتاج GDD |
| B6 | SSL قاعدة البيانات بلا تحقق | `config/database.js:15` | متوسطة في الإنتاج | مؤكد |
| B7 | مؤقت المباراة محلي على كل جهاز | `BattleManager.cs:162` | متوسطة | مؤكد؛ council unity M1 |

**ملاحظة B1:** لا يدخل تحت D9 (غش الـHost المقبول). هذا غش من المدافع. الإصلاح
الصغير المقترح (يحتاج موافقة): الخادم يعيد `max_health` للطرفين في جلسة المعركة،
والـHost يرفض أي صحة > MaxHealth المخزن، والخادم يقارن `*_final_health` بـ`max_health`
لكل لاعب (اقتراح council backend السطر 306).

---

## 6. ما يجب فحصه لـD12 (فرضيات، ليست أسباباً)

| # | الفرضية | كيف تُختبر |
|---|---|---|
| H-a | `SendMovementInput` لم يصبح true على أحد الجهازين (يُفعَّل فقط في `BattleLoadingController.cs:222` بعد العدّ) | سجل في `PhotonConnectionManager.OnInput` |
| H-b | `TouchStick.Tick()` لا يُستدعى لأن `BattleScreen` غير نشط | سجل في `BattleScreen.cs:78` |
| H-c | العميل لا يحاكي أفاتاره (prediction) فيبدو ثابتاً حتى يصل الـsnapshot | Inspector: `NetworkedPosition` على الـHost أثناء ضغط المفاتيح |
| H-d | المسافة 12.00 م ثابتة = نقاط الظهور؛ لا أحد تحرك فعلاً على الـHost | سجل `NetworkedPosition` كل ثانية على الـHost |

---

## 7. الخطة الهندسية المرتّبة

الرموز: **BR** = مسموح في Build Recovery. **قرار** = يحتاج موافقة المالك. **جديد** = ميزة جديدة (ممنوع الآن).
الجهد: S ≤ يوم، M = 2–5 أيام، L = 1–3 أسابيع، XL > 3 أسابيع.

### 7.1 الأسبوعان القادمان (هدف: معركة حقيقية بين جهازين، VERIFIED)

| # | البند | الجهد | BR؟ |
|---|---|---|---|
| 1 | دفع commits اللابتوب (`289d726` + السجلات) لفرع بعيد | S | BR |
| 2 | ترجمة `64a967d` على اللابتوب + EditMode/PlayMode + تسجيل النتيجة | S | BR |
| 3 | جذر D12 بالسجلات وInspector (§6)، ثم الإصلاح الأصغر | M | BR (إصلاح خلل) |
| 4 | تقييد الحركة بـ`ArenaRadiusMeters` في `ApplyMovement` + اختبار EditMode | S | BR (خلل) |
| 5 | Joystick مرئي (صورة للعصا الموجودة) + مادتان مختلفتان للاعبين | S | BR (أصول لما في الكود) |
| 6 | D11: مصدر واحد لـMaxHealth (الخادم) + backfill للحسابات القديمة | M | قرار (backfill) |
| 7 | B1: سقف للصحة/الفئة في `RPC_SetProfile` + مقارنة لكل لاعب في الخادم | S–M | قرار (تصحيح أمني) |
| 8 | D10: `server.keepAliveTimeout = 65 s` و`headersTimeout` أكبر، ثم إعادة الاختبار | S | قرار (اختبار فرضية) |
| 9 | المعركة الثالثة بالقائمة `FIRST_BATTLE_CHECKLIST.md` (E1–E7) | S | BR |
| 10 | Postgres service في CI لتشغيل `test:contract:db` + `npm run lint` | S | BR (أدوات) |

### 7.2 Alpha (6–8 أسابيع بعد معركة ناجحة)

| # | البند | الجهد | BR؟ |
|---|---|---|---|
| 11 | مؤقت مباراة مشترك: `[Networked] TickTimer` بدل `Time.deltaTime` | M | قرار |
| 12 | نقل cooldowns والضرر إلى `FixedUpdateNetwork` (تمهيد لـServer Mode) | L | قرار (إعادة هيكلة) |
| 13 | interpolation حقيقي (`NetworkTransform` من Fusion) | M | قرار |
| 14 | B3: اشتراط الجاهزية في `resolveBattle` | S | قرار |
| 15 | B4/H3: قاعدة الانسحاب (خسارة أو عقوبة) | S | قرار (GDD) |
| 16 | Crashlytics + Analytics (Firebase موجود) | S–M | جديد (أدوات) |
| 17 | حدود معدل لباقي المسارات (W12) | S | قرار |
| 18 | قياس A16: Profiler 30 د، هدف 30 fps، تقليل السجلات في Release | M | BR |
| 19 | نشر الخادم مُداراً (Postgres مُدار + HTTPS + نسخ احتياطي يومي) | M | قرار |
| 20 | CI لـUnity (GameCI مع رخصة) لترجمة كل push — يكسر bus factor | M | قرار (كلفة رخصة) |

### 7.3 Beta (4–5 أشهر)

| # | البند | الجهد | BR؟ |
|---|---|---|---|
| 21 | **Fusion Server Mode headless** + نقل السر للخادم (يغلق D9) | XL | جديد |
| 22 | Photon Custom Authentication عبر الخادم (رمز Firebase) | M | جديد |
| 23 | Play Integrity (Android) / App Attest (iOS) + كشف mock location | L | جديد |
| 24 | لوحة إدارة: حظر، مراجعة `pending_review`، سجل الغش | L | جديد |
| 25 | Redis (rate limit مشترك، حضور GEO) + WebSocket بدل polling | L | جديد |
| 26 | Remote Config + أحداث live-ops | M | جديد |
| 27 | بناء iOS عبر Codemagic (v3 §5) | M | جديد |
| 28 | اختبار حمل (k6) للخادم: 1k مستخدم متزامن | M | جديد |

---

## 8. ما هو واقعي لمطوّر واحد + AI

| واقعي | غير واقعي |
|---|---|
| خادم Node متين (موجود فعلاً) | عالم مفتوح بحجم GTA |
| قتال 1v1 قصير مع Server Mode | MMO بمئات اللاعبين في معركة |
| 3 أبطال بمسار CC4 هجين (v3 §2.2) | شخصيات photoreal وحركة وجه كاملة |
| Firebase للأعطال والتحليلات وRemote Config | مكافحة غش kernel-level |
| 30 fps على A16 | 60 fps ثابت على A16 مع ظلال وpost |

**شرط الواقعية:** AI يكتب الكود، لكن **اللابتوب وحده يثبت أنه يعمل**. كل دفعة سحابية
بلا ترجمة = دين. أوصي بـ: دفعة سحابية واحدة ← ترجمة ← اختبار جهازين ← التالية.

---

## 9. عدم اليقين

- لم أشغّل Unity ولا اختبارات DB هنا. كل حكم على C# من القراءة فقط.
- لم أرَ commits اللابتوب؛ قد تغيّر W5 وD12.
- B1 لم يُجرَّب بعميل معدَّل؛ مبني على قراءة `NetworkPlayerController.cs` و`BattleManager.cs`.
- سلوك prediction في Fusion 2 Host Mode للعميل (H-c) يحتاج تحققاً من التوثيق والـInspector.
- لم أفحص `resolveGuardBattle` قبل `guard_battle_ends_at`، ولا `ChargedPulseProjectile`.
- أرقام الكلفة في v3 تقديرية حتى أواخر 2026، ليست عروض أسعار.
