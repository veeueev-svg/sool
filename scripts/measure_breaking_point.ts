/**
 * scripts/measure_breaking_point.ts — قياس نقطة الانهيار فوق السقوف المعلنة (T-91)
 * المالك: ديوان التدقيق | المدخلات: config/load.yaml + دولة محلية | المخرجات: أرقام مقيسة خام
 *
 * سياسة القياس المنفصلة (T-91):
 *   1) كلُّ مستوى حملٍ يُنشئ دولةً جديدة على دليل مؤقت — لا أثر متبقٍّ على الإنتاج
 *   2) لا تُعدَّل تهيئةٌ ولا حدٌّ معلن: السقوف في config/load.yaml لا تُلمس
 *   3) القياس يستخدم القناة والمجدول مباشرة — لا يمرُّ عبر LoadDrill الذي يرفض
 *      التجاوز (ثابت 1 في load_drill.ts)، لأن هدفنا قياس الانهيار لا ادعاء اجتيازه
 *   4) نقطة الانهيار = أول مستوى يحقق أحدًا من:
 *      أ) فشل أمر واحد على الأقل (denied أو failed)
 *      ب) p99 > 1000ms (أكثر من 125× المعلن = 8ms)
 *      ج) ذاكرة العملية > 512MiB
 *      د) زمن المعالجة الكلي > 30 ثانية للمستوى
 *   5) الخرج خام: أرقام مقيسة لا حكم. الحكم على المعلن في تمرين السياسة لا هنا
 *
 * ثوابت هذه الوحدة:
 *   1) لا تجاوز للسياسة: القياس يقرأ المعلن ولا يغيّره
 *   2) لا أثر متبقٍّ: كل مستوى على دولة جديدة تُمحى بعد القياس
 *   3) الإحماء معلن ومستبعد: زمن JIT الأول ليس زمن النظام المستقر
 *   4) الخرق يُطبع ولا يُبتلع
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState, CommandChannel, FairScheduler } from '../src/index';

/** مستويات الحمل: المعلن مضاعفًا */
const LOAD_LEVELS = [500, 1000, 2000, 4000, 8000, 16000];

/** عتبات الانهيار */
const BREAK_P99_MS = 1000;
const BREAK_MEMORY_MIB = 512;
const BREAK_TOTAL_SECONDS = 30;

