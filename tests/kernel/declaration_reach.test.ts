/**
 * tests/kernel/declaration_reach.test.ts — مدى الإعلان ودفترُ ما حُمِّل (المرحلة 39، البند T-133)
 * المالك: القيّم على المستودع | المدخلات: مجلداتٌ مؤقتةٌ تُبنى في الاختبار · نسخةٌ من `config/`
 * المخرجات: رفضٌ برموزٍ معلنة · أعدادُ حصرٍ ودفترٍ مقيسة | التبعيات: declaration_reach · yaml
 * الصلاحيات: لا تعديل على تهيئة المستودع الفعليّة | السجلات: قيدُ `declaration_budget_measured`
 * حالات الفشل: `CONFIG_DECLARATION_REACH_TOO_DEEP` · `CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING`
 *   · `CONFIG_LOADED_NODES_OVER_CEILING` · `CONFIG_FILE_OVER_BYTE_CEILING`
 * الوثيقة: docs/test-reports/T-133-declaration-reach.md
 *   · القياسُ الخام: docs/audit/measurements/phase-39-T133.txt
 * ثوابت الاختبار:
 *   1) **الأسئلةُ الأربعةُ التي قِيست تُثبَّت هنا**: مجلدٌ فرعيّ · لاحقةٌ أخرى · نداءُ محمّلٍ
 *      مفردٍ بلا إقلاع · مجموعٌ يتراكم على قراءات. فمن أعاد أيًّا منها سقط عليه اختبار.
 *   2) **الرمزُ هو المُدَّعى لا النصّ**: كلُّ تأكيدٍ يُربط برمزِ خطأٍ أو بعددٍ مقيس، ولا يُؤكَّد
 *      على نصٍّ عربيٍّ مشكولٍ يتغيّر بتحسينِ صياغة.
 *   3) **ترتيبُ الحرَس مُثبَتٌ لا مُفترَض**: ملفٌّ فوق سقفِ بايتاته في مجلدٍ سليمٍ يُرفض برمزِ
 *      **الملفّ** لا برمزِ المجلد — فمن قلَب الترتيبَ غيّر رمزًا يقرؤه غيرُه.
 *   4) **العزلُ يُختبر لأنّه شرطُ صحّةِ 1900+ اختبارٍ**: الدفترُ مُفهرسٌ بالمجلد، فقراءةٌ في
 *      مجلدٍ لا تُثقل سقفَ مجلدٍ آخر، وإلّا لسقطت اختباراتٌ بريئةٌ بذنبِ أخرى.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SovereignViolation, bootstrapState } from '../../src/index';
import {
  CONFIG_DECLARATION_BUDGET, DECLARATION_REACH, censusDeclaration, isDeclarationFile,
  loadYamlFile, loadedDeclaration, resetLoadedDeclaration, resolveConfigDir,
  walkDeclarationFiles,
} from '../../src/kernel/config';

const REAL_CONFIG = resolveConfigDir();

/** يبني مجلدًا مؤقتًا ويُعيد مساره — والحذفُ على المستدعي */
function scratch(tag: string): string {
  return mkdtempSync(join(tmpdir(), `reach-${tag}-`));
}

