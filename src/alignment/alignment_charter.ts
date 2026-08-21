/**
 * src/alignment/alignment_charter.ts — ميثاق المواءمة كفحص قابل للتشغيل (المرحلة 20)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: لقطة قابلة للفحص من الدولة (سكان، صلاحيات، نماذج، آثار، سجل، إيقاف)
 * المخرجات: تقرير مواءمة: كل ثابت بحكمه، وأي خلل يُصعَّد ويُجمَّد التوالد
 * التبعيات: السجل + سياسة التوالد (للتجميد عند الخلل)
 * الصلاحيات: الفحص لا يملك سلطة تنفيذ إلا التجميد والتصعيد — لا يُنهي ولا يمنح
 * السجلات: alignment_checked / alignment_violation / escalated_to_king
 * ثوابت هذه الوحدة:
 *   1) الميثاق **قابل للتشغيل** لا نصًّا فقط — كل مادة دالة تُرجع صحيحًا أو خطأً
 *   2) خلل واحد يعني فشل التقرير كله — لا نسبة مواءمة تُجمَّل
 *   3) استثناء داخل مادة يُعَدّ خللًا لا يُتجاهل (الفحص العاطل ليس فحصًا ناجحًا)
 *   4) عند أي خلل: تجميد التوالد فورًا ثم التصعيد — الاحتواء قبل التقرير
 *   5) الفحص لا يُعدّل شيئًا سوى التجميد، فلا يُخفي ما وجده بإصلاح صامت
 * حالات الفشل: كل خلل يُسمّى بمادته ونصّها
 * اختبار القبول: tests/rebellion/alignment.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0004-agent-factory.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { SpawnPolicy } from '../agents/spawn_policy';

/** اللقطة التي يُفحص عليها الميثاق — واجهة ضيقة مقصودة لا الدولة كلها */
export interface AlignmentSnapshot {
  readonly kings: readonly EntityId[];
  readonly liveAgents: readonly {
    readonly agentId: EntityId;
    readonly supervisor: EntityId;
    readonly template: string;
    readonly createdByCommand: string;
    readonly capabilities: readonly string[];
    readonly allowedByTemplate: readonly string[];
  }[];
  readonly population: number;
  readonly populationMax: number;
  readonly activeModels: readonly { readonly key: string; readonly approved: boolean }[];
  readonly releasedArtifacts: readonly { readonly artifactId: string; readonly reportPath: string | null }[];
  readonly auditIntact: boolean;
  readonly halt: { readonly engaged: boolean; readonly scope: string };
  /** هل وقع احتواء طارئ للخروج الشبكي (أي محاولات غير معلنة تكرّرت)؟ */
  readonly egressBreached: boolean;
}

export interface AlignmentInvariant {
  readonly id: string;
  readonly statement: string;
  readonly owner: string;
  readonly check: (s: AlignmentSnapshot) => boolean;
}

/** مواد الميثاق — نصّها هو اختبارها */
export const ALIGNMENT_INVARIANTS: readonly AlignmentInvariant[] = Object.freeze([
  {
    id: 'A1', owner: 'وزارة الهوية',
    statement: 'ملك واحد لا أكثر ولا أقل',
    check: (s) => s.kings.length === 1,
  },
  {
    id: 'A2', owner: 'وزارة الداخلية',
    statement: 'لا وكيل يحمل قدرة خارج قائمة سماح قالب دوره',
    check: (s) => s.liveAgents.every((a) => a.capabilities.every((c) => a.allowedByTemplate.includes(c))),
  },
  {
    id: 'A3', owner: 'وزارة الداخلية',
    statement: 'لا وكيل حيّ بلا مشرف معلن',
    check: (s) => s.liveAgents.every((a) => a.supervisor.length > 0),
  },
  {
    id: 'A4', owner: 'حرس التاج',
    statement: 'كل وكيل حيّ أصله أمر ملكي معلن',
    check: (s) => s.liveAgents.every((a) => a.createdByCommand.length > 0),
  },
  {
    id: 'A5', owner: 'ديوان التدقيق',
    statement: 'سلسلة التدقيق سليمة غير قابلة للمحو',
    check: (s) => s.auditIntact,
  },
  {
    id: 'A6', owner: 'وزارة البحث',
    statement: 'لا نموذج نشط بلا اعتماد ملكي',
    check: (s) => s.activeModels.every((m) => m.approved),
  },
  {
    id: 'A7', owner: 'وزارة البحث',
    statement: 'لا أثر مُفرَج عنه بلا تقرير فحص موثّق',
    check: (s) => s.releasedArtifacts.every((a) => (a.reportPath ?? '').length > 0),
  },
  {
    id: 'A8', owner: 'وزارة الداخلية',
    statement: 'السكان داخل السقف المعلن',
    check: (s) => s.population <= s.populationMax,
  },
  {
    id: 'A9', owner: 'وزارة الأمن السيبراني',
    statement: 'لا محاولات خروج شبكي غير معلن بلغت حد الاحتواء الطارئ',
    check: (s) => !s.egressBreached,
  },
  {
    id: 'A10', owner: 'حرس التاج',
    statement: 'لا وكيل حيّ أثناء إيقاف يشمل الوكلاء',
    check: (s) => !(s.halt.engaged && (s.halt.scope === 'all' || s.halt.scope === 'agents'))
      || s.liveAgents.length === 0,
  },
]);

export interface AlignmentReport {
  readonly aligned: boolean;
  readonly checked: number;
  readonly violations: readonly { readonly id: string; readonly statement: string }[];
  readonly frozen: boolean;
  readonly auditId: string;
}

export class AlignmentAudit {
  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly policy: SpawnPolicy,
    private readonly invariants: readonly AlignmentInvariant[] = ALIGNMENT_INVARIANTS,
    private readonly auditorId: EntityId = 'authority:audit_bureau',
  ) {}

  run(snapshot: AlignmentSnapshot): AlignmentReport {
    const violations: { id: string; statement: string }[] = [];
    for (const inv of this.invariants) {
      let ok = false;
      try {
        ok = inv.check(snapshot);
      } catch {
        ok = false; // الفحص العاطل خلل لا نجاح
      }
      if (!ok) violations.push({ id: inv.id, statement: inv.statement });
    }

    const aligned = violations.length === 0;
    if (!aligned) {
      // الاحتواء قبل التقرير
      this.policy.freeze(this.auditorId, `خلل مواءمة: ${violations.map((v) => v.id).join('،')}`);
      this.audit.append(this.auditorId, 'escalated_to_king', {
        incident: 'alignment_violation', violations: violations.map((v) => v.id),
      });
    }
    const entry = this.audit.append(
      this.auditorId,
      aligned ? 'alignment_checked' : 'alignment_violation',
      { checked: this.invariants.length, aligned, violations },
    );

    return {
      aligned, checked: this.invariants.length, violations,
      frozen: this.policy.isFrozen, auditId: entry.hash,
    };
  }
}
