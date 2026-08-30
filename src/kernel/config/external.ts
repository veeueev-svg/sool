/**
 * src/kernel/config/external.ts — الحسابات الخارجية
 * المالك: القيّم على المستودع | المرحلة: 26
 * المدخلات: config/external.yaml | المخرجات: ExternalConfig
 * حالات الفشل: نافذة إلى الخارج بلا سقف أو بلا جهة مأذونة ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { loadEconomy } from './economy';
import { guardDeclaredCount } from './declaration_limits';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

/** تهيئة الحسابات الخارجية (المرحلة 26) — كل نافذة إلى الخارج معلنة هنا لا في الكود */
export interface ExternalConfig {
  policy: {
    default: string; unit_convertibility: string; suspension: string;
    resume_requires_royal_command: boolean; max_term_days: number;
    confirmation_window_hours: number; suspend_authorities: string[];
  };
  counterparties: {
    id: string; name: string; host: string; port: number; purpose: string;
    single_max: number; daily_max: number; total_cap: number;
  }[];
}

/**
 * يحمّل النظائر الخارجية المعلنة ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * سببه: النافذة إلى الخارج أخطر من المال نفسه — فمن يملك قناةً معلنة يملك أثرًا خارج المستودع.
 * ويتحقق كذلك من أن مجموع السقوف الخارجية **لا يتجاوز سقف الموازنة الكلي**، فلا يُتعهَّد
 * للخارج بما لا تستطيع الدولة تمويله (تقاطع مُلزم مع config/economy.yaml).
 */