/** يكتب ملفَّ إعلانٍ بحجمٍ مطلوبٍ تقريبًا بحشوٍ من تعليقات */
function padded(path: string, bytes: number): void {
  const head = 'key: value\n';
  writeFileSync(path, head + '#'.repeat(Math.max(0, bytes - head.length - 1)) + '\n', 'utf8');
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

test('T-133: المدى ثابتٌ مُجمَّدٌ يُقرأ ولا يُستنتج', () => {
  assert.equal(Object.isFrozen(DECLARATION_REACH), true);
  assert.equal(Object.isFrozen(DECLARATION_REACH.extensions), true);
  assert.deepEqual([...DECLARATION_REACH.extensions], ['.yaml', '.yml']);
  assert.equal(DECLARATION_REACH.max_depth > 0, true);
  assert.equal(isDeclarationFile('a.yaml'), true);
  assert.equal(isDeclarationFile('a.yml'), true);
  assert.equal(isDeclarationFile('a.yaml.bak'), false);
  assert.equal(isDeclarationFile('README.md'), false);
});

test('T-133/1: الحصرُ يرى المجلدَ الفرعيَّ واللاحقةَ الأخرى', () => {
  const dir = scratch('nested');
  try {
    padded(join(dir, 'flat.yaml'), 400);
    padded(join(dir, 'other.yml'), 500);
    mkdirSync(join(dir, 'sub', 'deeper'), { recursive: true });
    padded(join(dir, 'sub', 'inner.yaml'), 600);
    padded(join(dir, 'sub', 'deeper', 'deep.yml'), 700);
    writeFileSync(join(dir, 'notes.md'), 'ليس إعلانًا', 'utf8');

    const paths = walkDeclarationFiles(dir);
    assert.equal(paths.length, 4);
    assert.equal(paths.some((p) => p.endsWith('deep.yml')), true);
    assert.equal(paths.some((p) => p.endsWith('notes.md')), false);

    const census = censusDeclaration(dir);
    assert.equal(census.files, 4);
    assert.equal(census.bytes > 2100 && census.bytes < 2400, true, `مقيس: ${census.bytes}`);
    assert.equal(census.largestFile.includes('deep'), true, census.largestFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-133/1: العمقُ فوق المُعلن يُرفض برمزٍ لا يُتجاهل', () => {
  const dir = scratch('deep');
  try {
    let path = dir;
    for (let i = 0; i <= DECLARATION_REACH.max_depth + 1; i += 1) {
      path = join(path, `d${i}`);
      mkdirSync(path);
    }
    padded(join(path, 'buried.yaml'), 200);
    assert.equal(code(() => { walkDeclarationFiles(dir); }), 'CONFIG_DECLARATION_REACH_TOO_DEEP');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-133/2: مجلدٌ فرعيٌّ منفوخٌ يُردّ في الإقلاع وفي نداءِ محمّلٍ مفرد', () => {
  const dir = scratch('boot');
  try {
    cpSync(REAL_CONFIG, dir, { recursive: true });
    mkdirSync(join(dir, 'nested'));
    for (let i = 0; i < 4; i += 1) padded(join(dir, 'nested', `pad-${i}.yaml`), 60000);

    assert.equal(
      code(() => { bootstrapState({ configDir: dir, now: 1 }); }),
      'CONFIG_DECLARATION_TOTAL_BYTES_OVER_CEILING',
    );
    // وهذا هو جوهرُ T-133: قراءةُ ملفٍ **واحدٍ** من المجلد نفسِه لا تمرّ بعد اليوم
    assert.equal(
      code(() => { loadYamlFile(join(dir, 'production.yaml')); }),
      'CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING',
    );
  } finally {
    resetLoadedDeclaration(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-133/3: الدفترُ يُحصي ما حُمِّل، ويُسقط سقفَ العُقد بلا إقلاع', () => {
  const dir = scratch('ledger');
  try {
    for (let f = 0; f < 3; f += 1) {
      const rows = Array.from({ length: 3000 }, (_, i) => `  - x-${f}-${i}`).join('\n');
      writeFileSync(join(dir, `nodes-${f}.yaml`), `items:\n${rows}\n`, 'utf8');
    }
    resetLoadedDeclaration(dir);

    loadYamlFile(join(dir, 'nodes-0.yaml'));
    const first = loadedDeclaration(dir);
    assert.equal(first.files, 1);
    assert.equal(first.nodes > 3000, true, `مقيس: ${first.nodes}`);

    // قراءةٌ ثانيةٌ للملفِّ نفسِه لا تُضاعفه: الدفترُ مُفهرسٌ بالمسار
    loadYamlFile(join(dir, 'nodes-0.yaml'));
    assert.deepEqual(loadedDeclaration(dir), first);

    loadYamlFile(join(dir, 'nodes-1.yaml'));
    assert.equal(loadedDeclaration(dir).nodes > CONFIG_DECLARATION_BUDGET.declared_nodes / 2, true);
    assert.equal(
      code(() => { loadYamlFile(join(dir, 'nodes-2.yaml')); }),
      'CONFIG_LOADED_NODES_OVER_CEILING',
    );
  } finally {
    resetLoadedDeclaration(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-133/4: الدفترُ معزولٌ بالمجلد، والصفرُ يُعاد بالتصفير', () => {
  const one = scratch('iso-one');
  const two = scratch('iso-two');
  try {
    padded(join(one, 'a.yaml'), 300);
    padded(join(two, 'b.yaml'), 300);
    resetLoadedDeclaration(one);
    resetLoadedDeclaration(two);

    loadYamlFile(join(one, 'a.yaml'));
    assert.equal(loadedDeclaration(one).files, 1);
    assert.equal(loadedDeclaration(two).files, 0);
    assert.equal(loadedDeclaration(two).bytes, 0);

    resetLoadedDeclaration(one);
    assert.equal(loadedDeclaration(one).files, 0);
  } finally {
    resetLoadedDeclaration(one);
    resetLoadedDeclaration(two);
    rmSync(one, { recursive: true, force: true });
    rmSync(two, { recursive: true, force: true });
  }
});

test('T-133/5: ترتيبُ الحرَس محفوظ — سقفُ الملفِّ يسبق سقفَ المجلد', () => {
  const dir = scratch('order');
  try {
    padded(join(dir, 'huge.yaml'), CONFIG_DECLARATION_BUDGET.file_bytes + 1000);
    assert.equal(
      code(() => { loadYamlFile(join(dir, 'huge.yaml')); }),
      'CONFIG_FILE_OVER_BYTE_CEILING',
    );
  } finally {
    resetLoadedDeclaration(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-133/6: مدى الحصر مُدوَّنٌ في الدفتر مع رقمِه (RULE-009)', () => {
  const state = bootstrapState({ configDir: REAL_CONFIG, now: 1 });
  const entries = state.audit.find('declaration_budget_measured');
  assert.equal(entries.length, 1);
  const detail = entries[0]!.detail as Record<string, unknown>;
  assert.equal(detail.reach_extensions, DECLARATION_REACH.extensions.join(' '));
  assert.equal(detail.reach_max_depth, DECLARATION_REACH.max_depth);
  assert.equal(detail.files, censusDeclaration(REAL_CONFIG).files);
});
