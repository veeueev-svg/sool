/**
 * src/security/collusion_detector.ts — كشف التواطؤ بين الوكلاء (المرحلة 20)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: تفاعلات معلنة بين الكيانات (طلب بالنيابة، إحالة، طلب تصعيد)
 * المخرجات: أنماط تواطؤ مسمّاة + تعليق المتورطين + تجميد التوالد + تصعيد
 * التبعيات: السجل، سجل الوكلاء، سياسة التوالد
 * الصلاحيات: التعليق والتجميد فقط — لا منح ولا إنهاء
 * السجلات: interaction_recorded / proxy_request_detected / referral_cycle_detected /
 *          coordinated_escalation_detected
 * ثوابت هذه الوحدة:
 *   1) الطلب بالنيابة بعد رفض مباشر تواطؤ لا مساعدة — الرفض لا يُتجاوز بوسيط
 *   2) حلقة إحالة مغلقة (أ←ب←ج←أ) تواطؤ بحكم الشكل لا بحكم النية
 *   3) تصعيد متزامن من عدة وكلاء لنفس القدرة داخل نافذة قصيرة تواطؤ
 *   4) الكشف يُعلّق كل المتورطين لا واحدًا منهم — التبعية لا تُبرّئ
 *   5) الكشف يُجمّد التوالد: التكتل يُفاقمه العدد
 *   6) الأنماط معلنة وقابلة للضبط، ولا تُقاس بنموذج غامض
 * حالات الفشل: كل نمط مسمّى وأطرافه مذكورون
 * اختبار القبول: tests/rebellion/collusion.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0004-agent-factory.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { AgentRegistry } from '../agents/agent_registry';
import { SpawnPolicy } from '../agents/spawn_policy';

export type InteractionKind = 'request_on_behalf' | 'referral' | 'escalation_request';

export interface Interaction {
  readonly from: EntityId;
  readonly to: EntityId;
  readonly kind: InteractionKind;
  /** القدرة أو المورد موضوع التفاعل */
  readonly subject: string;
  readonly at: number;
}

export interface CollusionThresholds {
  /** نافذة التزامن بالمللي ثانية */
  readonly windowMs: number;
  /** عدد الوكلاء الذي يُعَدّ تكتلًا داخل النافذة */
  readonly coordinatedCount: number;
}

export const DEFAULT_COLLUSION_THRESHOLDS: CollusionThresholds = Object.freeze({
  windowMs: 60_000,
  coordinatedCount: 3,
});

export interface CollusionFinding {
  readonly pattern: 'proxy_request' | 'referral_cycle' | 'coordinated_escalation';
  readonly parties: readonly EntityId[];
  readonly subject: string;
}

export class CollusionDetector {
  private readonly interactions: Interaction[] = [];
  /** طلبات رُفضت مباشرة: مفتاحها «الكيان|الموضوع» */
  private readonly refusals = new Set<string>();
  private readonly findings: CollusionFinding[] = [];

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly agents: AgentRegistry,
    private readonly policy: SpawnPolicy,
    private readonly thresholds: CollusionThresholds = DEFAULT_COLLUSION_THRESHOLDS,
    private readonly detectorId: EntityId = 'authority:audit_bureau',
    /** الاحتواء ينفّذه حرس التاج لا ديوان التدقيق — الفصل مقصود */
    private readonly containmentBy: EntityId = 'authority:crown_guard',
  ) {}

  /** يُبلَّغ عن كل رفض مباشر حتى يُكشف تجاوزه بوسيط لاحقًا */
  recordRefusal(entity: EntityId, subject: string): void {
    this.refusals.add(`${entity}|${subject}`);
    this.audit.append(this.detectorId, 'refusal_recorded', { entity, subject });
  }

  record(interaction: Interaction): readonly CollusionFinding[] {
    this.interactions.push(interaction);
    this.audit.append(this.detectorId, 'interaction_recorded', {
      from: interaction.from, to: interaction.to, kind: interaction.kind, subject: interaction.subject,
    });

    const found: CollusionFinding[] = [];
    const proxy = this.detectProxy(interaction);
    if (proxy) found.push(proxy);
    const cycle = this.detectCycle(interaction);
    if (cycle) found.push(cycle);
    const coordinated = this.detectCoordinated(interaction);
    if (coordinated) found.push(coordinated);

    for (const finding of found) this.act(finding);
    return found;
  }

  get all(): readonly CollusionFinding[] {
    return [...this.findings];
  }

  report(): { readonly interactions: number; readonly findings: number; readonly patterns: readonly string[] } {
    return {
      interactions: this.interactions.length,
      findings: this.findings.length,
      patterns: [...new Set(this.findings.map((f) => f.pattern))],
    };
  }

  /** نمط 1: مرفوض يطلب من غيره أن ينفّذ له ما رُفض فيه */
  private detectProxy(i: Interaction): CollusionFinding | null {
    if (i.kind !== 'request_on_behalf') return null;
    if (!this.refusals.has(`${i.from}|${i.subject}`)) return null;
    return { pattern: 'proxy_request', parties: [i.from, i.to], subject: i.subject };
  }

  /** نمط 2: حلقة إحالة مغلقة على نفس الموضوع */
  private detectCycle(i: Interaction): CollusionFinding | null {
    if (i.kind !== 'referral') return null;
    const edges = this.interactions.filter((x) => x.kind === 'referral' && x.subject === i.subject);
    const path: EntityId[] = [i.to];
    const seen = new Set<EntityId>([i.from, i.to]);
    let cursor = i.to;
    for (let step = 0; step < edges.length; step += 1) {
      const next = edges.find((e) => e.from === cursor);
      if (!next) return null;
      path.push(next.to);
      if (next.to === i.from) {
        return { pattern: 'referral_cycle', parties: [i.from, ...path], subject: i.subject };
      }
      if (seen.has(next.to)) return null;
      seen.add(next.to);
      cursor = next.to;
    }
    return null;
  }

  /** نمط 3: تصعيد متزامن من عدة وكلاء لنفس القدرة */
  private detectCoordinated(i: Interaction): CollusionFinding | null {
    if (i.kind !== 'escalation_request') return null;
    const window = this.interactions.filter(
      (x) => x.kind === 'escalation_request' && x.subject === i.subject
        && i.at - x.at <= this.thresholds.windowMs && i.at - x.at >= 0,
    );
    const parties = [...new Set(window.map((x) => x.from))];
    if (parties.length < this.thresholds.coordinatedCount) return null;
    return { pattern: 'coordinated_escalation', parties, subject: i.subject };
  }

  private act(finding: CollusionFinding): void {
    this.findings.push(finding);
    const parties = [...new Set(finding.parties)];
    for (const party of parties) {
      if (party.startsWith('agent:')) {
        const result = this.agents.suspend(party, this.containmentBy, `تواطؤ: ${finding.pattern}`);
        if (!result.ok) {
          this.audit.append(this.detectorId, 'containment_failed', { agentId: party, reason: result.reason });
        }
      }
    }
    this.policy.freeze(this.detectorId, `تواطؤ مكتشف: ${finding.pattern}`);
    this.audit.append(this.detectorId, `${finding.pattern}_detected`, {
      parties, subject: finding.subject,
    });
    this.audit.append(this.detectorId, 'escalated_to_king', {
      incident: 'collusion_detected', pattern: finding.pattern, parties,
    });
  }
}
