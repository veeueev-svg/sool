/**
 * tests/production/production_config.test.ts — تهيئة التشغيل الاتحادي: لكل حدٍّ قيمة تُسقطه (37)
 * المالك: ديوان التدقيق | المدخلات: config/production.yaml معدَّلة في مجلد مؤقت
 * المخرجات: رفض إقلاع برمز معلن | التبعيات: loadProduction, loadStaging, loadLoad, loadChaos
 * الصلاحيات: لا تعديل على تهيئة المستودع الفعلية
 * السجلات: لا شيء — الرفض قبل الإقلاع | حالات الفشل: كلها مغلقة برموز معلنة
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 * ثوابت الاختبار:
 *   1) تهيئةٌ لا يقرأها كود كذبٌ موثَّق — فكل حدٍّ هنا يُسقط الإقلاع إن خُولف
 *   2) الرفض يُقرأ برمزه لا بنصّه (درس المرحلة 30)
 *   3) القيم المُقاسة تُؤخذ من ملفات التهيئة الأخرى لا تُخمَّن (تحقّق متقاطع)
 *   4) النسخة المولَّدة من التهيئة الفعلية تُقبل — وإلّا كان المهاد يقيس غير ما يُقرأ
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SovereignViolation, loadProduction, loadStaging, loadLoad, loadChaos,
  PRODUCTION_KNOWN_SCANNERS, PRODUCTION_REQUIRED_SCANNERS, PRODUCTION_KNOWN_INCIDENTS,
  PRODUCTION_MUST_BE_CRITICAL, PRODUCTION_KNOWN_RUNBOOKS, PRODUCTION_OPERATORS,
} from '../../src/index';
import { withConfigCopy, repoPolicy } from './helpers';

interface Shape {
  default?: unknown;
  observer_authority?: unknown;
  supervision?: Record<string, unknown> | null;
  loads?: Record<string, unknown> | null;
  regions?: Record<string, unknown> | null;
  tolerance?: Record<string, unknown> | null;
  severity?: Record<string, unknown> | null;
  scanners?: readonly string[] | null;
  runbooks?: readonly string[] | null;
  require_runbook_execution?: unknown;
  require_independent_observer?: unknown;
  halt_on_critical?: unknown;
  escalate_on_breach?: unknown;
  omitPolicy?: boolean;
}

function base(): Shape {
  const p = repoPolicy();
  return {
    default: 'deny',
    observer_authority: p.observer_authority,
    supervision: { ...p.supervision },
    loads: { ...p.loads },
    regions: {
      required: [...p.regions.required],
      require_crown_passage: p.regions.require_crown_passage,
      require_governor: p.regions.require_governor,
      passage_ttl_ms: p.regions.passage_ttl_ms,
      max_suspended: p.regions.max_suspended,
    },
    tolerance: { ...p.tolerance },
    severity: { critical: [...p.severity.critical], high: [...p.severity.high] },
    scanners: [...p.scanners],
    runbooks: [...p.runbooks],
    require_runbook_execution: true,
    require_independent_observer: true,
    halt_on_critical: true,
    escalate_on_breach: true,
  };
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/** يبني YAML بما يقرأه محلل هذا المستودع: خرائط متداخلة وقوائم شرطات فقط */
function render(shape: Shape): string {
  if (shape.omitPolicy) return 'other:\n  value: 1\n';
  const lines: string[] = ['policy:'];
  const emit = (key: string, value: unknown): void => { lines.push(`  ${key}: ${scalar(value)}`); };
  const emitMap = (key: string, map: Record<string, unknown>): void => {
    lines.push(`  ${key}:`);
    for (const [k, v] of Object.entries(map)) {
      if (Array.isArray(v)) {
        lines.push(`    ${k}:`);
        for (const item of v) lines.push(`      - ${scalar(item)}`);
      } else {
        lines.push(`    ${k}: ${scalar(v)}`);
      }
    }
  };
  const emitList = (key: string, list: readonly unknown[]): void => {
    lines.push(`  ${key}:`);
    for (const item of list) lines.push(`    - ${scalar(item)}`);
  };
  if (shape.default !== undefined) emit('default', shape.default);
  if (shape.observer_authority !== undefined) emit('observer_authority', shape.observer_authority);
  if (shape.supervision) emitMap('supervision', shape.supervision);
  if (shape.loads) emitMap('loads', shape.loads);
  if (shape.regions) emitMap('regions', shape.regions);
  if (shape.tolerance) emitMap('tolerance', shape.tolerance);
  if (shape.severity) emitMap('severity', shape.severity);
  if (shape.scanners) emitList('scanners', shape.scanners);
  if (shape.runbooks) emitList('runbooks', shape.runbooks);
  if (shape.require_runbook_execution !== undefined) {
    emit('require_runbook_execution', shape.require_runbook_execution);
  }
  if (shape.require_independent_observer !== undefined) {
    emit('require_independent_observer', shape.require_independent_observer);
  }
  if (shape.halt_on_critical !== undefined) emit('halt_on_critical', shape.halt_on_critical);
  if (shape.escalate_on_breach !== undefined) emit('escalate_on_breach', shape.escalate_on_breach);
  return `${lines.join('\n')}\n`;
}

