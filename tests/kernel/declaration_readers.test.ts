/**
 * tests/kernel/declaration_readers.test.ts — سجلُّ قُرّاءِ الإعلان في الإقلاع (المرحلة 40، البند T-137)
 * المالك: القيّم على المستودع
 * المدخلات: `config/` الحقيقيّ قراءةً + نسخٌ منه في tmpdir تُزاد فيها ملفّاتٌ بلا قارئ
 * المخرجات: تأكيدُ أنّ ملفَّ إعلانٍ بلا قارئٍ مسجَّلٍ **يُسقط الإقلاعَ** لا يمرّ صامتًا
 * التبعيات: `node:test` · `node:fs` · `node:os`
 * الصلاحيات (RULE-004): يقرأ ولا يكتب في المستودع؛ كلُّ زيادةٍ في نسخةٍ مؤقّتة
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: ملفٌّ في المجلد بلا صفّ · صفٌّ يُنادى محمّلُه فيرفض إعلانًا فاسدًا
 *   · تطابقُ السجلِّ مع المجلد الحقيقيّ · جمودُ السجل · لا صفَّ مكرَّرًا
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/decisions/ADR-0042-declaration-readers.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **يُختبر الحاجزُ من الإقلاع لا من البوابة وحدَها**: البوابةُ الصدفيّةُ تُفحص في
 *    `tests/governance/config_readers_gate.test.ts`؛ وهنا يُفحص المسارُ الذي يمرّ به **كلُّ
 *    إقلاعٍ حقيقيّ**: `guardDeclarationBudget` ⇒ `guardDeclarationReaders`. فحاجزٌ في البوابة
 *    وحدَها يُعطَّل بمن يشغّل الدولةَ بلا بوابة.
 *
 * 2) **الاتّجاهُ المفحوصُ هنا واحدٌ مُعلن**: ملفٌّ موجودٌ بلا قارئ. والاتّجاهُ المقابل (قارئٌ
 *    بلا ملف) موضعُه البوابةُ على المستودع الحقيقيّ — وهذا مُصرَّحٌ به هنا لئلّا يُظنَّ سهوًا.
 *
 * 4) **حرسُ تعداداتِ أسماءِ المفاتيح يُختبر بجدولٍ مصنوع**: `CLOSED_MAP_KEY_ENUMS` الحقيقيُّ
 *    يُفحص تطابقًا، وحالاتُ الرفضِ الثلاثُ تُجرَّب بجداولَ مصنوعةٍ — فلا يُفسَد الحقيقيُّ
 *    ليُرى الرفض، ولا يُدَّعى رفضٌ لم يُشاهَد.
 *
 * 3) **قارئا الحرَسِ يُناديان فعلًا**: يُثبَت بأنّ إفسادَ `policies.yaml` في النسخة يُسقط
 *    `guardDeclarationBudget` — فلو كان الصفُّ إعلانًا لا نداءً لَمَرَّ الفاسد.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLOSED_MAP_KEY_ENUMS,
  guardClosedMapKeyEnums,
  DECLARATION_READERS,
  declarationReaderOf,
  guardDeclarationBudget,
  guardDeclarationReaders,
  censusDeclaration,
  resolveConfigDir,
} from '../../src/kernel/config';
import { SovereignViolation } from '../../src/kernel/types';

const REAL = resolveConfigDir();
const WITHOUT_READER = 'DECLARATION_FILE_WITHOUT_READER';
/** موضعُ استعمالٍ مصنوعٌ للجداول المُختبَرة — لا يُلمس به سجلٌّ حقيقيّ (الثابت 4) */
const USE = { file: 'x.yaml', map: 'x', reader: 'loadX' } as const;

/** يُرجع رمزَ الرفض إن رُفض، وإلّا فـ`null` — ولا يُبتلع خطأٌ غيرُ سياديّ (RULE-007) */
function refusalCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof SovereignViolation) return error.code;
    throw error;
  }
}

/** نسخةٌ من الإعلان الحقيقيّ يُعمل فيها ما يُطلب — والأصلُ لا يُمسّ (الثابت 3) */
function withCopy(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'sool-readers-'));
  try {
    cpSync(REAL, dir, { recursive: true });
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? 'NO_CODE';
}

