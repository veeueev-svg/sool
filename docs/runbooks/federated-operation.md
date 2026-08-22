# دليل التشغيل: التشغيل الاتحادي (federated-operation)

> **القاعدة الحاكمة RULE-000:** وثّق كل ما قمت به واترك ما تبقّى. النص: `../../GOVERNING_RULE.md`
> **المرحلة:** 37 (التشغيل الاتحادي) · **المالك:** الديوان الملكي يُشغّل · **المراقب:** ديوان التدقيق يحكم

## لماذا هذا الدليل قابلٌ للتنفيذ لا للقراءة

لكل خطوة هنا **ثلاثة تمثيلات مقيَّدة معًا**، كما أُقرّ في المرحلة 36:

| التمثيل | الموضع |
|---|---|
| الوصف للبشر | هذا الملف |
| الإعلان المقروء آليًّا | `deploy/production/runbooks/federated-operation.yaml` |
| الفعل والتحقّق | `src/production/production_runbook_steps.ts` (`federated-operation#<الرقم>`) |

- خطوة معلنة بلا ربط تنفيذي ⇒ `PRODUCTION_RUNBOOK_STEP_UNBOUND`.
- ربطٌ تنفيذي بلا إعلان ⇒ `PRODUCTION_RUNBOOK_STEP_UNDECLARED`.
- خطوة نُودي فعلها ولم يُثبَت أثرها (`verify` سلبي) ⇒ الكتاب يفشل وتُقطع ما بعدها،
  ويسقط حكم التشغيل بـ `PROD_RUNBOOK_FAILED`.
- كتابٌ معلن في `config/production.yaml` ولم يُنفَّذ ⇒ `PROD_RUNBOOK_NOT_EXECUTED`.

## المتطلبات قبل التنفيذ

| المتطلب | القياس |
|---|---|
| جهة مشغّلة معلنة | العضوية في `PRODUCTION_OPERATORS` — وإلّا رفض `federated_operation_refused` |
| المشغّل ليس المراقب | `operator !== policy.observer_authority` (RULE-004) |
| سبب معلن | ثلاثة أحرف على الأقل — وإلّا الرفض (RULE-006) |
| الأقاليم الأربعة قائمة ومفوَّضة ولها حكّام | وإلّا سقط الحكم بـ `PROD_REGION_MISSING` أو `PROD_REGION_WITHOUT_GOVERNOR` |
| بيان النشر يطابق التهيئة | `deploy/production/manifest.yaml` — وإلّا أحد رموز `PRODUCTION_MANIFEST_*` |
| مرور التاج مشترط في التهيئة | `regions.require_crown_passage: true` — ولا يُرفع من التهيئة (`CONFIG_PRODUCTION_PASSAGE_OPTIONAL`) |

## الخطوات

### 1 — إثبات سلامة سلسلة التدقيق قبل فتح المرور
- **الفعل:** يُقيَّد `production_precheck { check: 'audit_chain' }`.
- **التحقّق:** `audit.verifyIntegrity().valid === true`.
- **الأثر المتوقع:** لا تُبنى شهادةٌ على سجلٍّ مكسور؛ الكسر يُسقط الحكم بـ
  `PROD_AUDIT_CHAIN_BROKEN`.

### 2 — إثبات أن كل إقليم مشترط قائم ومفوَّض وله حاكم
- **الفعل:** يُقيَّد فحصٌ قبْلي يُعلن الأقاليم المشترطة.
- **التحقّق:** لكل إقليم: `regions.isActive` و`governors.governorOf` موجود ونطاقٌ مفوَّض واحد على الأقل.
- **الأثر المتوقع:** النقص يظهر في الشهادة **ولا يُسدّ من داخل الكتاب** — الكتاب لا يُنشئ
  إقليمًا ولا يُجلس حاكمًا.

