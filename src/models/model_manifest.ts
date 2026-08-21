/**
 * src/models/model_manifest.ts — بيان النموذج والتحقق من صحته (المرحلة 17)
 * المالك: وزارة البحث
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: بيان نموذج مُعلن (معرّفه، إصداره، مصدره، رخصته، شرائح أوزانه ببصماتها، قدراته)
 * المخرجات: نتيجة تحقق ببنية الأخطاء — لا استيراد ببيان ناقص
 * التبعيات: لا شيء (وحدة نقية قابلة للاختبار وحدها)
 * ثوابت هذه الوحدة:
 *   1) لا نموذج بلا معرّف وإصدار ورخصة ومصدر
 *   2) لا نموذج بلا شريحة أوزان واحدة على الأقل، وكل شريحة ببصمة SHA-256 صحيحة الشكل
 *   3) القدرات المعلنة قائمة سماح مغلقة — أي قدرة غير معروفة تُبطل البيان
 *   4) لا شريحة بحجم صفر أو سالب — البيان الغامض بيان مرفوض
 *   5) لا تكرار مسارات بين الشرائح
 * حالات الفشل: كل خطأ يُعاد بنصه العربي، ولا يُقبل بيان فيه خطأ واحد
 * اختبار القبول: tests/models/model_registry.test.ts §البيان
 * الوثيقة المرتبطة: docs/decisions/ADR-0003-external-artifacts.md
 */

/** قائمة سماح مغلقة لقدرات النماذج — التوسيع قرار سياسة موثّق */
export const KNOWN_MODEL_CAPABILITIES: readonly string[] = [
  'text_generation', 'embedding', 'classification', 'summarization',
];

export interface ModelShard {
  readonly path: string;
  readonly digest: string;
  readonly bytes: number;
}

export interface ModelManifest {
  readonly modelId: string;
  readonly version: string;
  readonly source: string;
  readonly license: string;
  readonly shards: readonly ModelShard[];
  readonly declaredCapabilities: readonly string[];
  readonly signature: string;
}

export interface ManifestCheck {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function validateManifest(manifest: ModelManifest): ManifestCheck {
  const errors: string[] = [];
  if (!manifest.modelId) errors.push('معرّف النموذج مفقود');
  if (!SEMVER.test(manifest.version ?? '')) errors.push('إصدار النموذج ليس بصيغة x.y.z');
  if (!manifest.source) errors.push('مصدر النموذج مفقود');
  if (!manifest.license) errors.push('رخصة النموذج مفقودة');
  if (!manifest.signature) errors.push('البيان غير موقَّع');

  if (!manifest.shards || manifest.shards.length === 0) {
    errors.push('لا شرائح أوزان معلنة');
  } else {
    const seen = new Set<string>();
    for (const shard of manifest.shards) {
      if (!shard.path) errors.push('شريحة بلا مسار');
      else if (seen.has(shard.path)) errors.push(`مسار شريحة مكرّر: ${shard.path}`);
      else seen.add(shard.path);
      if (!SHA256_HEX.test(shard.digest ?? '')) {
        errors.push(`بصمة شريحة غير صحيحة الشكل: ${shard.path || '(بلا مسار)'}`);
      }
      if (typeof shard.bytes !== 'number' || shard.bytes <= 0) {
        errors.push(`حجم شريحة غير صالح: ${shard.path || '(بلا مسار)'}`);
      }
    }
  }

  if (!manifest.declaredCapabilities || manifest.declaredCapabilities.length === 0) {
    errors.push('لا قدرات معلنة — البيان الغامض مرفوض');
  } else {
    for (const cap of manifest.declaredCapabilities) {
      if (!KNOWN_MODEL_CAPABILITIES.includes(cap)) {
        errors.push(`قدرة نموذج غير معروفة: ${cap}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** الوقائع الموقَّعة من المصدر — ما يُوقَّع فعلًا لا البيان كله */
export function manifestSignedFacts(manifest: ModelManifest): Record<string, unknown> {
  return {
    modelId: manifest.modelId,
    version: manifest.version,
    shards: manifest.shards.map((s) => ({ path: s.path, digest: s.digest })),
  };
}