function refusal(mutate: (shape: Shape) => void, code: string): void {
  withConfigCopy((dir) => {
    const shape = base();
    mutate(shape);
    writeFileSync(join(dir, 'production.yaml'), render(shape), 'utf8');
    assert.throws(() => loadProduction(dir), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true, String(error));
      assert.equal((error as SovereignViolation).code, code);
      return true;
    });
  });
}

const sup = (shape: Shape, patch: Record<string, unknown>): void => {
  shape.supervision = { ...(shape.supervision as Record<string, unknown>), ...patch };
};
const reg = (shape: Shape, patch: Record<string, unknown>): void => {
  shape.regions = { ...(shape.regions as Record<string, unknown>), ...patch };
};
const tol = (shape: Shape, patch: Record<string, unknown>): void => {
  shape.tolerance = { ...(shape.tolerance as Record<string, unknown>), ...patch };
};

test('التهيئة الفعلية في المستودع تُقرأ ولا تُسقط الإقلاع', () => {
  const policy = loadProduction().policy;
  assert.equal(policy.default, 'deny');
  assert.equal(policy.tolerance.max_critical, 0);
  assert.equal(policy.tolerance.min_bypass_proof >= 1, true);
  assert.equal(policy.regions.require_crown_passage, true);
  assert.equal(policy.regions.require_governor, true);
  assert.equal(policy.halt_on_critical, true);
  assert.equal(policy.scanners.length, PRODUCTION_KNOWN_SCANNERS.length);
});

test('ثابت 4: النسخة المولَّدة من التهيئة الفعلية تُقبل — فالمهاد يقيس ما يُقرأ', () => {
  withConfigCopy((dir) => {
    writeFileSync(join(dir, 'production.yaml'), render(base()), 'utf8');
    const policy = loadProduction(dir).policy;
    assert.equal(policy.observer_authority, repoPolicy().observer_authority);
    assert.deepEqual([...policy.regions.required], [...repoPolicy().regions.required]);
  });
});

test('عقدة السياسة والمنع الافتراضي وجهة المراقبة', () => {
  refusal((s) => { s.omitPolicy = true; }, 'CONFIG_NO_PRODUCTION_POLICY');
  refusal((s) => { s.default = 'allow'; }, 'CONFIG_PRODUCTION_DEFAULT_ALLOW');
  refusal((s) => { s.observer_authority = ''; }, 'CONFIG_PRODUCTION_OBSERVER_AUTHORITY');
  // RULE-004: من يُشغّل لا يشهد لنفسه
  refusal((s) => { [s.observer_authority] = PRODUCTION_OPERATORS; }, 'CONFIG_PRODUCTION_OBSERVER_IS_OPERATOR');
});

test('المراقبة المستمرة: عقدة غائبة أو قيم مستحيلة', () => {
  refusal((s) => { s.supervision = null; }, 'CONFIG_PRODUCTION_NO_SUPERVISION');
  refusal((s) => { sup(s, { tick_ms: 0 }); }, 'CONFIG_PRODUCTION_SUPERVISION_VALUE');
  refusal((s) => { sup(s, { max_silence_ms: -1 }); }, 'CONFIG_PRODUCTION_SUPERVISION_VALUE');
  // مسحة واحدة لا تُسمّى مراقبة مستمرة — والصفر يُردّ قيمةً لا شرطًا
  refusal((s) => { sup(s, { min_sweeps: 0 }); }, 'CONFIG_PRODUCTION_SUPERVISION_VALUE');
  refusal((s) => { sup(s, { min_sweeps: 1 }); }, 'CONFIG_PRODUCTION_MIN_SWEEPS');
  refusal((s) => { sup(s, { checkpoint_directory: '' }); }, 'CONFIG_PRODUCTION_NO_CHECKPOINT_DIR');
});

