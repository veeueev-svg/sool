/**
 * tests/kernel/declaration_ceilings.test.ts — سقوفُ العدد المعلن (T-75)
 * المالك: وزارة الاقتصاد | المدخلات: نسخةٌ من `config/` تُضخَّم في مجلد مؤقت | المخرجات: رفضُ إقلاع
 * التبعيات: loadEnterprises · guardDeclaredCount · DECLARATION_CEILINGS
 * الصلاحيات: لا تعديل على تهيئة المستودع الفعلية | السجلات: لا شيء — الرفضُ قبل الإقلاع
 * حالات الفشل: كلُّها مغلقةٌ برموزٍ معلنة | الوثيقة: docs/test-reports/T-075-declaration-ceilings.md
 * ثوابت الاختبار:
 *   1) الفجوةُ تُبرهَن لا تُدَّعى: يُقاس أنّ الإعلانَ المضخَّم كان يمرّ لولا الحاجز.
 *   2) السقفُ يسكن النواةَ لا الملفَّ المحكوم — فلا يُوسَّع بسطرٍ في تهيئة (RULE-005).
 *   3) الرفضُ برمزه لا بنصّه، ويحمل العددَين مقيسَين.
 *   4) تهيئةُ المستودع الفعليّة تمرّ — الحاجزُ حرسٌ لا شلَل.
 *   ترتيبٌ مقيسٌ أُضيف في T-130: حاجزُ **بايتات الملف** في `loadYamlFile` يسبق حاجزَ العدد
 *      في المحمّل. فحملٌ ضخمٌ يُردّ حجمًا لا عددًا — وهو أرخص، والاختباران أدناه يُعلنانه
 *      صريحًا بدل أن يُبدَّل رمزُ الرفض في صمت.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SovereignViolation } from '../../src/index';
import {
  DECLARATION_CEILINGS, guardDeclaredCount, loadEnterprises, resolveConfigDir,
} from '../../src/kernel/config';

// مجلدُ التهيئة الفعليّ يُحلُّ كما يحلّه المستودعُ نفسُه، لا بمسارٍ نسبيٍّ من موقع الاختبار
// (فالاختبارُ يُشغَّل من `dist/` فـ`__dirname` هناك لا `config/` تحته)
const REAL_CONFIG = resolveConfigDir();

/** نسخةٌ من مجلد التهيئة الفعليّ تُضخَّم فيها قائمةٌ واحدة — والأصلُ لا يُمسّ */
function withEnterprises(
  mutate: (yaml: string) => string,
  body: (dir: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), 'decl-ceiling-'));
  try {
    cpSync(REAL_CONFIG, dir, { recursive: true });
    const file = join(dir, 'enterprises.yaml');
    writeFileSync(file, mutate(readFileSync(file, 'utf8')));
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** موادُّ داخليّةٌ صحيحةُ الشكل بعددٍ مطلوب — كلُّ عيبٍ فيها ليس عيبَ عدد */
function bulkMaterials(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += `  - { id: "material:bulk-${i}", name: "مادة مضخّمة ${i}", `
      + 'unit: "unit", source: "internal" }\n';
  }
  return out;
}

/** أنواعُ منشآتٍ صحيحةُ الشكل: مدخلٌ معلنٌ ومخرجٌ داخليٌّ وكلفةٌ تحت سقف الكيان وفحوصٌ كافية */
function bulkKinds(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += `  - id: "facility:bulk-${i}"\n    name: "منشأة مضخّمة ${i}"\n`
      + '    sector: "data_processing"\n    inputs:\n'
      + '      - { material: "material:raw-compute", quantity: 1 }\n'
      + `    output: { material: "material:bulk-${i}", quantity: 1 }\n`
      + '    resource_cost: { resource: "compute_units", amount: 1 }\n'
      + '    required_checks:\n      - "input_provenance"\n      - "output_integrity"\n'
      + '      - "waste_within_tolerance"\n      - "resource_within_limit"\n';
  }
  return out;
}

function refusalCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SovereignViolation, 'الرفضُ يكون انتهاكًا سياديًّا لا خطأً عامًّا');
    return (error as SovereignViolation).code;
  }
  assert.fail('كان يجب أن يُرفض');
}

test('T-75: تهيئةُ المستودع الفعليّة تمرّ، وسقوفُها فوق ما تعلنه', () => {
  const config = loadEnterprises();
  assert.ok(config.materials.length <= DECLARATION_CEILINGS.materials);
  assert.ok(config.kinds.length <= DECLARATION_CEILINGS.enterprise_kinds);
  assert.ok(Object.keys(config.quality_checks).length <= DECLARATION_CEILINGS.quality_checks);
  assert.ok(
    config.policy.suspend_authorities.length <= DECLARATION_CEILINGS.suspend_authorities,
  );
  // الحاجزُ حرسٌ لا شلَل: ثمّ متّسعٌ معلنٌ للنموّ فوق القائم
  assert.ok(DECLARATION_CEILINGS.enterprise_kinds > config.kinds.length);
  assert.ok(DECLARATION_CEILINGS.materials > config.materials.length);
});

