/**
 * src/crown/command_channel_lock.ts — قفل الوصول المتزامن لملف قناة الأوامر (T-89)
 * المالك: حرس التاج
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * فُصل منطقُ القفلِ عن `command_channel.ts` حين تجاوز سقفَ الوحدة (400 سطر)
 * في الجلسة 95 — تفكيكٌ لا رفعُ سقفٍ، كي يبقى `exceptions: []` فارغةً عن قصد.
 *
 * الوصولُ المتزامنُ لعمليّتين إلى نفس ملف القناة يُفقدُ التحديثاتِ: كلُّ عمليّةٍ
 * تُحمّلُ الحالةَ، تُضيفُ سجلاتِها، وتكتبُ فوق ما كتبتِ الأخرى. القفلُ الحصريُّ
 * يغطّي دورة restore→mutate→save كاملةً، فلا تُقرأ لقطةٌ نصفُ مكتوبةٍ ولا يُكتبُ
 * فوقها أثناء التحويل. القياسُ الأوّل (قراءةُ اللقطةِ وحدها) كان مُعيبًا ولم
 * يقرأِ اليوميّة، فأظهر 32/105؛ بالقراءةِ المصحَّحةِ عبر `list()` ظهرَ الفقدُ
 * متذبذبًا؛ وبعد القفل صار 105/105 ثابتًا في عدة تشغيلات.
 */
import { closeSync, openSync, unlinkSync } from 'node:fs';
import { AppendOnlyLog } from '../audit/append_only_log';

/** رمز فشل أخذ قفل القناة. */
export const CHANNEL_LOCK_FAILED = 'CHANNEL_LOCK_FAILED';

/** مهلة الانتظار لأخذ القفل بالملي ثانية. */
export const CHANNEL_LOCK_TIMEOUT_MS = 5000;

/** فترة الانتظار بين محاولات أخذ القفل. */
export const CHANNEL_LOCK_RETRY_DELAY_MS = 25;

export interface ChannelLockHooks {
  /** السجل غير القابل للمحو — يُسجَّل فيه فشلُ أخذ القفل بصوتٍ عالٍ. */
  readonly audit: AppendOnlyLog;
  /** مسار ملف القفل. */
  readonly lockPath: string;
}

/**
 * قفلٌ حصريٌّ يغطّي دورة restore→mutate→save كاملة. `openSync(path, 'wx')` ذرّيٌّ:
 * يُنشئ الملفَ ويمتلكه، أو يفشل برمز EEXIST إن ملكه غيرك. المحاولةُ تدور بدوّرٍ
 * قصيرٍ حتّى المهلة، ثمّ تفشل فشلًا مغلقًا بصوتٍ عالٍ برمز `CHANNEL_LOCK_FAILED`.
 * القفلُ يُحَرَّر في `finally` كي لا يبقى ممسكًا إذا رمى المحتوى استثناءً.
 */
export function withChannelLock<T>(hooks: ChannelLockHooks, fn: () => T): T {
  const { audit, lockPath } = hooks;
  const deadline = Date.now() + CHANNEL_LOCK_TIMEOUT_MS;
  let fd: number | undefined;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      fd = openSync(lockPath, 'wx');
      acquired = true;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        audit.append('authority:crown_guard', 'command_channel_lock_failed', {
          lockPath, code: code ?? 'unknown', error: (err as Error).message,
        });
        throw new Error(`${CHANNEL_LOCK_FAILED} — فشل أخذ قفل القناة برمز غير متوقّع: ${code ?? 'unknown'}`);
      }
      const sleepUntil = Math.min(Date.now() + CHANNEL_LOCK_RETRY_DELAY_MS, deadline);
      while (Date.now() < sleepUntil) { /* دورانٌ قصيرٌ للانتظار */ }
    }
  }
  if (!acquired || fd === undefined) {
    audit.append('authority:crown_guard', 'command_channel_lock_failed', {
      lockPath, timeoutMs: CHANNEL_LOCK_TIMEOUT_MS,
    });
    throw new Error(`${CHANNEL_LOCK_FAILED} — انتهت مهلة انتظار قفل القناة`);
  }
  try {
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* القفل قد يكون أُغلق */ }
    try { unlinkSync(lockPath); } catch { /* حذفٌ ممّن فشل لا يكسر */ }
  }
}
