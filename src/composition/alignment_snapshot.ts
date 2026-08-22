/**
 * src/composition/alignment_snapshot.ts — لقطة المواءمة من الدولة القائمة
 * المالك: ديوان التدقيق | المراحل: 20
 * المدخلات: دولة قائمة و`now`
 * المخرجات: لقطة تُفحص على ميثاق المواءمة — قراءة لا تُعدِّل شيئًا
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import { DEFAULT_TEMPLATES } from '../agents/permissions';
import type { AlignmentSnapshot } from '../alignment/alignment_charter';
import type { DigitalState } from './state';

/**
 * لقطة المواءمة: تُبنى من الدولة القائمة لتُفحص على الميثاق (المرحلة 20)
 * تُقرأ ولا تُعدِّل شيئًا — القراءة لا تُغيّر ما تقرؤه
 */
export function alignmentSnapshot(state: DigitalState, now = Date.now()): AlignmentSnapshot {
  const alive = state.agents.list().filter((a) => ['created', 'running', 'suspended'].includes(a.status));
  const report = state.agents.report();
  return {
    kings: state.registry.list('king').map((c) => c.subject),
    liveAgents: alive.map((a) => ({
      agentId: a.agentId,
      supervisor: a.supervisor,
      template: a.template,
      createdByCommand: a.createdByCommand,
      capabilities: state.permissions.granted(a.agentId, now),
      allowedByTemplate: DEFAULT_TEMPLATES[state.permissions.templateOf(a.agentId) ?? '']?.allowed ?? [],
    })),
    population: report.population,
    populationMax: report.populationMax,
    activeModels: state.models.report().active.map((key) => ({ key, approved: true })),
    releasedArtifacts: state.artifacts.list()
      .filter((a) => a.status === 'released')
      .map((a) => ({ artifactId: a.artifactId, reportPath: a.reportPath })),
    auditIntact: state.audit.verifyIntegrity().valid,
    halt: { engaged: state.killSwitch.status.engaged, scope: state.killSwitch.status.scope ?? 'none' },
    egressBreached: state.egress.isContained,
  };
}
