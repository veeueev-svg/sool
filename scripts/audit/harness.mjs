/**
 * scripts/audit/harness.mjs — مهاد مسبار التدقيق المستقل (المرحلة 38، البند T-110)
 * المالك: ديوان التدقيق (لا المنفّذ — RULE-004)
 * المدخلات: `dist/src/index.js` المبنيّة من المستودع عند بصمة التزامٍ معلنة
 * المخرجات: سطرٌ لكل فحص إلى المخرَج القياسي، يُحفظ خامًّا في docs/audit/measurements/
 * السجلّات: لا يكتب هذا المسبار في سلسلة التدقيق إلا ما تكتبه الوحدات المُقاسة نفسها
 * أنماط الفشل: خروجٌ بالرمز 1 إن سقط فحصٌ واحد؛ وكل فحصٍ ساقط يطبع الخرج الخام لسببه
 * الوثيقة المرتبطة: docs/audit/README.md · docs/test-reports/phase-38.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **الفحوص مكتوبة من نصّ المعيار لا من اختبارات المنفّذ.** غايتها ألّا يكون الدليل
 *    الوحيد على معيارٍ هو اختبارٌ كتبه من كتب الشيفرة. فهي تستدعي **السطح العام** وحده
 *    (`bootstrapState` وما يرجعه)، ولا تفتح وحدةً داخلية ولا تستورد ملف اختبار.
 *
 * 2) **لا فحص يُصلح ما يقيسه.** إن سقط فحصٌ فالحكم «فجوة» ويُفتح بند في PROGRESS.md §2؛
 *    ولا يُخفَّف الشرط ليمرّ (وهذا مزلق `docs/audit/README.md`).
 *
 * 3) **ما لا يُقاس هنا يُعلن هناك.** المسبار لا يغطي كل معيار: ما اكتُفي فيه بتقرير المنفّذ
 *    يُكتب صريحًا في ملف حكمه تحت `docs/audit/criteria/`.
 *
 * 4) **C-18 لا يُقاس بهذا المسبار** — التدقيق لا يشهد لاستقلاله بأداةٍ من عنده.
 */
const DIST = '/home/user/workspace/sool/dist/src/index.js';
const m = await import(DIST);
const { bootstrapState } = m;

const results = [];
const boot = (o) => bootstrapState(o);

function check(id, title, fn) {
  let verdict = 'FAIL';
  let detail = '';
  try {
    const out = fn();
    verdict = out.pass ? 'PASS' : 'FAIL';
    detail = out.detail ?? '';
  } catch (e) {
    detail = `استثناء: ${e && e.message ? e.message : String(e)}`;
  }
  results.push({ id, title, verdict, detail });
  console.log(`${id} | ${verdict} | ${title} | ${detail}`);
}
const J = (v) => JSON.stringify(v);
const rejected = (r) => r && (r.ok === false || r.allowed === false || r.accepted === false);

export { check, boot, m, J, rejected, results };
