/**
 * tests/kernel/declaration_dir_memo.test.ts — بصمةُ قياسِ المجلد: تُوفّر مشيًا ولا تُوفّر حكمًا (T-140)
 * المالك: القيّم على المستودع | المدخلات: مجلداتٌ مؤقّتةٌ تُبنى في الاختبار
 * المخرجات: حكمٌ على البصمةِ والمجلدِ الفرعيِّ والكتابةِ فوق ملفٍّ قائمٍ وبقاءِ السقف
 * التبعيات: src/kernel/config (`loadYamlFile` · حرَسُ المجلد · البصمةُ · عدّادُ العمل)
 * الصلاحيات (RULE-004): اختبارٌ يقرأ ويحكم؛ لا يُعدّل سقفًا ولا سياسة
 * السجلات: محورا `dir_walks` و`dir_reuses` في قيدِ `boot_work_measured`
 * حالات الفشل: `CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING` · قياسٌ بائتٌ يُعاد استخدامُه
 * الوثيقة: docs/test-reports/T-140-declaration-directory-memo.md
 *   · القرار: docs/decisions/ADR-0039-declaration-directory-memo.md
 *
 * ثوابت هذا الاختبار:
 *
 *   1) **الحكمُ على البصمة لا على الحظّ**: تغيُّرُ المجلد يُثبَّت بلمسِ زمنِ تعديله
 *      (`utimesSync`) بعد الكتابة — فلا يُبنى الاختبارُ على أنّ الكتابةَ ستقع في نانو ثانيةٍ
 *      مختلفة، ولا على انتظارٍ يجعله متقلّبًا.
 *
 *   2) **الرمزُ هو المُدَّعى لا النصّ**: كلُّ رفضٍ يُربط برمزِه، وكلُّ توفيرٍ يُربط بعددٍ من
 *      عدّادِ العمل — لا بنصٍّ عربيٍّ مشكولٍ يتغيّر بتحسينِ صياغة.
 *
 *   3) **كلُّ اختبارٍ ينسى ما حُفظ قبله وبعده**: فترتيبُ الاختبارات لا يُغيّر نتائجَها، ولا
 *      يُلمس قياسُ تهيئةِ المستودع الفعليّة إلّا بنسيان.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SovereignViolation, bootstrapState } from '../../src/index';
import {
  bootWork, directoryMeasureCount, guardDeclarationDirectoryBytes, loadYamlFile,
  resetDeclarationMemo, resetDirectoryMeasures, resetLoadedDeclaration, resolveConfigDir,
  storedDirectoryMeasure,
} from '../../src/kernel/config';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'dirmemo-'));
}

/** يكتب ملفَّ إعلانٍ بحجمٍ مطلوبٍ تقريبًا، ثمّ يُقدِّم زمنَ تعديلِ مجلدِه إثباتًا لا حظًّا */
function put(dir: string, name: string, bytes: number): string {
  const path = join(dir, name);
  const head = 'key: value\n';
  writeFileSync(path, head + '#'.repeat(Math.max(0, bytes - head.length - 1)) + '\n', 'utf8');
  return path;
}

