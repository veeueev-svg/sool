/**
 * src/models/source_verification.ts — التحقق من المصدر والحجر قبل التشغيل (المرحلة 16)
 * المالك: وزارة البحث (بمراجعة وزارة الأمن السيبراني)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أثر خارجي (وكيل أو أوزان أو بيانات) + أمر ملكي معتمد بفعل import_artifact
 * المخرجات: حالة الأثر: مرفوض أو محجور أو مُفرَج عنه — ولا شيء يعمل قبل الإفراج
 * التبعيات: بوابة التاج، السجل، مفتاح الإيقاف
 * الصلاحيات: الاستيراد أمر ملكي؛ والإفراج أمر ملكي ثانٍ مستقل مع تقرير فحص
 * السجلات: artifact_import_refused / artifact_quarantined / artifact_released
 * ثوابت هذه الوحدة:
 *   1) لا استيراد إلا من مصدر في قائمة سماح معلنة، ولنوع يسمح به ذلك المصدر
 *   2) البصمة تُحسب من البايتات لا تُصدَّق كما وردت — البصمة المعلنة تُطابق أو يُرفض الأثر
 *   3) الأثر غير الموقَّع مرفوض دائمًا — التوقيع بمفتاح المصدر المعلن لا بأي مفتاح
 *   4) الرخصة معلنة إلزامًا — لا استيراد بلا رخصة
 *   5) النجاح في التحقق يعني **الحجر** لا التشغيل. الإفراج قرار ثانٍ منفصل
 *   6) الإفراج يحتاج أمرًا ملكيًا مستقلًا + تقرير فحص + دولة غير موقوفة
 * حالات الفشل (كلها مغلقة): أي شك ⇒ رفض أو بقاء في الحجر
 * اختبار القبول: tests/models/source_verification.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0003-external-artifacts.md
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { sha256, verifyPayload } from '../identity/keys';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { KillSwitch } from '../security/kill_switch';

export type ArtifactKind = 'agent' | 'weights' | 'dataset';

/** مصدر خارجي معلن: اسمه، ومفتاح التوقيع المقبول منه، وما يُسمح باستيراده منه */
export interface ArtifactSource {
  readonly name: string;
  readonly origin: string;
  /** المفتاح العام (base64) الذي يجب أن يوقّع كل أثر من هذا المصدر */
  readonly signerPublicKey: string;
  readonly allowedKinds: readonly ArtifactKind[];
}

export interface ExternalArtifact {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly source: string;
  /** محتوى الأثر كنص (أو base64) — البصمة تُحسب منه */
  readonly bytes: string;
  readonly declaredDigest: string;
  readonly signature: string;
  readonly license: string;
}

export type ArtifactStatus = 'rejected' | 'quarantined' | 'released';

export interface ArtifactRecord {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly source: string;
  readonly digest: string;
  readonly license: string;
  readonly status: ArtifactStatus;
  readonly importedAt: number;
  readonly releasedAt: number | null;
  readonly reportPath: string | null;
}

export interface VerifierDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly killSwitch: KillSwitch;
  readonly sources?: Readonly<Record<string, ArtifactSource>>;
  readonly ministryId?: EntityId;
}

export class ArtifactVerifier {
  private readonly records = new Map<string, ArtifactRecord>();
  private readonly ministryId: EntityId;
  private readonly sources: Readonly<Record<string, ArtifactSource>>;

  constructor(private readonly deps: VerifierDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:research';
    this.sources = deps.sources ?? {};
    deps.audit.append(this.ministryId, 'artifact_verifier_online', {
      sources: Object.keys(this.sources),
    });
  }

  /** إضافة مصدر معلن — قرار سياسة يُسجَّل، ولا مصدر ضمني */
  declareSource(source: ArtifactSource, by: EntityId = 'ministry:cybersecurity'): boolean {
    if (!source.name || !source.signerPublicKey || source.allowedKinds.length === 0) {
      this.deps.audit.append(by, 'artifact_source_refused', { name: source.name });
      return false;
    }
    (this.sources as Record<string, ArtifactSource>)[source.name] = source;
    this.deps.audit.append(by, 'artifact_source_declared', {
      name: source.name, origin: source.origin, kinds: source.allowedKinds,
    });
    return true;
  }

  /** مصدر معلن بالاسم — لمن يحتاج فحص قائمة السماح قبل الاستيراد */
  sourceOf(name: string): ArtifactSource | undefined {
    return this.sources[name];
  }

  get(artifactId: string): ArtifactRecord | undefined {
    return this.records.get(artifactId);
  }

  isReleased(artifactId: string): boolean {
    return this.records.get(artifactId)?.status === 'released';
  }

  list(): readonly ArtifactRecord[] {
    return [...this.records.values()];
  }

