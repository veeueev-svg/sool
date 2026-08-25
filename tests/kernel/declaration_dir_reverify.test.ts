/**
 * tests/kernel/declaration_dir_reverify.test.ts — خاتمةُ الإقلاع تُعيد التحقّقَ ممّا اتُّكئ عليه (T-141)
 * المالك: القيّم على المستودع | المدخلات: مجلداتٌ مؤقّتةٌ · قياسٌ محفوظٌ · إقلاعٌ كامل
 * المخرجات: حكمٌ على كشفِ نفخٍ في مكانه لا يقرؤه أحدٌ، وعلى ثمنِ الجوابِ معدودًا
 * التبعيات: src/kernel/config (إعادةُ التحقّق · الحرَسُ · البصمةُ · عدّادُ العمل) · src/index
 * الصلاحيات (RULE-004): اختبارٌ يقرأ ويحكم؛ لا يُعدّل سقفًا ولا سياسة
 * السجلات: قيدُ `declaration_dirs_reverified` قبلَ `boot_work_measured` — يُتحقَّق منه هنا
 * حالات الفشل: `CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING`
 *   · `CONFIG_DECLARATION_DIR_UNREADABLE_AT_BOOT_END`
 * الوثيقة: docs/test-reports/T-141-declaration-boot-end-reverify.md
 *   · القرار: docs/decisions/ADR-0040-declaration-boot-end-reverify.md
 *
 * ثوابت هذا الاختبار:
 *
 *   1) **الحدُّ المُعلن يُثبَت أوّلًا ثمّ يُثبَت إغلاقُه**: يُبرهن اختبارٌ أنّ نفخًا في مكانه
 *      **لا يقرؤه أحدٌ** يمرّ على إعادةِ الاستخدام (فذاك حدُّ T-140 كما أُعلن، لا شكوى)، ثمّ
 *      يُبرهن الذي بعده أنّ **إعادةَ التحقّق** تردُّه برمزِ السقف. فالبندُ يُقاس لا يُدَّعى.
 *
 *   2) **الثمنُ معدودٌ لا موصوف**: كلُّ إعادةِ تحقّقٍ تُقاس بمحورِ `dir_walks` من عدّادِ العمل
 *      — ومن قال «رخيصٌ» بلا عددٍ لم يُثبت شيئًا.
 *
 *   3) **الرمزُ هو المُدَّعى لا النصّ**: كلُّ رفضٍ يُربط برمزِه لا بنصٍّ عربيٍّ مشكولٍ يتغيّر.
 *
 *   4) **كلُّ اختبارٍ ينسى ما حُفظ قبله وبعده**: فقياسُ تهيئةِ المستودع الفعليّة لا يُلمس
 *      إلّا بنسيان، وترتيبُ الاختبارات لا يُغيّر نتائجَها.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SovereignViolation, bootstrapState } from '../../src/index';
import {
  CONFIG_DECLARATION_BUDGET, bootWork, directoryMeasureNames,
  guardDeclarationDirectoryBytes, resetDeclarationMemo, resetDirectoryMeasures,
  resetLoadedDeclaration, resolveConfigDir, reverifyDeclarationDirectories,
  storedDirectoryMeasure,
} from '../../src/kernel/config';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'dirreverify-'));
}

/** يكتب ملفَّ إعلانٍ بحجمٍ مطلوبٍ تقريبًا — كتابةً أوّلًا أو **فوق ملفٍّ قائم** */
function put(dir: string, name: string, bytes: number): string {
  const path = join(dir, name);
  const head = 'key: value\n';
  writeFileSync(path, head + '#'.repeat(Math.max(0, bytes - head.length - 1)) + '\n', 'utf8');
  return path;
}

/** يُعيد رمزَ الرفض أو `null` إن مرّ النداء */
function code(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof SovereignViolation ? error.code : `أخطأ بلا رمز: ${String(error)}`;
  }
}

