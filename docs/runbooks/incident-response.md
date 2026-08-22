# دليل التشغيل: الاستجابة للحادث (incident-response)

> **القاعدة الحاكمة RULE-000:** وثّق كل ما قمت به واترك ما تبقّى. النص: `../../GOVERNING_RULE.md`
> **المرحلة:** 11 (مطلوب) → أُنجز في المرحلة 36 · **المالك:** حرس التاج · **المراقب:** ديوان التدقيق

## الثقب الذي أوجب هذا الدليل (قياسٌ لا رأي)

قبل المرحلة 36 كان في المستودع **مؤقّت واحد** (`src/crown/king_monitor.ts`) مقابل **ستة**
ماسحات تنتظر نداءً يدويًّا (`region_monitor.sweep`، `load_ledger.reconcile`،
`digital_unit.reconcile`، `factory_runtime.sweep`، `hospital_runtime.reconcile`،
`data/retention.sweep`). والقياس الفاصل:

> إقليمان مفوَّضان بمقعد حاكم خالٍ و`vacancyGraceMs = 300`. بعد **1500 مللي ثانية حقيقية**
> (خمسة أضعاف المهلة): سجلّات جديدة = **0**، رايات = **0**، الوضع `normal`.
> نداءٌ يدويٌّ واحد لـ `sweep()` رفع **رايتين** فورًا (`delegated_without_governor/high`).

**الخلاصة:** الحادث كان قائمًا والدولة لا تعلمه، وعلمته في اللحظة التي سُئلت فيها.
هذا الدليل يُخرج الاستجابة من انتظار السؤال إلى مرور الزمن.

## المتطلبات قبل التنفيذ

- النافذة لم تبدأ بعد: الاحتواء يسبق المراقبة كي تُقاس النافذة على حالٍ معلوم.
- جهة الاحتواء `authority:crown_guard` (`GOVERNOR_EXECUTOR`) — لا إقليم يحتوي نفسه.

## الخطوات

### 1 — مسح الأقاليم واحتواء كل راية قائمة
- **الفعل:** `regionMonitor.sweep(now)` ثم `contain(GOVERNOR_EXECUTOR, regionId, kind, reason, now)`
  لكل راية غير محتواة، تكرارًا حتى `outstanding() === 0`.
- **التحقّق:** `regionMonitor.outstanding().length === 0`.
- **الأثر المتوقع:** لا راية غير محتواة بعد الخطوة.

### 2 — إثبات خلوّ حرس النطاق من خرق قبل النافذة
- **الفعل:** قراءة `operationScope.violations()`.
- **التحقّق:** العدد صفر.
- **الأثر المتوقع:** أي خرق نطاق داخل النافذة يُنسَب إليها هي لا إلى ما قبلها.

## أثناء النافذة: من يستجيب؟

لا يد بشرية. `IncidentMonitor` يمسح كل `window.tick_ms` بمؤقّت حقيقي، ولكل حادث شدّةٌ
**من التهيئة** لا من الماسح:

| الشدّة | المصدر | الأثر |
|---|---|---|
| حرج | `severity.critical` في `config/staging.yaml` | إيقاف الدولة فورًا + `staging_critical_halt` + تصعيد |
| جسيم | `severity.high` | قيدٌ وتصعيد بلا إيقاف |
| ماسح انهار | — | `staging_watch_failed` + `failedTicks` — الصمت أخطر من الفشل |

الحوادث الحرجة المعلنة: `authority_without_holder`، `crown_domain_drift`،
`audit_chain_broken`، `scope_violation`، `terminated_entity_acting`.

## أمر التنفيذ والتحقّق

```bash
node --test dist/tests/staging/incident_monitor.test.js   # منها القياس الفاصل بمؤقّت حقيقي
```

## شرط النجاح

`monitorReport.failedTicks === 0` و `critical === 0` وكل حرس معلن مسح مرّة على الأقل
(`watchTicks[watch] >= 1`). حرسٌ معلن لم يمسح قطّ يُسقط الحكم برمز `STAGE_WATCH_NOT_OBSERVED`.

## من يُبلَّغ

| الحالة | الجهة | القيد |
|---|---|---|
| حادث جسيم | ديوان التدقيق | `staging_incident` (`severity: high`) |
| حادث حرج | حرس التاج + الملك | `staging_critical_halt` ثم `halt-and-recover.md` |

## المتبقّي المعلن

- الماسحات الخمسة الأخرى (الأحمال، الوحدة الرقمية، المصانع، المستشفيات، الاحتفاظ) لا تزال
  تنتظر نداءً: لم يُربط بها حرسٌ مؤقَّت بعد. مُقيَّد في `PROGRESS.md` كبندٍ مفتوح للمرحلة 37.