  /** التحقق ثم الحجر — لا يُفرج عن شيء هنا بحال */
  verify(command: SignedRoyalCommand, artifact: ExternalArtifact, now = Date.now()): Decision {
    const refuse = (reason: string, kind = 'artifact_import_refused'): Decision => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        artifactId: artifact.artifactId, source: artifact.source, reason,
        commandId: command.payload.commandId,
      });
      this.records.set(artifact.artifactId, {
        artifactId: artifact.artifactId, kind: artifact.kind, source: artifact.source,
        digest: '', license: artifact.license, status: 'rejected',
        importedAt: now, releasedAt: null, reportPath: null,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch.status;
    if (halt.engaged) return refuse('الإيقاف مُشتغل — لا استيراد');
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر الاستيراد مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'import_artifact') return refuse('الفعل لا يخصّ استيراد أثر');
    if (this.records.has(artifact.artifactId)) return refuse('معرّف أثر مستخدَم — لا تكرار');

    const source = this.sources[artifact.source];
    if (!source) return refuse('مصدر غير معلن — القائمة سماح لا حظر', 'unknown_source_refused');
    if (!source.allowedKinds.includes(artifact.kind)) {
      return refuse(`المصدر ${source.name} لا يُسمح منه باستيراد ${artifact.kind}`);
    }
    if (!artifact.license) return refuse('لا استيراد بلا رخصة معلنة');

    const digest = sha256(artifact.bytes);
    if (digest !== artifact.declaredDigest) {
      return refuse('البصمة المحسوبة تخالف المعلنة — أثر مُحرَّف', 'artifact_digest_mismatch');
    }
    if (!artifact.signature) return refuse('أثر غير موقَّع مرفوض', 'unsigned_artifact_refused');
    const signedFacts = { artifactId: artifact.artifactId, kind: artifact.kind, digest };
    if (!verifyPayload(source.signerPublicKey, signedFacts, artifact.signature)) {
      return refuse('التوقيع لا يطابق مفتاح المصدر المعلن', 'artifact_signature_invalid');
    }

    this.records.set(artifact.artifactId, {
      artifactId: artifact.artifactId, kind: artifact.kind, source: artifact.source,
      digest, license: artifact.license, status: 'quarantined',
      importedAt: now, releasedAt: null, reportPath: null,
    });
    const entry = this.deps.audit.append(this.ministryId, 'artifact_quarantined', {
      artifactId: artifact.artifactId, kind: artifact.kind, source: artifact.source,
      digest, license: artifact.license,
    });
    return { allowed: true, reason: 'تحقّق ناجح — الأثر في الحجر ولا يعمل قبل الإفراج', auditId: entry.hash };
  }

  /** الإفراج: قرار ثانٍ مستقل بأمر ملكي وتقرير فحص — لا إفراج تلقائي */
  release(
    command: SignedRoyalCommand,
    req: { readonly artifactId: string; readonly reportPath: string },
    now = Date.now(),
  ): Decision {
    const refuse = (reason: string, kind = 'artifact_release_refused'): Decision => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        artifactId: req.artifactId, reason, commandId: command.payload.commandId,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch.status;
    if (halt.engaged) return refuse('الإيقاف مُشتغل — لا إفراج');
    const record = this.records.get(req.artifactId);
    if (!record) return refuse('أثر غير مسجَّل');
    if (record.status !== 'quarantined') return refuse(`حالة الأثر ${record.status} — لا إفراج`);
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر الإفراج مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'import_artifact') return refuse('الفعل لا يخصّ إفراجًا عن أثر');
    if (!req.reportPath) return refuse('لا إفراج بلا تقرير فحص موثّق');

    this.records.set(req.artifactId, {
      ...record, status: 'released', releasedAt: now, reportPath: req.reportPath,
    });
    const entry = this.deps.audit.append(this.ministryId, 'artifact_released', {
      artifactId: req.artifactId, digest: record.digest, reportPath: req.reportPath,
    });
    return { allowed: true, reason: 'أُفرج عن الأثر بعد فحص موثّق', auditId: entry.hash };
  }

  /** إعادة الأثر إلى الحجر أو رفضه نهائيًا — إجراء احتواء فوري بلا أمر */
  quarantineAgain(artifactId: string, by: EntityId, reason: string): boolean {
    const record = this.records.get(artifactId);
    if (!record || record.status !== 'released') return false;
    this.records.set(artifactId, { ...record, status: 'quarantined', releasedAt: null });
    this.deps.audit.append(by, 'artifact_requarantined', { artifactId, reason });
    this.deps.audit.append(by, 'escalated_to_king', { incident: 'artifact_requarantined', artifactId, reason });
    return true;
  }
}
