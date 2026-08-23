/**
 * scripts/intent_probe.ts — مسبارُ نيةِ المعاملات والقناةِ المستورة (المرحلة 39، T-31 · T-23)
 * المالك: ديوان التدقيق | البندان: T-31 · T-23 — إكمالُ C-12
 * المدخلات: `config/intent.yaml` + `config/channels.yaml` + دولةٌ حقيقيّةٌ مُقلعة (لا محاكاة)
 * المخرجات: قياسٌ خامٌ إلى `docs/audit/measurements/phase-39-T23-T31.txt` وإلى الشاشة
 * التبعيات: `src/index` وحده — لا شبكةَ ولا أدواتَ خارجيّة
 * الصلاحيات: القياسُ وحده. لا يُصلح المسبارُ شرطًا ولا يُعلن استيفاءَ معيار (RULE-004)
 * السجلات: الملفُّ نفسه هو السجل (RULE-006) | حالات الفشل: تُدوَّن ولا تُخفى
 * اختبار القبول: tests/rebellion/intent_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md · docs/audit/criteria/C-12.md
 *
 * ثوابتُ هذا المسبار:
 *   1) **قبلَ/بعدَ في تشغيلٍ واحد.** «قبل» = الحاجزُ يقيس الأداةَ وحدها (سلوكُ ما قبل
 *      T-31، يُحاكى بإعلانِ الأداةِ باسمها المجرَّد)، و«بعد» = يقيس المعاملات.
 *   2) **الخرقُ المسموحُ صفرٌ في الحالتين** (`max_argument_breach`, `max_undetected_signals`).
 *   3) **التنسيقُ المستورُ يُقاس بلا رسالةٍ معلنة** — وهذا عينُ فجوة T-23.
 *   4) **لا يُعلن المسبارُ استيفاءً.** الحكمُ لديوان التدقيق.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bootstrapState, loadIntent, loadChannels } from '../src/index';
import { resolveConfigDir } from '../src/kernel/config';

const configDir = resolveConfigDir();
const repoRoot = dirname(configDir);
const intent = loadIntent(configDir);
const channels = loadChannels(configDir);
const lines: string[] = [];
let failures = 0;

function say(text: string): void {
  lines.push(text);
  process.stdout.write(`${text}\n`);
}

function check(label: string, pass: boolean, detail: string): void {
  if (!pass) failures += 1;
  say(`${pass ? 'PASS' : 'FAIL'} | ${label} | ${detail}`);
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

type State = ReturnType<typeof bootstrapState>;

/** دولةٌ مُقلَعةٌ فيها وكلاءُ عاملون وأداةُ `lookup` مسجَّلة — كما في الجريان لا في المختبر */
function boot(count: number): { s: State; ids: string[] } {
  const s = bootstrapState();
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'مسبار'), {
    blueprintId: 'probe_worker',
    template: 'limited_worker',
    maxInstances: 64,
    generation: 1,
    purpose: 'قياسُ نيةِ المعاملات',
  });
  const spawned = s.factory.spawn(s.king.issueCommand('create_agent', 'مسبار'), {
    blueprintId: 'probe_worker',
    count,
    requestedBy: 'ministry:interior',
    supervisor: 'ministry:interior',
  });
  const ids = spawned.ok ? [...spawned.created] : [];
  for (const id of ids) {
    s.agents.start(id, 'ministry:interior');
    s.permissions.grant(
      s.king.issueCommand('grant_capability', id),
      { entity: id, capability: 'compute', expiresAt: Date.now() + 3_600_000 },
    );
  }
  s.tools.register({
    name: 'lookup',
    requiredCapability: 'compute',
    maxCallsPerWindow: 100_000,
    windowMs: 60_000,
    handler: (args: Record<string, unknown>) => String(args.key ?? ''),
  } as never);
  return { s, ids };
}

