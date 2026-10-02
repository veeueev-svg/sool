/**
 * src/main.ts — نقطةُ دخولِ عمليّةِ الإنتاج (T-109 · W-2026-049 · ADR-0052)
 * المالك: وزارة البنية + ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: `--state-dir <مجلد>` اختياريّ (وإلّا المجلدُ المعلن في `config/persistence.yaml`)
 * المخرجات: دولةٌ مُقلَعةٌ باليوميّة الدائمة **ومراقبتُها جاريةٌ من لحظة الإقلاع**؛ وسطرُ JSON واحدٌ
 *           على stdout عند الإقلاع وآخرُ عند الوقف
 * لماذا وُجدت: صورةُ الإنتاج (`infra/docker/Dockerfile`) كانت تشغّل `dist/src/index.js` — وهو مكتبةٌ
 *   تُصدِّر ولا تُقلع، فتخرج العمليّةُ فورًا بلا دولةٍ ولا مراقبة. والمراقبةُ لم تكن تبدأ إلا مع
 *   `FederatedOperation.begin` (T-109). هنا تُقلع الدولةُ وتبدأ المراقبةُ في النداء نفسِه.
 * ثوابت:
 *   1) **لا إقلاعَ بلا ثبات**: مجلدُ اليوميّة إلزاميّ؛ وتعذّرُه يُسقط العمليّةَ برمزٍ غيرِ صفريّ.
 *   2) **العمليّةُ تبقى حيّةً ما دامت المراقبة**: مؤقّتا المراقب `unref`، فيُمسك هنا مؤقّتٌ صريح.
 *   3) **الوقفُ قرارٌ معلن**: SIGTERM/SIGINT ⇒ `supervisor.stop` بجهةٍ مشغّلةٍ معلنة وسبب، ثمّ
 *      إغلاقُ اليوميّة. والمراقبُ نفسُه لا يُغلق نفسَه.
 * حالات الفشل: إقلاعٌ يرمي ⇒ سطرُ خطأٍ على stderr ورمزُ خروج 1 (فشلٌ مغلق).
 * اختبار القبول: tests/production/boot_supervision.test.ts
 */
import { join } from 'node:path';
import { bootstrapState } from './index';
import { loadPersistence } from './kernel/config';
import type { DigitalState } from './composition/state';

/** الجهةُ التي توقف المراقبةَ عند إشارةِ النظام — من `PRODUCTION_OPERATORS` لا مخترعة */
export const PROCESS_OPERATOR = 'ministry:infrastructure';

export function stateDirFrom(argv: readonly string[]): string {
  const at = argv.indexOf('--state-dir');
  if (at >= 0) {
    const dir = argv[at + 1];
    if (!dir || dir.startsWith('--')) throw new Error('--state-dir بلا مجلد');
    return dir;
  }
  return loadPersistence().policy.journal_directory;
}

export function bootProductionProcess(argv: readonly string[], now = Date.now()): DigitalState {
  const stateDir = stateDirFrom(argv);
  return bootstrapState({
    now, persistenceDir: stateDir, checkpointDir: join(stateDir, 'supervision'), superviseAtBoot: true,
  });
}

function run(): void {
  let state: DigitalState;
  try {
    state = bootProductionProcess(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: 'boot_failed', error: String(error) })}\n`);
    process.exit(1);
  }
  const keepAlive = setInterval(() => undefined, 60_000); // ثابت 2
  const report = state.continuousSupervisor.report();
  process.stdout.write(`${JSON.stringify({
    event: 'state_online', supervising: state.continuousSupervisor.running,
    mode: state.mode(), sweeps: report.sweeps, journal: state.journal?.file ?? null,
  })}\n`);
  const shutdown = (signal: string): void => {
    const stopped = state.continuousSupervisor.stop(PROCESS_OPERATOR, `إشارة النظام ${signal}`);
    state.journal?.close();
    clearInterval(keepAlive);
    process.stdout.write(`${JSON.stringify({ event: 'state_stopped', signal, stopped: stopped.ok })}\n`);
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) run();
