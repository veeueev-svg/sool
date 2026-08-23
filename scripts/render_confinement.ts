/**
 * scripts/render_confinement.ts — يكتب منشورات الحصر المولَّدة
 * المالك: وزارة الأمن السيبراني | المرحلة 39 (البند T-16)
 * المدخلات: config/external.yaml + config/confinement.yaml
 * المخرجات: الملفات المعلنة في `policy.generated` — وكتابةٌ فقط، بلا حكم
 * حالات الفشل: أي رفضٍ من المحمّلين يتسرّب كما هو برمزه (RULE-007)
 *
 * الفرقُ بين هذا السكربت وحاجزِه: هذا يكتب، و`check_confinement.mjs` يقابل. من
 * ينادي هذا بعد تعديل `external.yaml` يُحدّث المنشور؛ ومن حرَّر المنشورَ بيدٍ ثم لم
 * ينادِ هذا يسقط عند الحاجز — وهو المقصود.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfinement, loadExternal, resolveConfigDir } from '../src/kernel/config';
import { renderEgressManifests } from '../src/security/egress_manifest';

// جذرُ المستودع يُشتقّ من مجلد التهيئة لا من `__dirname`: هذا السكربت يُنفَّذ من
// `dist/scripts/` لا من `scripts/`، فحسابُ الجذر بالصعود خطوةً واحدة يُخطئ (T-118).
const repoRoot = dirname(resolveConfigDir());
const confinement = loadConfinement().policy;
const external = loadExternal();
const manifests = renderEgressManifests(external, confinement);

const targets: readonly [string, string][] = [
  [join(repoRoot, confinement.generated.directory, confinement.generated.default_deny_file),
    manifests.defaultDeny],
  [join(repoRoot, confinement.generated.directory, confinement.generated.allowlist_file),
    manifests.allowlist],
  [join(repoRoot, confinement.generated.runtime_file), manifests.runtime],
];

for (const [path, content] of targets) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`كُتب: ${path} (${Buffer.byteLength(content, 'utf8')} بايت)`);
}
console.log('منشورات الحصر مولَّدة من الإعلان الواحد — لا تُحرَّر بيد.');