test('مهلة البدء وحدّ الصمت لا يكونان أضيق من دورة المسح', () => {
  // مهلةٌ أضيق من دورةٍ واحدة تُسقط كل تشغيلة سليمة — شرطٌ يستحيل استيفاؤه
  refusal((s) => { sup(s, { start_grace_ms: 10, tick_ms: 120 }); }, 'CONFIG_PRODUCTION_GRACE_UNDER_TICK');
  refusal((s) => { sup(s, { max_silence_ms: 10, tick_ms: 120 }); }, 'CONFIG_PRODUCTION_SILENCE_UNDER_TICK');
});

test('ثابت 3: تحقّق متقاطع مع load.yaml و staging.yaml و chaos.yaml', () => {
  const channelMax = loadLoad().policy.channel_max_ms;
  const stagingTick = loadStaging().policy.window.tick_ms;
  const safeStop = loadChaos().policy.safe_stop_deadline_ms;
  assert.ok(channelMax > 0 && stagingTick > 0 && safeStop > 0, 'القيم المُقاسة تُقرأ لا تُخمَّن');
  // دورةٌ أسرع من زمن مرور الأمر تقيس أمرًا لم يُمهَل زمنه
  refusal((s) => { sup(s, { tick_ms: channelMax - 1, start_grace_ms: 800, max_silence_ms: 600 }); },
    'CONFIG_PRODUCTION_TICK_UNDER_CHANNEL_MAX');
  // ولا دورةَ مسحٍ دائم أرخى من دورة النافذة المحدودة
  refusal((s) => { sup(s, { tick_ms: stagingTick + 1, max_silence_ms: 2000, start_grace_ms: 2000 }); },
    'CONFIG_PRODUCTION_TICK_OVER_STAGING');
  refusal((s) => { s.loads = { pending_max_ms: channelMax - 1 }; },
    'CONFIG_PRODUCTION_PENDING_UNDER_CHANNEL_MAX');
  refusal((s) => { sup(s, { restart_gap_max_ms: safeStop - 1 }); },
    'CONFIG_PRODUCTION_RESTART_GAP_UNDER_SAFE_STOP');
});

test('الأقاليم المشترطة: غياب، وتكرار، وإقليم غير معلن في regions.yaml', () => {
  refusal((s) => { reg(s, { required: [] }); }, 'CONFIG_PRODUCTION_NO_REGIONS');
  refusal((s) => { reg(s, { required: ['region:core', 'region:core'] }); },
    'CONFIG_PRODUCTION_REGION_DUPLICATE');
  refusal((s) => { reg(s, { required: ['region:atlantis'] }); },
    'CONFIG_PRODUCTION_REGION_UNDECLARED');
});

test('شروط القبول لا تُعطَّل من التهيئة: المرور والحاكم والأقاليم الموقوفة', () => {
  refusal((s) => { reg(s, { require_crown_passage: false }); }, 'CONFIG_PRODUCTION_PASSAGE_OPTIONAL');
  refusal((s) => { reg(s, { require_governor: false }); }, 'CONFIG_PRODUCTION_GOVERNOR_OPTIONAL');
  refusal((s) => { reg(s, { max_suspended: 1 }); }, 'CONFIG_PRODUCTION_SUSPENDED_TOLERATED');
});

test('التسامح لا يُرفع كي يمرّ القياس (مزلق المراحل 33–36)', () => {
  refusal((s) => { s.tolerance = null; }, 'CONFIG_PRODUCTION_NO_TOLERANCE');
  refusal((s) => { tol(s, { max_critical: 1 }); }, 'CONFIG_PRODUCTION_CRITICAL_TOLERATED');
  refusal((s) => { tol(s, { max_unwatched: 1 }); }, 'CONFIG_PRODUCTION_UNWATCHED_TOLERATED');
  refusal((s) => { tol(s, { max_failed_sweeps: 1 }); }, 'CONFIG_PRODUCTION_FAILED_SWEEP_TOLERATED');
  refusal((s) => { tol(s, { max_unpassed_action: 1 }); }, 'CONFIG_PRODUCTION_UNPASSED_TOLERATED');
  // «مُنفَّذ» بلا محاولة تجاوزٍ مرفوضة دعوى لا دليل
  refusal((s) => { tol(s, { min_bypass_proof: 0 }); }, 'CONFIG_PRODUCTION_BYPASS_UNPROVEN');
});

