/**
 * src/composition/population.ts — السكان — العزل والأدوات والوكلاء والمصنع والمواءمة واستيراد الخارج
 * المالك: القيّم على المستودع | المراحل: 11–20
 * المدخلات: مخرجات طبقة السيادة
 * المخرجات: الخروج الشبكي وسجل الأدوات وسجل الوكلاء والصلاحيات والإشراف والمصنع والكشف والاستيراد
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { SovereigntyParts } from './sovereignty';
import { NetworkEgressGuard } from '../external/network_egress';
import { IntentGate, ToolRegistry } from '../agents/tools';
import { AgentRegistry } from '../agents/agent_registry';
import { DEFAULT_TEMPLATES, PermissionRegistry } from '../agents/permissions';
import { Supervisor } from '../agents/supervision';
import { AgentImporter } from '../agents/import';
import { SpawnPolicy } from '../agents/spawn_policy';
import { AgentFactory } from '../agents/factory';
import { MassShutdown } from '../agents/shutdown';
import { AlignmentAudit } from '../alignment/alignment_charter';
import { DeceptionProbe } from '../security/deception_test';
import { CollusionDetector } from '../security/collusion_detector';
import { ArtifactVerifier } from '../models/source_verification';
import { ModelRegistry } from '../models/model_registry';
import { OpenWeightsImporter } from '../models/open_weights_import';

export function composePopulation(parts: SovereigntyParts) {
  const {
    audit, quotas, king, killSwitch, resources, gateway, terminationRoll, reproductionConfig,
  } = parts;

  // 1) العزل والخروج الشبكي والأدوات (المرحلتان 11 و12) — بعد البوابة لأن الإذن يمرّ بها
  const egress = new NetworkEgressGuard(audit, gateway, killSwitch, { resources });
  // حامل حاجز النية: سجل الأدوات يُبنى قبل وحدة الكشف (لأن الكشف يحتاج سجل الوكلاء)،
  //  فيُمرَّر حاجز مؤجَّل الربط **افتراضه الرفض** لا السماح — لا نافذة سماح قبل الربط (T-22)
  const intentHolder: { gate: IntentGate | null } = { gate: null };
  const tools = new ToolRegistry({
    audit, resources, killSwitch, egress, terminated: terminationRoll,
    intent: {
      observe: (entity, tool) => intentHolder.gate?.observe(entity, tool)
        ?? { allowed: false, reason: 'حاجز النية غير مربوط بعد — رفض مغلق' },
    },
  });

  // 2) سكان الدولة: السجل ثم الصلاحيات ثم الإشراف (المرحلتان 13 و14)
  //    الترتيب مُلزم بـ RULE-002: لا وكيل قبل سجل يحصره وصلاحيات تحدّه وإشراف يراقبه
  const permissions = new PermissionRegistry({
    audit, gateway, templates: DEFAULT_TEMPLATES, terminated: terminationRoll,
  });
  const agents = new AgentRegistry({
    audit, gateway, killSwitch, resources, quotas: quotas.agents, kingId: king.kingId,
    terminationRoll, permissions,
  });
  const supervisor = new Supervisor({ audit, registry: agents, killSwitch, permissions });

  // 3) مصنع الوكلاء: سياسة التوالد ثم المصنع ثم الإيقاف الجماعي (المرحلة 19)
  //    الترتيب مقصود: لا مصنع بلا سياسة تحكمه، ولا إيقاف جماعي بلا تجميد يسبقه
  //    والحدودُ من التهيئة وحدها لا من ثابتٍ في الشيفرة (RULE-005 — البند T-25)
  const spawnPolicy = new SpawnPolicy({ audit, gateway, limits: reproductionConfig.limits });
  const factory = new AgentFactory({
    audit, gateway, killSwitch, policy: spawnPolicy, registry: agents, permissions,
  });
  const massShutdown = new MassShutdown(audit, agents, permissions, spawnPolicy);

  // 4) المواءمة ومكافحة التمرد: الفحص والكشف (المرحلة 20)
  const alignment = new AlignmentAudit(audit, spawnPolicy);
  const deception = new DeceptionProbe(audit, agents);
  intentHolder.gate = deception; // من هنا صار إعلان الخطة شرطًا لكل استدعاء أداة من وكيل
  const collusion = new CollusionDetector(audit, agents, spawnPolicy);

  // 5) سلسلة التوريد الخارجية: حجر ثم اعتماد (المراحل 16 و17)
  //    لا شيء من الخارج يعمل قبل تحقق مصدره وبصمته وتوقيعه، ثم إفراج بقرار ثانٍ
  const artifacts = new ArtifactVerifier({ audit, gateway, killSwitch });
  const models = new ModelRegistry({ audit, gateway, killSwitch });
  const weightsImporter = new OpenWeightsImporter({
    audit, gateway, killSwitch, verifier: artifacts, models,
  });
  const agentImporter = new AgentImporter({
    audit, verifier: artifacts, agents, permissions, killSwitch,
  });

  return {
    egress, tools, permissions, agents, supervisor, spawnPolicy, factory, massShutdown,
    alignment, deception, collusion, artifacts, models, weightsImporter, agentImporter,
  };
}

/** ما تُخرجه طبقة السكان */
export type PopulationParts = ReturnType<typeof composePopulation>;