test('T-75: الفجوةُ مبرهنة — ألفُ نوعٍ صحيحِ الشكل كان يمرّ، والسقفُ وحده يردّه', () => {
  const BULK = 1000;
  withEnterprises(
    (yaml) => yaml
      .replace('materials:\n', `materials:\n${bulkMaterials(BULK)}`)
      .replace('kinds:\n', `kinds:\n${bulkKinds(BULK)}`),
    (dir) => {
      // أوّلًا: أنّ العيبَ عيبُ عددٍ لا عيبُ شكل — فالملفُّ المضخَّم أكبرُ من الأصل كثيرًا
      const grown = statSync(join(dir, 'enterprises.yaml')).size;
      const original = statSync(join(REAL_CONFIG, 'enterprises.yaml')).size;
      assert.ok(grown > original * 10, 'الإعلانُ المضخَّم أضعافُ الأصل');
      // وثانيًا: الرفضُ يقع — وموضعُ وقوعه تغيّر في البند T-130 وهذا مقيسٌ لا مُخفى:
      //   ألفُ نوعٍ يبلغ بالملف فوق 65536 بايتًا، وحاجزُ البايتات في `loadYamlFile` يسبق
      //   حاجزَ العدد في المحمّل. فالحملُ الضخمُ يُردّ **أبكرَ** ممّا كان يُردّ، وهو أرخص.
      assert.equal(
        refusalCode(() => loadEnterprises(dir)),
        'CONFIG_FILE_OVER_BYTE_CEILING',
      );
    },
  );
  // وسقفُ العدد باقٍ حيث كان: حملٌ يفوق السقفَ عددًا ويبقى تحت سقفِ البايتات يُردّ به
  withEnterprises(
    (yaml) => yaml
      .replace('materials:\n', `materials:\n${bulkMaterials(40)}`)
      .replace('kinds:\n', `kinds:\n${bulkKinds(40)}`),
    (dir) => {
      assert.ok(
        statSync(join(dir, 'enterprises.yaml')).size < 65_536,
        'الحملُ المتوسّطُ تحت سقفِ البايتات، فالرفضُ رفضُ عددٍ لا رفضُ حجم',
      );
      assert.equal(refusalCode(() => loadEnterprises(dir)), 'CONFIG_DECLARATION_OVER_CEILING');
    },
  );
});

test('T-75: كلُّ سقفٍ يقع على حدّه — أنواعٌ ومواد', () => {
  const kinds = DECLARATION_CEILINGS.enterprise_kinds;
  const materials = DECLARATION_CEILINGS.materials;
  // نوعٌ واحدٌ فوق السقف يكفي للرفض (القائمُ 3 أنواعٍ في الأصل)
  withEnterprises(
    (yaml) => yaml
      .replace('materials:\n', `materials:\n${bulkMaterials(kinds + 1)}`)
      .replace('kinds:\n', `kinds:\n${bulkKinds(kinds - 2)}`),
    (dir) => {
      // المُقاس: الأنواعُ صارت (kinds - 2) + 3 = kinds + 1 ⇒ فوق السقف بواحد
      assert.equal(refusalCode(() => loadEnterprises(dir)), 'CONFIG_DECLARATION_OVER_CEILING');
    },
  );
  // وعلى الحدّ بالضبط يُقبل — فحدٌّ لا يُقبل عنده ليس سقفًا بل منعًا
  withEnterprises(
    (yaml) => yaml.replace('kinds:\n', `kinds:\n${bulkKinds(kinds - 3)}`)
      .replace('materials:\n', `materials:\n${bulkMaterials(kinds - 3)}`),
    (dir) => {
      const config = loadEnterprises(dir);
      assert.equal(config.kinds.length, kinds);
      assert.ok(config.materials.length <= materials);
    },
  );
});

test('T-75: المواد فوق سقفها تُرفض وحدها ولو صحّت الأنواع', () => {
  withEnterprises(
    (yaml) => yaml.replace(
      'materials:\n', `materials:\n${bulkMaterials(DECLARATION_CEILINGS.materials)}`,
    ),
    (dir) => {
      // القائمُ 4 موادَّ + سقفُ الموادِّ ⇒ فوق السقف، والأنواعُ 3 كما هي
      assert.equal(refusalCode(() => loadEnterprises(dir)), 'CONFIG_DECLARATION_OVER_CEILING');
    },
  );
});

test('T-75: فحوصُ الجودة فوق سقفها تُرفض', () => {
  let extra = '';
  for (let i = 0; i < DECLARATION_CEILINGS.quality_checks; i += 1) {
    extra += `  filler_${i}: 1\n`;
  }
  withEnterprises(
    (yaml) => yaml.replace('quality_checks:\n', `quality_checks:\n${extra}`),
    (dir) => {
      assert.equal(refusalCode(() => loadEnterprises(dir)), 'CONFIG_DECLARATION_OVER_CEILING');
    },
  );
});

