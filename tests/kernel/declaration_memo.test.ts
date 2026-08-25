/**
 * tests/kernel/declaration_memo.test.ts — ذاكرةُ قراءةِ الإعلان: توفّر عملًا ولا تُخفي تغييرًا (T-139)
 * المالك: القيّم على المستودع | المدخلات: مجلداتُ تهيئةٍ مؤقّتةٌ + تهيئةُ المستودع
 * المخرجات: حكمٌ على البصمة والنسيانِ والنسخِ وبقاءِ الحرَس وعدِّ العمل
 * التبعيات: src/kernel/config (`loadYamlFile` · الذاكرة · عدّادُ العمل) · src/index
 * الصلاحيات (RULE-004): اختبارٌ يقرأ ويحكم؛ لا يُعدّل سقفًا ولا سياسة
 * السجلات: محورُ `memo_hits` في قيدِ `boot_work_measured` — يُتحقَّق منه هنا
 * حالات الفشل: نصٌّ قديمٌ يُعاد بعد تعديلٍ · حرَسٌ يُلغى بالذاكرة · ذاكرةٌ تعبر إقلاعَين
 * الوثيقة: docs/test-reports/T-139-declaration-memo.md
 *
 * ثوابت هذا الاختبار:
 *
 *   1) **الحكمُ على البصمة لا على الحظّ**: التعديلُ يُثبَت بكتابةٍ ثمّ لمسِ زمنِ التعديل
 *      (`utimesSync`) — فلا يُبنى الاختبارُ على أنّ الكتابةَ الثانيةَ ستقع في نانو ثانيةٍ
 *      مختلفة، ولا على انتظارٍ زمنيٍّ يجعله متقلّبًا.
 *
 *   2) **لا تُلمس ذاكرةُ الإقلاع الحقيقيّة إلّا بنسيان**: كلُّ اختبارٍ ينسى ما حُفظ قبله
 *      وبعده، فترتيبُ الاختبارات لا يُغيّر نتائجَها.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bootstrapState } from '../../src/index';
import {
  BootWork, bootWork, declarationMemoSize, loadYamlFile, resetDeclarationMemo,
  resetLoadedDeclaration,
} from '../../src/kernel/config';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'memo-'));
}

test('T-139: القراءةُ الثانيةُ للمسارِ نفسِه تُسترجع من الذاكرة ولا تُقرأ من القرص', () => {
  const dir = scratch();
  const path = join(dir, 'a.yaml');
  writeFileSync(path, 'x: 1\ny: 2\n', 'utf8');
  resetDeclarationMemo();
  resetLoadedDeclaration(dir);
  const before = { ...bootWork() };
  const first = loadYamlFile(path);
  const afterFirst = { ...bootWork() };
  const second = loadYamlFile(path);
  const afterSecond = { ...bootWork() };
  assert.deepEqual(second, first);
  assert.equal(afterFirst.file_reads - before.file_reads, 1);
  assert.equal(afterSecond.file_reads - afterFirst.file_reads, 0);
  assert.equal(afterSecond.memo_hits - afterFirst.memo_hits, 1);
  resetDeclarationMemo();
});

test('T-139: ملفٌّ تغيّر زمنُ تعديله يُقرأ من جديدٍ فلا يُخفى تغييرٌ', () => {
  const dir = scratch();
  const path = join(dir, 'b.yaml');
  writeFileSync(path, 'value: old\n', 'utf8');
  resetDeclarationMemo();
  resetLoadedDeclaration(dir);
  assert.equal(loadYamlFile(path)['value'], 'old');
  writeFileSync(path, 'value: new\n', 'utf8');
  utimesSync(path, new Date(), new Date(Date.now() + 5_000));
  const before = { ...bootWork() };
  assert.equal(loadYamlFile(path)['value'], 'new');
  assert.equal(bootWork().file_reads - before.file_reads, 1);
  resetDeclarationMemo();
});

test('T-139: الذاكرةُ تُعطي نسخةً — تعديلُ القارئِ لا يُفسد ما يُعطى لمن بعده', () => {
  const dir = scratch();
  const path = join(dir, 'c.yaml');
  writeFileSync(path, 'root:\n  leaf: 1\n', 'utf8');
  resetDeclarationMemo();
  resetLoadedDeclaration(dir);
  const first = loadYamlFile(path) as { root: { leaf: number } };
  first.root.leaf = 999;
  const second = loadYamlFile(path) as { root: { leaf: number } };
  assert.equal(second.root.leaf, 1);
  assert.notEqual(first, second);
  resetDeclarationMemo();
});

test('T-139: النسيانُ يُخلي الذاكرةَ — مسارًا مسارًا وكلَّها', () => {
  const dir = scratch();
  const first = join(dir, 'd.yaml');
  const second = join(dir, 'e.yaml');
  writeFileSync(first, 'a: 1\n', 'utf8');
  writeFileSync(second, 'b: 2\n', 'utf8');
  resetDeclarationMemo();
  resetLoadedDeclaration(dir);
  loadYamlFile(first);
  loadYamlFile(second);
  assert.equal(declarationMemoSize(), 2);
  resetDeclarationMemo(first);
  assert.equal(declarationMemoSize(), 1);
  resetDeclarationMemo();
  assert.equal(declarationMemoSize(), 0);
});

test('T-139: سقفُ بايتات الملف يُرفض ولو كان النصُّ محفوظًا — الذاكرةُ لا تُلغي حرَسًا', () => {
  const dir = scratch();
  const path = join(dir, 'f.yaml');
  writeFileSync(path, 'small: 1\n', 'utf8');
  resetDeclarationMemo();
  resetLoadedDeclaration(dir);
  loadYamlFile(path);
  writeFileSync(path, `padded: "${'ـ'.repeat(70_000)}"\n`, 'utf8');
  assert.throws(() => loadYamlFile(path), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'CONFIG_FILE_OVER_BYTE_CEILING');
    return true;
  });
  resetDeclarationMemo();
  resetLoadedDeclaration(dir);
});

test('T-139: الذاكرةُ لا تعبر إقلاعَين — كلُّ إقلاعٍ يقرأ إعلانَه من القرص', () => {
  const first = bootstrapState({ configDir: 'config', now: 1 });
  const firstWork = { ...bootWork() };
  const second = bootstrapState({ configDir: 'config', now: 2 });
  const secondWork = { ...bootWork() };
  assert.ok(firstWork.file_reads > 0);
  assert.deepEqual(secondWork, firstWork);
  const axes = Object.keys(firstWork) as (keyof BootWork)[];
  for (const axis of axes) assert.equal(secondWork[axis], firstWork[axis], axis);
  assert.ok(first.audit.find('boot_work_measured').length === 1);
  assert.ok(second.audit.find('boot_work_measured').length === 1);
});

test('T-139: الإقلاعُ يستردّ أكثرَ مما يقرأ — والقيدُ يحمل المحورَين', () => {
  const state = bootstrapState({ configDir: 'config', now: 3 });
  const detail = state.audit.find('boot_work_measured')[0]!.detail as Record<string, number>;
  assert.equal(typeof detail['memo_hits'], 'number');
  assert.ok(detail['memo_hits']! > detail['file_reads']!);
  assert.equal(detail['parse_calls'], detail['file_reads']);
});