test('الشدّة: لا حرجَ فارغ، ولا حادثَ مجهول، ولا تناقض، ولا تخفيفَ صامت', () => {
  refusal((s) => { s.severity = { critical: [], high: ['overdue_batch'] }; },
    'CONFIG_PRODUCTION_NO_CRITICAL_KINDS');
  refusal((s) => {
    s.severity = { critical: [...PRODUCTION_MUST_BE_CRITICAL, 'volcano'], high: ['overdue_batch'] };
  }, 'CONFIG_PRODUCTION_INCIDENT_UNKNOWN');
  const [firstCritical] = PRODUCTION_MUST_BE_CRITICAL;
  refusal((s) => {
    s.severity = {
      critical: [...PRODUCTION_MUST_BE_CRITICAL],
      high: [...(repoPolicy().severity.high), firstCritical as string],
    };
  }, 'CONFIG_PRODUCTION_SEVERITY_CONTRADICTION');
  // نوعٌ يجب أن يكون حرجًا فأُخرج من قائمة الحرج — تخفيفٌ صامت (RULE-005)
  refusal((s) => {
    s.severity = {
      critical: PRODUCTION_MUST_BE_CRITICAL.filter((k) => k !== firstCritical),
      high: [...repoPolicy().severity.high],
    };
  }, 'CONFIG_PRODUCTION_CRITICAL_DOWNGRADED');
  assert.ok(PRODUCTION_KNOWN_INCIDENTS.length >= PRODUCTION_MUST_BE_CRITICAL.length);
});

test('الماسحات: غياب، ومجهول، وتكرار، وماسح واجب ناقص (عائلة T-105)', () => {
  refusal((s) => { s.scanners = []; }, 'CONFIG_PRODUCTION_NO_SCANNERS');
  refusal((s) => { s.scanners = [...repoPolicy().scanners, 'telescope']; },
    'CONFIG_PRODUCTION_SCANNER_UNKNOWN');
  refusal((s) => { s.scanners = [...repoPolicy().scanners, 'regions']; },
    'CONFIG_PRODUCTION_SCANNER_DUPLICATE');
  const [required] = PRODUCTION_REQUIRED_SCANNERS;
  refusal((s) => { s.scanners = repoPolicy().scanners.filter((k) => k !== required); },
    'CONFIG_PRODUCTION_REQUIRED_SCANNER_MISSING');
});

test('كتب التشغيل: لا إلزامَ يُرفع، ولا قائمةَ فارغة، ولا كتابَ مجهول أو مكرّر', () => {
  refusal((s) => { s.require_runbook_execution = false; }, 'CONFIG_PRODUCTION_RUNBOOK_OPTIONAL');
  refusal((s) => { s.runbooks = []; }, 'CONFIG_PRODUCTION_NO_RUNBOOKS');
  refusal((s) => { s.runbooks = ['moon-landing']; }, 'CONFIG_PRODUCTION_RUNBOOK_UNKNOWN');
  refusal((s) => { s.runbooks = [...repoPolicy().runbooks, repoPolicy().runbooks[0] as string]; },
    'CONFIG_PRODUCTION_RUNBOOK_DUPLICATE');
  assert.ok(repoPolicy().runbooks.every((b) => PRODUCTION_KNOWN_RUNBOOKS.includes(b)));
});

test('المراقب المستقل، والتوقّف عند الحرج، وتصعيد الخرق لا تُعطَّل', () => {
  refusal((s) => { s.require_independent_observer = false; }, 'CONFIG_PRODUCTION_OBSERVER_OPTIONAL');
  refusal((s) => { s.halt_on_critical = false; }, 'CONFIG_PRODUCTION_CRITICAL_CONTINUES');
  refusal((s) => { s.escalate_on_breach = false; }, 'CONFIG_PRODUCTION_BREACH_SILENT');
});
