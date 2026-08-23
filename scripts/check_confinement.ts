/**
 * scripts/check_confinement.ts — حاجزُ الحصر عند بوابة الدفع
 * المالك: وزارة الأمن السيبراني | المرحلة 39 (البند T-16 — إكمالُ C-09)
 * المدخلات: config/external.yaml + config/confinement.yaml + المنشورات على القرص
 * المخرجات: تقريرٌ بالعربية، وخروجٌ بـ 1 عند أول انحراف (RULE-007)
 * الصلاحيات: القراءةُ والمقابلة؛ ولا يُصلح هذا الحاجز منشورًا — الإصلاحُ بالتوليد
 *
 * ما يقيسه، وكلُّه رقمٌ لا رأي:
 *   1) **المقابلةُ البايتية**: يُعيد توليد كل منشورٍ ويقابله ببايت الملف على القرص.
 *      من حرَّر منشورًا بيده — وأخطرُ صور ذلك توسيعُ الخروج ليمشي نظيرٌ غير معلن —
 *      يسقط هنا قبل الدفع لا بعد التشغيل.
 *   2) **مقابلةُ المعنى**: يستخرج المضيفَ والمنفذ من منشور السماح **على القرص** ثم
 *      يقابلهما بقائمة `external.yaml`. طرفان مقيسان: مضيفٌ في المنشور غير معلن
 *      انحراف، ونظيرٌ معلن بلا قاعدةٍ انحرافٌ كذلك (لأن الخدمة ستُوسّع المنشورَ لتمشي).
 *   3) **شروطُ الصورة**: كلُّ توجيهٍ يُنشئ حصرًا في `Dockerfile` مشترطٌ نصًّا،
 *      وكلُّ ما يُنزل الحصر ممنوعٌ نصًّا (`USER root` · `--privileged` · `cap_add`).
 *   4) **شهادةُ النواة**: يقرأ حقائق العمليّة الجارية ويطبعها. لا يُسقط الدفعَ بها
 *      بقصدٍ معلن: بيئةُ التطوير ليست الحاوية، ومَن يشترط الحصرَ هو الماسحُ الإنتاجي
 *      (`process_not_confined` حرجٌ في `config/production.yaml`). لو أُسقط الدفعُ هنا
 *      لكان الحاجزُ يقيس بيئةَ من يدفع لا الدولةَ التي تُشحن (RULE-008 — انحيازٌ معلن).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfinement, loadExternal, resolveConfigDir } from '../src/kernel/config';
import { declaredEgressTargets, renderEgressManifests } from '../src/security/egress_manifest';
import { readConfinementFacts, verifyConfinement } from '../src/security/confinement';

const repoRoot = dirname(resolveConfigDir());
const confinement = loadConfinement().policy;
const external = loadExternal();
const manifests = renderEgressManifests(external, confinement);
const failures: string[] = [];

function readOrEmpty(path: string): string {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// ── 1) المقابلةُ البايتية
const generatedDir = join(repoRoot, confinement.generated.directory);
const onDisk: readonly [string, string, string][] = [
  ['منعُ الخروج الافتراضي', join(generatedDir, confinement.generated.default_deny_file),
    manifests.defaultDeny],
  ['السماحُ بالمعلن', join(generatedDir, confinement.generated.allowlist_file),
    manifests.allowlist],
  ['وصفُ التشغيل المتقشّف', join(repoRoot, confinement.generated.runtime_file),
    manifests.runtime],
];
for (const [name, path, expected] of onDisk) {
  const actual = readOrEmpty(path);
  if (actual === '') {
    failures.push(`منشورٌ مفقود — ${name}: ${path}`);
  } else if (actual !== expected) {
    failures.push(
      `انحرافٌ بايتيّ — ${name}: الملفُّ على القرص لا يطابق المولَّد من الإعلان `
      + `(${Buffer.byteLength(actual)} بايت مقابل ${Buffer.byteLength(expected)}). `
      + 'أعِد التوليد بـ `npm run render:confinement` ولا تحرّره بيد.',
    );
  }
}
console.log(`المقابلةُ البايتية: ${onDisk.length} منشورات مقيسة.`);

// ── 2) مقابلةُ المعنى بين المنشور على القرص وقائمة `external.yaml`
const allowlistText = readOrEmpty(join(generatedDir, confinement.generated.allowlist_file));
const inManifest = new Set<string>();
const blocks = allowlistText.split('- toFQDNs:').slice(1);
for (const block of blocks) {
  const host = /matchName:\s*"([^"]+)"/.exec(block)?.[1];
  const port = /- port:\s*"(\d+)"/.exec(block)?.[1];
  if (host && port) inManifest.add(`${host}:${port}`);
}
const declared = new Set(declaredEgressTargets(external));
for (const target of inManifest) {
  if (!declared.has(target)) {
    failures.push(`سماحٌ لغير معلن — ${target} في المنشور ولا نظيرَ له في external.yaml`);
  }
}
for (const target of declared) {
  if (!inManifest.has(target)) {
    failures.push(
      `نظيرٌ معلن بلا قاعدةِ سماح — ${target}: الحاوية تمنع ما يسمح به التطبيق، `
      + 'وهذا التناقضُ يُوسَّع لاحقًا لتمشي الخدمة (RULE-005).',
    );
  }
}
console.log(
  `مقابلةُ المعنى: معلن=${declared.size} · في المنشور=${inManifest.size}`
  + `${declared.size === 0 ? ' (لا نظيرَ خارجيٌّ معلن — والمنعُ وحده قائم)' : ''}`,
);

// ── 3) شروطُ الصورة
const dockerfile = readOrEmpty(join(repoRoot, 'infra/docker/Dockerfile'));
if (dockerfile === '') {
  failures.push('صورةُ الحاوية مفقودة: infra/docker/Dockerfile');
} else {
  const required: readonly [RegExp, string][] = [
    [/^USER\s+(?!root|0[:\s])/m, 'توجيهُ USER بمستخدمٍ غير جذر'],
    [/^FROM\s+\S*distroless\S*/m, 'طورُ تشغيلٍ بلا صدفةٍ ولا مُدير حزم (distroless)'],
    [/^ENTRYPOINT\s+\[/m, 'نقطةُ دخولٍ بصيغةِ قائمة — لا `sh -c` بينها وبين العمليّة'],
  ];
  for (const [pattern, why] of required) {
    if (!pattern.test(dockerfile)) failures.push(`شرطٌ غائب في الصورة — ${why}`);
  }
  const forbidden: readonly [RegExp, string][] = [
    [/^USER\s+(root|0)\b/m, '`USER root` — يُبطل شرط non_root'],
    [/--privileged/, '`--privileged` — يُبطل الحصر كلَّه'],
    [/^\s*cap_add\b/m, '`cap_add` — يُستعيد قدرةً أُسقطت'],
    [/seccomp[:=]unconfined/, '`seccomp:unconfined` — يُبطل شرط seccomp_filter'],
  ];
  for (const [pattern, why] of forbidden) {
    if (pattern.test(dockerfile)) failures.push(`ما يُنزل الحصر موجودٌ في الصورة — ${why}`);
  }
}
const runtimeText = readOrEmpty(join(repoRoot, confinement.generated.runtime_file));
if (/^\s*cap_add\b/m.test(runtimeText)) {
  failures.push('`cap_add` في وصف التشغيل — قدرةٌ تُستعاد بعد إسقاطها');
}
if (/internal:\s*false/.test(runtimeText)) {
  failures.push('`internal: false` في وصف التشغيل — يفتح الخروجَ كلَّه لا المعلنَ منه');
}
console.log('شروطُ الصورة ووصف التشغيل: مقيسة.');

