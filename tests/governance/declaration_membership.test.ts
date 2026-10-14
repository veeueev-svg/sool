/**
 * tests/governance/declaration_membership.test.ts — عضويّةُ القوائم في حاجز الإعلان بلا أنبوب (W-2026-071)
 * المالك: المساعد الآلي — Perplexity Computer (الجلسة 114 — بتفويض المالك)
 * المدخلات: `scripts/check_declaration.sh` (يُقرأ نصُّه ويُشغَّل على المستودع وعلى جذرٍ منسوخ)
 * المخرجات: تأكيدٌ أن «هل السطرُ في القائمة؟» لا يُسأل بأنبوبٍ تحت pipefail، وأن الجوابَ لا يتغيّر بالجدولة
 * التبعيات: `node:child_process` · `node:fs` · مساعداتُ `./helpers` (قراءةٌ فقط — لا يُعدَّل ملفُّها)
 * الصلاحيات (RULE-004): الاختبار يقرأ ويشغّل؛ وما يعبث به ففي tmpdir بـ`withRoot` — لا يكتب في المستودع حرفًا
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: عودةُ `printf … | grep -q` تحت pipefail · دالةُ العضويّة تقبل بادئةً أو تُسقط
 *   آخرَ سطر · التشغيلُ المتوازي على شجرةٍ واحدة يعطي رمزين مختلفين · حارسُ «phases_partial وphases_complete
 *   معًا» (السطرُ الذي كان الإغفالُ فيه **فتحًا صامتًا** لا إسقاطًا)
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-071.md ·
 *   docs/audit/measurements/phase-40-W-2026-071-membership-stress.md · docs/work/orders/W-2026-071.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **الحكمُ على نصّ السكربت مقصود**: العيبُ نمطٌ (`| grep -q` تحت `set -o pipefail`) يظهر بالاحتمال،
 *    واختبارٌ احتماليٌّ وحده يمرّ أحيانًا على العيب. فالنمطُ نفسُه يُمنع بقراءةِ النصّ (حتميًّا)،
 *    والسلوكُ يُقاس بالتشغيل المتوازي (احتماليًّا) — والأوّلُ هو ما يُسقط الانحدارَ في كلّ تشغيل.
 * 2) **التعليقاتُ لا تُحتسب**: السطرُ الذي يبدأ بـ`#` يشرح العيبَ ولا يُنفّذه.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SCRIPT, editIn, withRoot } from './helpers';

const source = (): string => readFileSync(join(ROOT, SCRIPT), 'utf8');
const codeLines = (): string[] => source().split('\n').filter((l) => !/^\s*#/.test(l));

/** يستخرج تعريفَ in_lines من السكربت كما هو — فالمختبَرُ الدالّةُ المشحونةُ لا نسخةٌ منها */
function inLinesDef(): string {
  const s = source();
  const start = s.indexOf('in_lines() {');
  assert.ok(start >= 0, 'لا تعريفَ لـin_lines في السكربت');
  const end = s.indexOf('\n}\n', start);
  assert.ok(end > start, 'تعريفُ in_lines بلا خاتمة');
  return s.slice(start, end + 2);
}

function inLines(needle: string, list: string): boolean {
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${inLinesDef()}\nin_lines "$1" "$2"`, 'x', needle, list], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

test('W-2026-071: السكربتُ تحت pipefail ولا يسأل عن العضويّة بـ«| grep -q» في سطرٍ منفَّذ', () => {
  const lines = codeLines();
  assert.ok(lines.some((l) => /set -[a-z]*o pipefail/.test(l)), 'السكربتُ لم يعد تحت pipefail — فهذا الحارسُ يُعاد النظرُ فيه لا يُحذف');
  const bad = lines.filter((l) => /\|\s*grep\s+-[a-zA-Z]*q/.test(l));
  assert.deepEqual(bad, [], `أنبوبٌ إلى grep -q تحت pipefail يقلب التطابقَ نفيًا بـSIGPIPE:\n${bad.join('\n')}`);
});

test('W-2026-071: in_lines مساواةٌ حرفيّةٌ للسطر كاملًا — لا بادئة ولا لاحقة، وآخرُ سطرٍ محسوب', () => {
  assert.equal(inLines('T-27', 'T-115\nT-27\nT-29'), true);
  assert.equal(inLines('T-29', 'T-115\nT-27\nT-29'), true, 'آخرُ سطرٍ بلا فاصلٍ ختاميّ');
  assert.equal(inLines('T-2', 'T-115\nT-27\nT-29'), false, 'بادئةٌ ليست عضوًا');
  assert.equal(inLines('T-27', 'T-271\nxT-27'), false, 'لاحقةٌ أو سابقةٌ ليست عضوًا');
  assert.equal(inLines('T-27', ''), false, 'القائمةُ الفارغةُ لا عضوَ فيها');
  assert.equal(inLines('39', '1\n2\n39'), true);
  assert.equal(inLines('T-115ب', 'T-115أ\nT-115ب'), true, 'المعرّفُ بلاحقةٍ عربيّة');
});

test('W-2026-071: الحاجزُ على شجرةٍ واحدة يعطي رمزًا واحدًا تحت 8 نسخٍ متوازية × 3 جولات', async () => {
  const runOnce = (): Promise<number> => new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT], { cwd: ROOT, stdio: 'ignore' });
    p.on('close', (code) => resolve(code ?? -1));
  });
  const codes: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    codes.push(...(await Promise.all(Array.from({ length: 8 }, runOnce))));
  }
  assert.deepEqual([...new Set(codes)], [0], `رموزُ الخروج: ${codes.join(',')} — والحكمُ على شجرةٍ واحدة لا يتبع الجدولة`);
});

test('W-2026-071: مرحلةٌ في phases_partial وphases_complete معًا تُسقط الحاجزَ برسالتها (كان الإغفالُ هنا فتحًا صامتًا)', () => {
  withRoot(
    (root) => editIn(root, 'version.json', (t) => t.replace(/"phases_complete": \[\n/, '"phases_complete": [\n    39,\n')),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /المرحلة 39 في phases_partial وphases_complete معًا/);
    },
  );
});