test('T-137: السجلُّ يقابل مجلدَ الإعلان الحقيقيَّ ملفًّا بملفّ', () => {
  const census = censusDeclaration(REAL);
  const registered = DECLARATION_READERS.map((r) => r.file).sort();
  assert.deepEqual([...census.names].sort(), registered);
  assert.equal(DECLARATION_READERS.length, census.files);
});

test('T-137: السجلُّ مجمَّدٌ ولا صفَّ مكرَّرًا ولا صفَّ ناقصَ حقل', () => {
  assert.ok(Object.isFrozen(DECLARATION_READERS));
  const files = DECLARATION_READERS.map((r) => r.file);
  assert.equal(new Set(files).size, files.length, 'صفٌّ مكرَّرٌ في السجل');
  for (const row of DECLARATION_READERS) {
    assert.ok(row.file.endsWith('.yaml') || row.file.endsWith('.yml'), row.file);
    assert.match(row.reader, /^load[A-Z]/, `اسمُ قارئٍ غيرُ صالح: ${row.reader}`);
    assert.match(row.module, /^src\/kernel\/config\//, `وحدةٌ خارجَ النواة: ${row.module}`);
    assert.ok(row.site === 'read_at_guard' || row.site === 'read_in_domain', row.site);
  }
  // والسياساتُ والأدوارُ وحدَهما يُناديهما الحرَسُ — لأنّهما يعلوان الأبوابَ كلَّها
  const atGuard = DECLARATION_READERS.filter((r) => r.site === 'read_at_guard').map((r) => r.file).sort();
  assert.deepEqual(atGuard, ['policies.yaml', 'roles.yaml']);
});

test('T-137: البحثُ عن صفٍّ يُعيد الصفَّ أو لا شيءَ — قراءةٌ بلا حكم', () => {
  assert.equal(declarationReaderOf('policies.yaml')?.reader, 'loadPolicies');
  assert.equal(declarationReaderOf('roles.yaml')?.reader, 'loadRoles');
  // ما نُقل إلى scripts/limits/ لا صفَّ له: إعلانُ أدواتٍ لا إعلانُ دولة
  assert.equal(declarationReaderOf('module_limits.yaml'), undefined);
  assert.equal(declarationReaderOf('لا-وجود-له.yaml'), undefined);
});

test('T-137: الإعلانُ القائمُ يمرّ بالحاجز، والعائدُ عددُ ما فُحص', () => {
  const census = censusDeclaration(REAL);
  assert.equal(guardDeclarationReaders(REAL, census.names), census.files);
});

test('T-137: ملفٌّ يُزاد إلى مجلد الإعلان بلا قارئٍ يُسقط الإقلاع (الثابت 1)', () => {
  withCopy((dir) => {
    writeFileSync(join(dir, 'invented.yaml'), 'k: 1\n', 'utf8');
    assert.throws(
      () => guardDeclarationBudget(dir),
      (e) => codeOf(e) === WITHOUT_READER,
      'ملفٌّ بلا قارئٍ مرَّ في الإقلاع — والحاجزُ الذي لا يقع ليس حاجزًا',
    );
  });
});

test('T-137: الرفضُ يسمّي الملفَّ ويسمّي المخرجَين — فلا يُبحث عن العلاج يدويًّا', () => {
  withCopy((dir) => {
    writeFileSync(join(dir, 'invented.yaml'), 'k: 1\n', 'utf8');
    try {
      guardDeclarationBudget(dir);
      assert.fail('لم يسقط الحاجز');
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /invented\.yaml/);
      assert.match(message, /declaration_readers\.ts/);
      assert.match(message, /إعلانُ أدواتٍ لا إعلانُ دولة/);
    }
  });
});

test('T-137: صفُّ الحرَسِ نداءٌ لا إعلان — إعلانُ سياساتٍ فاسدٌ يُسقط الإقلاع (الثابت 3)', () => {
  withCopy((dir) => {
    writeFileSync(join(dir, 'policies.yaml'), 'policies:\n  audit_every_decision: false\n', 'utf8');
    assert.throws(() => guardDeclarationBudget(dir), (e) => {
      const code = codeOf(e);
      return code === 'CONFIG_POLICY_MUST_HOLD' || code === 'CONFIG_POLICY_MISSING_KEY';
    });
  });
});