export function loadExternal(configDir = resolveConfigDir()): ExternalConfig {
  const raw = loadYamlFile(join(configDir, 'external.yaml')) as unknown as ExternalConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة الحسابات الخارجية غير معلنة', 'CONFIG_NO_EXTERNAL_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في الحسابات الخارجية هو الرفض', 'CONFIG_EXTERNAL_DEFAULT_ALLOW',
    );
  }
  // تنبيه النطاق مُلزم في الكود: فتح حساب خارجي لا يجعل الوحدة قابلة للتحويل
  if (policy.unit_convertibility !== 'forbidden') {
    throw new SovereignViolation(
      'قابلية تحويل الوحدة ممنوعة — الحساب الخارجي ليس صرّافًا',
      'CONFIG_EXTERNAL_CONVERTIBLE',
    );
  }
  if (policy.suspension !== 'immediate') {
    throw new SovereignViolation(
      'التعليق يجب أن يكون فوريًّا — تعليق مؤجَّل ليس تعليقًا',
      'CONFIG_EXTERNAL_SUSPENSION_DELAYED',
    );
  }
  if (policy.resume_requires_royal_command !== true) {
    throw new SovereignViolation(
      'الاستئناف بأمر ملكي — رفع الحماية أغلى من إنزالها',
      'CONFIG_EXTERNAL_RESUME_WITHOUT_KING',
    );
  }
  if (!Number.isSafeInteger(policy.max_term_days) || policy.max_term_days <= 0
    || policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة الحساب الخارجي غير معلنة أو غير مقبولة — لا حساب دائم',
      'CONFIG_EXTERNAL_TERM',
    );
  }
  if (!Number.isSafeInteger(policy.confirmation_window_hours)
    || policy.confirmation_window_hours <= 0) {
    throw new SovereignViolation(
      'مدة إثبات الاستلام غير معلنة — لا التزام بلا مدة إثبات',
      'CONFIG_EXTERNAL_NO_CONFIRM_WINDOW',
    );
  }
  if (!Array.isArray(policy.suspend_authorities) || policy.suspend_authorities.length === 0) {
    throw new SovereignViolation(
      'لا جهة مخوَّلة بالتعليق — قناة بلا يد تعلّقها', 'CONFIG_EXTERNAL_NO_SUSPENDERS',
    );
  }
  // فشل مغلق: معرّف جهة غير نصّي يعني تهيئة مقروءة خطأ — ولا تعليق بيد مجهولة
  for (const authority of policy.suspend_authorities) {
    if (typeof authority !== 'string' || authority.trim().length === 0) {
      throw new SovereignViolation(
        'جهة تعليق غير معلنة بمعرّف نصّي', 'CONFIG_EXTERNAL_SUSPENDER_ID',
      );
    }
  }
  guardDeclaredCount(
    'suspend_authorities', policy.suspend_authorities.length, 'جهاتُ تعليق القنوات الخارجيّة',
  );
  // فشل مغلق: جهةٌ مكرَّرةٌ تنفخ العددَ ولا تزيد الأيدي — «أربعُ جهاتٍ» تصير جهةً واحدةً
  // كُتبت أربعًا، فيمرّ تعدُّدُ الجهات من السقفِ وهو وهمٌ عدديّ (T-135)
  const authorities = policy.suspend_authorities.map((a) => String(a));
  if (new Set(authorities).size !== authorities.length) {
    throw new SovereignViolation(
      'جهةُ تعليقٍ مكرَّرةٌ في الإعلان — تعدُّدُ الأيدي لا يُبلغ بالتكرار',
      'CONFIG_EXTERNAL_SUSPEND_AUTHORITY_DUPLICATE',
    );
  }
  if (!Array.isArray(raw.counterparties) || raw.counterparties.length === 0) {
    throw new SovereignViolation(
      'لا نظائر خارجية معلنة — لا حساب بلا إعلان', 'CONFIG_EXTERNAL_NO_COUNTERPARTIES',
    );
  }
  guardDeclaredCount('counterparties', raw.counterparties.length, 'النظائرُ الخارجيّةُ المعلنة');

  const ids = new Set<string>();
  const hosts = new Set<string>();
  let capsTotal = 0;
  for (const cp of raw.counterparties) {
    if (typeof cp.id !== 'string' || !cp.id.startsWith('external:')) {
      throw new SovereignViolation('معرّف نظير خارجي غير صالح', 'CONFIG_EXTERNAL_ID');
    }
    if (ids.has(cp.id)) {
      throw new SovereignViolation(`نظير مكرَّر: ${cp.id}`, 'CONFIG_EXTERNAL_DUPLICATE');
    }
    ids.add(cp.id);
    if (typeof cp.name !== 'string' || cp.name.trim().length < 3) {
      throw new SovereignViolation(`نظير بلا اسم معلن: ${cp.id}`, 'CONFIG_EXTERNAL_NO_NAME');
    }
    if (typeof cp.host !== 'string' || cp.host.trim().length < 3) {
      throw new SovereignViolation(`نظير بلا مضيف معلن: ${cp.id}`, 'CONFIG_EXTERNAL_NO_HOST');
    }
    if (hosts.has(cp.host)) {
      throw new SovereignViolation(
        `مضيف مكرَّر بين نظيرين: ${cp.host}`, 'CONFIG_EXTERNAL_HOST_DUPLICATE',
      );
    }
    hosts.add(cp.host);
    if (!Number.isSafeInteger(cp.port) || cp.port <= 0 || cp.port > 65535) {
      throw new SovereignViolation(`منفذ غير صالح: ${cp.id}`, 'CONFIG_EXTERNAL_PORT');
    }
    if (typeof cp.purpose !== 'string' || cp.purpose.trim().length < 3) {
      throw new SovereignViolation(`نظير بلا غرض معلن: ${cp.id}`, 'CONFIG_EXTERNAL_NO_PURPOSE');
    }
    for (const [key, value] of [
      ['single_max', cp.single_max], ['daily_max', cp.daily_max], ['total_cap', cp.total_cap],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new SovereignViolation(
          `سقف غير معلن أو غير صالح (${key}): ${cp.id}`, 'CONFIG_EXTERNAL_CAP',
        );
      }
    }
    if (cp.single_max > cp.daily_max || cp.daily_max > cp.total_cap) {
      throw new SovereignViolation(
        `ترتيب السقوف مختلّ (الدفعة ≤ اليوم ≤ الكلي): ${cp.id}`,
        'CONFIG_EXTERNAL_CAP_ORDER',
      );
    }
    capsTotal += cp.total_cap;
  }

  // تقاطع مُلزم: لا يُتعهَّد للخارج بما يتجاوز سقف الموازنة الكلي
  const economy = loadEconomy(configDir);
  if (capsTotal > economy.budget.ceiling_total) {
    throw new SovereignViolation(
      'مجموع السقوف الخارجية يتجاوز سقف الموازنة الكلي — تعهّد لا يمكن تمويله',
      'CONFIG_EXTERNAL_CAPS_OVER_BUDGET',
    );
  }
  return raw;
}
