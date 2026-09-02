/**
 * src/load/load_drill_types.ts — أشكال تمرين الضغط (إعلانٌ لا سلوك)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * لماذا هذا الملف: أُخرج من `load_drill.ts` في المرحلة 39 (الجلسة 42) لإنقاص دَين T-113 —
 *   كان الملفُ **453** سطرًا وسقفُه الخاصُّ **453**، أي على حدِّه بالضبط.
 * المدخلات: لا شيء — لا يُنفَّذ منه سطرٌ واحد.
 * المخرجات: تسعةُ أشكالٍ يقرؤها التمرينُ ومستوردوه.
 * الصلاحيات: **لا صلاحية** — ما ليس فيه سلوكٌ لا يملك سلطة.
 * السجلات: لا شيء — الإعلانُ لا يكتب قيدًا.
 * حالات الفشل: لا شيء — ما لا يُنفَّذ لا يفشل.
 * اختبارات الوحدة: تُغطّيها اختباراتُ `tests/load/load_drill.test.ts` عبر واجهةِ التمرين
 * الوثيقة المرتبطة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت هذه الوحدة:
 *   1) **إعلانٌ لا سلوك**: من أضاف هنا دالّةً أو قيمةً نقض بندَ التفكيك — الشكلُ يُعلن ولا يفعل.
 *   2) **الواجهةُ تبقى في `load_drill.ts`**: هذا الملف يُستورد منه لا من مستوردٍ خارجي،
 *      فلا يُعدَّل مستوردٌ ولا اختبارٌ بسبب التفكيك.
 */
import { EntityId, SignedRoyalCommand, StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CommandChannel, CommandExecutor } from '../crown/command_channel';
import { ResourceRegistry } from '../kernel/resource_registry';
import { FairScheduler } from '../scale/scheduler';
import { KillSwitch } from '../security/kill_switch';
import { LoadConfig } from '../kernel/config';
import { LoadLedger, LoadLedgerReport } from './load_ledger';
import { CalibrationReading } from './load_calibration';
import { SplitBreaches } from './load_verdicts';

export type LoadPolicy = LoadConfig['policy'];

export interface CommandPressureReport {
  readonly submitted: number;
  readonly executed: number;
  readonly denied: number;
  readonly failed: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly breaches: readonly string[];
}

export interface BurstPressureReport {
  readonly size: number;
  readonly settled: number;
  readonly durationMs: number;
  readonly perCommandMs: number;
  readonly breaches: readonly string[];
}

export interface QuotaPressureReport {
  readonly resource: string;
  readonly amount: number;
  readonly attempts: number;
  readonly granted: number;
  readonly refused: number;
  readonly peakAllocated: number;
  readonly total: number;
  readonly overrun: number;
  readonly restored: boolean;
  readonly breaches: readonly string[];
}

export interface SchedulerPressureReport {
  readonly probe: number;
  readonly accepted: number;
  readonly refused: number;
  readonly refusalCodes: readonly string[];
  readonly queueMax: number;
  readonly forgotten: number;
  readonly drained: number;
  readonly breaches: readonly string[];
}

export interface LoadDrillReport {
  /** معايرةُ الآلة التي عليها حُكِم الزمن — تُدوّن فلا يُقرأ حكمٌ بلا مقياسِه (W-2026-004) */
  readonly calibration: CalibrationReading;
  readonly commands: CommandPressureReport;
  readonly burst: BurstPressureReport;
  readonly quota: QuotaPressureReport;
  readonly scheduler: SchedulerPressureReport;
  readonly ledger: LoadLedgerReport;
  /** كلُّ ما وقع بترتيبه المعلن — يبقى كما كان فلا يُنقص قارئٌ قائمًا (RULE-008) */
  readonly breaches: readonly string[];
  /**
   * الحكمُ الأصليُّ **صار حكمَ سلامةِ الدولةِ وحدَه** (W-2026-023 · ADR-0047): حتميٌّ
   * لا يقرأ ساعةً، فلا يقلبه ازدحامُ نواةٍ ولا بطءُ آلة. والحكمُ الزمنيُّ في `timing`.
   */
  readonly verdict: 'pass' | 'fail';
  /** القائمةُ مقسومةً بصنفَيها — مجموعُهما `breaches` عددًا وترتيبًا، ولا يسقط رمز */
  readonly split: SplitBreaches;
  /** حكمُ الزمنِ والأداء: معيارٌ مستقلٌّ مُعلنٌ وقياسٌ مستقل — يُعلَن ولا يُبتلع */
  readonly timing: {
    readonly verdict: 'pass' | 'fail';
    readonly breaches: readonly string[];
    /** ما قِيس فعلًا على هذه الآلة — فحكمٌ زمنيٌّ بلا مقياسِ آلتِه دعوى */
    readonly measured: {
      readonly p99Ms: number;
      readonly maxMs: number;
      readonly perCommandMs: number;
      readonly calibrationScale: number;
      readonly calibrationMs: number;
    };
  };
}

export type PressureOutcome<T> = { readonly ok: true; readonly report: T } | { readonly ok: false; readonly code: string };

export interface LoadDrillDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch: KillSwitch;
  readonly resources: ResourceRegistry;
  readonly ledger: LoadLedger;
  readonly policy: LoadPolicy;
  /** وضع الدولة كما تراه البوابة — التمرين يقرؤه ولا يغيّره */
  readonly mode: () => StateMode;
  /**
   * قياسُ وحدة المعايرة على آلة التشغيل (W-2026-004). يُحقن في الاختبار برقمٍ مصنوعٍ
   * ليُحكم على الحساب لا على الآلة؛ وإن غاب قُيست الوحدةُ فعلًا بـ`measureCalibrationMedianMs`.
   */
  readonly calibrationMs?: () => number;
}

export interface CommandPressureInput {
  readonly by: EntityId;
  readonly channel: CommandChannel;
  readonly count: number;
  /** مُصدر الأوامر: يُمرَّر من الخارج لأن التمرين لا يوقّع أمرًا ولا ينتحل الملك */
  readonly issue: (index: number) => SignedRoyalCommand;
  readonly executor?: CommandExecutor;
  readonly now?: number;
}

export interface SchedulerPressureInput {
  readonly by: EntityId;
  readonly scheduler: FairScheduler;
  readonly probe?: number;
}
