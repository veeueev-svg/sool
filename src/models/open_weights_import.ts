/**
 * src/models/open_weights_import.ts — استيراد نموذج مفتوح الأوزان (المرحلة 17)
 * المالك: وزارة البحث
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: بيان نموذج + بايتات كل شريحة + أمر ملكي معتمد بفعل import_artifact
 * المخرجات: نموذج مسجَّل بحالة محجور، أو رفض كامل — ولا استيراد جزئي
 * التبعيات: مدقّق الآثار (قائمة سماح المصادر)، بيان النموذج، سجل النماذج
 * الصلاحيات: الاستيراد أمر ملكي؛ والاعتماد والتنشيط قرارات لاحقة منفصلة
 * السجلات: weights_import_refused / shard_digest_mismatch / weights_imported
 * ثوابت هذه الوحدة:
 *   1) البيان يُتحقَّق أولًا — بيان غير صالح يعني رفضًا قبل لمس أي بايت
 *   2) مصدر النموذج يجب أن يكون معلنًا ويُسمح منه بنوع weights
 *   3) بصمة كل شريحة تُحسب من بايتاتها — شريحة واحدة مختلفة تُبطل الاستيراد كله
 *   4) شريحة معلنة وبايتاتها غائبة ⇒ رفض (لا استيراد ناقص)
 *   5) البيان غير الموقَّع بمفتاح المصدر مرفوض
 *   6) النجاح يعني التسجيل **محجورًا** لا التشغيل
 * حالات الفشل (كلها مغلقة): لا نجاح جزئي بحال
 * اختبار القبول: tests/models/model_registry.test.ts §الاستيراد
 * الوثيقة المرتبطة: docs/decisions/ADR-0003-external-artifacts.md
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { sha256, verifyPayload } from '../identity/keys';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { CrownGateway } from '../crown/crown_gateway';
import { ArtifactVerifier } from './source_verification';
import { ModelManifest, validateManifest, manifestSignedFacts } from './model_manifest';
import { ModelRegistry } from './model_registry';

export interface OpenWeightsImporterDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly killSwitch: KillSwitch;
  readonly verifier: ArtifactVerifier;
  readonly models: ModelRegistry;
  readonly ministryId?: EntityId;
}

export class OpenWeightsImporter {
  private readonly ministryId: EntityId;

  constructor(private readonly deps: OpenWeightsImporterDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:research';
  }

  /**
   * يستورد نموذجًا مفتوح الأوزان. `shardBytes` يربط مسار كل شريحة ببايتاتها.
   * أي نقص أو اختلاف بصمة يعني رفضًا كاملًا بلا تسجيل.
   */
  import(
    command: SignedRoyalCommand,
    manifest: ModelManifest,
    shardBytes: Readonly<Record<string, string>>,
    now = Date.now(),
  ): Decision {
    const refuse = (reason: string, kind = 'weights_import_refused'): Decision => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        modelId: manifest.modelId ?? '', version: manifest.version ?? '', reason,
        commandId: command.payload.commandId,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch.status;
    if (halt.engaged) return refuse('الإيقاف مُشتغل — لا استيراد');

    const check = validateManifest(manifest);
    if (!check.valid) return refuse(`بيان غير صالح: ${check.errors.join('؛ ')}`, 'manifest_invalid');

    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر الاستيراد مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'import_artifact') return refuse('الفعل لا يخصّ استيراد أثر');

    const source = this.deps.verifier.sourceOf(manifest.source);
    if (!source) return refuse('مصدر غير معلن — القائمة سماح لا حظر', 'unknown_source_refused');
    if (!source.allowedKinds.includes('weights')) {
      return refuse(`المصدر ${source.name} لا يُسمح منه باستيراد أوزان`);
    }
    if (!verifyPayload(source.signerPublicKey, manifestSignedFacts(manifest), manifest.signature)) {
      return refuse('توقيع البيان لا يطابق مفتاح المصدر', 'manifest_signature_invalid');
    }

    for (const shard of manifest.shards) {
      const bytes = shardBytes[shard.path];
      if (bytes === undefined) {
        return refuse(`شريحة معلنة وبايتاتها غائبة: ${shard.path}`, 'shard_missing');
      }
      const digest = sha256(bytes);
      if (digest !== shard.digest) {
        return refuse(`بصمة شريحة مخالفة: ${shard.path}`, 'shard_digest_mismatch');
      }
    }

    const registered = this.deps.models.register(manifest, { origin: 'imported' }, now);
    if (!registered.allowed) return refuse(`التسجيل مرفوض: ${registered.reason}`);

    const entry = this.deps.audit.append(this.ministryId, 'weights_imported', {
      modelId: manifest.modelId, version: manifest.version, source: manifest.source,
      shards: manifest.shards.length, license: manifest.license,
      capabilities: manifest.declaredCapabilities,
    });
    return {
      allowed: true,
      reason: 'استُوردت الأوزان وسُجّل النموذج محجورًا — لا يعمل قبل اعتماد ملكي',
      auditId: entry.hash,
    };
  }
}
