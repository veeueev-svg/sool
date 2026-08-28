/**
 * tests/governance/helpers.ts — جذرٌ منسوخٌ يُعبث به ويُحذف: مساعداتُ حاجزِ الإعلان
 * المالك: القيّم على المستودع | المرحلة: 40 | البند: T-142 (`W-2026-012`)
 * المدخلات: ملفّاتُ الإعلان في المستودع (`version.json` · `COMPLETION_CRITERIA.md` ·
 *   `PROGRESS.md` · `ROADMAP.md`) و`docs/royal-orders/` و`docs/audit/criteria/`
 * المخرجات: جذرٌ في `tmpdir` يُشغَّل عليه `scripts/check_declaration.sh` بـ`SOOL_DECL_ROOT`
 * التبعيات: `node:child_process` · `node:fs` — لا شفرةَ إنتاجٍ تُستدعى من هنا
 * الصلاحيات (RULE-004): يقرأ المستودعَ ويكتب في `tmpdir` وحدَه — لا يلمس ملفًّا حقيقيًّا
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: لا شيء — هذا ملفُّ مساعداتٍ لا ملفُّ أحكام؛ الأحكامُ في
 *   `declaration_gate.test.ts` وهو الذي يقيسها برمز الخروج
 * اختبار القبول: `tests/governance/declaration_gate.test.ts` (يستورد من هنا)
 * الوثيقة المرتبطة: docs/work/orders/W-2026-012.md §7 · docs/test-reports/phase-40-T142.md
 *
 * ثوابت هذا الملف:
 * 1) **أُخرج ليبقى ملفُّ الأحكامِ تحت سقفِه بهامشٍ يُرى**: سقفُ الوحدة **400** سطرًا، وكان
 *    `declaration_gate.test.ts` **348** سطرًا فلم يبقَ لأحكامِ `T-142` الخمسةِ متّسع.
 *    و**درسُ `T-154` مقيس**: انتهى ملفُّ اختبارِه إلى **400 من 400** — هامشٌ صفر. فالمساعداتُ
 *    تُخرَج إلى `tests/<مجال>/helpers.ts` كما في `tests/chaos/` و`tests/load/` وغيرِهما،
 *    ولا يُرفع سقفٌ ولا يُعلن استثناء.
 * 2) **لا حالةَ سلبيّةً تلمس ملفًّا حقيقيًّا** (درسُ `W-2026-004`): node يشغّل الاختباراتَ
 *    بالتوازي، فعبثٌ في المستودع يجعل بوابةَ CI تسقط بالاحتمال. فالعبثُ كلُّه في نسخةٍ
 *    تُحذف في `finally` ولو سقط التأكيد.
 * 3) **النسخُ يُتحقَّق منه لا يُفترض**: لو تسابق ملفُّ اختبارٍ آخرُ على `version.json` لحظةَ
 *    النسخ لَقِيسَ عبثُ غيرِنا حكمًا لنا (RULE-007).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** جذرُ المستودع هو مكانُ تشغيل `npm test` (كما في tests/governance/criteria_status.test.ts) */
export const ROOT = process.cwd();
export const SCRIPT = 'scripts/check_declaration.sh';
export const DECL_FILES = ['version.json', 'COMPLETION_CRITERIA.md', 'PROGRESS.md', 'ROADMAP.md'] as const;

export interface CheckResult { code: number; out: string }