test('T-137: صفُّ الأدوارِ نداءٌ كذلك — دورٌ يجمع الاعتمادَ والتنفيذَ يُسقط الإقلاع', () => {
  withCopy((dir) => {
    // الأدوارُ الستّةُ معلنةٌ كلُّها والعلّةُ واحدةٌ: الملكُ يعتمد وينفّذ معًا
    const powers = (propose: boolean, approve: boolean, execute: boolean, audit: boolean): string[] => [
      `    propose: ${String(propose)}`,
      `    approve: ${String(approve)}`,
      `    execute: ${String(execute)}`,
      `    audit: ${String(audit)}`,
    ];
    const roles = [
      'roles:',
      '  king:', ...powers(true, true, true, false),
      '  crown_guard:', ...powers(false, false, true, false),
      '  minister:', ...powers(true, false, true, false),
      '  governor:', ...powers(true, false, true, false),
      '  auditor:', ...powers(false, false, false, true),
      '  agent:', ...powers(true, false, true, false),
      '',
    ].join('\n');
    writeFileSync(join(dir, 'roles.yaml'), roles, 'utf8');
    assert.throws(() => guardDeclarationBudget(dir), (e) => codeOf(e) === 'CONFIG_ROLE_SEPARATION');
  });
});

test('T-137: الاتّجاهُ المقابلُ ليس من عملِ الإقلاع — نقصُ ملفٍّ في نسخةٍ لا يُسقطه (الثابت 2)', () => {
  // مجلدُ إعلانٍ منسوخٌ ناقصٌ في اختبارٍ ليس علّةً في الدولة؛ والاتّجاهُ يُحرس في البوابة
  assert.equal(guardDeclarationReaders(REAL, ['policies.yaml']), 1);
});

// ═══ الثابت 4: تعداداتُ أسماءِ المفاتيح — تطابقٌ مقيسٌ وثلاثُ حالاتِ رفضٍ مُشاهَدة
test('T-137: كلُّ تعدادِ أسماءِ مفاتيحَ مُسجَّلٌ مجمَّدٌ وعددُه مطابقٌ وله موضعُ استعمال', () => {
  assert.ok(CLOSED_MAP_KEY_ENUMS.length > 0, 'جدولٌ فارغٌ يجعل الحرسَ لا شيء');
  assert.ok(Object.isFrozen(CLOSED_MAP_KEY_ENUMS), 'جدولُ التعدادات نفسُه غيرُ مجمَّد');
  for (const binding of CLOSED_MAP_KEY_ENUMS) {
    assert.ok(Object.isFrozen(binding.values), `تعدادٌ غيرُ مجمَّد: ${binding.name}`);
    assert.equal(binding.values.length, binding.members, `عددٌ انحرف: ${binding.name}`);
    assert.ok(binding.uses.length > 0, `تعدادٌ مُسجَّلٌ بلا موضعِ استعمال: ${binding.name}`);
    for (const use of binding.uses) {
      assert.ok(use.file.endsWith('.yaml'), `موضعٌ ليس ملفَّ إعلان: ${use.file}`);
      assert.ok(use.map.length > 0 && use.reader.length > 0, `موضعٌ ناقصُ الإسناد: ${binding.name}`);
    }
  }
  assert.equal(guardClosedMapKeyEnums(), CLOSED_MAP_KEY_ENUMS.length);
});

test('T-137: تعدادُ أسماءِ مفاتيحَ فارغٌ يُرفض — لا يُقرأ حرسًا صارمًا', () => {
  const code = refusalCode(() => guardClosedMapKeyEnums([
    { name: 'X', values: Object.freeze([]), members: 0, uses: [USE] },
  ]));
  assert.equal(code, 'CONFIG_CLOSED_ENUM_EMPTY');
});

test('T-137: تعدادُ أسماءِ مفاتيحَ غيرُ مجمَّدٍ يُرفض — الغلقُ في الأنواع وحدها دعوى', () => {
  const code = refusalCode(() => guardClosedMapKeyEnums([
    { name: 'X', values: ['a'], members: 1, uses: [USE] },
  ]));
  assert.equal(code, 'CONFIG_CLOSED_ENUM_NOT_FROZEN');
});

test('T-137: عددٌ خالفَ المُثبَتَ يُرفض — فتحُ التعدادِ قرارٌ يُعلن لا يُمرَّر', () => {
  const code = refusalCode(() => guardClosedMapKeyEnums([
    { name: 'X', values: Object.freeze(['a', 'b']), members: 1, uses: [USE] },
  ]));
  assert.equal(code, 'CONFIG_CLOSED_ENUM_CENSUS_DRIFT');
});