interface LevelResult {
  readonly level: number;
  readonly submitted: number;
  readonly executed: number;
  readonly denied: number;
  readonly failed: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly totalSeconds: number;
  readonly memoryMib: number;
  readonly auditValid: boolean;
  readonly broke: boolean;
  readonly breakReason: string | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

function runLevel(level: number, declaredP99: number, declaredMax: number): LevelResult {
  const dir = mkdtempSync(join(tmpdir(), `sool-break-${level}-`));
  try {
    const now = Date.now();
    const state = bootstrapState({ now, auditPath: join(dir, 'audit.jsonl') });
    const channel = new CommandChannel(
      state.audit, state.gateway, join(dir, 'channel.json'),
    );
    const scheduler = new FairScheduler(
      state.audit, state.killSwitch, 8,
      state.scaleConfig.policy.scheduler_queue_max,
      state.scaleConfig.policy.scheduler_owner_queue_max,
    );
    let counter = 0;
    const issue = () => {
      counter += 1;
      return state.king.issueCommand(
        'create_agent', `agent:break-${level}-${counter}`, { break: counter }, now,
      );
    };

    // الإحماء معلن ومستبعد: 50 أمرًا على قناة منفصلة
    const warmupDir = mkdtempSync(join(tmpdir(), 'sool-warmup-'));
    try {
      const warmupChannel = new CommandChannel(
        state.audit, state.gateway, join(warmupDir, 'warmup.json'),
      );
      for (let i = 0; i < 50; i += 1) {
        warmupChannel.submit(issue());
        warmupChannel.process(() => undefined, now);
      }
    } finally {
      rmSync(warmupDir, { recursive: true, force: true });
    }

    // القياس: إرسال ومعالجة مستوى الحمل
    const latencies: number[] = [];
    let executed = 0;
    let denied = 0;
    let failed = 0;
    const began = process.hrtime.bigint();

    for (let i = 0; i < level; i += 1) {
      const cmdStart = process.hrtime.bigint();
      channel.submit(issue());
      const outcomes = channel.process(() => undefined, now);
      const cmdMs = Number(process.hrtime.bigint() - cmdStart) / 1_000_000;
      latencies.push(cmdMs);
      for (const outcome of outcomes) {
        if (outcome.status === 'executed') executed += 1;
        else if (outcome.status === 'denied') denied += 1;
        else if (outcome.status === 'failed') failed += 1;
      }
    }

    const totalSeconds = Number(process.hrtime.bigint() - began) / 1_000_000_000;
    const memory = process.memoryUsage();
    latencies.sort((a, b) => a - b);

    const p99Ms = percentile(latencies, 99);
    const maxMs = latencies.length > 0 ? latencies[latencies.length - 1]! : 0;
    const meanMs = latencies.length > 0
      ? latencies.reduce((s, v) => s + v, 0) / latencies.length
      : 0;
    const memoryMib = memory.rss / (1024 * 1024);
    const auditValid = state.audit.verifyIntegrity().valid;

    // هل انكسر؟
    let broke = false;
    let breakReason: string | null = null;
    if (failed > 0 || denied > 0) {
      broke = true;
      breakReason = `أوامر فشلت أو رُفضت: denied=${denied} failed=${failed}`;
    } else if (p99Ms > BREAK_P99_MS) {
      broke = true;
      breakReason = `p99=${p99Ms.toFixed(3)}ms يتجاوز ${BREAK_P99_MS}ms`;
    } else if (memoryMib > BREAK_MEMORY_MIB) {
      broke = true;
      breakReason = `ذاكرة=${memoryMib.toFixed(1)}MiB تتتجاوز ${BREAK_MEMORY_MIB}MiB`;
    } else if (totalSeconds > BREAK_TOTAL_SECONDS) {
      broke = true;
      breakReason = `زمن=${totalSeconds.toFixed(3)}s يتجاوز ${BREAK_TOTAL_SECONDS}s`;
    }

    return {
      level, submitted: level, executed, denied, failed,
      p99Ms, maxMs, meanMs, totalSeconds, memoryMib, auditValid, broke, breakReason,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- التشغيل ---
const declaredP99 = 8;
const declaredMax = 60;
const declaredSustained = 500;

console.log('== قياس نقطة الانهيار فوق السقوف المعلنة — T-91 ==');
console.log(`السقوف المعلنة: مستمر=${declaredSustained} · p99=${declaredP99}ms · أقصى=${declaredMax}ms`);
console.log(`عتبات الانهيار: p99>${BREAK_P99_MS}ms · ذاكرة>${BREAK_MEMORY_MIB}MiB · زمن>${BREAK_TOTAL_SECONDS}s`);
console.log(`مستويات الحمل: ${LOAD_LEVELS.join('، ')}`);
console.log('');

const results: LevelResult[] = [];
let breakingPoint: LevelResult | null = null;

for (const level of LOAD_LEVELS) {
  process.stderr.write(`قياس مستوى ${level}... `);
  const result = runLevel(level, declaredP99, declaredMax);
  results.push(result);
  process.stderr.write(`p99=${result.p99Ms.toFixed(3)}ms · زمن=${result.totalSeconds.toFixed(3)}s · ذاكرة=${result.memoryMib.toFixed(1)}MiB`);
  if (result.broke) {
    process.stderr.write(` ⟵ انكسر: ${result.breakReason}`);
    breakingPoint = result;
  }
  process.stderr.write('\n');

  console.log(`مستوى ${level}:`);
  console.log(`  أُرسل=${result.submitted} نُفِّذ=${result.executed} رُفض=${result.denied} فشل=${result.failed}`);
  console.log(`  زمن (ms): متوسط=${result.meanMs.toFixed(3)} p99=${result.p99Ms.toFixed(3)} أقصى=${result.maxMs.toFixed(3)}`);
  console.log(`  زمن كلي=${result.totalSeconds.toFixed(3)}s · ذاكرة=${result.memoryMib.toFixed(1)}MiB · سلسلة التدقيق=${result.auditValid ? 'سليمة' : 'مكسورة'}`);
  if (result.broke) {
    console.log(`  ⟵ نقطة الانهيار: ${result.breakReason}`);
  }
  console.log('');

  if (breakingPoint) break;
}

console.log('== الخلاصة ==');
if (breakingPoint) {
  console.log(`نقطة الانهيار: ${breakingPoint.level} أمر`);
  console.log(`السبب: ${breakingPoint.breakReason}`);
  console.log(`السقف المعلن: ${declaredSustained} أمر (p99=${declaredP99}ms)`);
  console.log(`نسبة الانهيار إلى المعلن: ${(breakingPoint.level / declaredSustained).toFixed(1)}×`);
} else {
  console.log(`لم ينكسر النظام حتى ${results[results.length - 1]!.level} أمر`);
  console.log(`السقف المعلن: ${declaredSustained} أمر`);
  console.log(`النسبة الأخيرة إلى المعلن: ${(results[results.length - 1]!.level / declaredSustained).toFixed(1)}×`);
}