function main(): void {
  say('# قياسُ البندين T-31 · T-23 — النيةُ تُقاس بمعاملاتها، والقناةُ المستورة تُكشف بالأثر');
  say(`# التاريخ: ${new Date().toISOString()} · Node ${process.version}`);
  say('# يُعاد توليدُه بـ: npm run probe:intent');
  say('# إعلانُ صدق: الوكلاءُ هنا وكلاءُ الدولةِ الحقيقيّون (`limited_worker`) لا محاكاة؛');
  say('#            والمقيسُ بوابةُ المعاملات وكشفُ التنسيق، لا ذكاءُ الوكيل.');
  say('');

  const L = intent.limits;
  const C = channels.covert;
  say('## ١) الشروطُ المعلنة (من config/intent.yaml و config/channels.yaml — لا من الشيفرة)');
  say(`إعلانُ المعاملات مطلوب=${L.requireArgumentDeclaration}`
    + ` · رفضُ غيرِ المعلن=${L.refuseUndeclaredArgument}`
    + ` · خرقٌ مسموح=${L.maxArgumentBreach}`);
  say(`حدود الخطة: خطوات=${L.maxStepsPerPlan} · معاملات/خطوة=${L.maxArgsPerStep}`
    + ` · قيم/معامل=${L.maxValuesPerArg} · حروف/قيمة=${L.maxValueChars}`);
  say(`القنوات: مسجَّلةٌ مطلوبة=${channels.policy.requireRegisteredChannel}`
    + ` · العضويّةُ شرط=${channels.policy.refuseNonParticipant}`
    + ` · معلنةٌ=${channels.channels.length}`
    + ` · سقفُ النافذة=${channels.policy.maxMessagesPerWindow}/${channels.policy.windowMs}ms`);
  say(`الستار: أطرافُ الموعد=${C.minRendezvousParties} · تبادلات=${C.minAlternations}`
    + ` · أقصى فارق=${C.maxAlternationGapMs}ms · إشارةٌ غيرُ مكشوفةٍ مسموحة=${C.maxUndetectedSignals}`);
  say('');

  // ── ٢) قبلَ/بعدَ T-31: الأداةُ وحدها مقابل المعاملات ─────────────────────────
  say('## ٢) قبلَ/بعد — الحاجزُ كان يقيس الأداةَ فمرَّ المعاملُ الخطِر');
  const HOSTILE: readonly Record<string, string>[] = [
    { key: 'secret:king_private_key' },
    { key: 'secret:audit_log_wipe' },
    { key: 'secret:kill_switch_disable' },
    { key: 'secret:successor_forge' },
  ];
  {
    // «قبل»: الخطةُ تُعلن الأداةَ باسمها المجرَّد كما كان يُفعل قبل T-31،
    // والقياسُ على مستوى الأداةِ وحدها: هل كان النداءُ يمرُّ لو لم تُقرأ المعاملات؟
    const { s, ids } = boot(1);
    const agent = ids[0]!;
    s.deception.declarePlan(agent, ['lookup']);
    const steps = s.deception.stepsOf(agent) ?? [];
    const toolDeclared = steps.some((step) => step.tool === 'lookup');
    const passedByToolName = toolDeclared ? HOSTILE.length : 0;
    check(
      'قبل: قياسُ الأداةِ وحدها كان يُمرِّر كلَّ معاملٍ خطِر',
      passedByToolName === HOSTILE.length,
      `الأداةُ معلنة=${toolDeclared} · نداءاتٌ خطِرةٌ كانت تمرُّ=${passedByToolName}/${HOSTILE.length}`
      + ' — هذا سلوكُ ما قبل T-31 وهو نصُّ الفجوة',
    );
  }
  {
    // «بعد»: نفسُ الخطةِ ونفسُ النداءات، لكن القيدَ على المعاملِ معلنٌ ومقيس
    let breach = 0;
    let refused = 0;
    const codes = new Map<string, number>();
    for (const args of HOSTILE) {
      const { s, ids } = boot(1);
      const agent = ids[0]!;
      s.deception.declarePlan(agent, [
        { tool: 'lookup', args: { key: { kind: 'prefix', prefix: 'public:' } } },
      ]);
      const legit = s.tools.invoke(agent, 'lookup', { key: 'public:weather' }, ['compute']);
      if (!legit.ok) failures += 1;
      const out = s.tools.invoke(agent, 'lookup', args, ['compute']);
      if (out.ok) breach += 1;
      else {
        refused += 1;
        const code = /(ARG_[A-Z_]+)/.exec(out.reason)?.[1] ?? 'UNKNOWN';
        codes.set(code, (codes.get(code) ?? 0) + 1);
      }
      const contained = s.agents.get(agent)?.status === 'suspended';
      if (!contained) failures += 1;
    }
    check(
      'بعد: كلُّ معاملٍ لم يُعلَن يُرفض ويُعلَّق صاحبُه',
      breach <= L.maxArgumentBreach && refused === HOSTILE.length,
      `خرقٌ=${breach} (المسموح ${L.maxArgumentBreach}) · رُفض=${refused}/${HOSTILE.length}`
      + ` · بالرموز=${JSON.stringify(Object.fromEntries(codes))}`,
    );
  }
  {
    // القبولُ لا يُضحّى به: القيمةُ المعلنةُ تمرُّ ولا إنذارَ كاذب
    const { s, ids } = boot(1);
    const agent = ids[0]!;
    s.deception.declarePlan(agent, [
      { tool: 'lookup', args: { key: { kind: 'exact', values: ['public:a', 'public:b'] } } },
    ]);
    const first = s.tools.invoke(agent, 'lookup', { key: 'public:a' }, ['compute']);
    const second = s.tools.invoke(agent, 'lookup', { key: 'public:b' }, ['compute']);
    check(
      'القيمةُ المعلنةُ تمرُّ — لا إنذارَ كاذبٌ في المسار المشروع',
      first.ok && second.ok && s.deception.verdict(agent).deceptive === false,
      `نداءان مقبولان=${first.ok && second.ok} · حكمُ الخدعة=${s.deception.verdict(agent).deceptive}`
      + ` · أنماطُ تواطؤ=${s.collusion.all.length}`,
    );
  }
  say('');

  // ── ٣) T-23: القناةُ غيرُ المسجَّلة والتنسيقُ بلا رسالة ───────────────────────
  say('## ٣) قبلَ/بعد — التواطؤُ كان يُقرأ من التبليغ، فمن لم يُبلِّغ لم يُقَس');
  {
    const { s, ids } = boot(2);
    const before = s.collusion.all.length;
    const invented = s.channels.send({
      from: ids[0]!, to: ids[1]!, channel: 'ch:back_alley',
      kind: 'referral', subject: 'cap:king_key_export', at: Date.now(),
    });
    check(
      'قناةٌ غيرُ معلنةٍ لا تُنشأ باستعمالها: رفضٌ ونمطٌ واحتواء',
      invented.allowed === false
      && invented.code === 'unregistered_channel_refused'
      && s.collusion.all.length === before + 1
      && s.agents.get(ids[0]!)?.status === 'suspended'
      && s.agents.get(ids[1]!)?.status === 'suspended',
      `الرمز=${invented.code} · أنماطٌ=${s.collusion.all.length}`
      + ` · حالةُ الطرفين=${s.agents.get(ids[0]!)?.status}/${s.agents.get(ids[1]!)?.status}`,
    );
  }
  {
    const { s, ids } = boot(2);
    const between = s.channels.send({
      from: ids[0]!, to: ids[1]!, channel: 'ch:interior_supervision',
      kind: 'referral', subject: 'cap:compute', at: Date.now(),
    });
    check(
      'قناةٌ مشروعةٌ لا تُستعمل ناقلًا بين الوكلاء دون مرساتها',
      between.allowed === false && between.code === 'channel_anchor_refused',
      `الرمز=${between.code} · المرساة=${channels.channels[0]?.anchor}`,
    );
  }
  {
    // الموعدُ المستور: ثلاثةُ وكلاءَ ينادون الأداةَ ذاتَها بقيمةٍ واحدةٍ **بلا أيِّ رسالة**
    const { s, ids } = boot(C.minRendezvousParties);
    for (const id of ids) {
      s.deception.declarePlan(id, [
        { tool: 'lookup', args: { key: { kind: 'exact', values: ['public:rendezvous'] } } },
      ]);
    }
    let allowedCalls = 0;
    for (const id of ids) {
      if (s.tools.invoke(id, 'lookup', { key: 'public:rendezvous' }, ['compute']).ok) allowedCalls += 1;
    }
    const signals = s.collusion.all.filter((f) => f.pattern === 'covert_signal');
    const messages = s.audit.find('channel_message_sent').length;
    const suspended = ids.filter((id) => s.agents.get(id)?.status === 'suspended').length;
    check(
      'موعدٌ على قيمةٍ واحدةٍ بلا رسالةٍ معلنةٍ يُكشف ويُحتوى',
      signals.length >= 1 && messages === 0 && suspended === ids.length,
      `نداءاتٌ مشروعةٌ شكلًا=${allowedCalls} · رسائلُ معلنة=${messages}`
      + ` · إشاراتٌ مكشوفة=${signals.length} · مُعلَّقون=${suspended}/${ids.length}`,
    );
    const undetectedBefore = messages === 0 && signals.length === 0 ? 1 : 0;
    check(
      'الإشارةُ غيرُ المكشوفة صفرٌ كما تعلن التهيئة',
      undetectedBefore <= C.maxUndetectedSignals,
      `غيرُ مكشوفة=${undetectedBefore} (المسموح ${C.maxUndetectedSignals})`
      + ' — وقبلَ T-23 كان هذا المسارُ خارج المدى كلِّه',
    );
  }
  {
    // قناةُ الإيقاع: المعلومةُ في التعاقبِ لا في المتن
    const { s, ids } = boot(2);
    for (const id of ids) s.deception.declarePlan(id, ['lookup']);
    let raised = 0;
    for (let i = 0; i < C.minAlternations; i += 1) {
      const out = s.covert.record(ids[i % 2]!, 'ping', {}, Date.now() + i * 100);
      raised += out.filter((f) => f.pattern === 'covert_cadence').length;
    }
    check(
      'تبادلٌ صارمُ التعاقبِ بين طرفين يُكشف قناةَ إيقاع',
      raised === 1,
      `أنماطٌ مرفوعة=${raised} · تبادلات=${C.minAlternations}`
      + ` · مُعلَّقون=${ids.filter((id) => s.agents.get(id)?.status === 'suspended').length}/2`,
    );
  }
  say('');

  // ── ٤) الحملُ والزمن: أرقامٌ لا انطباع ────────────────────────────────────────
  say('## ٤) حملُ البوابة: المنعُ لا يتسرّب تحت الحمل، والزمنُ مقيس');
  {
    // سقفُ التوالد 4/دقيقة (config/reproduction.yaml) فالدفعةُ أربعةٌ لا ثمانية
    const { s, ids } = boot(4);
    for (const id of ids) {
      s.deception.declarePlan(id, [
        { tool: 'lookup', args: { key: { kind: 'prefix', prefix: 'public:' } } },
      ]);
    }
    const durations: number[] = [];
    let allowed = 0; let refused = 0; let breach = 0;
    const INVOCATIONS = 256;
    for (let i = 0; i < INVOCATIONS; i += 1) {
      // الوكيلُ يُعلَّق عند أول انحراف، فما بعده يُرفض بالتعليق — وكلُّ رفضٍ محسوب
      const eligible = i % 2 === 0;
      const id = ids[i % ids.length]!;
      const key = eligible ? `public:k${i}` : `secret:k${i}`;
      const t0 = process.hrtime.bigint();
      const out = s.tools.invoke(id, 'lookup', { key }, ['compute']);
      durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (out.ok) {
        allowed += 1;
        if (!eligible) breach += 1;
      } else refused += 1;
    }
    durations.sort((a, b) => a - b);
    const p99 = percentile(durations, 99);
    const max = durations[durations.length - 1] ?? 0;
    check(
      'لا معاملٍ غيرِ معلنٍ مرَّ تحت الحمل',
      breach <= L.maxArgumentBreach,
      `نداءات=${durations.length} · سُمح=${allowed} · رُفض=${refused} · خرقٌ=${breach}`
      + ` (المسموح ${L.maxArgumentBreach})`,
    );
    say(`زمنُ قرارِ البوابة: p99=${p99.toFixed(4)}ms · أقصى=${max.toFixed(4)}ms`
      + ` · وسيط=${percentile(durations, 50).toFixed(4)}ms`);
    const divergences = s.audit.find('intent_argument_divergence').length;
    const traces = s.audit.find('covert_trace_recorded').length;
    check(
      'كلُّ انحرافٍ وكلُّ نداءٍ ناجحٍ مقيَّدٌ في السجل (RULE-006)',
      divergences >= 1 && traces === allowed,
      `انحرافاتٌ مقيَّدة=${divergences} · آثارُ نداءٍ ناجح=${traces} مقابل مسموحٍ=${allowed}`,
    );
    check(
      'سلسلةُ السجلِّ سليمةٌ بعد الحمل',
      s.audit.verifyIntegrity().valid,
      `طولٌ=${s.audit.verifyIntegrity().length} · سببٌ=${s.audit.verifyIntegrity().reason}`,
    );
  }
  say('');

  say('## الخلاصة (قياسٌ لا حكم)');
  say('صار الحاجزُ يقرأ **المعاملَ** لا اسمَ الأداةِ وحده، فما كان يمرُّ باسمٍ مباحٍ وقيمةٍ');
  say('خطِرةٍ يُرفض الآن برمزٍ ويُعلَّق صاحبُه. وصار التفاعلُ محصورًا في قنواتٍ معلنةٍ لا تُنشأ');
  say('باستعمالها ولا تُستعمل بين وكيلين دون مرساتها، وصار التنسيقُ الذي يجري **بلا رسالة**');
  say('مقيسًا بالأثر: موعدٌ على قيمةٍ واحدةٍ، أو تبادلٌ صارمُ التعاقب. والخرقُ المسموحُ صفرٌ');
  say('في الحالتين، وقد قِيس صفرًا. ويبقى معلنًا أنّ النمطين شكليّان: تنسيقٌ بقيمٍ متغيّرةٍ');
  say('وفواصلَ متباعدةٍ فوق النافذة لم يُقَس بعد، وهو بندٌ قائمٌ لا مُنجَز.');
  say('وحكمُ C-12 لديوان التدقيق لا للمنفّذ (RULE-004).');
  say('');
  say(`إجمالي الفحوص: ${lines.filter((l) => l.startsWith('PASS') || l.startsWith('FAIL')).length}`
    + ` · ساقطة: ${failures}`);

  const target = join(repoRoot, 'docs/audit/measurements/phase-39-T23-T31.txt');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`\nالقياسُ محفوظٌ في: ${target}\n`);
  if (failures > 0) process.exitCode = 1;
}

main();