test('T-75: جهاتُ التعليق فوق سقفها تُرفض — والحمايةُ الرخيصةُ لها حدٌّ أيضًا', () => {
  let extra = '';
  for (let i = 0; i < DECLARATION_CEILINGS.suspend_authorities; i += 1) {
    extra += `    - "ministry:filler-${i}"\n`;
  }
  withEnterprises(
    (yaml) => yaml.replace('  suspend_authorities:\n', `  suspend_authorities:\n${extra}`),
    (dir) => {
      assert.equal(refusalCode(() => loadEnterprises(dir)), 'CONFIG_DECLARATION_OVER_CEILING');
    },
  );
});

test('T-75: نصُّ الرفض يحمل العددَين مقيسَين لا وصفًا عامًّا', () => {
  try {
    guardDeclaredCount('enterprise_kinds', DECLARATION_CEILINGS.enterprise_kinds + 5, 'أنواعُ س');
    assert.fail('كان يجب أن يُرفض');
  } catch (error) {
    const violation = error as SovereignViolation;
    assert.equal(violation.code, 'CONFIG_DECLARATION_OVER_CEILING');
    assert.match(
      violation.message,
      new RegExp(`${DECLARATION_CEILINGS.enterprise_kinds + 5}/${DECLARATION_CEILINGS.enterprise_kinds}`),
    );
    // ويسمّي القاعدةَ التي منعت السقفَ من أن يسكن الملفَّ المحكوم
    assert.match(violation.message, /RULE-005/);
  }
});

test('T-75: على الحدّ يُقبل وفوقه بواحدٍ يُرفض — حدٌّ يقع لا شعار', () => {
  const max = DECLARATION_CEILINGS.materials;
  assert.doesNotThrow(() => guardDeclaredCount('materials', max, 'موادُّ س'));
  assert.equal(
    refusalCode(() => guardDeclaredCount('materials', max + 1, 'موادُّ س')),
    'CONFIG_DECLARATION_OVER_CEILING',
  );
});

test('T-75: عددٌ غيرُ مقيسٍ يُرفض برمزٍ آخر — لا يُقرأ الغائبُ صفرًا', () => {
  for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    assert.equal(
      refusalCode(() => guardDeclaredCount('materials', bad, 'موادُّ س')),
      'CONFIG_DECLARATION_COUNT_UNMEASURED',
    );
  }
});

test('T-75: السقوفُ مجمَّدةٌ في النواة — لا تُوسَّع في زمن التشغيل', () => {
  assert.ok(Object.isFrozen(DECLARATION_CEILINGS));
  const before = DECLARATION_CEILINGS.enterprise_kinds;
  try {
    (DECLARATION_CEILINGS as unknown as Record<string, number>).enterprise_kinds = 10_000;
  } catch {
    // في النمط الصارم يُرمى، وفي غيره يُهمل — والمقيسُ أنّ القيمة لم تتغيّر
  }
  assert.equal(DECLARATION_CEILINGS.enterprise_kinds, before);
});

test('T-75: كلُّ سقفٍ معلنٍ عددٌ صحيحٌ موجب — سقفٌ صفرٌ يُقعد الدولةَ عن الإقلاع', () => {
  const names = Object.keys(DECLARATION_CEILINGS);
  assert.ok(names.length >= 4, 'السقوفُ الأربعةُ معلنةٌ على الأقل');
  for (const name of names) {
    const value = (DECLARATION_CEILINGS as unknown as Record<string, number>)[name] as number;
    assert.ok(Number.isSafeInteger(value) && value > 0, `سقفٌ غيرُ صالح: ${name}`);
  }
});

test('T-75: السقفُ لا يُوسَّع من داخل الملف المحكوم — سطرٌ فيه لا أثرَ له', () => {
  // من كتب في تهيئته «max_kinds: 1000» ثمّ أعلن ألفَ نوعٍ يُرفض كما لو لم يكتب شيئًا
  withEnterprises(
    (yaml) => yaml
      .replace('policy:\n', 'policy:\n  max_kinds: 1000\n  max_materials: 1000\n')
      // الحملُ 40 لا 200: مئتان تبلغ فوق سقفِ بايتات الملف (T-130) فيسبق الرفضُ الحجميُّ
      // الرفضَ العدديَّ، وهذا الاختبارُ مقصدُه RULE-005 لا ترتيبُ الحاجزَين.
      .replace('materials:\n', `materials:\n${bulkMaterials(40)}`)
      .replace('kinds:\n', `kinds:\n${bulkKinds(40)}`),
    (dir) => {
      assert.equal(refusalCode(() => loadEnterprises(dir)), 'CONFIG_DECLARATION_OVER_CEILING');
    },
  );
});
