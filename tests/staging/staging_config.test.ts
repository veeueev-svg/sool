/**
 * tests/staging/staging_config.test.ts — تهيئة التشغيل المحدود: كل حدّ له قيمة تُسقطه (المرحلة 36)
 * المالك: ديوان التدقيق | المدخلات: config/staging.yaml معدَّلة في مجلد مؤقت | المخرجات: رفض إقلاع
 * التبعيات: loadStaging | الصلاحيات: لا تعديل على تهيئة المستودع الفعلية
 * السجلات: لا شيء — الرفض قبل الإقلاع | حالات الفشل: كلها مغلقة برموز معلنة
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0020-limited-operation.md
 * ثوابت الاختبار: 1) تهيئة لا تُقرأ كذبٌ موثَّق؛ 2) لكل حدّ قيمة تُسقط الإقلاع؛
 *   3) الرفض برمزه لا بنصه؛ 4) القيم المُقاسة تُؤخذ من ملفات التهيئة الأخرى لا تُخمَّن.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SovereignViolation, loadStaging, loadLoad, loadChaos,
  STAGING_KNOWN_WATCHES, STAGING_REQUIRED_WATCHES, STAGING_KNOWN_INCIDENTS,
  STAGING_MUST_BE_CRITICAL, STAGING_KNOWN_RUNBOOKS, STAGING_OPERATORS,
} from '../../src/index';
import { loadQuotas } from '../../src/kernel/config';
import { withConfigCopy, repoPolicy } from './helpers';

interface Shape {
  default?: unknown;
  observer_authority?: unknown;
  window?: Record<string, unknown> | null;
  scope?: Record<string, unknown> | null;
  severity?: Record<string, unknown> | null;
  tolerance?: Record<string, unknown> | null;
  watches?: readonly string[] | null;
  require_runbook_execution?: unknown;
  runbooks?: readonly string[] | null;
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
    window: { ...p.window },
    scope: {
      permitted_actions: [...p.scope.permitted_actions],
      forbidden_actions: [...p.scope.forbidden_actions],
      max_agents: p.scope.max_agents,
    },
    severity: { critical: [...p.severity.critical], high: [...p.severity.high] },
    tolerance: { ...p.tolerance },
    watches: [...p.watches],
    require_runbook_execution: true,
    runbooks: [...p.runbooks],
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
  if (shape.window) emitMap('window', shape.window);
  if (shape.scope) emitMap('scope', shape.scope);
  if (shape.severity) emitMap('severity', shape.severity);
  if (shape.tolerance) emitMap('tolerance', shape.tolerance);
  if (shape.watches) emitList('watches', shape.watches);
  if (shape.require_runbook_execution !== undefined) {
    emit('require_runbook_execution', shape.require_runbook_execution);
  }
  if (shape.runbooks) emitList('runbooks', shape.runbooks);
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
    writeFileSync(join(dir, 'staging.yaml'), render(shape), 'utf8');
    assert.throws(() => loadStaging(dir), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true);
      assert.equal((error as SovereignViolation).code, code);
      return true;
    });
  });
}

test('التهيئة الفعلية في المستودع تُقرأ ولا تُسقط الإقلاع', () => {
  const policy = loadStaging().policy;
  assert.equal(policy.default, 'deny');
  assert.equal(policy.tolerance.max_critical, 0);
  assert.equal(policy.halt_on_critical, true);
});

test('نسخة التهيئة المولَّدة من الفعلية تُقبل — فالمهاد يقيس ما يُقرأ', () => {
  withConfigCopy((dir) => {
    writeFileSync(join(dir, 'staging.yaml'), render(base()), 'utf8');
    assert.equal(loadStaging(dir).policy.observer_authority, repoPolicy().observer_authority);
  });
});

test('CONFIG_NO_STAGING_POLICY: تهيئة بلا عقدة سياسة', () => {
  refusal((s) => { s.omitPolicy = true; }, 'CONFIG_NO_STAGING_POLICY');
});

test('CONFIG_STAGING_DEFAULT_ALLOW: نطاق يُبنى سماحًا لا منعًا', () => {
  refusal((s) => { s.default = 'allow'; }, 'CONFIG_STAGING_DEFAULT_ALLOW');
});

test('CONFIG_STAGING_OBSERVER_AUTHORITY: جهة المراقبة فارغة', () => {
  refusal((s) => { s.observer_authority = ''; }, 'CONFIG_STAGING_OBSERVER_AUTHORITY');
});

test('CONFIG_STAGING_OBSERVER_IS_OPERATOR: المشغّل يشهد لنفسه (RULE-004)', () => {
  refusal((s) => { [s.observer_authority] = STAGING_OPERATORS; }, 'CONFIG_STAGING_OBSERVER_IS_OPERATOR');
});

test('CONFIG_STAGING_NO_WINDOW: نافذة المراقبة غير معلنة', () => {
  refusal((s) => { s.window = null; }, 'CONFIG_STAGING_NO_WINDOW');
});

test('CONFIG_STAGING_WINDOW_VALUE: مدة نافذة صفر', () => {
  refusal((s) => { s.window = { ...(s.window as object), duration_ms: 0 }; }, 'CONFIG_STAGING_WINDOW_VALUE');
});

test('CONFIG_STAGING_WINDOW_VALUE: أقل عدد مسحات سالب', () => {
  refusal((s) => { s.window = { ...(s.window as object), min_ticks: -1 }; }, 'CONFIG_STAGING_WINDOW_VALUE');
});

test('CONFIG_STAGING_WINDOW_TOO_SHORT: نافذة يستحيل أن تستوفي أقل عدد مسحات', () => {
  refusal((s) => {
    s.window = { duration_ms: 300, tick_ms: 100, min_ticks: 9 };
  }, 'CONFIG_STAGING_WINDOW_TOO_SHORT');
});

test('CONFIG_STAGING_NO_SCOPE: النطاق غير معلن', () => {
  refusal((s) => { s.scope = null; }, 'CONFIG_STAGING_NO_SCOPE');
});

test('CONFIG_STAGING_NO_PERMITTED_ACTIONS: تشغيلٌ لا يفعل شيئًا لا يُراقب', () => {
  refusal((s) => {
    s.scope = { permitted_actions: [], forbidden_actions: ['train_model'], max_agents: 8 };
  }, 'CONFIG_STAGING_NO_PERMITTED_ACTIONS');
});

test('CONFIG_STAGING_NO_FORBIDDEN_ACTIONS: نطاق بلا ممنوع ليس قيدًا', () => {
  refusal((s) => {
    s.scope = { permitted_actions: ['create_agent'], forbidden_actions: [], max_agents: 8 };
  }, 'CONFIG_STAGING_NO_FORBIDDEN_ACTIONS');
});

test('CONFIG_STAGING_ACTION_UNKNOWN: فعل سيادي غير معروف في النطاق', () => {
  refusal((s) => {
    s.scope = { permitted_actions: ['fly_to_moon'], forbidden_actions: ['train_model'], max_agents: 8 };
  }, 'CONFIG_STAGING_ACTION_UNKNOWN');
});

test('CONFIG_STAGING_ACTION_DUPLICATE: فعل معلن مرتين — عدّ مضلِّل', () => {
  refusal((s) => {
    s.scope = {
      permitted_actions: ['create_agent', 'create_agent'],
      forbidden_actions: ['train_model'], max_agents: 8,
    };
  }, 'CONFIG_STAGING_ACTION_DUPLICATE');
});

test('CONFIG_STAGING_ACTION_CONTRADICTION: فعل مسموح وممنوع في وقت واحد', () => {
  refusal((s) => {
    s.scope = {
      permitted_actions: ['create_agent'], forbidden_actions: ['create_agent'], max_agents: 8,
    };
  }, 'CONFIG_STAGING_ACTION_CONTRADICTION');
});

test('CONFIG_STAGING_MAX_AGENTS: سقف سكان غير صالح', () => {
  refusal((s) => { s.scope = { ...(s.scope as object), max_agents: 0 }; }, 'CONFIG_STAGING_MAX_AGENTS');
});

test('CONFIG_STAGING_NO_CRITICAL_KINDS: شرطٌ يقول «بلا حادث حرج» بلا تعريف للحرج', () => {
  refusal((s) => { s.severity = { critical: [], high: ['overdue_batch'] }; }, 'CONFIG_STAGING_NO_CRITICAL_KINDS');
});

test('CONFIG_STAGING_INCIDENT_UNKNOWN: حادث غير معروف في التصنيف', () => {
  refusal((s) => {
    s.severity = { critical: [...STAGING_MUST_BE_CRITICAL, 'meteor_strike'], high: ['overdue_batch'] };
  }, 'CONFIG_STAGING_INCIDENT_UNKNOWN');
});

test('CONFIG_STAGING_SEVERITY_CONTRADICTION: حادث حرج وجسيم في وقت واحد', () => {
  refusal((s) => {
    s.severity = { critical: [...STAGING_MUST_BE_CRITICAL], high: [`${STAGING_MUST_BE_CRITICAL[0]}`] };
  }, 'CONFIG_STAGING_SEVERITY_CONTRADICTION');
});

test('CONFIG_STAGING_CRITICAL_DOWNGRADED: حادث لا يجوز تصنيفه دون حرج', () => {
  refusal((s) => {
    s.severity = { critical: STAGING_MUST_BE_CRITICAL.slice(1), high: ['overdue_batch'] };
  }, 'CONFIG_STAGING_CRITICAL_DOWNGRADED');
});

test('CONFIG_STAGING_NO_TOLERANCE: سقوف التسامح غير معلنة', () => {
  refusal((s) => { s.tolerance = null; }, 'CONFIG_STAGING_NO_TOLERANCE');
});

test('CONFIG_STAGING_CRITICAL_TOLERATED: سقفٌ يسمح بحادث حرج واحد يُبطل شرط القبول', () => {
  refusal((s) => {
    s.tolerance = { ...(s.tolerance as object), max_critical: 1 };
  }, 'CONFIG_STAGING_CRITICAL_TOLERATED');
});

test('CONFIG_STAGING_UNWATCHED_TOLERATED: حرس معلن لم يمسح قطّ يُتسامح معه', () => {
  refusal((s) => {
    s.tolerance = { ...(s.tolerance as object), max_unwatched: 1 };
  }, 'CONFIG_STAGING_UNWATCHED_TOLERATED');
});

test('CONFIG_STAGING_FAILED_TICK_TOLERATED: مسحة انهارت يُتسامح معها', () => {
  refusal((s) => {
    s.tolerance = { ...(s.tolerance as object), max_failed_ticks: 2 };
  }, 'CONFIG_STAGING_FAILED_TICK_TOLERATED');
});

test('CONFIG_STAGING_NO_WATCHES: مراقبة بلا ماسح انتظارٌ لا مراقبة', () => {
  refusal((s) => { s.watches = null; }, 'CONFIG_STAGING_NO_WATCHES');
});

test('CONFIG_STAGING_WATCH_UNKNOWN: حرس غير معروف', () => {
  refusal((s) => {
    s.watches = [...STAGING_REQUIRED_WATCHES, 'weather'];
  }, 'CONFIG_STAGING_WATCH_UNKNOWN');
});

test('CONFIG_STAGING_WATCH_DUPLICATE: حرس معلن مرتين', () => {
  refusal((s) => {
    s.watches = [...STAGING_REQUIRED_WATCHES, `${STAGING_REQUIRED_WATCHES[0]}`];
  }, 'CONFIG_STAGING_WATCH_DUPLICATE');
});

test('CONFIG_STAGING_REQUIRED_WATCH_MISSING: شرط القبول يوجب حرس النطاق وحرس السلسلة', () => {
  refusal((s) => {
    s.watches = STAGING_KNOWN_WATCHES.filter((w) => !STAGING_REQUIRED_WATCHES.includes(w));
  }, 'CONFIG_STAGING_REQUIRED_WATCH_MISSING');
});

test('CONFIG_STAGING_RUNBOOK_OPTIONAL: كتابٌ يُقرأ ولا يُنفَّذ', () => {
  refusal((s) => { s.require_runbook_execution = false; }, 'CONFIG_STAGING_RUNBOOK_OPTIONAL');
});

test('CONFIG_STAGING_NO_RUNBOOKS: لا كتاب تشغيل معلن', () => {
  refusal((s) => { s.runbooks = null; }, 'CONFIG_STAGING_NO_RUNBOOKS');
});

test('CONFIG_STAGING_RUNBOOK_UNKNOWN: كتاب تشغيل غير معروف', () => {
  refusal((s) => { s.runbooks = [`${STAGING_KNOWN_RUNBOOKS[0]}`, 'how-to-win']; }, 'CONFIG_STAGING_RUNBOOK_UNKNOWN');
});

test('CONFIG_STAGING_RUNBOOK_DUPLICATE: كتاب معلن مرتين', () => {
  refusal((s) => {
    s.runbooks = [`${STAGING_KNOWN_RUNBOOKS[0]}`, `${STAGING_KNOWN_RUNBOOKS[0]}`];
  }, 'CONFIG_STAGING_RUNBOOK_DUPLICATE');
});

test('CONFIG_STAGING_OBSERVER_OPTIONAL: المراقبة المستقلة شرط لا خيار', () => {
  refusal((s) => { s.require_independent_observer = false; }, 'CONFIG_STAGING_OBSERVER_OPTIONAL');
});

test('CONFIG_STAGING_CRITICAL_CONTINUES: حادث حرج يُواصَل عليه التشغيل', () => {
  refusal((s) => { s.halt_on_critical = false; }, 'CONFIG_STAGING_CRITICAL_CONTINUES');
});

test('CONFIG_STAGING_BREACH_SILENT: خرق نافذة بلا تصعيد', () => {
  refusal((s) => { s.escalate_on_breach = false; }, 'CONFIG_STAGING_BREACH_SILENT');
});

test('CONFIG_STAGING_TICK_UNDER_CHANNEL_MAX: مسحة أسرع من أقصى زمن أمر معلن في load.yaml', () => {
  const channelMax = loadLoad().policy.channel_max_ms;
  refusal((s) => {
    s.window = { duration_ms: 1200, tick_ms: channelMax - 1, min_ticks: 2 };
  }, 'CONFIG_STAGING_TICK_UNDER_CHANNEL_MAX');
});

test('CONFIG_STAGING_WINDOW_UNDER_SAFE_STOP: نافذة أقصر من مهلة التوقف الآمن في chaos.yaml', () => {
  const deadline = loadChaos().policy.safe_stop_deadline_ms;
  const tick = loadLoad().policy.channel_max_ms;
  refusal((s) => {
    s.window = { duration_ms: deadline - 1, tick_ms: tick, min_ticks: 1 };
  }, 'CONFIG_STAGING_WINDOW_UNDER_SAFE_STOP');
});

test('CONFIG_STAGING_AGENTS_OVER_POPULATION: قيدٌ أرخى من السقف السكاني الأصلي', () => {
  const populationMax = loadQuotas().agents.population_max;
  refusal((s) => {
    s.scope = { ...(s.scope as object), max_agents: populationMax + 1 };
  }, 'CONFIG_STAGING_AGENTS_OVER_POPULATION');
});

test('الحوادث الواجب كونها حرجة كلها معروفة ومعلنة في تهيئة المستودع', () => {
  const critical = repoPolicy().severity.critical;
  for (const kind of STAGING_MUST_BE_CRITICAL) {
    assert.equal(STAGING_KNOWN_INCIDENTS.includes(kind), true);
    assert.equal(critical.includes(kind), true);
  }
});
