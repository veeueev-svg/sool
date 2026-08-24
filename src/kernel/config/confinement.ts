/**
 * src/kernel/config/confinement.ts — سياسةُ الحصر على مستوى النواة والحاوية
 * المالك: وزارة الأمن السيبراني | المرحلة: 39 (البند T-16 — إكمالُ C-09)
 * المدخلات: config/confinement.yaml | المخرجات: ConfinementConfig
 * التبعيات: محلّل YAML الآمن، و`resolveConfigDir` — ولا شيء غيرهما
 * الصلاحيات: القراءةُ والتحقّق؛ ولا يُنشئ هذا الملف حصرًا ولا يُنزله
 * حالات الفشل (كلها مغلقة):
 *   - لا ملف أو لا سياسة معلنة ⇒ CONFIG_NO_CONFINEMENT_POLICY
 *   - الافتراض ليس رفضًا ⇒ CONFIG_CONFINEMENT_DEFAULT_ALLOW
 *   - جذرُ الشاهد ليس مسارًا مطلقًا ⇒ CONFIG_CONFINEMENT_WITNESS
 *   - شرطٌ مُلزم غائب أو معطَّل ⇒ CONFIG_CONFINEMENT_REQUIREMENT
 *   - منفذٌ بنيويٌّ غير صحيح ⇒ CONFIG_CONFINEMENT_PORT
 *   - وجهةُ التوليد ناقصة ⇒ CONFIG_CONFINEMENT_GENERATED
 *   - شدّةُ الإنتاج ليست «حرجة» ⇒ CONFIG_CONFINEMENT_SEVERITY
 *
 * ثابتُ هذه الوحدة: **الشرطُ المُلزم لا يُعطَّل من التهيئة.** لو قُبل `false` في
 * `require.*` لصار إنزالُ الحماية تحريرَ سطرٍ في ملفٍ لا قرارَ مراجعة، فتُفتح
 * الفجوةُ نفسها التي فُتح البند T-16 لسدّها. فالرفضُ هنا مقصود لا تزيُّد.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { guardDeclaredCount } from './declaration_limits';
import { loadYamlFile } from './yaml';

/** الشروطُ المعروفة — قائمة مغلقة: شرطٌ غير معلن لا يُقاس ولا يُشترط */
export const CONFINEMENT_REQUIREMENTS = [
  'non_root',
  'no_effective_capabilities',
  'empty_bounding_set',
  'no_new_privileges',
  'seccomp_filter',
  'read_only_root',
  'default_deny_egress',
] as const;
export type ConfinementRequirement = (typeof CONFINEMENT_REQUIREMENTS)[number];

export interface InfrastructurePort {
  readonly name: string;
  readonly port: number;
  readonly protocol: 'TCP' | 'UDP';
}

export interface ConfinementConfig {
  policy: {
    default: 'deny';
    witness_root: string;
    require: Readonly<Record<ConfinementRequirement, boolean>>;
    infrastructure_ports: readonly InfrastructurePort[];
    generated: {
      directory: string;
      default_deny_file: string;
      allowlist_file: string;
      runtime_file: string;
      workload_label: string;
      namespace: string;
    };
    production_severity: 'critical';
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SovereignViolation(
      `وجهةُ التوليد ناقصة — ${field} غير معلن`, 'CONFIG_CONFINEMENT_GENERATED',
    );
  }
  return value;
}