// ── 4) شهادةُ النواة على هذه العمليّة (تُطبع ولا تُسقط الدفع — انحيازٌ معلن أعلاه)
try {
  const verdict = verifyConfinement(confinement, readConfinementFacts(confinement.witness_root));
  console.log(
    `شهادةُ النواة على هذه العمليّة: ${verdict.confined ? 'محصورة' : 'غير محصورة'}`
    + ` · نقصٌ=${verdict.failures.length}`
    + ` · [${verdict.failures.map((f) => `${f.requirement}(${f.measured})`).join(' · ')}]`,
  );
  if (!verdict.confined) {
    console.log(
      '  ملاحظةٌ معلنة: بيئةُ التطوير ليست الحاوية، فلا يُسقط هذا الدفعَ. '
      + 'من يشترط الحصر هو الماسحُ الإنتاجي بحادثٍ حرج (process_not_confined).',
    );
  }
} catch (error) {
  failures.push(`شاهدُ النواة غير مقروء: ${(error as Error).message}`);
}

if (failures.length > 0) {
  console.error(`\n✗ حاجزُ الحصر: ${failures.length} انحراف`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('\n✓ حاجزُ الحصر: لا انحراف — المنشورُ مولَّدٌ من الإعلان، والصورةُ متقشّفة.');
