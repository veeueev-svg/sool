/**
 * tests/kernel/closed_enum_bounds.test.ts — حدودُ التعدادات المغلقة (المرحلة 39، البند T-131)
 * المالك: القيّم على المستودع | المدخلات: نسخةٌ من `config/` تُنفخ في مجلد مؤقت · جدولٌ مصنوع
 * المخرجات: رفضُ تحميلٍ ورفضُ إقلاعٍ برموزٍ معلنة | التبعيات: closed_enums · closed_enum_cases
 * الصلاحيات: لا تعديل على تهيئة المستودع الفعليّة | السجلات: قيدُ `closed_enums_guarded`
 * حالات الفشل: `CONFIG_CLOSED_ENUM_EMPTY` · `CONFIG_CLOSED_ENUM_NOT_FROZEN`
 *   · `CONFIG_CLOSED_ENUM_CENSUS_DRIFT` · ورمزُ كلِّ محمّلٍ عند قيمةٍ مجهولةٍ أو مكرّرة
 * الوثيقة: docs/test-reports/T-131-closed-enum-bounds.md
 *   · القياسُ الخام: docs/audit/measurements/phase-39-T131.txt
 * ثوابت الاختبار:
 *   1) **الجدولُ يُختبر لا نسخةٌ منه**: الحالاتُ تُقرأ من `CLOSED_CASES` فمن أضاف تعدادًا
 *      مغلقًا ولم يُسجّله لم يُختبر — ولهذا بوابةُ `scripts/check_closed_enums.sh` تُحصي
 *      التعداداتَ المصدَّرةَ وتقارنها بالسجل، فلا يُكتفى بالاختبار وحده.
 *   2) **سؤالان لكلِّ مفتاح لا سؤال**: قيمةٌ **خارج** التعداد تُرفض (العضويّة)، وعنصرٌ معلنٌ
 *      **مكرَّرٌ ألفًا** يُرفض (الطول). فمن حذف حرسَ العضويّة أو حرسَ التكرار سقط عليه اختبار،
 *      وهذا هو الإنذارُ الذي طلبه T-131: **لا يُفتح تعدادٌ في صمت**.
 *   3) **حالاتُ الحرس تُجرَّب بجدولٍ مصنوعٍ** لا بتخريب تعدادٍ حقيقيّ: تعدادٌ حقيقيٌّ يُفرَّغ
 *      في اختبارٍ يُفسد بقيّةَ الاختبارات في العمليّة نفسِها، والمصنوعُ يُصيب الرمزَ نفسَه.
 *   4) **الحرسُ في مسار الإقلاع فعلًا**: `bootstrapState` يُدوّن `closed_enums_guarded`
 *      بعددٍ مقيسٍ من الجدول — فحاجزٌ لا أثرَ له في الدفتر لا يُراجَع (RULE-009).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SovereignViolation, bootstrapState } from '../../src/index';
import {
  CLOSED_ENUMS, ClosedEnumBinding, closedEnumUseCount, guardClosedEnums, resolveConfigDir,
} from '../../src/kernel/config';
import { CLOSED_CASES, alien } from '../../scripts/closed_enum_cases';
import { inflate } from '../../scripts/declaration_cases';

const REAL_CONFIG = resolveConfigDir();
const BULK = 1024;

/** نسخةٌ من التهيئة الفعليّة يُعمل فيها ما يُطلب — والأصلُ لا يُمسّ */
function withCopy(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'closed-enum-'));
  try {
    cpSync(REAL_CONFIG, dir, { recursive: true });
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** أوّلُ عنصرٍ معلنٍ تحت مفتاح — يُقرأ من الملف فلا يُصادف تناقضًا مع قائمةٍ أخرى */
function firstDeclared(dir: string, file: string, key: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  const at = lines.findIndex((l: string) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  assert.notStrictEqual(at, -1, `مفتاحٌ غيرُ موجود: ${key} في ${file}`);
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = (lines[i] as string).trim();
    if (line === '' || line.startsWith('#')) continue;
    assert.ok(line.startsWith('- '), `أوّلُ عنصرٍ ليس عنصرَ قائمة: ${key}`);
    return line.slice(2).trim().replace(/^"(.*)"$/, '$1');
  }
  throw new Error(`لا عنصرَ معلنًا تحت ${key}`);
}

/** يُرجع رمزَ الرفض إن رُفض، وإلّا فـ`null` — ولا يُبتلع خطأٌ غيرُ سياديّ */
function refusalCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof SovereignViolation) return error.code;
    throw error;
  }
}