/** يُقدّم زمنَ تعديلِ مسارٍ ثانيةً واحدةً — إثباتُ التغيُّرِ بلا انتظار */
function touch(path: string): void {
  const at = statSync(path).mtime.getTime() / 1000 + 1;
  utimesSync(path, at, at);
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

test('T-140: القياسُ الثاني للمجلد يُعاد استخدامُه ولا يُمشى المجلدُ من جديد', () => {
  const dir = scratch();
  try {
    put(dir, 'a.yaml', 300);
    put(dir, 'b.yaml', 300);
    resetDirectoryMeasures();
    const before = { ...bootWork() };
    const first = guardDeclarationDirectoryBytes(dir);
    const afterFirst = { ...bootWork() };
    const second = guardDeclarationDirectoryBytes(dir);
    const afterSecond = { ...bootWork() };

    assert.equal(second, first, 'القياسُ المحفوظُ هو المقيسُ نفسُه لا تقديرًا');
    assert.equal(afterFirst.dir_walks, before.dir_walks + 1, 'المشيةُ الأولى تُعَدّ');
    assert.equal(afterSecond.dir_walks, afterFirst.dir_walks, 'ولا مشيةَ ثانيةً');
    assert.equal(afterSecond.dir_reuses, afterFirst.dir_reuses + 1, 'وإعادةُ الاستخدام تُعَدّ');
    assert.equal(directoryMeasureCount() >= 1, true);
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-140: ملفٌّ يُضاف إلى المجلد يُغيّر بصمتَه فيُمشى من جديدٍ ويُقرأ المجموعُ الجديد', () => {
  const dir = scratch();
  try {
    put(dir, 'a.yaml', 400);
    resetDirectoryMeasures();
    const first = guardDeclarationDirectoryBytes(dir);
    put(dir, 'b.yaml', 900);
    touch(dir);
    const walksBefore = bootWork().dir_walks;
    const second = guardDeclarationDirectoryBytes(dir);

    assert.equal(second > first, true, 'المجموعُ الجديدُ أكبرُ — فلا قياسَ بائتٌ يُعاد');
    assert.equal(bootWork().dir_walks, walksBefore + 1, 'ومشيةٌ جديدةٌ تُعَدّ');
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-140: ملفٌّ منفوخٌ يُدَسّ في مجلدٍ فرعيٍّ يُكشف — البصمةُ تشمل كلَّ مجلدٍ مُشِيَ فيه', () => {
  const dir = scratch();
  try {
    put(dir, 'a.yaml', 400);
    mkdirSync(join(dir, 'nested'));
    put(join(dir, 'nested'), 'small.yaml', 200);
    resetDirectoryMeasures();
    const first = guardDeclarationDirectoryBytes(dir);
    const stored = storedDirectoryMeasure(dir);
    assert.equal(stored?.stamps.size, 2, 'بصمتانِ: المجلدُ الأعلى ومجلدُه الفرعيّ');

    // نفخٌ في المجلد الفرعيِّ وحدَه — زمنُ المجلد الأعلى لا يتحرّك أصلًا
    for (let i = 0; i < 5; i += 1) put(join(dir, 'nested'), `pad-${i}.yaml`, 60000);
    touch(join(dir, 'nested'));
    assert.equal(
      code(() => { guardDeclarationDirectoryBytes(dir); }),
      'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING',
      'السقفُ يقع ولو كان النفخُ في مجلدٍ فرعيٍّ بعد حفظِ القياس',
    );
    assert.equal(first > 0, true);
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-140: الكتابةُ فوق ملفٍّ قائمٍ تُكشف عند قراءته — القياسُ يُنسى ويُمشى المجلد', () => {
  const dir = scratch();
  try {
    const path = put(dir, 'a.yaml', 400);
    put(dir, 'b.yaml', 400);
    resetDirectoryMeasures();
    resetDeclarationMemo();
    resetLoadedDeclaration(dir);
    guardDeclarationDirectoryBytes(dir);
    const walksBefore = bootWork().dir_walks;

    // كتابةٌ فوق ملفٍّ قائمٍ لا تُحرّك زمنَ المجلد — فلا تكشفها البصمةُ وحدَها
    put(dir, 'a.yaml', 50000);
    assert.equal(storedDirectoryMeasure(dir) !== undefined, true, 'القياسُ محفوظٌ بعدُ');
    loadYamlFile(path);

    assert.equal(bootWork().dir_walks, walksBefore + 1, 'قراءةُ الملفِّ المتغيّرِ أنسَت القياس');
    assert.equal(
      storedDirectoryMeasure(dir)?.sizes.get(path),
      statSync(path).size,
      'والقياسُ الجديدُ يحمل الحجمَ الجديد',
    );
  } finally {
    resetDirectoryMeasures();
    resetDeclarationMemo();
    resetLoadedDeclaration(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-140: قياسٌ فوق السقف لا يُحفظ — والرفضُ يتكرّر برمزِه في كلِّ نداء', () => {
  const dir = scratch();
  try {
    for (let i = 0; i < 6; i += 1) put(dir, `pad-${i}.yaml`, 60000);
    resetDirectoryMeasures();
    assert.equal(
      code(() => { guardDeclarationDirectoryBytes(dir); }),
      'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING',
    );
    assert.equal(storedDirectoryMeasure(dir), undefined, 'لا يُحفظ قياسٌ فوق السقف');
    assert.equal(
      code(() => { guardDeclarationDirectoryBytes(dir); }),
      'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING',
      'والنداءُ الثاني يُردّ كالأوّل — لا ذاكرةَ تُمرِّر ما رُدّ',
    );
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-140: مجلدٌ محفوظُ القياسِ اختفى — لا يُعاد استخدامُ قياسِه', () => {
  const dir = scratch();
  const nested = join(dir, 'nested');
  try {
    put(dir, 'a.yaml', 300);
    mkdirSync(nested);
    put(nested, 'b.yaml', 300);
    resetDirectoryMeasures();
    const first = guardDeclarationDirectoryBytes(dir);
    rmSync(nested, { recursive: true, force: true });
    const walksBefore = bootWork().dir_walks;
    const second = guardDeclarationDirectoryBytes(dir);

    assert.equal(bootWork().dir_walks, walksBefore + 1, 'بصمةٌ غائبةٌ ⇒ مشيٌ لا تخمين');
    assert.equal(second < first, true, 'والمجموعُ نقص بحذفِ المجلد الفرعيّ');
  } finally {
    resetDirectoryMeasures();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-140: النسيانُ يُخلي القياسَ — مجلدًا مجلدًا وكلَّه', () => {
  const one = scratch();
  const two = scratch();
  try {
    put(one, 'a.yaml', 200);
    put(two, 'a.yaml', 200);
    resetDirectoryMeasures();
    guardDeclarationDirectoryBytes(one);
    guardDeclarationDirectoryBytes(two);
    assert.equal(directoryMeasureCount(), 2);
    resetDirectoryMeasures(one);
    assert.equal(directoryMeasureCount(), 1);
    assert.equal(storedDirectoryMeasure(one), undefined);
    assert.equal(storedDirectoryMeasure(two) !== undefined, true);
    resetDirectoryMeasures();
    assert.equal(directoryMeasureCount(), 0);
  } finally {
    resetDirectoryMeasures();
    rmSync(one, { recursive: true, force: true });
    rmSync(two, { recursive: true, force: true });
  }
});

test('T-140: القياسُ لا يعبر إقلاعَين — والعدُّ يتكرّر حرفًا فيصلح عقدًا', () => {
  const configDir = resolveConfigDir();
  bootstrapState({ configDir, now: 1 });
  const first = { ...bootWork() };
  bootstrapState({ configDir, now: 2 });
  const second = { ...bootWork() };

  assert.deepEqual(second, first, 'إقلاعان في عمليّةٍ واحدةٍ يعملان العملَ نفسَه');
  assert.equal(first.dir_reuses > first.dir_walks, true, 'وإعادةُ الاستخدامِ أكثرُ من المشي');
  assert.equal(first.dir_walks <= 16, true, 'والمشيُ في حدودِ عددِ المجلدات المقروءة');
});