function readPorts(raw: unknown): readonly InfrastructurePort[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SovereignViolation(
      'المنافذ البنيوية غير معلنة — بلا ترجمةِ أسماءٍ يصير المنعُ عن غير قصد',
      'CONFIG_CONFINEMENT_PORT',
    );
  }
  guardDeclaredCount('infrastructure_ports', raw.length, 'المنافذُ البنيويّةُ المعلنة');
  const ports: InfrastructurePort[] = [];
  for (const entry of raw as InfrastructurePort[]) {
    const port = Number(entry?.port);
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
      throw new SovereignViolation(
        `منفذٌ بنيويٌّ غير صحيح: ${String(entry?.port)}`, 'CONFIG_CONFINEMENT_PORT',
      );
    }
    if (entry?.protocol !== 'TCP' && entry?.protocol !== 'UDP') {
      throw new SovereignViolation(
        `بروتوكولٌ غير معروف للمنفذ ${port}`, 'CONFIG_CONFINEMENT_PORT',
      );
    }
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new SovereignViolation(
        `منفذٌ بلا اسمٍ معلن: ${port}`, 'CONFIG_CONFINEMENT_PORT',
      );
    }
    ports.push({ name: entry.name, port, protocol: entry.protocol });
  }
  return ports;
}

/**
 * يحمّل سياسة الحصر ويرفض كل صورةٍ تُبقي التشغيل بلا حاجز في النواة.
 * سببُه: البند T-16 لم يُفتح لأن الشيفرة ناقصة، بل لأن الحاجزَ كان في مكانٍ واحد؛
 * فمن يقرأ هذه السياسة يقرأ شرطًا على العمليّة كلِّها لا على وحدةٍ فيها.
 */
export function loadConfinement(configDir = resolveConfigDir()): ConfinementConfig {
  const file = join(configDir, 'confinement.yaml');
  if (!existsSync(file)) {
    throw new SovereignViolation(
      `سياسة الحصر غير موجودة: ${file}`, 'CONFIG_NO_CONFINEMENT_POLICY',
    );
  }
  const raw = loadYamlFile(file) as unknown as ConfinementConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة الحصر غير معلنة', 'CONFIG_NO_CONFINEMENT_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في الحصر هو الرفض — لا حصرَ يبدأ بالسماح',
      'CONFIG_CONFINEMENT_DEFAULT_ALLOW',
    );
  }
  if (typeof policy.witness_root !== 'string' || !policy.witness_root.startsWith('/')) {
    throw new SovereignViolation(
      'جذرُ شاهد الحصر يجب أن يكون مسارًا مطلقًا معلنًا', 'CONFIG_CONFINEMENT_WITNESS',
    );
  }
  const require = policy.require;
  if (!require || typeof require !== 'object') {
    throw new SovereignViolation(
      'شروطُ الحصر غير معلنة', 'CONFIG_CONFINEMENT_REQUIREMENT',
    );
  }
  // ثابتُ الوحدة: الشرطُ المُلزم لا يُعطَّل من التهيئة — غيابُه وتعطيلُه سواء
  for (const key of CONFINEMENT_REQUIREMENTS) {
    if (require[key] !== true) {
      throw new SovereignViolation(
        `شرطُ الحصر «${key}» غائب أو معطَّل — إنزالُ الحماية لا يقع بتحرير سطر`,
        'CONFIG_CONFINEMENT_REQUIREMENT',
      );
    }
  }
  const generated = policy.generated;
  if (!generated || typeof generated !== 'object') {
    throw new SovereignViolation(
      'وجهةُ المنشورات المولَّدة غير معلنة', 'CONFIG_CONFINEMENT_GENERATED',
    );
  }
  if (policy.production_severity !== 'critical') {
    throw new SovereignViolation(
      'انعدامُ الحصر في الإنتاج حادثٌ حرج بالنص — لا يُصنَّف أدنى من ذلك',
      'CONFIG_CONFINEMENT_SEVERITY',
    );
  }
  return {
    policy: {
      default: 'deny',
      witness_root: policy.witness_root,
      require: { ...require },
      infrastructure_ports: readPorts(policy.infrastructure_ports),
      generated: {
        directory: requireText(generated.directory, 'directory'),
        default_deny_file: requireText(generated.default_deny_file, 'default_deny_file'),
        allowlist_file: requireText(generated.allowlist_file, 'allowlist_file'),
        runtime_file: requireText(generated.runtime_file, 'runtime_file'),
        workload_label: requireText(generated.workload_label, 'workload_label'),
        namespace: requireText(generated.namespace, 'namespace'),
      },
      production_severity: 'critical',
    },
  };
}