### 3 — محاولة فعل إقليمي بلا إذن مرور وإثبات رفضها وتقييدها
- **الفعل:** حاكم الإقليم الأول يُحاول `BYPASS_ACTION` بلا إذن.
- **التحقّق:** المحاولة في `passage.blockedAttempts()` وفي السجل `region_action_bypass_blocked`.
- **الأثر المتوقع:** الإنفاذ **مُثبت بمنعٍ واقع** لا بدعوى. لو نفَذ الفعل رُمي
  `PRODUCTION_BYPASS_EXECUTED`. وغياب المنع يُسقط الحكم بـ `PROD_PASSAGE_UNPROVEN`
  (`tolerance.min_bypass_proof = 1`). والفعل المستعمل للتجاوز **يختلف** عن الفعل المعتمد
  كي لا يستهلك إذنه.

### 4 — منح إذن مرور بأمر ملكي لكل إقليم وتنفيذ فعله
- **الفعل:** لكل إقليم: أمرٌ ملكي `approve_phase` مطابق للإقليم والنطاق والفعل، ثم
  `passage.grant`، ثم `governors.act`.
- **التحقّق:** لكل إقليم مشترط `region_action_passed` و`region_action_executed` في السجل.
- **الأثر المتوقع:** الإذن **واحدٌ لفعل واحد**: مطابقةٌ في الإقليم والنطاق والفعل، وصلاحيةٌ
  بـ `passage_ttl_ms`، واستهلاكٌ مرة واحدة. فشل المنح ⇒ `PRODUCTION_PASSAGE_NOT_GRANTED`،
  وفشل الفعل ⇒ `PRODUCTION_REGION_ACTION_REFUSED`.

### 5 — إثبات أن المراقبة المستمرة جارية ومسحت
- **الفعل:** يُقيَّد `production_precheck { check: 'supervision' }`.
- **التحقّق:** `supervisor.running === true` و`report().sweeps >= 1`.
- **الأثر المتوقع:** «مستمرة» تُحكم بجريانها لا بإعلانها؛ التوقف يُسقط الحكم بـ
  `PROD_SUPERVISION_NOT_RUNNING`، والتأخّر عن الإقلاع بـ `PROD_SUPERVISION_LATE`.

## أمر التنفيذ

```bash
npm test                              # 1480 اختبارًا — منها 69 للمرحلة 37
node --test dist/tests/production/    # تشغيل اتحادي بمؤقّت حقيقي ومسحات فعلية
```

برمجيًّا: `FederatedOperation.begin(operator, books, reason)` يُعلن التشغيل في الدفتر، ثم
يفتح مرور التاج، ثم **يبدأ المراقبة المستمرة**، ثم ينفّذ الكتب المعلنة؛ والحكم بعده
`FederatedOperation.judge()`.

## شرط النجاح

«كل الأقاليم تعمل تحت مرور التاج مع مراقبة مستمرة» — ويُقاس بحكم `ProductionLedger`:
`verdict.passed === true` و`breaches === []` و`regionsOperating === 4`
و`blockedBypasses >= 1`. الحكم يُصدره **ديوان التدقيق** ويُقيَّد `production_verdict`.

## من يُبلَّغ

| الحالة | الجهة | القيد |
|---|---|---|
| خرق أي شرط | ديوان التدقيق | `production_breach` + `escalated: true` |
| حادث حرج | حرس التاج (يوقف الدولة) | `production_critical_halt` |
| فجوة صمت أو تأخّر بدء أو فجوة إعادة تشغيل | ديوان التدقيق | `supervision_gap` |
| وقف المراقبة | المشغّل المعلن بسبب معلن | `supervision_stopped` / `supervision_stop_refused` |

## المتبقّي المعلن

- **T-109:** المراقبة لا تبدأ داخل `bootstrapState` (تلازمٌ مع عدّ سجلّات نحو 1400 اختبار
  قائم)، بل مع `FederatedOperation.begin`؛ و«تبدأ مع الإقلاع» تُقاس بفارق أول مسحة عن
  لحظة الإقلاع على `start_grace_ms`. الفصل الكامل مؤجَّل إلى ما بعد المرحلة 38.
- `key-rotation.md` لم يُنجز بعد — مُقيَّد في `../../PROGRESS.md` §2.
