#!/usr/bin/env node
/**
 * scripts/audit_probe.mjs — مُشغِّل مسبار التدقيق المستقل (المرحلة 38، البند T-110)
 * المالك: ديوان التاج للتدقيق (لا المنفّذ — RULE-004)
 * المدخلات: وحدات الفحص في `scripts/audit/` (سيادة، احتواء، مؤسسات)
 * المخرجات: سطرٌ لكل فحص إلى المخرَج القياسي، يُحفظ خامًّا في `docs/audit/measurements/`
 * الاعتمادات: `scripts/audit/harness.mjs` وحداتُ الفحص — ولا شيء من `src/` مباشرةً
 * السجلّات: لا يكتب هذا المُشغِّل في سلسلة التدقيق
 * أنماط الفشل: رمز الخروج 1 إن سقط فحصٌ واحد
 * اختبار القبول: `node --max-old-space-size=6144 scripts/audit_probe.mjs`
 * الوثيقة المرتبطة: docs/audit/README.md · docs/audit/verdict.md · docs/test-reports/phase-38.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **الترتيب معلن لا عارض:** السيادة أولًا (فما بعدها بلا معنى إن سقطت)، ثم الاحتواء
 *    والاستعادة، ثم المؤسسات والقياس. وكلُّ وحدةٍ تُدرَج بالاستيراد فتُسجّل فحوصها في المهاد.
 *
 * 2) **المُشغِّل لا يحكم:** يطبع ما قيس ويرفع رمز الخروج؛ والحكمُ في
 *    `docs/audit/criteria/` بقلم المدقّق لا باشتقاقٍ آلي من PASS/FAIL.
 *
 * 3) **C-18 لا يُقاس هنا** — التدقيق لا يشهد لاستقلاله بأداةٍ من عنده.
 */
import { results } from './audit/harness.mjs';
import './audit/probes_sovereignty.mjs';
import './audit/probes_containment.mjs';
import './audit/probes_institutions.mjs';

const failed = results.filter((r) => r.verdict !== 'PASS');
console.log('---');
console.log(`إجمالي الفحوص: ${results.length} · ناجحة: ${results.length - failed.length} · ساقطة: ${failed.length}`);
if (failed.length) console.log(`الساقطة: ${failed.map((r) => r.id).join(', ')}`);
process.exit(failed.length ? 1 : 0);