// ═══ ثابت 2: العضويّةُ مُنفَذةٌ في كلِّ مفتاح — قيمةٌ خارج التعداد تُرفض
for (const c of CLOSED_CASES) {
  test(`تعدادٌ مغلق: قيمةٌ خارج ${c.enumName} تُرفض في ${c.file}·${c.key}`, () => {
    withCopy((dir) => {
      inflate(join(dir, c.file), c.key, () => c.entry(alien(c.values)), {} as never, 1);
      const code = refusalCode(() => c.load(dir));
      assert.ok(
        code !== null,
        `قيمةٌ خارج ${c.enumName} قُبلت في ${c.file}·${c.key} — `
        + 'إن فُتح التعدادُ عن قصدٍ فأعلن سقفًا في DECLARATION_CEILINGS يقابله',
      );
    });
  });

  // ═══ ثابت 2: الطولُ محدودٌ كذلك — عضويّةٌ تحدُّ القيمَ لا العدد
  test(`تعدادٌ مغلق: عنصرٌ معلنٌ مكرَّرٌ ${BULK} مرّةً يُرفض في ${c.file}·${c.key}`, () => {
    withCopy((dir) => {
      const known = firstDeclared(dir, c.file, c.key);
      inflate(join(dir, c.file), c.key, () => c.entry(known), {} as never, BULK);
      const code = refusalCode(() => c.load(dir));
      assert.ok(
        code !== null,
        `${BULK} نسخةً من «${known}» قُبلت في ${c.file}·${c.key} — `
        + 'قائمةٌ محدودةُ القيم مفتوحةُ الطول ليست مغلقة: احرس التكرارَ أو أعلن سقفًا',
      );
    });
  });
}

// ═══ ثابت 1: كلُّ تعدادٍ مُسجَّلٍ له موضعُ استعمالٍ واحدٌ على الأقلّ، والعكسُ مُحصًى
test('سجلُّ التعدادات: كلُّ تعدادٍ مُسجَّلٍ يحدُّ مفتاحًا فعلًا', () => {
  for (const binding of CLOSED_ENUMS) {
    assert.ok(binding.uses.length > 0, `تعدادٌ مُسجَّلٌ بلا موضعِ استعمال: ${binding.name}`);
  }
  assert.strictEqual(closedEnumUseCount(), CLOSED_CASES.length);
});

// ═══ ثابت 3: حالاتُ الحرس الثلاثُ بجدولٍ مصنوع
test('CONFIG_CLOSED_ENUM_EMPTY: تعدادٌ فارغٌ حرسٌ يرفض كلَّ شيء', () => {
  const fake: ClosedEnumBinding = {
    name: 'FAKE_EMPTY', values: Object.freeze([]), members: 0, uses: [{ file: 'x.yaml', key: 'k' }],
  };
  assert.strictEqual(refusalCode(() => guardClosedEnums([fake])), 'CONFIG_CLOSED_ENUM_EMPTY');
});

test('CONFIG_CLOSED_ENUM_NOT_FROZEN: الغلقُ في الأنواع وحدها ليس غلقًا', () => {
  const fake: ClosedEnumBinding = {
    name: 'FAKE_THAWED', values: ['a', 'b'], members: 2, uses: [{ file: 'x.yaml', key: 'k' }],
  };
  assert.strictEqual(refusalCode(() => guardClosedEnums([fake])), 'CONFIG_CLOSED_ENUM_NOT_FROZEN');
});

test('CONFIG_CLOSED_ENUM_CENSUS_DRIFT: فتحُ تعدادٍ يُسقط الإقلاع لا يمرّ صامتًا', () => {
  const opened: ClosedEnumBinding = {
    name: 'FAKE_OPENED', values: Object.freeze(['a', 'b', 'c']), members: 2,
    uses: [{ file: 'x.yaml', key: 'k' }],
  };
  assert.strictEqual(
    refusalCode(() => guardClosedEnums([opened])), 'CONFIG_CLOSED_ENUM_CENSUS_DRIFT',
  );
  const narrowed: ClosedEnumBinding = { ...opened, values: Object.freeze(['a']) };
  assert.strictEqual(
    refusalCode(() => guardClosedEnums([narrowed])), 'CONFIG_CLOSED_ENUM_CENSUS_DRIFT',
  );
});

test('الجدولُ الحقيقيُّ يمرّ: كلُّ تعدادٍ مجمَّدٌ وعددُه كما أُثبت', () => {
  assert.strictEqual(guardClosedEnums(), CLOSED_ENUMS.length);
  for (const binding of CLOSED_ENUMS) {
    assert.ok(Object.isFrozen(binding.values), `غيرُ مجمَّد: ${binding.name}`);
  }
});

// ═══ ثابت 4: الأثرُ في الدفتر
test('الإقلاعُ يُدوّن closed_enums_guarded بعددٍ مقيسٍ من الجدول', () => {
  const state = bootstrapState({ configDir: REAL_CONFIG, now: Date.now() });
  const entries = state.audit.snapshot().filter((e) => e.kind === 'closed_enums_guarded');
  assert.strictEqual(entries.length, 1);
  const details = entries[0]?.detail as { enums: number; keys_bounded: number };
  assert.strictEqual(details.enums, CLOSED_ENUMS.length);
  assert.strictEqual(details.keys_bounded, closedEnumUseCount());
});