test('T-141: الحدُّ المُعلن حقيقيٌّ — نفخٌ في مكانه لا يقرؤه أحدٌ يمرّ على إعادةِ الاستخدام', () => {
  const dir = scratch();
  try {
    put(dir, 'a.yaml', 400);
    resetDirectoryMeasures();
    guardDeclarationDirectoryBytes(dir);
    // كتابةٌ فوق ملفٍّ قائمٍ: لا مدخلَ يُضاف فلا يتغيّر زمنُ المجلد، ولا قارئَ يقرؤه
    put(dir, 'a.yaml', CONFIG_DECLARATION_BUDGET.total_bytes + 5000);
    assert.equal(code(() => guardDeclarationDirectoryBytes(dir)), null, 'هذا حدُّ T-140 كما أُعلن');
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-141: وإعادةُ التحقّقِ تردُّه برمزِ سقفِ المجلد نفسِه — لا برمزٍ جديدٍ ولا بسكوت', () => {
  const dir = scratch();
  try {
    put(dir, 'a.yaml', 400);
    resetDirectoryMeasures();
    guardDeclarationDirectoryBytes(dir);
    put(dir, 'a.yaml', CONFIG_DECLARATION_BUDGET.total_bytes + 5000);
    assert.equal(
      code(() => reverifyDeclarationDirectories()),
      'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING',
    );
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-141: إعادةُ التحقّقِ تُعيد المشيَ لكلِّ مجلدٍ محفوظٍ — والثمنُ معدودٌ في `dir_walks`', () => {
  const first = scratch();
  const second = scratch();
  try {
    put(first, 'a.yaml', 300);
    put(second, 'b.yaml', 300);
    resetDirectoryMeasures();
    guardDeclarationDirectoryBytes(first);
    guardDeclarationDirectoryBytes(second);
    assert.equal(directoryMeasureNames().length, 2, 'مجلدانِ حُفظ قياسُهما');

    const before = { ...bootWork() };
    const summary = reverifyDeclarationDirectories();
    const after = { ...bootWork() };

    assert.equal(summary.dirs, 2, 'كلُّ محفوظٍ يُعاد قياسُه — لا واحدٌ منه');
    assert.equal(summary.files, 2);
    assert.equal(after.dir_walks, before.dir_walks + 2, 'مشيةٌ لكلِّ مجلدٍ: الثمنُ معدودٌ');
    assert.equal(after.dir_reuses, before.dir_reuses, 'ولا إعادةَ استخدامٍ تُحتسب هنا');
  } finally {
    resetDirectoryMeasures();
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('T-141: نفخٌ تحت السقف يمرّ لكنّ القياسَ المحفوظَ يُحدَّث بما قيس الآن', () => {
  const dir = scratch();
  try {
    put(dir, 'a.yaml', 400);
    resetDirectoryMeasures();
    const before = guardDeclarationDirectoryBytes(dir);
    put(dir, 'a.yaml', 4000);

    const summary = reverifyDeclarationDirectories();
    assert.ok(summary.bytes > before, 'المجموعُ المُرجَعُ هو المقيسُ الآن');
    assert.equal(storedDirectoryMeasure(dir)?.bytes, summary.bytes, 'والمحفوظُ صار طازجًا');
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-141: مجلدٌ اتُّكئ على قياسِه ثمّ صار لا يُقرأ ⇒ رفضٌ برمزٍ لا خطأُ نظامٍ عريان', () => {
  const dir = scratch();
  try {
    put(dir, 'a.yaml', 300);
    resetDirectoryMeasures();
    guardDeclarationDirectoryBytes(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(
      code(() => reverifyDeclarationDirectories()),
      'CONFIG_DECLARATION_DIR_UNREADABLE_AT_BOOT_END',
    );
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-141: لا محفوظَ ⇒ لا مشيَ ولا حكمَ — إعادةُ تحقّقٍ على فراغٍ لا تكلّف شيئًا', () => {
  resetDirectoryMeasures();
  const before = { ...bootWork() };
  const summary = reverifyDeclarationDirectories();
  assert.deepEqual(summary, { dirs: 0, files: 0, bytes: 0 });
  assert.equal(bootWork().dir_walks, before.dir_walks);
});

test('T-141: الإقلاعُ يُدوّن `declaration_dirs_reverified` قبلَ عدِّ العمل وقبلَ إعلانِ الدولة', () => {
  resetDeclarationMemo();
  resetDirectoryMeasures();
  resetLoadedDeclaration();
  const state = bootstrapState({ configDir: resolveConfigDir(), now: 7 });
  const kinds = state.audit.snapshot().map((entry) => entry.kind);
  const at = kinds.indexOf('declaration_dirs_reverified');
  assert.ok(at > 0, 'القيدُ موجودٌ ولا يسبق الحصرَ');
  assert.equal(kinds[at + 1], 'boot_work_measured', 'ثمّ العدُّ — فثمنُه معدودٌ لا مخفيّ');
  assert.equal(kinds[at + 2], 'state_online', 'ثمّ الخاتمة — فلا دولةَ تُعلن قبل المراجعة');

  const detail = state.audit.find('declaration_dirs_reverified')[0]!.detail as
    Record<string, number>;
  assert.ok(detail.dirs! >= 1, 'مجلدُ التهيئة على الأقلّ يُعاد قياسُه');
  assert.ok(detail.files! >= 1);
  assert.ok(detail.bytes! > 0);
});

test('T-141: إقلاعانِ متتاليان — عددُ المُعاد قياسُه نفسُه، فالإعادةُ عقدٌ لا حظّ', () => {
  const first = bootstrapState({ configDir: resolveConfigDir(), now: 8 });
  const second = bootstrapState({ configDir: resolveConfigDir(), now: 9 });
  const read = (state: typeof first): Record<string, number> =>
    state.audit.find('declaration_dirs_reverified')[0]!.detail as Record<string, number>;
  assert.deepEqual(read(second), read(first));
});
