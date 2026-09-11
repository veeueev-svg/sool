/**
 * tests/data/rehydrate_census_harness.ts — مهادُ تطفيرِ حاجزِ حصرِ الإرجاع (المرحلة 39 · W-2026-040)
 * المالك: وزارة البيانات | المدخلات: جذرٌ منسوخٌ إلى tmpdir | المخرجات: رمزُ خروجٍ ونصُّ الحاجز
 * التبعيات: `node:fs` و`node:child_process` والحزمةُ المبنيّةُ في `dist/`
 * الصلاحيات: الكتابةُ في tmpdir وحدَها — **لا يُلمس ملفٌّ في المستودع** (درسُ W-2026-004)
 * السجلات: لا سجلَّ — المهادُ أداةُ قياسٍ لا سلطة
 * حالات الفشل: تطفيرٌ لا موضعَ له يُسقط التأكيدَ فورًا، فلا يُقاس حاجزٌ على نسخةٍ لم تُحرَّف
 * اختبارات الوحدة: يُستخدَم في tests/data/rehydrate_census.test.ts
 *   وtests/data/rehydrate_census_mutations.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *
 * **سببُ استقلالِه عن ملفِّ الاختبار**: بلغ ملفُّ الاختبارِ سقفَ الوحدةِ المعلنَ (400 سطرًا)
 * بعد إضافةِ تطفيراتِ الجولةِ الثالثة، وقائمةُ الاستثناءاتِ في
 * `scripts/limits/module_limits.yaml` **فارغةٌ عن قصدٍ** (أُغلق بها البند T-113) — فالسقفُ
 * لا يُرفَع، والملفُّ يُفكَّك. وحدُّ القسمةِ سلطةٌ لا حجم: هنا **أداةُ التحريفِ والتشغيل**،
 * وهناك **الحكمُ على ما قاسته**.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

/**
 * تطفيرُ الحاجزِ الساكن: نسخةٌ من الجذر تُحرَّف فيُطلب من الحاجز أن يسقط.
 * (درسُ W-2026-004: يُحرَّف نسخةٌ لا أصل — ولا حالةَ اختبارٍ تلمس ملفًّا حقيقيًّا.)
 *
 * والحاجزُ يُشغَّل من الحزمةِ المبنيّةِ الحقيقيّةِ ويُوجَّه بـ`SOOL_CHECK_ROOT` إلى النسخة،
 * لأنّه **يقرأ مدخلاتِه من الجذرِ نصًّا ويُحلّلها شجرةَ نحو** لا يستوردها.
 */
export function gateRoot(): { root: string; run: () => { code: number; out: string }; clean: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'sool-census-gate-'));
  for (const dir of ['config', 'src', 'scripts']) {
    cpSync(join(process.cwd(), dir), join(root, dir), { recursive: true });
  }
  return {
    root,
    run: () => {
      const r = spawnSync('node', [join(process.cwd(), 'dist/scripts/check_rehydrate_census.js')], {
        encoding: 'utf8', env: { ...process.env, SOOL_CHECK_ROOT: root },
      });
      return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
    },
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * بندُ `case` الكاملُ للصنفِ المُطفَّرِ — يُنزع بجسمِه لا يُشطَر، وإلّا بقيت العبارةُ
 * ذاتُ الأثرِ في البندِ نفسِه فنجا التطفيرُ لسببٍ لا صلةَ له بالخاصّيّةِ المقيسة.
 */
export const LEVY_CLAUSE = [
  "    case 'tax_levy': {",
  '      state.revenueSeen = true;',
  '      const levy = payload.levy as Levy | undefined;',
  "      if (levy && typeof levy.levyId === 'string') state.levies.set(levy.levyId, { ...levy });",
  '      state.levySequence = Math.max(state.levySequence, seq);',
  '      return;',
  '    }',
  '',
].join('\n');

/** يُبدل بندَ `tax_levy` كلَّه بصيغةٍ أخرى — والتطفيرُ يُثبَت موضعُه أوّلًا */
export const patchClause = (root: string, replacement: string): void => {
  const file = join(root, 'src/data/rehydrate_fiscal.ts');
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes(LEVY_CLAUSE), 'تطفيرٌ لا موضعَ له: بندُ tax_levy في rehydrate_fiscal.ts');
  writeFileSync(file, text.replace(LEVY_CLAUSE, replacement), 'utf8');
};

export const patch = (root: string, rel: string, from: string, to: string): void => {
  const file = join(root, rel);
  const body = readFileSync(file, 'utf8');
  assert.ok(body.includes(from), `تطفيرٌ لا موضعَ له: ${rel} ⇐ ${from}`);
  writeFileSync(file, body.replace(from, to), 'utf8');
};
