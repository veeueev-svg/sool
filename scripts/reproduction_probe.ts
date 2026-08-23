/**
 * scripts/reproduction_probe.ts — مسبارُ النسب والتزامن والحمل (المرحلة 39، T-25)
 * المالك: وزارة الداخلية | البند: T-25 — إكمالُ C-11
 * المدخلات: `config/reproduction.yaml` + دولةٌ حقيقيّةٌ مُقلعة (لا محاكاة)
 * المخرجات: قياسٌ خامٌ إلى `docs/audit/measurements/phase-39-T25.txt` وإلى الشاشة
 * التبعيات: `src/index` وحده — لا شبكةَ ولا أدواتَ خارجيّة
 * الصلاحيات: القياسُ وحده. لا يُصلح المسبارُ حدًّا ولا يُعلن استيفاءَ معيار
 * السجلات: الملفُّ نفسه هو السجل (RULE-006) | حالات الفشل: تُدوَّن ولا تُخفى
 * اختبار القبول: tests/agents/lineage.test.ts · tests/agents/spawn_reservations.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 *
 * ثوابتُ هذا المسبار:
 *   1) **يقيس على الدولة المُقلعة لا على وحدةٍ معزولة**: السقفُ الذي يُقاس هو
 *      السقفُ الذي يُنفَّذ في التشغيل، والحدودُ من `config/reproduction.yaml`.
 *   2) **التزامنُ يُقاس بانتظارٍ فعليٍّ بين الحكم والفعل** — وهو ما يفعله أيُّ
 *      كتابةٍ دائمة. بلا ذلك الانتظارِ لا تُرى النافذةُ أصلًا في محرّكٍ ذي خيطٍ واحد.
 *   3) **العتباتُ من التهيئة**: تجاوزُها إفشالٌ معلنٌ لا ملاحظةٌ في هامش.
 *   4) **لا يُعلن المسبارُ استيفاءً.** يُخرج أرقامًا؛ والحكمُ لديوان التدقيق (RULE-004).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bootstrapState, loadReproduction } from '../src/index';
import type { AgentBlueprint } from '../src/index';
import { resolveConfigDir } from '../src/kernel/config';

const configDir = resolveConfigDir();
const repoRoot = dirname(configDir);
const config = loadReproduction(configDir);
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

function declare(s: State, bp: Partial<AgentBlueprint> & { blueprintId: string }): ReturnType<
  State['spawnPolicy']['declareBlueprint']
> {
  return s.spawnPolicy.declareBlueprint(
    s.king.issueCommand('amend_policy', bp.blueprintId),
    {
      template: 'limited_worker', maxInstances: 4, generation: 1,
      purpose: 'قياسُ نسبٍ وتزامنٍ وحملٍ للتوالد', ...bp,
    },
  );
}

async function main(): Promise<void> {
  say('# قياسُ البند T-25 — النسبُ مقيسٌ لا مُدَّعى، والتزامنُ والحملُ بأرقام');
  say(`# التاريخ: ${new Date().toISOString()} · Node ${process.version}`);
  say('# يُعاد توليدُه بـ: npm run probe:reproduction');
  say('');

  const L = config.limits;
  say('## ١) الحدودُ المعلنة (من config/reproduction.yaml — لا من الشيفرة)');
  say(`حدُّ الأجيال=${L.generationMax} · سقفُ الدفعة=${L.batchMax} · في الساعة=${L.perHourMax}`);
  say(`مهلةُ الحجز=${L.reservationTtlMs}ms · أقصى حجوزٍ معلَّقة=${L.maxOutstandingReservations}`);
  say(`عتباتُ الحمل: دفعاتٌ متزامنة=${config.load.concurrentBatches} × ${config.load.batchSize}`
    + ` · سقفُ المخطط=${config.load.blueprintCap} · خرقٌ مسموح=${config.load.maxCapBreach}`
    + ` · p99=${config.load.decisionP99Ms}ms · أقصى=${config.load.decisionMaxMs}ms`);
  say('');

  // ── ٢) النسبُ يُقاس: سلسلةُ اشتقاقٍ تُرفض عند العمق المعلن ───────────────────
  say('## ٢) عمقُ السلسلة يُقاس من النسب لا من الدعوى');
  {
    const s = bootstrapState();
    const chain: string[] = [];
    let refusedAt = 0; let refusal = '';
    let parent: string | null = null;
    for (let depth = 1; depth <= L.generationMax + 3; depth += 1) {
      const id = `bp:depth-${depth}`;
      const d = declare(s, { blueprintId: id, generation: depth, derivedFrom: parent });
      if (d.allowed) { chain.push(id); parent = id; } else if (!refusedAt) { refusedAt = depth; refusal = d.reason; }
    }
    check(
      'سلسلةُ الاشتقاق تُرفض عند تجاوز حدِّ الأجيال',
      chain.length === L.generationMax && refusedAt === L.generationMax + 1,
      `أُعلن=${chain.length} · أولُ رفضٍ عند العمق=${refusedAt} · السبب=${JSON.stringify(refusal)}`,
    );
    const last = chain[chain.length - 1] ?? 'bp:depth-1';
    check(
      'سلسلةُ النسب محفوظةٌ دليلًا على الجيل',
      (s.spawnPolicy.lineageOf(last) ?? []).length === L.generationMax,
      `نسبُ ${last} = ${(s.spawnPolicy.lineageOf(last) ?? []).join(' ← ')}`,
    );
  }
  {
    const s = bootstrapState();
    declare(s, { blueprintId: 'bp:root' });
    const understated = declare(s, { blueprintId: 'bp:liar', generation: 1, derivedFrom: 'bp:root' });
    const overstated = declare(s, { blueprintId: 'bp:liar2', generation: 2, derivedFrom: null });
    const ghost = declare(s, { blueprintId: 'bp:orphan', generation: 2, derivedFrom: 'bp:ghost' });
    const selfParent = declare(s, { blueprintId: 'bp:self', generation: 1, derivedFrom: 'bp:self' });
    check(
      'دعوى الجيل المخالفةُ للنسب مرفوضةٌ في الاتجاهين',
      understated.allowed === false && overstated.allowed === false,
      `مُنقِصٌ=${JSON.stringify(understated.reason)} · مُبالِغٌ=${JSON.stringify(overstated.reason)}`,
    );
    check(
      'أصلٌ غيرُ معلنٍ أو أصلٌ هو نفسُه مرفوضان',
      ghost.allowed === false && selfParent.allowed === false,
      `أصلٌ مجهول=${JSON.stringify(ghost.reason)} · أصلُ نفسه=${JSON.stringify(selfParent.reason)}`,
    );
    const drift = s.spawnPolicy.verifyLineage();
    check('كلُّ جيلٍ معلنٍ مطابقٌ لنسبِه المقيس', drift.ok, `انحرافات=${drift.drifts.length}`);
  }
  say('');

  // ── ٣) التزامن: انتظارٌ فعليٌّ بين الحكم والفعل ────────────────────────────
  say('## ٣) التزامنُ: نافذةُ «فحصٌ ثم فعل» مقيسةٌ بانتظارٍ حقيقيّ');
  {
    const s = bootstrapState();
    const CAP = 5;
    declare(s, { blueprintId: 'bp:race', maxInstances: CAP });
    const facts = { blueprintId: 'bp:race', count: CAP, requestedBy: 'ministry:interior', population: 0, populationMax: 1000 };

    // الطريقُ القديم: حكمٌ ثم انتظارٌ ثم تقييد
    const legacy: number[] = await Promise.all([1, 2, 3, 4].map(async (): Promise<number> => {
      const verdict = s.spawnPolicy.evaluate(facts);
      if (!verdict.allowed) return 0;
      await new Promise((r) => setImmediate(r));
      return s.spawnPolicy.recordSpawn('bp:race', CAP) ? CAP : 0;
    }));
    const legacyTotal = legacy.reduce((a: number, b: number) => a + b, 0);
    check(
      'الطريقُ المتزامن لا يتجاوز السقف — التقييدُ نفسُه ذرّيٌّ ويرفض فوق السقف',
      s.spawnPolicy.instancesOf('bp:race') === CAP && legacyTotal === CAP,
      `سقف=${CAP} · حكمٌ سُمح له=${legacy.filter((n) => n > 0).length}/4`
      + ` · مُثبَّتٌ فعلًا=${s.spawnPolicy.instancesOf('bp:race')} · الخرق=${s.spawnPolicy.instancesOf('bp:race') - CAP}`,
    );
  }
  {
    const s = bootstrapState();
    const CAP = 6;
    declare(s, { blueprintId: 'bp:reserve', maxInstances: CAP });
    const facts = (count: number) => ({
      blueprintId: 'bp:reserve', count, requestedBy: 'ministry:interior',
      population: 0, populationMax: 1000,
    });
    const held = await Promise.all([3, 3, 3, 3].map(async () => {
      const r = s.spawnPolicy.reserveBatch(facts(3));
      if (!r.allowed) return { granted: false as const };
      await new Promise((res) => setImmediate(res));
      s.spawnPolicy.commitReservation(r.reservation.reservationId);
      return { granted: true as const };
    }));
    const granted = held.filter((h) => h.granted).length;
    check(
      'الحجزُ يخصم لحظةَ الحكم فلا يُرى نصيبٌ محجوزٌ متاحًا',
      granted === 2 && s.spawnPolicy.instancesOf('bp:reserve') === CAP,
      `سقف=${CAP} · حجوزٌ مُنحت=${granted}/4 · مُثبَّت=${s.spawnPolicy.instancesOf('bp:reserve')}`,
    );
  }
  {
    const s = bootstrapState();
    declare(s, { blueprintId: 'bp:ttl', maxInstances: 2 });
    const t0 = Date.now();
    const facts = { blueprintId: 'bp:ttl', count: 2, requestedBy: 'ministry:interior', population: 0, populationMax: 100 };
    const first = s.spawnPolicy.reserveBatch(facts, t0);
    const blockedWhileHeld = s.spawnPolicy.reserveBatch(facts, t0 + 1);
    const afterExpiry = s.spawnPolicy.reserveBatch(facts, t0 + L.reservationTtlMs + 1);
    check(
      'حجزٌ لم يُثبَّت يسقط بمهلته ويعيد نصيبَه — لا تسريبَ دائمًا في النصيب',
      first.allowed && !blockedWhileHeld.allowed && afterExpiry.allowed,
      `أولُ حجز=${first.allowed} · بينما هو قائمٌ=${blockedWhileHeld.allowed}`
      + ` · بعد ${L.reservationTtlMs}ms=${afterExpiry.allowed} · حجوزٌ ساقطة=${s.spawnPolicy.report().expiredReservations}`,
    );
    const settled = s.spawnPolicy.commitReservation(
      first.allowed ? first.reservation.reservationId : 'x', t0 + L.reservationTtlMs + 2,
    );
    check(
      'تسويةُ حجزٍ ساقطٍ مرفوضة — لا نصيبَ يُثبَّت مرّتين',
      settled === false,
      `تثبيتُ حجزٍ منتهي المهلة=${settled}`,
    );
  }
  say('');

  // ── ٤) الحمل: على السياسة نفسها ثم عبر المصنع الحقيقي ──────────────────────
  say('## ٤-أ) الحملُ على السياسة: حجوزٌ متزامنةٌ ضدّ سقفٍ واحد');
  {
    const s = bootstrapState();
    const { concurrentBatches, batchSize, blueprintCap } = config.load;
    declare(s, { blueprintId: 'bp:load', maxInstances: blueprintCap });
    const facts = {
      blueprintId: 'bp:load', count: batchSize, requestedBy: 'ministry:interior',
      population: 0, populationMax: 1_000_000,
    };
    const latencies: number[] = [];
    let granted = 0; let denied = 0;
    const t0 = process.hrtime.bigint();
    await Promise.all(Array.from({ length: concurrentBatches }, async () => {
      await new Promise((r) => setImmediate(r));
      const start = process.hrtime.bigint();
      const held = s.spawnPolicy.reserveBatch(facts);
      latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
      if (!held.allowed) { denied += 1; return; }
      granted += 1;
      await new Promise((r) => setImmediate(r));
      s.spawnPolicy.commitReservation(held.reservation.reservationId);
    }));
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p99 = percentile(sorted, 99);
    const max = sorted[sorted.length - 1] ?? 0;
    const created = s.spawnPolicy.instancesOf('bp:load');
    const breach = Math.max(0, created - blueprintCap);
    const expected = Math.floor(blueprintCap / batchSize);

    check(
      'خرقُ السقف تحت الحمل المتزامن',
      breach <= config.load.maxCapBreach,
      `طالبون=${concurrentBatches}×${batchSize} · سُمح=${granted} · رُفض=${denied}`
      + ` · سقف=${blueprintCap} · مُثبَّتٌ=${created} · الخرق=${breach}`,
    );
    check(
      'المسموحُ يساوي حصّةَ السقف بالتمام — لا نقصَ ولا زيادة',
      created === blueprintCap && granted === expected,
      `مُتوقَّعٌ سماحُه=${expected} دفعة (${blueprintCap} نسخة) · الواقع=${granted} (${created})`,
    );
    check(
      'زمنُ الحكم تحت الحمل داخل العتبة المعلنة',
      p99 <= config.load.decisionP99Ms && max <= config.load.decisionMaxMs,
      `p99=${p99.toFixed(3)}ms (العتبة ${config.load.decisionP99Ms}) · أقصى=${max.toFixed(3)}ms`
      + ` (العتبة ${config.load.decisionMaxMs}) · وسيط=${percentile(sorted, 50).toFixed(3)}ms`
      + ` · المجموع=${elapsed.toFixed(1)}ms`,
    );
    const report = s.spawnPolicy.report();
    check(
      'لا حجزَ معلَّقٌ بعد انتهاء الحمل — كلُّ نصيبٍ سُوّي',
      report.outstandingReservations === 0,
      `معلَّق=${report.outstandingReservations} · ساقطٌ بمهلته=${report.expiredReservations}`
      + ` · تقييدٌ بلا حجز=${report.unreservedRecords}`,
    );
  }
  say('');

  say('## ٤-ب) الحملُ عبر مصنع الوكلاء الحقيقي — والقيدُ الحاكمُ يُعلن لا يُخفى');
  {
    const s = bootstrapState();
    const { concurrentBatches, batchSize, blueprintCap } = config.load;
    declare(s, { blueprintId: 'bp:factory', maxInstances: blueprintCap });
    let granted = 0; let denied = 0; let firstDenial = '';
    await Promise.all(Array.from({ length: concurrentBatches }, async (_unused, i) => {
      await new Promise((r) => setImmediate(r));
      const result = s.factory.spawn(
        s.king.issueCommand('create_agent', `load-${i}`),
        {
          blueprintId: 'bp:factory', count: batchSize,
          requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
        },
      );
      if (result.ok) granted += 1;
      else { denied += 1; if (!firstDenial) firstDenial = result.reason; }
    }));
    const created = s.spawnPolicy.instancesOf('bp:factory');
    const alive = s.agents.report().population;
    check(
      'الطريقُ الكاملُ لا يخرق سقفَ المخطط ولا سقفَ سجل الوكلاء',
      created <= blueprintCap && Math.max(0, created - blueprintCap) <= config.load.maxCapBreach,
      `طالبون=${concurrentBatches}×${batchSize} · سُمح=${granted} · رُفض=${denied}`
      + ` · مُثبَّتٌ=${created} · سكانٌ أحياء=${alive} · أولُ رفض=${JSON.stringify(firstDenial)}`,
    );
    check(
      'القيدُ الحاكمُ هنا سقفُ التوالد الدقيقيُّ في سجل الوكلاء لا سقفُ المخطط',
      firstDenial.includes('سقف التوالد'),
      'سقفُ ٤/دقيقة في config/quotas.yaml يسبق سقفَ المخطط — قيدٌ سياديٌّ أضيق سابقٌ لهذا البند',
    );
    const report = s.spawnPolicy.report();
    check(
      'كلُّ دفعةٍ ملغاةٍ أفرجت عن حجزها — لا نصيبَ يتسرّب بالإلغاء',
      report.outstandingReservations === 0 && report.unreservedRecords === 0 && created === alive,
      `دفعاتٌ ملغاة=${denied} · حجزٌ معلَّق=${report.outstandingReservations}`
      + ` · تقييدٌ بلا حجز=${report.unreservedRecords} · مُثبَّتٌ=${created} مقابل أحياء=${alive}`,
    );
  }
  say('');

  say('## الخلاصة (قياسٌ لا حكم)');
  say('الجيلُ صار مقيسًا من النسب: سلسلةُ اشتقاقٍ تُرفض عند العمق المعلن، ودعوى الجيل');
  say('المخالفةُ للنسب مرفوضةٌ في الاتجاهين. والنصيبُ يُخصم لحظةَ الحكم لا بعده، فالحملُ');
  say('المتزامنُ لا يخرق السقفَ ولو نسخةً واحدة. وحكمُ C-11 لديوان التدقيق لا للمنفّذ.');
  say('');
  say(`إجمالي الفحوص: ${lines.filter((l) => l.startsWith('PASS') || l.startsWith('FAIL')).length}`
    + ` · ساقطة: ${failures}`);

  const target = join(repoRoot, 'docs/audit/measurements/phase-39-T25.txt');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`\nالقياسُ محفوظٌ في: ${target}\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
