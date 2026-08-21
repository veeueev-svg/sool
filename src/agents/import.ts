/**
 * src/agents/import.ts — استيراد وكيل مفتوح المصدر إلى الدولة (المرحلة 16)
 * المالك: وزارة البحث (والتسجيل بيد وزارة الداخلية)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أثر من نوع agent أُفرج عنه من الحجر + أمر ملكي معتمد بإنشاء وكيل
 * المخرجات: وكيل مسجَّل بأصل موثّق (مصدره وبصمته ورخصته) وبصفر قدرات
 * التبعيات: مدقّق الآثار، سجل الوكلاء، سجل الصلاحيات، مفتاح الإيقاف
 * الصلاحيات: لا قدرة تُمنح تلقائيًا للوكيل المستورد — القدرات أمر ملكي منفصل لاحق
 * السجلات: imported_agent_refused / imported_agent_registered
 * ثوابت هذه الوحدة:
 *   1) لا تحميل من الحجر — الأثر يجب أن يكون released
 *   2) نوع الأثر يجب أن يكون agent لا أوزانًا ولا بيانات
 *   3) الوكيل المستورد يُسجَّل كأي وكيل: أمر ملكي، مشرف، قالب دور، سقف سكاني
 *   4) القدرات صفر عند التسجيل — الاستيراد ليس منحًا
 *   5) أصل الوكيل (البصمة والمصدر والرخصة) يُقيَّد في السجل فلا يُنسى مصدره
 *   6) قالب الدور يجب أن يكون معلنًا في سجل الصلاحيات
 * حالات الفشل (كلها مغلقة)
 * اختبار القبول: tests/models/source_verification.test.ts §الاستيراد
 * الوثيقة المرتبطة: docs/decisions/ADR-0003-external-artifacts.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { ArtifactVerifier } from '../models/source_verification';
import { AgentRegistry, AgentRecord } from './agent_registry';
import { PermissionRegistry } from './permissions';

export interface ImportAgentRequest {
  readonly artifactId: string;
  readonly agentId: EntityId;
  readonly template: string;
  readonly supervisor: EntityId;
}

export type ImportAgentResult =
  | { readonly ok: true; readonly record: AgentRecord; readonly digest: string; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface AgentImporterDeps {
  readonly audit: AppendOnlyLog;
  readonly verifier: ArtifactVerifier;
  readonly agents: AgentRegistry;
  readonly permissions: PermissionRegistry;
  readonly killSwitch: KillSwitch;
  readonly ministryId?: EntityId;
}

export class AgentImporter {
  private readonly provenance = new Map<EntityId, { artifactId: string; digest: string; license: string }>();
  private readonly ministryId: EntityId;

  constructor(private readonly deps: AgentImporterDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:research';
  }

  /** أصل وكيل مستورد — من أين جاء وبأي بصمة ورخصة */
  originOf(agentId: EntityId): { artifactId: string; digest: string; license: string } | undefined {
    return this.provenance.get(agentId);
  }

  load(command: SignedRoyalCommand, req: ImportAgentRequest, now = Date.now()): ImportAgentResult {
    const refuse = (reason: string, kind = 'imported_agent_refused'): ImportAgentResult => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        artifactId: req.artifactId, agentId: req.agentId, reason,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch.status;
    if (halt.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      return refuse('الإيقاف مُشتغل — لا استيراد وكيل');
    }
    const artifact = this.deps.verifier.get(req.artifactId);
    if (!artifact) return refuse('أثر غير مسجَّل');
    if (artifact.kind !== 'agent') return refuse(`نوع الأثر ${artifact.kind} لا يُسجَّل كوكيل`);
    if (artifact.status !== 'released') {
      return refuse('الأثر ما زال محجورًا — لا تشغيل من الحجر', 'quarantined_load_refused');
    }
    if (!this.deps.permissions.assignTemplate(req.agentId, req.template)) {
      return refuse('قالب دور غير معلن');
    }

    const created = this.deps.agents.create(
      command, { agentId: req.agentId, template: req.template, supervisor: req.supervisor }, now,
    );
    if (!created.ok) return refuse(`تسجيل الوكيل مرفوض: ${created.reason}`);

    this.provenance.set(req.agentId, {
      artifactId: artifact.artifactId, digest: artifact.digest, license: artifact.license,
    });
    const entry = this.deps.audit.append(this.ministryId, 'imported_agent_registered', {
      agentId: req.agentId, artifactId: artifact.artifactId, digest: artifact.digest,
      source: artifact.source, license: artifact.license, template: req.template,
      capabilities: this.deps.permissions.granted(req.agentId, now).length,
    });
    return { ok: true, record: created.record, digest: artifact.digest, auditId: entry.hash };
  }
}
