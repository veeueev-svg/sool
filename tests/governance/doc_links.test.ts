/**
 * tests/governance/doc_links.test.ts — حارسُ الروابط النسبيّة في الوثائق (المرحلة 40، البند W-2026-064)
 * المالك: القيّم على المستودع
 * المدخلات: كلُّ ملفِّ Markdown متتبَّعٍ في git
 * المخرجات: تأكيدٌ أنّ كلَّ رابطٍ نسبيٍّ يصل إلى ملفٍّ موجود
 * التبعيات: `node:child_process` (قائمةُ git) · `node:fs` · `node:path`
 * الصلاحيات (RULE-004): يقرأ ولا يكتب
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: رابطٌ إلى ملفٍّ نُقل (`config/module_limits.yaml` ⇒ `scripts/limits/`) ·
 *   رابطٌ يُحسب من جذرٍ غيرِ مجلدِ ملفِّه · رابطٌ إلى ملفٍّ لم يوجد قطّ
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-064.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **الرابطُ يُحسب من مجلدِ ملفِّه** كما يعرضه GitHub — إلّا `docs/work/WORK_LOG.md` فروابطُه
 *    من جذر المستودع **بعقدِ البوابة**: `scripts/check_work.mjs` يتحقّق من وجودِ تقريرِ كلِّ صفٍّ
 *    بالمسارِ نفسِه من الجذر (RULE-014)، والسجلُّ يُذيَّل ولا يُعدَّل — فيُقاس كما تقيسه البوابة.
 * 2) **قائمةُ الانتظار مغلقةٌ ومسمّاة**: ملفٌّ فيه رابطٌ مكسورٌ ونطاقُه محجوزٌ لبندٍ حيٍّ آخر لا
 *    يُصلَح من خارج بندِه (RULE-011)، فيُسمّى هنا ببندِه. والقائمةُ تُفرَّغ ولا تُزاد؛ وملفٌّ فيها
 *    صار سليمًا يُسقط الاختبارَ حتى يُحذف منها — فلا يبقى استثناءٌ بلا موجب.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const ROOT_RELATIVE = new Set(['docs/work/WORK_LOG.md']);
/** ملفٌّ ⇒ البندُ الحيُّ الذي يحجزه (يُفرَّغ بإصلاحه داخل بندِه). */
const PENDING: ReadonlyMap<string, string> = new Map<string, string>([]);

function brokenLinks(file: string): string[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const base = ROOT_RELATIVE.has(file) ? '' : dirname(file);
  const out: string[] = [];
  for (const m of text.matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)) {
    const link = m[1] ?? '';
    if (/^[a-z]+:/i.test(link) || !/[A-Za-z]/.test(link) || link.includes("'")) continue;
    if (!existsSync(join(ROOT, normalize(join(base, link))))) out.push(link);
  }
  return out;
}

test('حارسُ الروابط: كلُّ رابطٍ نسبيٍّ في الوثائق يصل إلى ملفٍّ موجود، والانتظارُ مسمًّى ببندِه', () => {
  const ls = spawnSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ls.status, 0, 'git ls-files');
  const files = ls.stdout.split('\n').filter((f) => f !== '');
  assert.ok(files.length > 100, `قائمةُ الوثائق أقصرُ من المتوقّع: ${files.length}`);
  const broken: string[] = [];
  const healedPending: string[] = [];
  for (const f of files) {
    const b = brokenLinks(f);
    if (PENDING.has(f)) {
      if (b.length === 0) healedPending.push(f);
      continue;
    }
    for (const l of b) broken.push(`${f} -> ${l}`);
  }
  assert.deepEqual(broken, [], `روابطُ مكسورة:\n${broken.join('\n')}`);
  assert.deepEqual(healedPending, [], `ملفّاتٌ في قائمةِ الانتظار صارت سليمة — احذفها منها:\n${healedPending.join('\n')}`);
});