/** يشغّل الحاجزَ على المستودع كما هو — قارئًا لا كاتبًا */
export function runCheck(): CheckResult {
  const r = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** ينسخ مجلدًا من المستودع إلى الجذر المؤقّت بلاحقةٍ مسمّاة — والمعدومُ لا يُنسخ */
function copyDir(root: string, rel: string, ext: string): void {
  const dst = join(root, rel);
  mkdirSync(dst, { recursive: true });
  const src = join(ROOT, rel);
  if (!existsSync(src)) return;
  for (const f of readdirSync(src)) {
    if (f.endsWith(ext)) copyFileSync(join(src, f), join(dst, f));
  }
}

/**
 * ينسخ ما يقرأه الحاجزُ إلى جذرٍ في tmpdir ثم يشغّله عليه بـ`SOOL_DECL_ROOT`.
 * والنسخُ **يُتحقَّق منه**: لو تسابق ملفُّ اختبارٍ آخرُ على `version.json` لحظةَ النسخ لَقِيسَ
 * عبثُ غيرِنا حكمًا لنا — فتُعاد المحاولةُ حتى تُقرأ نسخةٌ صحيحةُ البنية (RULE-007).
 */
export function withRoot(mutate: (root: string) => void, assertOn: (r: CheckResult) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-decl-'));
  try {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt += 1) {
      for (const f of DECL_FILES) copyFileSync(join(ROOT, f), join(root, f));
      try {
        const v = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')) as { completion_percent?: number };
        ok = typeof v.completion_percent === 'number';
      } catch {
        ok = false;
      }
    }
    assert.ok(ok, 'لم تُقرأ نسخةٌ صحيحةُ البنية من version.json — لا يُحكم على قياسٍ مشكوكٍ فيه');
    copyDir(root, 'docs/royal-orders', '.md');
    // (T-142) وأحكامُ المعايير تُنسخ كذلك: الحاجزُ صار يستخرج البنودَ من الحكم لا من الخانة
    copyDir(root, 'docs/audit/criteria', '.md');
    mutate(root);
    const r = spawnSync('bash', [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, SOOL_DECL_ROOT: root },
    });
    assertOn({ code: r.status ?? -1, out: `${r.stdout}${r.stderr}` });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** يقرأ ملفًّا من الجذر المنسوخ ويكتبه بعد تعديلٍ يجب أن يُغيّر شيئًا */
export function editIn(root: string, file: string, mutate: (t: string) => string): void {
  const p = join(root, file);
  const before = readFileSync(p, 'utf8');
  const after = mutate(before);
  assert.notEqual(after, before, `العبثُ لم يغيّر شيئًا في ${file} — فالتأكيدُ لا يقيس شيئًا`);
  writeFileSync(p, after);
}

/**
 * يعبث بملفٍّ **في الجذر المنسوخ** لا في المستودع (W-2026-004).
 * لا `finally` يستعيد أصلًا هنا: فالمعبوثُ نسخةٌ في tmpdir تُحذف بتمامها في `withRoot`.
 */
export function withTampered(file: string, mutate: (t: string) => string, assertOn: (r: CheckResult) => void): void {
  withRoot((root) => editIn(root, file, mutate), assertOn);
}

/** يرقّي كلَّ صفٍّ إلى ✅ ويُصلح سطرَ الحصيلة معه — فحالُ «لا عائقَ مسمّى» يُصطنع في النسخة وحدَها */
export function allCriteriaMet(root: string): void {
  editIn(root, 'COMPLETION_CRITERIA.md', (t) => {
    const rows = t.split('\n').map((l) => (l.startsWith('| C-')
      ? l.replace('| ⚠️ فجوة |', '| ✅ مستوفى |').replace('| 🟡 اكتُفي بتقرير المنفّذ |', '| ✅ مستوفى |')
      : l)).join('\n');
    const met = (rows.match(/\| ✅ مستوفى \|/g) ?? []).length;
    return rows.replace(
      /^\*\*الحصيلة اليوم:\*\*.*$/m,
      `**الحصيلة اليوم:** ✅ مستوفى **${met}** · ⚠️ فجوة **0** · 🟡 اكتُفي بتقرير المنفّذ **0**.`,
    );
  });
}

/** أمرٌ ملكيٌّ مقيَّدٌ في السلسلة، يُذكر فيه الدَّينُ أو لا يُذكر */
export function writeOrder(root: string, debtLine: string | null): void {
  const lines = ['الرقم: 000', 'التاريخ: 2026-01-01', 'المُصدِر: الملك', 'الموضوع: اختبارُ الحاجز',
    'النص: لا أثرَ لهذا الملفِّ خارج الاختبار', 'الأثر على المراحل: لا شيء',
    'معرّف السجل في سلسلة التدقيق (auditId): audit-اختبار-000'];
  if (debtLine !== null) lines.push(debtLine);
  writeFileSync(join(root, 'docs/royal-orders/2026-01-01-000-اختبار-حاجز.md'), `${lines.join('\n')}\n`);
}
