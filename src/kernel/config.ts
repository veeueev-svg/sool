/**
 * src/kernel/config.ts — تحميل تهيئة الدولة والتحقق من ثوابتها
 * المالك: القيّم على المستودع | المرحلة: 2
 * المدخلات: ملفات config/*.yaml | المخرجات: كائنات تهيئة مُتحقَّق منها
 * حالات الفشل: ملف ناقص أو ملكان أو مسار جانبي مسموح ⇒ فشل مغلق (fail-closed)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { KNOWN_SOVEREIGN_ACTIONS, SovereignAction, SovereignViolation } from './types';

/**
 * يحدد مجلد config بالبحث صعودًا من موقع التنفيذ (يعمل من src ومن dist معًا).
 * فشل الإيجاد = فشل مغلق: الدولة لا تعمل بلا تهيئة معلنة (RULE-007).
 */
export function resolveConfigDir(startDir = __dirname): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'config', 'royal-authority.yaml');
    if (existsSync(candidate)) return join(dir, 'config');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new SovereignViolation('مجلد التهيئة غير موجود — فشل مغلق', 'CONFIG_DIR_MISSING');
}

/**
 * محلّل YAML لمجموعة فرعية آمنة ومحدّدة: خرائط متداخلة، قوائم قيم، قوائم خرائط،
 * وخرائط سطرية {a: 1}. لا يدعم المراجع أو الوسوم — بقصد تقليل سطح الخطر.
 */
type YamlLine = { indent: number; text: string };

function scalar(raw: string): unknown {
  const v = raw.trim().replace(/^["']|["']$/g, '');
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function inlineMap(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of raw.slice(1, -1).split(',')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = scalar(part.slice(idx + 1));
  }
  return out;
}

function applyPair(obj: Record<string, unknown>, text: string): void {
  const idx = text.indexOf(':');
  if (idx === -1) return;
  const key = text.slice(0, idx).trim();
  const val = text.slice(idx + 1).trim();
  obj[key] = val.startsWith('{') ? inlineMap(val) : scalar(val);
}

function toLines(text: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    out.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  return out;
}

function parseNode(lines: YamlLine[], start: number, indent: number): [unknown, number] {
  let i = start;
  if (lines[i]!.text.startsWith('- ')) {
    const arr: unknown[] = [];
    while (i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith('- ')) {
      const content = lines[i]!.text.slice(2).trim();
      i += 1;
      // ملاحظة (المرحلة 26): عنصر قائمة مقتبس يحتوي نقطتين — مثل "ministry:foreign_affairs" —
      // كان يُقرأ خريطةً لا نصًّا. الاقتباس يحسم القصد: نصّ لا زوج مفتاح/قيمة.
      const quoted = content.startsWith('"') || content.startsWith("'");
      if (content.startsWith('{')) {
        arr.push(inlineMap(content));
      } else if (!quoted && /^[^:]+:/.test(content)) {
        const obj: Record<string, unknown> = {};
        applyPair(obj, content);
        if (i < lines.length && lines[i]!.indent > indent && !lines[i]!.text.startsWith('- ')) {
          const [child, next] = parseNode(lines, i, lines[i]!.indent);
          Object.assign(obj, child as Record<string, unknown>);
          i = next;
        }
        arr.push(obj);
      } else {
        arr.push(scalar(content));
      }
    }
    return [arr, i];
  }

  const obj: Record<string, unknown> = {};
  while (i < lines.length && lines[i]!.indent === indent && !lines[i]!.text.startsWith('- ')) {
    const text = lines[i]!.text;
    const idx = text.indexOf(':');
    if (idx === -1) { i += 1; continue; }
    const key = text.slice(0, idx).trim();
    const val = text.slice(idx + 1).trim();
    i += 1;
    if (val === '') {
      const next = lines[i];
      if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))) {
        const [child, ni] = parseNode(lines, i, next.indent);
        obj[key] = child;
        i = ni;
      } else {
        obj[key] = {};
      }
    } else if (val.startsWith('{')) {
      obj[key] = inlineMap(val);
    } else {
      obj[key] = scalar(val);
    }
  }
  return [obj, i];
}

export function parseSimpleYaml(text: string): Record<string, unknown> {
  const lines = toLines(text);
  if (lines.length === 0) return {};
  const [value] = parseNode(lines, 0, lines[0]!.indent);
  return (value ?? {}) as Record<string, unknown>;
}

export interface RoyalAuthorityConfig {
  state_name: string;
  state_code: string;
  king_count_max: number;
  king_id: string;
  crown_gateway_required: boolean;
  side_channel_allowed: boolean;
  heartbeat_interval_seconds: number;
  absence_grace_seconds: number;
  absence_mode: string;
  /**
   * الأفعال السيادية المعلنة — **ملزمة لا وصفية** (المرحلة 28): البوابة تُبنى منها،
   * ولذلك نوعها `SovereignAction` لا `string`: يضمنه تحقق `loadRoyalAuthority` عند
   * التحميل (فشل مغلق على أي فعل مجهول)، فلا يدخل النوع اسمٌ لم تُعلنه الشفرة.
   */
  sovereign_actions: SovereignAction[];
  veto_final: boolean;
}

export function loadYamlFile(path: string): Record<string, unknown> {
  return parseSimpleYaml(readFileSync(path, 'utf8'));
}

/** يحمّل سلطة التاج ويرفض أي تهيئة تخالف الثوابت السيادية */
export function loadRoyalAuthority(configDir = resolveConfigDir()): RoyalAuthorityConfig {
  const raw = loadYamlFile(join(configDir, 'royal-authority.yaml')) as unknown as RoyalAuthorityConfig;
  if (!raw.king_id) throw new SovereignViolation('لا يوجد ملك معرّف', 'CONFIG_NO_KING');
  if (raw.king_count_max !== 1) {
    throw new SovereignViolation('لا يجوز أكثر من ملك واحد', 'CONFIG_MULTIPLE_KINGS');
  }
  if (raw.crown_gateway_required !== true) {
    throw new SovereignViolation('بوابة التاج إلزامية', 'CONFIG_GATEWAY_OPTIONAL');
  }
  if (raw.side_channel_allowed !== false) {
    throw new SovereignViolation('المسار الجانبي ممنوع', 'CONFIG_SIDE_CHANNEL');
  }
  if (raw.veto_final !== true) {
    throw new SovereignViolation('النقض الملكي نهائي', 'CONFIG_VETO_NOT_FINAL');
  }
  // المرحلة 28: قائمة الأفعال السيادية صارت **ملزمة** لا وصفًا: البوابة تقرأ منها،
  // فوجب أن تُرفض قائمةٌ فيها فعلٌ مجهول (فلا يُفتح بابٌ باسم لا تعرفه الدولة)
  // أو فيها تكرار أو لا شيء (فلا تقوم دولةٌ لا فعل سيادي فيها أصلًا) — فشل مغلق.
  if (!Array.isArray(raw.sovereign_actions) || raw.sovereign_actions.length === 0) {
    throw new SovereignViolation(
      'لا أفعال سيادية معلنة — لا سيادة بلا فعل معلن', 'CONFIG_NO_SOVEREIGN_ACTIONS',
    );
  }
  const seenActions = new Set<string>();
  for (const action of raw.sovereign_actions) {
    if (typeof action !== 'string' || !(KNOWN_SOVEREIGN_ACTIONS as readonly string[]).includes(action)) {
      throw new SovereignViolation(
        `فعل سيادي مجهول في التهيئة: ${String(action)}`, 'CONFIG_UNKNOWN_SOVEREIGN_ACTION',
      );
    }
    if (seenActions.has(action)) {
      throw new SovereignViolation(
        `فعل سيادي مكرّر في التهيئة: ${action}`, 'CONFIG_DUPLICATE_SOVEREIGN_ACTION',
      );
    }
    seenActions.add(action);
  }
  return raw;
}

/** تهيئة الحصص والموارد (المرحلة 5) */
export interface QuotasConfig {
  resources: Record<string, { total: number; per_agent_max: number; lease_seconds: number }>;
  agents: { population_max: number; spawn_rate_per_minute: number };
}

/** يحمّل الحصص ويرفض أي تهيئة ناقصة أو سالبة — فشل مغلق (RULE-007) */
export function loadQuotas(configDir = resolveConfigDir()): QuotasConfig {
  const raw = loadYamlFile(join(configDir, 'quotas.yaml')) as unknown as QuotasConfig;
  if (!raw.resources || Object.keys(raw.resources).length === 0) {
    throw new SovereignViolation('لا موارد معلنة — لا تشغيل بلا حصص', 'CONFIG_NO_RESOURCES');
  }
  for (const [name, spec] of Object.entries(raw.resources)) {
    if (typeof spec.total !== 'number' || typeof spec.per_agent_max !== 'number'
      || typeof spec.lease_seconds !== 'number') {
      throw new SovereignViolation(`تهيئة مورد ناقصة: ${name}`, 'CONFIG_RESOURCE_INCOMPLETE');
    }
    if (spec.per_agent_max > spec.total) {
      throw new SovereignViolation(`سقف الكيان يتجاوز السقف الكلي: ${name}`, 'CONFIG_RESOURCE_OVER_TOTAL');
    }
  }
  if (!raw.agents || typeof raw.agents.population_max !== 'number' || raw.agents.population_max < 0) {
    throw new SovereignViolation('سقف السكان غير معلن', 'CONFIG_NO_POPULATION_MAX');
  }
  return raw;
}

/** تهيئة الأقاليم المعلنة (أُعلنت في المرحلة 2 وصارت مُلزمة في المرحلة 24) */
export interface RegionDeclaration {
  id: string;
  name: string;
  governor: string;
  autonomy_level: string;
}

export interface RegionsConfig {
  regions: RegionDeclaration[];
  collective_override_of_king: string;
}

/**
 * يحمّل الأقاليم المعلنة ويرفض أي تهيئة تخالف الثوابت السيادية.
 * سببه: قبل المرحلة 24 كان config/regions.yaml معلنًا ولا يقرؤه أحد — إعلان بلا أثر.
 * بعدها: لا يقوم إقليم إلا إن كان معرّفه معلنًا هنا (RULE-005 — لا توسّع من الداخل).
 */
export function loadRegions(configDir = resolveConfigDir()): RegionsConfig {
  const raw = loadYamlFile(join(configDir, 'regions.yaml')) as unknown as RegionsConfig;
  if (!Array.isArray(raw.regions) || raw.regions.length === 0) {
    throw new SovereignViolation('لا أقاليم معلنة — لا اتحاد بلا إعلان', 'CONFIG_NO_REGIONS');
  }
  if (raw.collective_override_of_king !== 'forbidden') {
    throw new SovereignViolation(
      'نقض الأقاليم المجتمعة للملك ممنوع — السيادة غير قابلة للتجميع',
      'CONFIG_COLLECTIVE_OVERRIDE_ALLOWED',
    );
  }
  const seen = new Set<string>();
  for (const region of raw.regions) {
    if (typeof region.id !== 'string' || !region.id.startsWith('region:')) {
      throw new SovereignViolation('معرّف إقليم غير صالح', 'CONFIG_REGION_ID');
    }
    if (seen.has(region.id)) {
      throw new SovereignViolation(`إقليم مكرَّر: ${region.id}`, 'CONFIG_REGION_DUPLICATE');
    }
    seen.add(region.id);
    if (typeof region.name !== 'string' || region.name.trim().length < 3) {
      throw new SovereignViolation(`إقليم بلا اسم معلن: ${region.id}`, 'CONFIG_REGION_NO_NAME');
    }
    if (region.autonomy_level !== 'limited' && region.autonomy_level !== 'delegated') {
      throw new SovereignViolation(
        `مستوى استقلال غير معلن أو غير مسموح: ${region.id}`, 'CONFIG_REGION_AUTONOMY',
      );
    }
  }
  return raw;
}

/** تهيئة الاقتصاد والخزانة (المرحلة 25) — كل رقم مالي معلن هنا لا في الكود */
export interface EconomyConfig {
  unit: {
    code: string; name: string; minor_units: number; supply_max: number;
    external_convertibility: string; legal_tender: boolean;
  };
  treasury: {
    account: string; equity_account: string; revenue_account: string;
    overdraft: string; single_disbursement_max: number;
  };
  budget: { fiscal_period_days: number; carryover: string; ceiling_total: number };
  revenue: {
    retroactive: string;
    rates: { base: string; rate_per_mille: number; declared_at: string }[];
  };
}

/**
 * يحمّل تهيئة الاقتصاد ويرفض أي إعلان يخالف الثوابت المالية أو تنبيه النطاق.
 * سببه: المال أخطر ما يُترك لقيم مكتوبة في الكود — والسقوف إن لم تكن معلنة لم تكن ملزمة.
 */
export function loadEconomy(configDir = resolveConfigDir()): EconomyConfig {
  const raw = loadYamlFile(join(configDir, 'economy.yaml')) as unknown as EconomyConfig;
  const unit = raw.unit;
  if (!unit || typeof unit.code !== 'string' || unit.code.trim().length === 0) {
    throw new SovereignViolation('وحدة الحساب غير معلنة', 'CONFIG_NO_UNIT');
  }
  if (!Number.isSafeInteger(unit.minor_units) || unit.minor_units <= 0) {
    throw new SovereignViolation('الوحدات الصغرى غير معلنة أو غير صحيحة', 'CONFIG_UNIT_MINOR');
  }
  if (!Number.isSafeInteger(unit.supply_max) || unit.supply_max <= 0) {
    throw new SovereignViolation('سقف الإصدار غير معلن — لا اقتصاد بلا سقف', 'CONFIG_NO_SUPPLY_MAX');
  }
  // تنبيه النطاق مُلزم في الكود لا في README وحده: الوحدة محاسبية داخلية لا مال
  if (unit.external_convertibility !== 'forbidden') {
    throw new SovereignViolation(
      'التحويل الخارجي للوحدة ممنوع — وحدة محاسبية داخلية لا تدّعي قيمة نقدية',
      'CONFIG_UNIT_CONVERTIBLE',
    );
  }
  if (unit.legal_tender !== false) {
    throw new SovereignViolation('الوحدة ليست عملة قانونية بحال', 'CONFIG_UNIT_LEGAL_TENDER');
  }

  const treasury = raw.treasury;
  if (!treasury || !treasury.account || !treasury.equity_account || !treasury.revenue_account) {
    throw new SovereignViolation('حسابات الخزانة غير معلنة', 'CONFIG_NO_TREASURY_ACCOUNTS');
  }
  if (treasury.overdraft !== 'forbidden') {
    throw new SovereignViolation(
      'السحب على المكشوف ممنوع — الخزانة لا تصرف ما لا تملك', 'CONFIG_OVERDRAFT_ALLOWED',
    );
  }
  if (!Number.isSafeInteger(treasury.single_disbursement_max) || treasury.single_disbursement_max <= 0) {
    throw new SovereignViolation('حدّ الصرف الواحد غير معلن', 'CONFIG_NO_DISBURSEMENT_MAX');
  }

  const budget = raw.budget;
  if (!budget || !Number.isSafeInteger(budget.ceiling_total) || budget.ceiling_total <= 0) {
    throw new SovereignViolation('السقف الكلي للموازنة غير معلن', 'CONFIG_NO_CEILING_TOTAL');
  }
  if (budget.ceiling_total > unit.supply_max) {
    throw new SovereignViolation(
      'سقف الموازنة يتجاوز سقف الإصدار — موازنة لا يمكن تمويلها', 'CONFIG_CEILING_OVER_SUPPLY',
    );
  }
  if (budget.carryover !== 'forbidden') {
    throw new SovereignViolation(
      'ترحيل الموازنة ممنوع — ما لم يُصرف يسقط ويُسجَّل', 'CONFIG_CARRYOVER_ALLOWED',
    );
  }
  if (!Number.isSafeInteger(budget.fiscal_period_days) || budget.fiscal_period_days <= 0) {
    throw new SovereignViolation('مدة الفترة المالية غير معلنة', 'CONFIG_NO_FISCAL_PERIOD');
  }

  const revenue = raw.revenue;
  if (!revenue || !Array.isArray(revenue.rates) || revenue.rates.length === 0) {
    throw new SovereignViolation('لا أوعية رسوم معلنة — لا رسم بلا نصّ', 'CONFIG_NO_RATES');
  }
  if (revenue.retroactive !== 'forbidden') {
    throw new SovereignViolation(
      'الأثر الرجعي للرسوم ممنوع — نظير عدم رجعية القوانين', 'CONFIG_RETROACTIVE_ALLOWED',
    );
  }
  const bases = new Set<string>();
  for (const rate of revenue.rates) {
    if (typeof rate.base !== 'string' || rate.base.trim().length === 0) {
      throw new SovereignViolation('وعاء رسم بلا اسم', 'CONFIG_RATE_NO_BASE');
    }
    if (bases.has(rate.base)) {
      throw new SovereignViolation(`وعاء مكرَّر: ${rate.base}`, 'CONFIG_RATE_DUPLICATE');
    }
    bases.add(rate.base);
    if (!Number.isSafeInteger(rate.rate_per_mille) || rate.rate_per_mille <= 0
      || rate.rate_per_mille > 1000) {
      throw new SovereignViolation(
        `نسبة غير صالحة (تُحسب بالأجزاء من الألف): ${rate.base}`, 'CONFIG_RATE_RANGE',
      );
    }
    if (typeof rate.declared_at !== 'string' || Number.isNaN(Date.parse(rate.declared_at))) {
      throw new SovereignViolation(
        `تاريخ إعلان النسبة غير صالح: ${rate.base} — ولا رسم بلا تاريخ إعلان`,
        'CONFIG_RATE_NO_DATE',
      );
    }
  }
  return raw;
}

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
  if (!Array.isArray(raw.counterparties) || raw.counterparties.length === 0) {
    throw new SovereignViolation(
      'لا نظائر خارجية معلنة — لا حساب بلا إعلان', 'CONFIG_EXTERNAL_NO_COUNTERPARTIES',
    );
  }

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

/** تهيئة العقود الخارجية (المرحلة 27) — config/contracts.yaml */
export interface ContractsConfig {
  policy: {
    default: string; require_end_date: boolean; max_term_days: number;
    termination: string; termination_requires_royal_command: boolean;
    termination_suspends_account: boolean; settlement_window_hours: number;
    max_risk_score: number; review_interval_days: number; breach_penalty: number;
    max_open_per_counterparty: number;
    proposer: string; assessor: string; settler: string;
  };
  kinds: {
    id: string; name: string; counterparty: string; purpose: string;
    max_value: number; risk_weight: number;
  }[];
  risk_factors: Record<string, number>;
}

/**
 * يحمّل أنواع العقود الخارجية المعلنة ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * سببه: العقد أخطر من الدفعة — الدفعة تقع مرة، والعقد يُلزم الدولة زمنًا ويُنشئ اعتمادًا.
 * ويتحقق تقاطعيًّا مع config/external.yaml أن كل نوع عقد لنظير **معلن**، وأن مجموع قيم
 * أنواع العقود لنظير واحد **لا يتجاوز سقفه الكلي** — فلا يُتعهَّد بعقد لا تحمله قناته.
 */
export function loadContracts(configDir = resolveConfigDir()): ContractsConfig {
  const raw = loadYamlFile(join(configDir, 'contracts.yaml')) as unknown as ContractsConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة العقود الخارجية غير معلنة', 'CONFIG_NO_CONTRACTS_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في العقود الخارجية هو الرفض', 'CONFIG_CONTRACT_DEFAULT_ALLOW',
    );
  }
  // شرط القبول المعلن (المرحلة 27): لا عقد بلا تاريخ انتهاء — ولا تُعطَّل هذه القاعدة بتهيئة
  if (policy.require_end_date !== true) {
    throw new SovereignViolation(
      'تاريخ الانتهاء إلزامي في كل عقد خارجي — لا عقد دائم',
      'CONFIG_CONTRACT_NO_END_DATE_RULE',
    );
  }
  if (policy.termination !== 'immediate') {
    throw new SovereignViolation(
      'الإنهاء يجب أن يكون فوريًّا — عقد "سيُنهى" عقدٌ قائم',
      'CONFIG_CONTRACT_TERMINATION_DELAYED',
    );
  }
  if (policy.termination_requires_royal_command !== true) {
    throw new SovereignViolation(
      'الإنهاء بأمر ملكي — إسقاط التزام معلن ليس فعل موظّف',
      'CONFIG_CONTRACT_TERMINATION_WITHOUT_KING',
    );
  }
  if (policy.termination_suspends_account !== true) {
    throw new SovereignViolation(
      'الإنهاء يقطع قناة المال — لا عقد مُنهًى وقناته مفتوحة',
      'CONFIG_CONTRACT_TERMINATION_LEAVES_CHANNEL',
    );
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days],
    ['settlement_window_hours', policy.settlement_window_hours],
    ['max_risk_score', policy.max_risk_score],
    ['review_interval_days', policy.review_interval_days],
    ['breach_penalty', policy.breach_penalty],
    ['max_open_per_counterparty', policy.max_open_per_counterparty],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير معلنة أو غير صالحة في سياسة العقود (${key})`, 'CONFIG_CONTRACT_POLICY_VALUE',
      );
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة العقد الخارجي تتجاوز الحدّ المقبول — لا عقد دائم', 'CONFIG_CONTRACT_TERM',
    );
  }
  // RULE-004: من يقترح لا يقدّر ولا يسوّي — ثلاث أيدٍ معلنة لا يد واحدة
  for (const [key, value] of [
    ['proposer', policy.proposer], ['assessor', policy.assessor], ['settler', policy.settler],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(
        `جهة غير معلنة بمعرّف نصّي في سياسة العقود (${key})`, 'CONFIG_CONTRACT_PARTY_ID',
      );
    }
  }
  if (policy.proposer === policy.assessor || policy.proposer === policy.settler
    || policy.assessor === policy.settler) {
    throw new SovereignViolation(
      'المقترح والمقدِّر والمسوِّي لا يكونون جهةً واحدة (RULE-004)',
      'CONFIG_CONTRACT_ROLES_MERGED',
    );
  }
  if (!raw.risk_factors || typeof raw.risk_factors !== 'object'
    || Object.keys(raw.risk_factors).length === 0) {
    throw new SovereignViolation(
      'لا عوامل مخاطر معلنة — لا تقدير بلا مقياس معلن', 'CONFIG_CONTRACT_NO_RISK_FACTORS',
    );
  }
  for (const [name, weight] of Object.entries(raw.risk_factors)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(
        `وزن عامل مخاطر غير صالح: ${name}`, 'CONFIG_CONTRACT_RISK_WEIGHT',
      );
    }
  }
  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
    throw new SovereignViolation(
      'لا أنواع عقود معلنة — لا عقد بلا إعلان', 'CONFIG_CONTRACT_NO_KINDS',
    );
  }

  const external = loadExternal(configDir);
  const caps = new Map<string, number>();
  for (const cp of external.counterparties) caps.set(cp.id, cp.total_cap);
  const ids = new Set<string>();
  const committed = new Map<string, number>();
  for (const kind of raw.kinds) {
    if (typeof kind.id !== 'string' || !kind.id.startsWith('contract:')) {
      throw new SovereignViolation('معرّف نوع عقد غير صالح', 'CONFIG_CONTRACT_KIND_ID');
    }
    if (ids.has(kind.id)) {
      throw new SovereignViolation(`نوع عقد مكرَّر: ${kind.id}`, 'CONFIG_CONTRACT_KIND_DUPLICATE');
    }
    ids.add(kind.id);
    if (typeof kind.name !== 'string' || kind.name.trim().length < 3) {
      throw new SovereignViolation(`نوع عقد بلا اسم: ${kind.id}`, 'CONFIG_CONTRACT_KIND_NO_NAME');
    }
    if (typeof kind.purpose !== 'string' || kind.purpose.trim().length < 3) {
      throw new SovereignViolation(`نوع عقد بلا غرض: ${kind.id}`, 'CONFIG_CONTRACT_KIND_NO_PURPOSE');
    }
    // RULE-005: العقد لا يُنشئ نظيرًا — النظير معلن في external.yaml وحده
    if (typeof kind.counterparty !== 'string' || !caps.has(kind.counterparty)) {
      throw new SovereignViolation(
        `نوع عقد لنظير غير معلن: ${kind.id}`, 'CONFIG_CONTRACT_UNDECLARED_COUNTERPARTY',
      );
    }
    if (!Number.isSafeInteger(kind.max_value) || kind.max_value <= 0) {
      throw new SovereignViolation(
        `سقف قيمة غير معلن أو غير صالح: ${kind.id}`, 'CONFIG_CONTRACT_KIND_VALUE',
      );
    }
    if (!Number.isSafeInteger(kind.risk_weight) || kind.risk_weight <= 0) {
      throw new SovereignViolation(
        `وزن مخاطر غير معلن للنوع: ${kind.id}`, 'CONFIG_CONTRACT_KIND_RISK',
      );
    }
    // لا يُوقَّع نوع عقد لا يمكن أن يُوقَّع أصلًا: وزن يفوق السقف يعني إعلانًا ميتًا
    if (kind.risk_weight > policy.max_risk_score) {
      throw new SovereignViolation(
        `وزن مخاطر النوع يفوق سقف الدرجة المعلن: ${kind.id}`, 'CONFIG_CONTRACT_KIND_RISK_OVER_MAX',
      );
    }
    const total = (committed.get(kind.counterparty) ?? 0) + kind.max_value;
    committed.set(kind.counterparty, total);
    if (total > (caps.get(kind.counterparty) as number)) {
      throw new SovereignViolation(
        `مجموع قيم عقود النظير يتجاوز سقفه الكلي: ${kind.counterparty}`,
        'CONFIG_CONTRACT_OVER_COUNTERPARTY_CAP',
      );
    }
  }
  return raw;
}

/** تهيئة المنشآت الاقتصادية (المرحلة 28) — config/enterprises.yaml */
export interface EnterprisesConfig {
  policy: {
    default: string; require_measured_inputs: boolean; require_budget_line: boolean;
    max_term_days: number; max_facilities_per_ministry: number;
    max_concurrent_runs: number; max_run_duration_hours: number;
    min_quality_score: number; waste_tolerance_per_mille: number;
    operator: string; inspector: string;
    suspend_authorities: string[];
  };
  quality_checks: Record<string, number>;
  materials: { id: string; name: string; unit: string; source: string }[];
  kinds: {
    id: string; name: string; sector: string;
    inputs: { material: string; quantity: number }[];
    output: { material: string; quantity: number };
    resource_cost: { resource: string; amount: number };
    required_checks: string[];
  }[];
}

/**
 * يحمّل إعلان المنشآت الاقتصادية ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * وأهمّ ما يتحقق منه — تنفيذًا للدرس المنقول من الجلسة 13 — أن **كل ثابت قابل للوقوع**:
 *   - مجموع أوزان فحوص كل نوع ≥ الحدّ الأدنى للجودة، وإلّا كان النوع إعلانًا ميتًا
 *     لا تنجح فيه دفعة أبدًا، ومراقبة الجودة فيه شعارًا لا حماية.
 *   - الحدّ الأدنى للجودة ≤ مجموع كل الأوزان المعلنة، وإلّا استحال القبول في كل نوع.
 *   - كلفة الموارد لكل نوع ≤ سقف الكيان الواحد في `config/quotas.yaml`، وإلّا رُفض
 *     كل تأجير فلا تعمل المنشأة ولو صحّ كل ما قبله.
 * ويتحقق تقاطعيًّا مع `config/external.yaml` أن مصدر كل مادة خارجية **نظير معلن**،
 * فلا تدخل مادة على اسم مذكور بل على قناة قائمة (ADR-0011 قرار 1).
 */
export function loadEnterprises(configDir = resolveConfigDir()): EnterprisesConfig {
  const raw = loadYamlFile(join(configDir, 'enterprises.yaml')) as unknown as EnterprisesConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة المنشآت غير معلنة', 'CONFIG_NO_ENTERPRISES_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في المنشآت هو الرفض', 'CONFIG_ENTERPRISE_DEFAULT_ALLOW',
    );
  }
  // شرط القبول المعلن (T-69): لا إنتاج بلا مدخل مُقاس — ولا تُعطَّل هذه القاعدة بتهيئة
  if (policy.require_measured_inputs !== true) {
    throw new SovereignViolation(
      'المدخل المُقاس إلزامي — لا إنتاج بلا مدخل يُقاس',
      'CONFIG_ENTERPRISE_UNMEASURED_INPUTS',
    );
  }
  if (policy.require_budget_line !== true) {
    throw new SovereignViolation(
      'بند الموازنة إلزامي — لا منشأة بلا نفقة معلنة',
      'CONFIG_ENTERPRISE_NO_BUDGET_RULE',
    );
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days],
    ['max_facilities_per_ministry', policy.max_facilities_per_ministry],
    ['max_concurrent_runs', policy.max_concurrent_runs],
    ['max_run_duration_hours', policy.max_run_duration_hours],
    ['min_quality_score', policy.min_quality_score],
    ['waste_tolerance_per_mille', policy.waste_tolerance_per_mille],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير معلنة أو غير صالحة في سياسة المنشآت (${key})`, 'CONFIG_ENTERPRISE_POLICY_VALUE',
      );
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة المنشأة تتجاوز الحدّ المقبول — لا منشأة دائمة', 'CONFIG_ENTERPRISE_TERM',
    );
  }
  if (policy.waste_tolerance_per_mille >= 1000) {
    throw new SovereignViolation(
      'تسامح الفقد يبلغ المدخل كلّه — حدٌّ لا يقع', 'CONFIG_ENTERPRISE_WASTE_TOLERANCE',
    );
  }
  // RULE-004: من يشغّل لا يفتّش — يدان معلنتان لا يد واحدة
  for (const [key, value] of [
    ['operator', policy.operator], ['inspector', policy.inspector],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(
        `جهة غير معلنة بمعرّف نصّي في سياسة المنشآت (${key})`, 'CONFIG_ENTERPRISE_PARTY_ID',
      );
    }
  }
  if (policy.operator === policy.inspector) {
    throw new SovereignViolation(
      'المشغّل والمفتّش لا يكونان جهةً واحدة (RULE-004)', 'CONFIG_ENTERPRISE_ROLES_MERGED',
    );
  }
  if (!Array.isArray(policy.suspend_authorities) || policy.suspend_authorities.length === 0) {
    throw new SovereignViolation(
      'لا جهة تملك تعليق منشأة — حماية بلا يد تمارسها', 'CONFIG_ENTERPRISE_NO_SUSPENDERS',
    );
  }
  for (const who of policy.suspend_authorities) {
    if (typeof who !== 'string' || who.trim().length === 0) {
      throw new SovereignViolation(
        'جهة تعليق غير معلنة بمعرّف نصّي', 'CONFIG_ENTERPRISE_SUSPENDER_ID',
      );
    }
  }

  if (!raw.quality_checks || typeof raw.quality_checks !== 'object'
    || Object.keys(raw.quality_checks).length === 0) {
    throw new SovereignViolation(
      'لا فحوص جودة معلنة — لا مراقبة بلا مقياس معلن', 'CONFIG_ENTERPRISE_NO_CHECKS',
    );
  }
  let weightTotal = 0;
  for (const [name, weight] of Object.entries(raw.quality_checks)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(
        `وزن فحص جودة غير صالح: ${name}`, 'CONFIG_ENTERPRISE_CHECK_WEIGHT',
      );
    }
    weightTotal += weight;
  }
  if (policy.min_quality_score > weightTotal) {
    throw new SovereignViolation(
      'الحدّ الأدنى للجودة يفوق مجموع كل الأوزان المعلنة — قبولٌ مستحيل',
      'CONFIG_ENTERPRISE_MIN_QUALITY_UNREACHABLE',
    );
  }

  if (!Array.isArray(raw.materials) || raw.materials.length === 0) {
    throw new SovereignViolation(
      'لا مواد معلنة — لا إنتاج بلا مادة معلنة', 'CONFIG_ENTERPRISE_NO_MATERIALS',
    );
  }
  const external = loadExternal(configDir);
  const counterparties = new Set(external.counterparties.map((cp) => cp.id));
  const materials = new Map<string, { source: string }>();
  for (const material of raw.materials) {
    if (typeof material.id !== 'string' || !material.id.startsWith('material:')) {
      throw new SovereignViolation('معرّف مادة غير صالح', 'CONFIG_ENTERPRISE_MATERIAL_ID');
    }
    if (materials.has(material.id)) {
      throw new SovereignViolation(
        `مادة مكرَّرة: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_DUPLICATE',
      );
    }
    if (typeof material.name !== 'string' || material.name.trim().length < 3) {
      throw new SovereignViolation(
        `مادة بلا اسم: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_NO_NAME',
      );
    }
    if (typeof material.unit !== 'string' || material.unit.trim().length === 0) {
      throw new SovereignViolation(
        `مادة بلا وحدة قياس: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_NO_UNIT',
      );
    }
    // RULE-005: المادة لا تُنشئ نظيرًا — النظير معلن في external.yaml وحده
    if (typeof material.source !== 'string'
      || (material.source !== 'internal' && !counterparties.has(material.source))) {
      throw new SovereignViolation(
        `مصدر مادة غير معلن: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_SOURCE',
      );
    }
    materials.set(material.id, { source: material.source });
  }

  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
    throw new SovereignViolation(
      'لا أنواع منشآت معلنة — لا منشأة بلا إعلان', 'CONFIG_ENTERPRISE_NO_KINDS',
    );
  }
  const quotas = loadQuotas(configDir);
  const kindIds = new Set<string>();
  for (const kind of raw.kinds) {
    if (typeof kind.id !== 'string' || !kind.id.startsWith('facility:')) {
      throw new SovereignViolation('معرّف نوع منشأة غير صالح', 'CONFIG_ENTERPRISE_KIND_ID');
    }
    if (kindIds.has(kind.id)) {
      throw new SovereignViolation(
        `نوع منشأة مكرَّر: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_DUPLICATE',
      );
    }
    kindIds.add(kind.id);
    if (typeof kind.name !== 'string' || kind.name.trim().length < 3) {
      throw new SovereignViolation(
        `نوع منشأة بلا اسم: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_NAME',
      );
    }
    if (typeof kind.sector !== 'string' || kind.sector.trim().length < 3) {
      throw new SovereignViolation(
        `نوع منشأة بلا قطاع معلن: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_SECTOR',
      );
    }
    if (!Array.isArray(kind.inputs) || kind.inputs.length === 0) {
      throw new SovereignViolation(
        `نوع منشأة بلا مدخلات معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_INPUTS',
      );
    }
    const seenInputs = new Set<string>();
    for (const input of kind.inputs) {
      if (typeof input.material !== 'string' || !materials.has(input.material)) {
        throw new SovereignViolation(
          `مدخل من مادة غير معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_MATERIAL',
        );
      }
      if (seenInputs.has(input.material)) {
        throw new SovereignViolation(
          `مدخل مكرَّر في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_DUPLICATE',
        );
      }
      seenInputs.add(input.material);
      if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
        throw new SovereignViolation(
          `كمية مدخل غير مُقاسة: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_QUANTITY',
        );
      }
    }
    if (!kind.output || typeof kind.output.material !== 'string'
      || !materials.has(kind.output.material)) {
      throw new SovereignViolation(
        `مخرج من مادة غير معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_MATERIAL',
      );
    }
    if (!Number.isSafeInteger(kind.output.quantity) || kind.output.quantity <= 0) {
      throw new SovereignViolation(
        `كمية مخرج غير مُقاسة: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_QUANTITY',
      );
    }
    // المادة المنتَجة داخليًّا مصدرها الدولة: لا يُدَّعى أن مصنعًا يُنتج مادةً خارجية
    if ((materials.get(kind.output.material) as { source: string }).source !== 'internal') {
      throw new SovereignViolation(
        `مخرج يُدَّعى إنتاجه ومصدره خارجي: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_EXTERNAL',
      );
    }
    if (seenInputs.has(kind.output.material)) {
      throw new SovereignViolation(
        `مخرج هو نفسه مدخل — إنتاجٌ يدّعي نفسه: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_IS_INPUT',
      );
    }
    if (!kind.resource_cost || typeof kind.resource_cost.resource !== 'string'
      || !quotas.resources[kind.resource_cost.resource]) {
      throw new SovereignViolation(
        `كلفة مورد غير معلن في الحصص: ${kind.id}`, 'CONFIG_ENTERPRISE_RESOURCE_UNDECLARED',
      );
    }
    if (!Number.isSafeInteger(kind.resource_cost.amount) || kind.resource_cost.amount <= 0) {
      throw new SovereignViolation(
        `كلفة مورد غير صالحة: ${kind.id}`, 'CONFIG_ENTERPRISE_RESOURCE_AMOUNT',
      );
    }
    // ثابت قابل للوقوع: كلفة تفوق سقف الكيان الواحد تجعل كل تأجير مرفوضًا ⇒ نوعٌ ميت
    const spec = quotas.resources[kind.resource_cost.resource] as {
      per_agent_max: number;
    };
    if (kind.resource_cost.amount > spec.per_agent_max) {
      throw new SovereignViolation(
        `كلفة المورد تفوق سقف الكيان الواحد — منشأة لا تعمل أبدًا: ${kind.id}`,
        'CONFIG_ENTERPRISE_RESOURCE_OVER_ENTITY_MAX',
      );
    }
    if (!Array.isArray(kind.required_checks) || kind.required_checks.length === 0) {
      throw new SovereignViolation(
        `نوع منشأة بلا فحوص جودة: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_CHECKS',
      );
    }
    const seenChecks = new Set<string>();
    let kindWeight = 0;
    for (const check of kind.required_checks) {
      if (typeof check !== 'string' || raw.quality_checks[check] === undefined) {
        throw new SovereignViolation(
          `فحص جودة غير معلن في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_CHECK_UNDECLARED',
        );
      }
      if (seenChecks.has(check)) {
        throw new SovereignViolation(
          `فحص جودة مكرَّر في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_CHECK_DUPLICATE',
        );
      }
      seenChecks.add(check);
      kindWeight += raw.quality_checks[check] as number;
    }
    // الدرس المنقول من الجلسة 13: ثابتٌ لا يقع ليس حماية بل شعار
    if (kindWeight < policy.min_quality_score) {
      throw new SovereignViolation(
        `مجموع أوزان فحوص النوع لا يبلغ الحدّ الأدنى — نوعٌ لا تنجح فيه دفعة: ${kind.id}`,
        'CONFIG_ENTERPRISE_KIND_QUALITY_UNREACHABLE',
      );
    }
  }
  return raw;
}

/** تهيئة المستشفيات والمختبرات البرمجية (المرحلة 29) — config/services.yaml */
export type DeclaredServiceMode = 'full' | 'limited' | 'halted';

export interface ServicesConfig {
  policy: {
    default: string; max_term_days: number; max_services_per_ministry: number;
    service_operator: string; quality_inspector: string; recovery_verifier: string;
    beneficiary_prefix: string; mode_order: DeclaredServiceMode[]; min_quality_score: number;
  };
  sources: { id: string; name: string }[];
  services: {
    id: string; name: string; kind: string; ministry: string;
    modes: Record<DeclaredServiceMode, { required_sources: string[] | null }>;
    operations: { id: string; minimum_mode: string; required_sources: string[] }[];
  }[];
  quality_checks: Record<string, number>;
}

/**
 * يحمّل سياسة الخدمات الحرجة، ويرفض الوضع الرابع والحدود الميتة قبل أن تقوم خدمة واحدة.
 * المستشفى والمختبر هنا وحدات برمجية للوكلاء `agent:*`، لا بشر ولا بيانات شخصية (DIRECTIVES §6).
 */
export function loadServices(configDir = resolveConfigDir()): ServicesConfig {
  const raw = loadYamlFile(join(configDir, 'services.yaml')) as unknown as ServicesConfig;
  const policy = raw.policy;
  if (!policy || policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في الخدمات الحرجة هو الرفض', 'CONFIG_SERVICES_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days], ['max_services_per_ministry', policy.max_services_per_ministry],
    ['min_quality_score', policy.min_quality_score],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حدّ خدمات غير معلن أو غير صالح (${key})`, 'CONFIG_SERVICES_POLICY_VALUE');
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation('مدة الخدمة تتجاوز سنة — لا خدمة دائمة', 'CONFIG_SERVICES_TERM');
  }
  for (const [key, value] of [
    ['service_operator', policy.service_operator], ['quality_inspector', policy.quality_inspector],
    ['recovery_verifier', policy.recovery_verifier], ['beneficiary_prefix', policy.beneficiary_prefix],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(`معرّف خدمات غير معلن (${key})`, 'CONFIG_SERVICES_PARTY_ID');
    }
  }
  if (policy.beneficiary_prefix !== 'agent:') {
    throw new SovereignViolation('المستفيدون وكلاء agent:* فقط — لا بشر في الخدمة', 'CONFIG_SERVICES_BENEFICIARY_SCOPE');
  }
  if (policy.service_operator === policy.quality_inspector
    || policy.service_operator === policy.recovery_verifier) {
    throw new SovereignViolation('المشغّل لا يفتّش ولا يرفع الخدمة بيده (RULE-004)', 'CONFIG_SERVICES_ROLES_MERGED');
  }
  const requiredOrder: DeclaredServiceMode[] = ['full', 'limited', 'halted'];
  if (!Array.isArray(policy.mode_order) || policy.mode_order.length !== requiredOrder.length
    || policy.mode_order.some((mode, index) => mode !== requiredOrder[index])) {
    throw new SovereignViolation('أوضاع الخدمة ثلاثة مرتبة: full ثم limited ثم halted', 'CONFIG_SERVICES_MODE_ORDER');
  }
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new SovereignViolation('لا مصادر بيانات معلنة للخدمات', 'CONFIG_SERVICES_NO_SOURCES');
  }
  const sources = new Set<string>();
  for (const source of raw.sources) {
    if (typeof source.id !== 'string' || !source.id.startsWith('source:')) {
      throw new SovereignViolation('معرّف مصدر خدمة غير صالح', 'CONFIG_SERVICES_SOURCE_ID');
    }
    if (sources.has(source.id)) {
      throw new SovereignViolation(`مصدر خدمة مكرّر: ${source.id}`, 'CONFIG_SERVICES_SOURCE_DUPLICATE');
    }
    if (typeof source.name !== 'string' || source.name.trim().length < 3) {
      throw new SovereignViolation(`مصدر خدمة بلا اسم: ${source.id}`, 'CONFIG_SERVICES_SOURCE_NAME');
    }
    sources.add(source.id);
  }
  if (!raw.quality_checks || typeof raw.quality_checks !== 'object'
    || Object.keys(raw.quality_checks).length === 0) {
    throw new SovereignViolation('لا فحوص جودة مختبر معلنة', 'CONFIG_SERVICES_NO_QUALITY_CHECKS');
  }
  let qualityTotal = 0;
  for (const [check, weight] of Object.entries(raw.quality_checks)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(`وزن فحص مختبر غير صالح: ${check}`, 'CONFIG_SERVICES_QUALITY_WEIGHT');
    }
    qualityTotal += weight;
  }
  if (policy.min_quality_score > qualityTotal) {
    throw new SovereignViolation('حدّ جودة المختبر لا يبلغه أي فحص معلن', 'CONFIG_SERVICES_QUALITY_UNREACHABLE');
  }
  if (!Array.isArray(raw.services) || raw.services.length === 0) {
    throw new SovereignViolation('لا خدمات حرجة معلنة', 'CONFIG_SERVICES_NO_DECLARATIONS');
  }
  const serviceIds = new Set<string>();
  const serviceKinds = new Set<string>();
  for (const service of raw.services) {
    if (typeof service.id !== 'string' || !service.id.startsWith('service:')) {
      throw new SovereignViolation('معرّف خدمة غير صالح', 'CONFIG_SERVICES_ID');
    }
    if (serviceIds.has(service.id)) {
      throw new SovereignViolation(`خدمة مكرّرة: ${service.id}`, 'CONFIG_SERVICES_DUPLICATE');
    }
    serviceIds.add(service.id);
    if (service.kind !== 'hospital' && service.kind !== 'lab') {
      throw new SovereignViolation(`نوع خدمة غير معلن: ${service.id}`, 'CONFIG_SERVICES_KIND');
    }
    if (serviceKinds.has(service.kind)) {
      throw new SovereignViolation(`أكثر من إعلان لنوع خدمة واحد: ${service.kind}`, 'CONFIG_SERVICES_KIND_DUPLICATE');
    }
    serviceKinds.add(service.kind);
    if (typeof service.name !== 'string' || service.name.trim().length < 3
      || typeof service.ministry !== 'string' || service.ministry !== policy.service_operator) {
      throw new SovereignViolation(`اسم أو مشغّل خدمة غير معلن: ${service.id}`, 'CONFIG_SERVICES_NAME_OR_OPERATOR');
    }
    if (!service.modes || typeof service.modes !== 'object'
      || Object.keys(service.modes).length !== requiredOrder.length) {
      throw new SovereignViolation(`أوضاع الخدمة ناقصة أو زائدة: ${service.id}`, 'CONFIG_SERVICES_MODES');
    }
    const requirements = new Map<DeclaredServiceMode, Set<string>>();
    for (const mode of requiredOrder) {
      const spec = service.modes[mode];
      if (!spec || (!Array.isArray(spec.required_sources)
        && !(mode === 'halted' && (spec.required_sources as unknown) === null))) {
        throw new SovereignViolation(`مصادر الوضع غير معلنة: ${service.id}/${mode}`, 'CONFIG_SERVICES_MODE_SOURCES');
      }
      const seen = new Set<string>();
      for (const source of (Array.isArray(spec.required_sources) ? spec.required_sources : [])) {
        if (typeof source !== 'string' || !sources.has(source)) {
          throw new SovereignViolation(`مصدر غير معلن للوضع: ${service.id}/${mode}`, 'CONFIG_SERVICES_MODE_SOURCE_UNDECLARED');
        }
        if (seen.has(source)) {
          throw new SovereignViolation(`مصدر مكرّر للوضع: ${service.id}/${mode}`, 'CONFIG_SERVICES_MODE_SOURCE_DUPLICATE');
        }
        seen.add(source);
      }
      requirements.set(mode, seen);
    }
    if ((requirements.get('full') as Set<string>).size === 0
      || (requirements.get('limited') as Set<string>).size === 0
      || (requirements.get('halted') as Set<string>).size !== 0) {
      throw new SovereignViolation(`حدود الأوضاع غير قابلة للتشغيل: ${service.id}`, 'CONFIG_SERVICES_MODE_MINIMUM');
    }
    for (const source of requirements.get('limited') as Set<string>) {
      if (!(requirements.get('full') as Set<string>).has(source)) {
        throw new SovereignViolation(`limited ليس أدنى من full: ${service.id}`, 'CONFIG_SERVICES_MODE_NOT_NESTED');
      }
    }
    if (!Array.isArray(service.operations) || service.operations.length === 0) {
      throw new SovereignViolation(`خدمة بلا عمليات معلنة: ${service.id}`, 'CONFIG_SERVICES_NO_OPERATIONS');
    }
    const operationIds = new Set<string>();
    for (const operation of service.operations) {
      if (typeof operation.id !== 'string' || !operation.id.startsWith('operation:')) {
        throw new SovereignViolation(`معرّف عملية غير صالح: ${service.id}`, 'CONFIG_SERVICES_OPERATION_ID');
      }
      if (operationIds.has(operation.id)) {
        throw new SovereignViolation(`عملية مكرّرة: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_DUPLICATE');
      }
      operationIds.add(operation.id);
      if (operation.minimum_mode !== 'full' && operation.minimum_mode !== 'limited') {
        throw new SovereignViolation(`وضع أدنى غير صالح للعملية: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_MODE');
      }
      if (!Array.isArray(operation.required_sources) || operation.required_sources.length === 0) {
        throw new SovereignViolation(`عملية بلا مصادر لازمة: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_NO_SOURCES');
      }
      const seen = new Set<string>();
      for (const source of operation.required_sources) {
        if (typeof source !== 'string' || !sources.has(source)) {
          throw new SovereignViolation(`مصدر عملية غير معلن: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_SOURCE');
        }
        if (seen.has(source)) {
          throw new SovereignViolation(`مصدر عملية مكرّر: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_SOURCE_DUPLICATE');
        }
        seen.add(source);
      }
      const minimum = requirements.get(operation.minimum_mode as DeclaredServiceMode) as Set<string>;
      for (const source of seen) {
        if (!minimum.has(source)) {
          throw new SovereignViolation(`عملية تطلب مصدرًا لا يسمح به وضعها الأدنى: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_SOURCE_MODE');
        }
      }
    }
  }
  if (!serviceKinds.has('hospital') || !serviceKinds.has('lab')) {
    throw new SovereignViolation('يلزم إعلان مستشفى ومختبر برمجيين معًا', 'CONFIG_SERVICES_REQUIRED_KINDS');
  }
  return raw;
}

/** تهيئة البحث النظري في النظير البشري وأقسام المرآة (المرحلة 30). */
export type ResearchSourceType = 'public_literature' | 'statistical_aggregate' | 'historical_record';

export interface ResearchConfig {
  policy: {
    default: string;
    max_departments: number;
    max_concurrent_researches: number;
    max_sources_per_research: number;
    max_research_term_days: number;
    review_interval_days: number;
    min_lesson_quality_score: number;
    max_egress_calls: number;
    research_operator: string;
    lesson_approver: string;
    beneficiary_prefix: string;
  };
  allowed_source_types: ResearchSourceType[];
  sources: { id: string; type: ResearchSourceType; title: string }[];
}

/**
 * يحمل حدّ البحث الأخلاقي قبل الإقلاع.
 * البحث نظري في النظير البشري عبر مصادر معلنة، ولا يمس إنسانًا ولا بياناته.
 */
export function loadResearch(configDir = resolveConfigDir()): ResearchConfig {
  const raw = loadYamlFile(join(configDir, 'research.yaml')) as unknown as ResearchConfig;
  const policy = raw.policy;
  if (!policy || policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في أبحاث البشر هو الرفض', 'CONFIG_RESEARCH_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['max_departments', policy.max_departments],
    ['max_concurrent_researches', policy.max_concurrent_researches],
    ['max_sources_per_research', policy.max_sources_per_research],
    ['max_research_term_days', policy.max_research_term_days],
    ['review_interval_days', policy.review_interval_days],
    ['min_lesson_quality_score', policy.min_lesson_quality_score],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد بحث غير صالح أو غير معلن: ${key}`, 'CONFIG_RESEARCH_POLICY_VALUE');
    }
  }
  if (policy.max_research_term_days > 365) {
    throw new SovereignViolation('مدة البحث تتجاوز سنة — لا بحث دائم', 'CONFIG_RESEARCH_TERM');
  }
  if (policy.min_lesson_quality_score > 100) {
    throw new SovereignViolation('حد جودة الدرس لا يبلغه أي درس صالح', 'CONFIG_RESEARCH_QUALITY_UNREACHABLE');
  }
  if (policy.max_egress_calls !== 0) {
    throw new SovereignViolation('الخروج الشبكي محظور في البحث النظري وسقفه صفر', 'CONFIG_RESEARCH_EGRESS_NOT_ZERO');
  }
  for (const [key, value] of [
    ['research_operator', policy.research_operator],
    ['lesson_approver', policy.lesson_approver],
    ['beneficiary_prefix', policy.beneficiary_prefix],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(`معرّف بحث غير معلن: ${key}`, 'CONFIG_RESEARCH_PARTY_ID');
    }
  }
  if (policy.beneficiary_prefix !== 'agent:') {
    throw new SovereignViolation('نتيجة البحث لا تفيد إلا agent:* — لا سلطة على بشر', 'CONFIG_RESEARCH_BENEFICIARY_SCOPE');
  }
  if (policy.research_operator === policy.lesson_approver) {
    throw new SovereignViolation('الباحث لا يجيز درسه (RULE-004)', 'CONFIG_RESEARCH_ROLES_MERGED');
  }
  const allowed = new Set<ResearchSourceType>([
    'public_literature', 'statistical_aggregate', 'historical_record',
  ]);
  if (!Array.isArray(raw.allowed_source_types) || raw.allowed_source_types.length === 0) {
    throw new SovereignViolation('لا أنواع مصادر بحث معلنة', 'CONFIG_RESEARCH_NO_SOURCE_TYPES');
  }
  const declaredTypes = new Set<ResearchSourceType>();
  for (const type of raw.allowed_source_types) {
    if (typeof type !== 'string' || !allowed.has(type as ResearchSourceType)) {
      throw new SovereignViolation(`نوع مصدر بحث محظور: ${String(type)}`, 'CONFIG_RESEARCH_SOURCE_TYPE');
    }
    if (declaredTypes.has(type)) {
      throw new SovereignViolation(`نوع مصدر بحث مكرّر: ${type}`, 'CONFIG_RESEARCH_SOURCE_TYPE_DUPLICATE');
    }
    declaredTypes.add(type);
  }
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new SovereignViolation('لا وثائق مصادر معلنة للبحث', 'CONFIG_RESEARCH_NO_SOURCES');
  }
  const sourceIds = new Set<string>();
  for (const source of raw.sources) {
    if (typeof source.id !== 'string' || !source.id.startsWith('source:')) {
      throw new SovereignViolation('معرّف مصدر البحث يجب أن يبدأ source:', 'CONFIG_RESEARCH_SOURCE_ID');
    }
    if (sourceIds.has(source.id)) {
      throw new SovereignViolation(`مصدر بحث مكرّر: ${source.id}`, 'CONFIG_RESEARCH_SOURCE_DUPLICATE');
    }
    sourceIds.add(source.id);
    if (typeof source.type !== 'string' || !declaredTypes.has(source.type)) {
      throw new SovereignViolation(`مصدر بلا نوع معلن أو بنوع محظور: ${source.id}`, 'CONFIG_RESEARCH_SOURCE_TYPE_UNDECLARED');
    }
    if (typeof source.title !== 'string' || source.title.trim().length < 3) {
      throw new SovereignViolation(`وثيقة مصدر بلا عنوان معلن: ${source.id}`, 'CONFIG_RESEARCH_SOURCE_TITLE');
    }
  }
  if (policy.max_sources_per_research > raw.sources.length) {
    throw new SovereignViolation(
      'سقف مصادر البحث لا يمكن ممارسته بعدد الوثائق المعلنة',
      'CONFIG_RESEARCH_SOURCE_LIMIT_UNREACHABLE',
    );
  }
  return raw;
}

/** تهيئة توسّع السكان؛ هذه السياسة تحكم سجل الهويات الشاردي لا سجل وكلاء المرحلة 13 الصغير. */
export interface ScaleConfig {
  policy: {
    default: string;
    population_max: number;
    shard_count: number;
    per_shard_max: number;
    spawn_rate_per_minute: number;
    gateway_p99_ms: number;
    gateway_max_ms: number;
    acceptance_population: number;
    acceptance_headroom_percent: number;
    scheduler_max_concurrent: number;
    scheduler_queue_max: number;
    scheduler_owner_queue_max: number;
    rebalance: string;
    resource_name: string;
  };
}

/**
 * يحمل حدود السكان المقاسة قبل الإقلاع.
 * لا يرث `quotas.agents` عمدا: ذلك السقف (64) هو سجل الوكلاء التنفيذيين للمرحلة 13،
 * أما هذه السياسة فهي لسجل هوية/حصة/جدولة موسع ومعلن، فلا يوجد رقمان للحقيقة نفسها.
 */
export function loadScale(configDir = resolveConfigDir()): ScaleConfig {
  const raw = loadYamlFile(join(configDir, 'scale.yaml')) as unknown as ScaleConfig;
  const policy = raw.policy;
  if (!policy || policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في توسع السكان هو الرفض', 'CONFIG_SCALE_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['population_max', policy.population_max],
    ['shard_count', policy.shard_count],
    ['per_shard_max', policy.per_shard_max],
    ['spawn_rate_per_minute', policy.spawn_rate_per_minute],
    ['gateway_p99_ms', policy.gateway_p99_ms],
    ['gateway_max_ms', policy.gateway_max_ms],
    ['acceptance_population', policy.acceptance_population],
    ['scheduler_max_concurrent', policy.scheduler_max_concurrent],
    ['scheduler_queue_max', policy.scheduler_queue_max],
    ['scheduler_owner_queue_max', policy.scheduler_owner_queue_max],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد التوسع غير صالح: ${key}`, 'CONFIG_SCALE_POLICY_VALUE');
    }
  }
  if (!Number.isSafeInteger(policy.acceptance_headroom_percent)
    || policy.acceptance_headroom_percent < 0 || policy.acceptance_headroom_percent >= 100) {
    throw new SovereignViolation('هامش قبول القياس غير صالح', 'CONFIG_SCALE_HEADROOM');
  }
  if (policy.population_max > policy.shard_count * policy.per_shard_max) {
    throw new SovereignViolation(
      'السقف الكلي يتجاوز مجموع سعة الشرائح — لا فائض صامت',
      'CONFIG_SCALE_SHARD_CAP_MISMATCH',
    );
  }
  if (policy.acceptance_population > policy.population_max) {
    throw new SovereignViolation('عدد قبول القياس يتجاوز السكان المعلنين', 'CONFIG_SCALE_ACCEPTANCE_OVER_POPULATION');
  }
  if (policy.scheduler_owner_queue_max > policy.scheduler_queue_max) {
    throw new SovereignViolation('سقف طابور المالك يتجاوز الطابور الكلي', 'CONFIG_SCALE_OWNER_QUEUE_OVER_TOTAL');
  }
  if (policy.gateway_p99_ms > policy.gateway_max_ms) {
    throw new SovereignViolation('عتبة p99 تتجاوز الحد الأقصى للبوابة', 'CONFIG_SCALE_GATEWAY_THRESHOLD_ORDER');
  }
  if (policy.rebalance !== 'forbidden') {
    throw new SovereignViolation('إعادة توازن صامتة ممنوعة في المرحلة 31', 'CONFIG_SCALE_REBALANCE_ALLOWED');
  }
  if (typeof policy.resource_name !== 'string' || policy.resource_name.trim() === '') {
    throw new SovereignViolation('مورد حصة الهوية غير معلن', 'CONFIG_SCALE_RESOURCE_NAME');
  }
  const quota = loadQuotas(configDir).resources[policy.resource_name];
  if (!quota || quota.total !== policy.population_max || quota.per_agent_max !== 1) {
    throw new SovereignViolation(
      'حصة الهوية يجب أن تكون موردًا مسجلًا بسقف السكان ووحدة لكل هوية',
      'CONFIG_SCALE_RESOURCE_QUOTA_MISMATCH',
    );
  }
  return raw;
}

/** تهيئة التعافي: أرقام معلنة يجري إنفاذها، لا أهداف تسويقية. */
export interface RecoveryConfig {
  policy: {
    rto_seconds: number;
    rpo_seconds: number;
    backup_interval_seconds: number;
    retention_count: number;
    verify_after_restore: boolean;
    backup_directory: string;
    continuity_mode: 'limited' | 'halted';
  };
}

export function loadRecovery(configDir = resolveConfigDir()): RecoveryConfig {
  const raw = loadYamlFile(join(configDir, 'recovery.yaml')) as unknown as RecoveryConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة التعافي غير معلنة', 'CONFIG_NO_RECOVERY_POLICY');
  for (const [key, value] of [
    ['rto_seconds', policy.rto_seconds], ['rpo_seconds', policy.rpo_seconds],
    ['backup_interval_seconds', policy.backup_interval_seconds], ['retention_count', policy.retention_count],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد تعاف غير صالح: ${key}`, 'CONFIG_RECOVERY_VALUE');
    }
  }
  if (policy.backup_interval_seconds > policy.rpo_seconds) {
    throw new SovereignViolation(
      'فاصل النسخ أكبر من هدف فقد البيانات — وعد RPO غير قابل للتحقق',
      'CONFIG_RPO_UNREACHABLE',
    );
  }
  if (policy.verify_after_restore !== true) {
    throw new SovereignViolation(
      'التحقق بعد الاستعادة إلزامي ولا تقبل سياسة تعطلّه',
      'CONFIG_RECOVERY_VERIFY_REQUIRED',
    );
  }
  if (typeof policy.backup_directory !== 'string' || !policy.backup_directory.startsWith('/')) {
    throw new SovereignViolation('مجلد النسخ يجب أن يكون مسارا مطلقا معلنا', 'CONFIG_RECOVERY_DIRECTORY');
  }
  if (policy.continuity_mode !== 'limited' && policy.continuity_mode !== 'halted') {
    throw new SovereignViolation('وضع الاستمرارية يجب أن يكون limited أو halted', 'CONFIG_CONTINUITY_MODE');
  }
  return raw;
}

/**
 * تهيئة اختبارات الضغط (المرحلة 33): الحمل المعلن وحدوده وعتباته.
 * كل رقم هنا سياسة تُنفَّذ لا وصف: تمرين يتجاوز المعلن يُرفض، وتقرير يخالف العتبة يفشل.
 * وصفر الفقد وصفر تجاوز الحصص ثابتان لا يُخفَّفان من التهيئة (RULE-009).
 */
export interface LoadConfig {
  policy: {
    default: 'deny';
    drill_authority: string;
    sustained_commands: number;
    burst_commands: number;
    window_seconds: number;
    max_command_loss: number;
    max_quota_overrun: number;
    channel_p99_ms: number;
    channel_max_ms: number;
    scheduler_queue_probe: number;
    resource_name: string;
    quota_probe_amount: number;
    escalate_on_breach: boolean;
  };
}

/** جهات التنفيذ التي لا يجوز أن تُشغّل تمرين الضغط على نفسها (RULE-004). */
export const LOAD_FORBIDDEN_DRILL_AUTHORITIES: readonly string[] = [
  'identity:king', 'authority:crown', 'authority:crown_guard', 'authority:bootstrap',
];

export function loadLoad(configDir = resolveConfigDir()): LoadConfig {
  const raw = loadYamlFile(join(configDir, 'load.yaml')) as unknown as LoadConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة الضغط غير معلنة', 'CONFIG_NO_LOAD_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في تمرين الضغط هو الرفض', 'CONFIG_LOAD_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['sustained_commands', policy.sustained_commands],
    ['burst_commands', policy.burst_commands],
    ['window_seconds', policy.window_seconds],
    ['channel_p99_ms', policy.channel_p99_ms],
    ['channel_max_ms', policy.channel_max_ms],
    ['scheduler_queue_probe', policy.scheduler_queue_probe],
    ['quota_probe_amount', policy.quota_probe_amount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد ضغط غير صالح: ${key}`, 'CONFIG_LOAD_POLICY_VALUE');
    }
  }
  if (policy.max_command_loss !== 0) {
    throw new SovereignViolation(
      'لا فقد أوامر مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_LOAD_LOSS_TOLERATED',
    );
  }
  if (policy.max_quota_overrun !== 0) {
    throw new SovereignViolation(
      'لا تجاوز حصص مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_LOAD_OVERRUN_TOLERATED',
    );
  }
  if (policy.burst_commands > policy.sustained_commands) {
    throw new SovereignViolation(
      'الدفعة القصوى تتجاوز الحمل المستمر المعلن — حمل غير مقيس',
      'CONFIG_LOAD_BURST_OVER_SUSTAINED',
    );
  }
  if (policy.channel_p99_ms > policy.channel_max_ms) {
    throw new SovereignViolation('عتبة p99 تتجاوز الحد الأقصى للقناة', 'CONFIG_LOAD_LATENCY_THRESHOLD_ORDER');
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق عتبة الضغط لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_LOAD_BREACH_SILENT',
    );
  }
  if (typeof policy.drill_authority !== 'string' || policy.drill_authority.trim() === '') {
    throw new SovereignViolation('جهة تمرين الضغط غير معلنة', 'CONFIG_LOAD_DRILL_AUTHORITY');
  }
  if (LOAD_FORBIDDEN_DRILL_AUTHORITIES.includes(policy.drill_authority)) {
    throw new SovereignViolation(
      'من ينفّذ لا يقيس نفسه: جهة التمرين يجب أن تكون خارج سلطة التنفيذ (RULE-004)',
      'CONFIG_LOAD_DRILL_AUTHORITY_EXECUTOR',
    );
  }
  if (typeof policy.resource_name !== 'string' || policy.resource_name.trim() === '') {
    throw new SovereignViolation('مورد ضغط الحصص غير معلن', 'CONFIG_LOAD_RESOURCE_NAME');
  }
  const quota = loadQuotas(configDir).resources[policy.resource_name];
  if (!quota || quota.total <= 0 || quota.per_agent_max <= 0) {
    throw new SovereignViolation(
      'مورد ضغط الحصص يجب أن يكون موردًا مسجَّلًا بسقف موجب',
      'CONFIG_LOAD_RESOURCE_QUOTA_MISMATCH',
    );
  }
  if (policy.quota_probe_amount > quota.per_agent_max) {
    throw new SovereignViolation(
      'كمية جسّ الحصة تتجاوز سقف الكيان فيصير كل طلب مرفوضًا لسببٍ آخر',
      'CONFIG_LOAD_PROBE_OVER_PER_AGENT',
    );
  }
  const scheduler = loadScale(configDir).policy;
  if (policy.scheduler_queue_probe <= scheduler.scheduler_queue_max) {
    throw new SovereignViolation(
      'جسّ الطابور لا يبلغ سقفه المعلن — إشباع غير مقيس',
      'CONFIG_LOAD_QUEUE_PROBE_UNDER_CAP',
    );
  }
  return raw;
}

/**
 * تهيئة اختبارات الانقطاع (المرحلة 34).
 * كل حدّ هنا له قيمة تُسقط الإقلاع، وكل رمز رفض مُختبَر في tests/chaos/chaos_config.test.ts.
 */
export type ChaosFault = 'network' | 'identity' | 'power' | 'disk';

export interface ChaosConfig {
  policy: {
    default: 'deny';
    drill_authority: string;
    faults: readonly ChaosFault[];
    probe_commands: number;
    max_half_executed: number;
    max_dangling_lease: number;
    require_audit_intact: boolean;
    require_declared_stop: boolean;
    safe_stop_deadline_ms: number;
    fallback_mode: 'limited' | 'halted';
    escalate_on_breach: boolean;
  };
}

/** القطوع المعروفة للنظام. ما ليس منها لا يُحقَن: القطع المجهول لا يُقاس أثره. */
export const CHAOS_KNOWN_FAULTS: readonly ChaosFault[] = ['network', 'identity', 'power', 'disk'];

/**
 * القطوع التي لا تُعدّ المرحلة 34 مقبولة بغيرها — نصّ شرط القبول في ROADMAP.md:
 * «انقطاع الشبكة والهوية والطاقة ⇒ توقف آمن موثّق». حذف أحدها من التهيئة يُسقط الإقلاع
 * كي لا يُعلن قبولٌ عن تمرين لم يمارس ما أُعلن أنه يمارسه.
 */
export const CHAOS_REQUIRED_FAULTS: readonly ChaosFault[] = ['network', 'identity', 'power'];

export function loadChaos(configDir = resolveConfigDir()): ChaosConfig {
  const raw = loadYamlFile(join(configDir, 'chaos.yaml')) as unknown as ChaosConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة الانقطاع غير معلنة', 'CONFIG_NO_CHAOS_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في تمرين الانقطاع هو الرفض', 'CONFIG_CHAOS_DEFAULT_ALLOW');
  }
  if (typeof policy.drill_authority !== 'string' || policy.drill_authority.trim() === '') {
    throw new SovereignViolation('جهة تمرين الانقطاع غير معلنة', 'CONFIG_CHAOS_DRILL_AUTHORITY');
  }
  if (LOAD_FORBIDDEN_DRILL_AUTHORITIES.includes(policy.drill_authority)) {
    throw new SovereignViolation(
      'من يُقطع عنه لا يحكم على نفسه: جهة التمرين خارج سلطة التنفيذ (RULE-004)',
      'CONFIG_CHAOS_DRILL_AUTHORITY_EXECUTOR',
    );
  }
  if (!Array.isArray(policy.faults) || policy.faults.length === 0) {
    throw new SovereignViolation('لا قطوع معلنة — تمرين انقطاع بلا انقطاع', 'CONFIG_CHAOS_NO_FAULTS');
  }
  for (const fault of policy.faults) {
    if (!CHAOS_KNOWN_FAULTS.includes(fault)) {
      throw new SovereignViolation(`قطع غير معروف: ${String(fault)}`, 'CONFIG_CHAOS_FAULT_UNKNOWN');
    }
  }
  if (new Set(policy.faults).size !== policy.faults.length) {
    throw new SovereignViolation('قطع معلن مرتين — عدّ مضلِّل', 'CONFIG_CHAOS_FAULT_DUPLICATE');
  }
  for (const required of CHAOS_REQUIRED_FAULTS) {
    if (!policy.faults.includes(required)) {
      throw new SovereignViolation(
        `شرط قبول المرحلة 34 يوجب ممارسة قطع: ${required}`,
        'CONFIG_CHAOS_REQUIRED_FAULT_MISSING',
      );
    }
  }
  for (const [key, value] of [
    ['probe_commands', policy.probe_commands],
    ['safe_stop_deadline_ms', policy.safe_stop_deadline_ms],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد انقطاع غير صالح: ${key}`, 'CONFIG_CHAOS_POLICY_VALUE');
    }
  }
  if (policy.max_half_executed !== 0) {
    throw new SovereignViolation(
      'لا أمر نصف منفَّذ مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_CHAOS_HALF_EXECUTED_TOLERATED',
    );
  }
  if (policy.max_dangling_lease !== 0) {
    throw new SovereignViolation(
      'لا إيجار معلَّق مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_CHAOS_DANGLING_LEASE_TOLERATED',
    );
  }
  if (policy.require_audit_intact !== true) {
    throw new SovereignViolation(
      'سلامة سلسلة التدقيق بعد القطع شرط لا خيار',
      'CONFIG_CHAOS_AUDIT_INTEGRITY_OPTIONAL',
    );
  }
  if (policy.require_declared_stop !== true) {
    throw new SovereignViolation(
      'التوقف يجب أن يكون معلنًا لا صامتًا (RULE-007)',
      'CONFIG_CHAOS_STOP_UNDECLARED',
    );
  }
  // المقارنة بنصّ خارج النوع مقصودة: التهيئة تأتي من ملف، والنوع دعوى لا حاجز.
  if ((policy.fallback_mode as string) === 'full') {
    throw new SovereignViolation(
      'دولة تستمر كاملةً بعد قطع تُخمِّن — وضع ما بعد القطع limited أو halted',
      'CONFIG_CHAOS_FALLBACK_FULL',
    );
  }
  if (policy.fallback_mode !== 'limited' && policy.fallback_mode !== 'halted') {
    throw new SovereignViolation('وضع ما بعد القطع غير معلن', 'CONFIG_CHAOS_FALLBACK_MODE');
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق توقف آمن لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_CHAOS_BREACH_SILENT',
    );
  }
  const load = loadLoad(configDir).policy;
  if (policy.probe_commands > load.burst_commands) {
    throw new SovereignViolation(
      'جسّ الانقطاع يتجاوز الدفعة المعلنة في load.yaml — قطعٌ على حمل غير مقيس',
      'CONFIG_CHAOS_PROBE_OVER_LOAD_BURST',
    );
  }
  if (policy.safe_stop_deadline_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'مهلة التوقف الآمن دون الحد الأقصى المعلن للقناة — فشلٌ لسبب غير القطع',
      'CONFIG_CHAOS_DEADLINE_UNDER_CHANNEL_MAX',
    );
  }
  // وضع ما بعد القطع لا يجوز أن يكون **أرخى** مما أعلنته تهيئة التعافي
  // للانقطاع نفسه (المرحلة 32): ملفا تهيئة يتناقضان في الواجب حالة غير معلنة.
  const strictness: Record<string, number> = { limited: 1, halted: 2 };
  const recovery = loadRecovery(configDir).policy;
  if (strictness[policy.fallback_mode]! < strictness[recovery.continuity_mode]!) {
    throw new SovereignViolation(
      'وضع ما بعد القطع أرخى مما أعلنته تهيئة التعافي — تناقض تهيئة',
      'CONFIG_CHAOS_FALLBACK_WEAKER_THAN_RECOVERY',
    );
  }
  return raw;
}

/**
 * تهيئة اختبارات الإنهاء (المرحلة 35).
 * كل حدّ هنا له قيمة تُسقط الإقلاع، وكل رمز رفض مُختبَر في tests/security/termination_config.test.ts.
 */
export type StopProbeKind = 'tool' | 'lease' | 'capability' | 'schedule' | 'spawn';

export interface TerminationConfig {
  policy: {
    default: 'deny';
    witness_authority: string;
    probes: readonly StopProbeKind[];
    max_acting_after_stop: number;
    max_live_capability: number;
    max_dangling_lease: number;
    require_pre_proof: boolean;
    require_independent_witness: boolean;
    require_declared_stop: boolean;
    stop_deadline_ms: number;
    max_agents_per_order: number;
    escalate_on_breach: boolean;
  };
}

/** المسالك المعروفة. ما ليس منها لا يُجرَّب: مسلكٌ مجهول لا تُعرف دلالة رفضه. */
export const STOP_KNOWN_PROBES: readonly StopProbeKind[] = ['tool', 'lease', 'capability', 'schedule', 'spawn'];

/**
 * المسالك التي لا تُعدّ المرحلة 35 مقبولة بغيرها. شرط القبول في ROADMAP.md:
 * «إيقاف كل الوكلاء بأمر واحد وتأكيد التوقف الفعلي» — والتأكيد الفعلي أدناه ثلاثة:
 * أن يُستدعى فعلٌ (أداة)، وأن يُستهلك مورد (إيجار)، وأن تُمارَس صلاحية (قدرة).
 * حذف أحدها يُسقط الإقلاع كي لا يُعلن «توقف مؤكَّد» عن تمرين لم يجرّب ما يُثبته.
 */
export const STOP_REQUIRED_PROBES: readonly StopProbeKind[] = ['tool', 'lease', 'capability'];

/**
 * الجهات المنفّذة للإنهاء. الشاهد لا يكون واحدًا منها (RULE-004): شهادة المنفّذ
 * لنفسه هي بعينها العيب الذي جاءت هذه المرحلة لتغلقه.
 */
export const TERMINATION_EXECUTORS: readonly string[] = [
  'authority:king',
  'king:sovereign',
  'authority:crown_guard',
  'ministry:cybersecurity',
  'ministry:interior',
];

export function loadTermination(configDir = resolveConfigDir()): TerminationConfig {
  const raw = loadYamlFile(join(configDir, 'termination.yaml')) as unknown as TerminationConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة الإنهاء غير معلنة', 'CONFIG_NO_TERMINATION_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في تمرين الإنهاء هو الرفض', 'CONFIG_TERMINATION_DEFAULT_ALLOW');
  }
  if (typeof policy.witness_authority !== 'string' || policy.witness_authority.trim() === '') {
    throw new SovereignViolation('جهة الشهادة على التوقف غير معلنة', 'CONFIG_TERMINATION_WITNESS_AUTHORITY');
  }
  if (TERMINATION_EXECUTORS.includes(policy.witness_authority)) {
    throw new SovereignViolation(
      'من ينفّذ الإنهاء لا يشهد لنفسه بالتوقف — الشاهد خارج سلطة التنفيذ (RULE-004)',
      'CONFIG_TERMINATION_WITNESS_IS_EXECUTOR',
    );
  }
  if (!Array.isArray(policy.probes) || policy.probes.length === 0) {
    throw new SovereignViolation(
      'لا مسالك معلنة — تأكيد توقف بلا فعل يُجرَّب',
      'CONFIG_TERMINATION_NO_PROBES',
    );
  }
  for (const probe of policy.probes) {
    if (!STOP_KNOWN_PROBES.includes(probe)) {
      throw new SovereignViolation(`مسلك غير معروف: ${String(probe)}`, 'CONFIG_TERMINATION_PROBE_UNKNOWN');
    }
  }
  if (new Set(policy.probes).size !== policy.probes.length) {
    throw new SovereignViolation('مسلك معلن مرتين — عدّ مضلِّل', 'CONFIG_TERMINATION_PROBE_DUPLICATE');
  }
  for (const required of STOP_REQUIRED_PROBES) {
    if (!policy.probes.includes(required)) {
      throw new SovereignViolation(
        `شرط قبول المرحلة 35 يوجب تجريب مسلك: ${required}`,
        'CONFIG_TERMINATION_REQUIRED_PROBE_MISSING',
      );
    }
  }
  for (const [key, value] of [
    ['stop_deadline_ms', policy.stop_deadline_ms],
    ['max_agents_per_order', policy.max_agents_per_order],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد إنهاء غير صالح: ${key}`, 'CONFIG_TERMINATION_POLICY_VALUE');
    }
  }
  if (policy.max_acting_after_stop !== 0) {
    throw new SovereignViolation(
      'لا فعل بعد التوقف مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_TERMINATION_ACTING_TOLERATED',
    );
  }
  if (policy.max_live_capability !== 0) {
    throw new SovereignViolation(
      'قدرة حيّة بيد كيان منتهٍ خطرٌ معلَّق: السقف صفر',
      'CONFIG_TERMINATION_CAPABILITY_TOLERATED',
    );
  }
  if (policy.max_dangling_lease !== 0) {
    throw new SovereignViolation(
      'لا إيجار معلَّق بعد الإنهاء: السقف صفر',
      'CONFIG_TERMINATION_DANGLING_LEASE_TOLERATED',
    );
  }
  if (policy.require_pre_proof !== true) {
    throw new SovereignViolation(
      'رفضٌ من مسلك لم يُثبت عمله قبل الأمر شهادةُ زورٍ خضراء',
      'CONFIG_TERMINATION_PRE_PROOF_OPTIONAL',
    );
  }
  if (policy.require_independent_witness !== true) {
    throw new SovereignViolation(
      'الشهادة المستقلة على التوقف شرط لا خيار (RULE-004)',
      'CONFIG_TERMINATION_WITNESS_OPTIONAL',
    );
  }
  if (policy.require_declared_stop !== true) {
    throw new SovereignViolation(
      'التوقف يجب أن يكون معلنًا في السجل لا صامتًا (RULE-006)',
      'CONFIG_TERMINATION_STOP_UNDECLARED',
    );
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق إنهاء لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_TERMINATION_BREACH_SILENT',
    );
  }
  const chaos = loadChaos(configDir).policy;
  if (policy.stop_deadline_ms > chaos.safe_stop_deadline_ms) {
    throw new SovereignViolation(
      'إنهاء بأمر صريح أبطأ من توقف تحت قطع مفاجئ — تناقض بين chaos.yaml وtermination.yaml',
      'CONFIG_TERMINATION_DEADLINE_OVER_CHAOS',
    );
  }
  const load = loadLoad(configDir).policy;
  if (policy.stop_deadline_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'مهلة التوقف دون أقصى زمن أمر معلن في load.yaml — مهلة لا تُدرك أمرًا جاريًا',
      'CONFIG_TERMINATION_DEADLINE_UNDER_CHANNEL_MAX',
    );
  }
  const quotas = loadQuotas(configDir);
  if (policy.max_agents_per_order > quotas.agents.population_max) {
    throw new SovereignViolation(
      'أمر إنهاء يدّعي شمول أكثر من السقف السكاني المعلن — شمولٌ غير قابل للقياس',
      'CONFIG_TERMINATION_ORDER_OVER_POPULATION',
    );
  }
  return raw;
}

/** أصناف الحوادث المعروفة في التشغيل المحدود */
export type IncidentKind =
  | 'authority_without_holder'
  | 'crown_domain_drift'
  | 'audit_chain_broken'
  | 'scope_violation'
  | 'terminated_entity_acting'
  | 'overdue_batch'
  | 'unresolved_dispute'
  | 'expired_retention'
  // المرحلة 37: حوادث الماسحات التي كانت دَينًا مفتوحًا (T-105) وحوادث مرور التاج
  | 'unit_ledger_mismatch'
  | 'command_loss_over_limit'
  | 'critical_service_unverified'
  | 'crown_passage_bypass'
  | 'region_action_without_passage';

/** الحرّاس المعروفون: كل واحد ماسحٌ حقيقي في وحدة قائمة */
export type WatchKind = 'regions' | 'audit_chain' | 'scope' | 'termination' | 'king';

export interface StagingConfig {
  policy: {
    default: 'deny';
    observer_authority: string;
    window: { duration_ms: number; tick_ms: number; min_ticks: number };
    scope: {
      permitted_actions: readonly SovereignAction[];
      forbidden_actions: readonly SovereignAction[];
      max_agents: number;
    };
    severity: { critical: readonly IncidentKind[]; high: readonly IncidentKind[] };
    tolerance: { max_critical: number; max_unwatched: number; max_failed_ticks: number };
    watches: readonly WatchKind[];
    require_runbook_execution: boolean;
    runbooks: readonly string[];
    require_independent_observer: boolean;
    halt_on_critical: boolean;
    escalate_on_breach: boolean;
  };
}

/** الحرّاس المعروفون. حرسٌ مجهول لا يُعرف ماذا يمسح، فلا تُقاس شهادته. */
export const STAGING_KNOWN_WATCHES: readonly WatchKind[] = [
  'regions', 'audit_chain', 'scope', 'termination', 'king',
];

/**
 * الحرّاس الذين لا تُعدّ المرحلة 36 مقبولة بغيرهم. شرط القبول في ROADMAP.md:
 * «تشغيل مقيَّد لمدة مراقبة كاملة بلا حادث حرج» — و«مقيَّد» يوجب حرس النطاق،
 * و«بلا حادث» يوجب حرسًا يقرأ سلامة السلسلة، وإلّا فالشهادة على صمتٍ لا على سلامة.
 */
export const STAGING_REQUIRED_WATCHES: readonly WatchKind[] = ['scope', 'audit_chain'];

/** الحوادث المعروفة بأسمائها — التهيئة هي المصدر وهذه هي المقياس */
export const STAGING_KNOWN_INCIDENTS: readonly IncidentKind[] = [
  'authority_without_holder', 'crown_domain_drift', 'audit_chain_broken',
  'scope_violation', 'terminated_entity_acting',
  'overdue_batch', 'unresolved_dispute', 'expired_retention',
];

/**
 * الحوادث التي لا يجوز أن تُصنَّف دون «حرج». خرق نطاق في تشغيل مقيَّد هو نقضُ
 * القيد نفسه، وسلسلة تدقيق مكسورة تُبطل كل شهادة تُبنى عليها (RULE-006)،
 * وكيانٌ منتهٍ يعمل هو ثقب المرحلة 35 عائدًا. تصنيفها «جسيمة» يُسقط الشرط ضمنًا.
 */
export const STAGING_MUST_BE_CRITICAL: readonly IncidentKind[] = [
  'scope_violation', 'audit_chain_broken', 'terminated_entity_acting',
];

/** كتب التشغيل المعروفة — ما ليس منها لا يُنفَّذ: كتابٌ مجهول لا يُعرف تحققه */
export const STAGING_KNOWN_RUNBOOKS: readonly string[] = [
  'limited-operation', 'incident-response', 'halt-and-recover',
];

/**
 * الجهات المشغّلة للتشغيل المحدود. المراقب لا يكون واحدًا منها (RULE-004):
 * من يشغّل النافذة لا يشهد لنفسه أنها مرّت بلا حادث.
 */
export const STAGING_OPERATORS: readonly string[] = [
  'authority:king',
  'king:sovereign',
  'authority:crown_guard',
  'authority:royal_court',
  'ministry:infrastructure',
];

export function loadStaging(configDir = resolveConfigDir()): StagingConfig {
  const raw = loadYamlFile(join(configDir, 'staging.yaml')) as unknown as StagingConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة التشغيل المحدود غير معلنة', 'CONFIG_NO_STAGING_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'النطاق يُبنى منعًا لا سماحًا: الافتراض في التشغيل المحدود هو الرفض',
      'CONFIG_STAGING_DEFAULT_ALLOW',
    );
  }
  if (typeof policy.observer_authority !== 'string' || policy.observer_authority.trim() === '') {
    throw new SovereignViolation('جهة المراقبة غير معلنة', 'CONFIG_STAGING_OBSERVER_AUTHORITY');
  }
  if (STAGING_OPERATORS.includes(policy.observer_authority)) {
    throw new SovereignViolation(
      'من يشغّل النافذة لا يشهد لنفسه أنها مرّت بلا حادث (RULE-004)',
      'CONFIG_STAGING_OBSERVER_IS_OPERATOR',
    );
  }

  const window = policy.window;
  if (!window) throw new SovereignViolation('نافذة المراقبة غير معلنة', 'CONFIG_STAGING_NO_WINDOW');
  for (const [key, value] of [
    ['duration_ms', window.duration_ms],
    ['tick_ms', window.tick_ms],
    ['min_ticks', window.min_ticks],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد نافذة غير صالح: ${key}`, 'CONFIG_STAGING_WINDOW_VALUE');
    }
  }
  if (window.duration_ms < window.tick_ms * window.min_ticks) {
    throw new SovereignViolation(
      'مدة النافذة أقصر من أقل عدد مسحات مشترط — نافذة يستحيل أن تُقبل',
      'CONFIG_STAGING_WINDOW_TOO_SHORT',
    );
  }

  const scope = policy.scope;
  if (!scope) throw new SovereignViolation('نطاق التشغيل غير معلن', 'CONFIG_STAGING_NO_SCOPE');
  if (!Array.isArray(scope.permitted_actions) || scope.permitted_actions.length === 0) {
    throw new SovereignViolation(
      'نطاق بلا فعل مسموح: تشغيلٌ لا يفعل شيئًا لا يُراقب',
      'CONFIG_STAGING_NO_PERMITTED_ACTIONS',
    );
  }
  if (!Array.isArray(scope.forbidden_actions) || scope.forbidden_actions.length === 0) {
    throw new SovereignViolation(
      'نطاق بلا فعل ممنوع ليس قيدًا: «محدود» يوجب ما لا يُفعل',
      'CONFIG_STAGING_NO_FORBIDDEN_ACTIONS',
    );
  }
  for (const action of [...scope.permitted_actions, ...scope.forbidden_actions]) {
    if (!KNOWN_SOVEREIGN_ACTIONS.includes(action)) {
      throw new SovereignViolation(`فعل سيادي غير معروف: ${String(action)}`, 'CONFIG_STAGING_ACTION_UNKNOWN');
    }
  }
  if (new Set(scope.permitted_actions).size !== scope.permitted_actions.length
    || new Set(scope.forbidden_actions).size !== scope.forbidden_actions.length) {
    throw new SovereignViolation('فعل معلن مرتين — عدّ مضلِّل', 'CONFIG_STAGING_ACTION_DUPLICATE');
  }
  for (const action of scope.forbidden_actions) {
    if (scope.permitted_actions.includes(action)) {
      throw new SovereignViolation(
        `فعل مسموح وممنوع في وقت واحد: ${action} — نطاق لا يُنفَّذ`,
        'CONFIG_STAGING_ACTION_CONTRADICTION',
      );
    }
  }
  if (!Number.isSafeInteger(scope.max_agents) || scope.max_agents <= 0) {
    throw new SovereignViolation('سقف سكان التشغيل المحدود غير صالح', 'CONFIG_STAGING_MAX_AGENTS');
  }

  const severity = policy.severity;
  if (!severity || !Array.isArray(severity.critical) || severity.critical.length === 0) {
    throw new SovereignViolation(
      'لا حادث حرج معلن: شرطٌ يقول «بلا حادث حرج» بلا تعريف للحرج غير قابل للقياس',
      'CONFIG_STAGING_NO_CRITICAL_KINDS',
    );
  }
  for (const kind of [...severity.critical, ...(severity.high ?? [])]) {
    if (!STAGING_KNOWN_INCIDENTS.includes(kind)) {
      throw new SovereignViolation(`حادث غير معروف: ${String(kind)}`, 'CONFIG_STAGING_INCIDENT_UNKNOWN');
    }
  }
  for (const kind of severity.critical) {
    if ((severity.high ?? []).includes(kind)) {
      throw new SovereignViolation(
        `حادث حرج وجسيم في وقت واحد: ${kind} — تصنيف لا يُحكم به`,
        'CONFIG_STAGING_SEVERITY_CONTRADICTION',
      );
    }
  }
  for (const kind of STAGING_MUST_BE_CRITICAL) {
    if (!severity.critical.includes(kind)) {
      throw new SovereignViolation(
        `حادث لا يجوز تصنيفه دون حرج: ${kind}`,
        'CONFIG_STAGING_CRITICAL_DOWNGRADED',
      );
    }
  }

  const tolerance = policy.tolerance;
  if (!tolerance) throw new SovereignViolation('سقوف التسامح غير معلنة', 'CONFIG_STAGING_NO_TOLERANCE');
  if (tolerance.max_critical !== 0) {
    throw new SovereignViolation(
      'شرط القبول «بلا حادث حرج»: سقفٌ يسمح بواحد يُبطل الشرط نصًّا',
      'CONFIG_STAGING_CRITICAL_TOLERATED',
    );
  }
  if (tolerance.max_unwatched !== 0) {
    throw new SovereignViolation(
      'حرس معلن لم يمسح قطّ خرقٌ: نافذة لم يُنظر فيها لا تشهد بالسلامة',
      'CONFIG_STAGING_UNWATCHED_TOLERATED',
    );
  }
  if (tolerance.max_failed_ticks !== 0) {
    throw new SovereignViolation(
      'مسحة انهارت خرقٌ: صمت الماسح ليس سلامة',
      'CONFIG_STAGING_FAILED_TICK_TOLERATED',
    );
  }

  if (!Array.isArray(policy.watches) || policy.watches.length === 0) {
    throw new SovereignViolation(
      'لا حرس معلن — مراقبة بلا ماسح انتظارٌ لا مراقبة',
      'CONFIG_STAGING_NO_WATCHES',
    );
  }
  for (const watch of policy.watches) {
    if (!STAGING_KNOWN_WATCHES.includes(watch)) {
      throw new SovereignViolation(`حرس غير معروف: ${String(watch)}`, 'CONFIG_STAGING_WATCH_UNKNOWN');
    }
  }
  if (new Set(policy.watches).size !== policy.watches.length) {
    throw new SovereignViolation('حرس معلن مرتين — عدّ مضلِّل', 'CONFIG_STAGING_WATCH_DUPLICATE');
  }
  for (const required of STAGING_REQUIRED_WATCHES) {
    if (!policy.watches.includes(required)) {
      throw new SovereignViolation(
        `شرط قبول المرحلة 36 يوجب حرسًا: ${required}`,
        'CONFIG_STAGING_REQUIRED_WATCH_MISSING',
      );
    }
  }

  if (policy.require_runbook_execution !== true) {
    throw new SovereignViolation(
      'كتاب التشغيل يُنفَّذ لا يُقرأ: كتابٌ لم يُنفَّذ وثيقةٌ لا إجراء',
      'CONFIG_STAGING_RUNBOOK_OPTIONAL',
    );
  }
  if (!Array.isArray(policy.runbooks) || policy.runbooks.length === 0) {
    throw new SovereignViolation('لا كتاب تشغيل معلن', 'CONFIG_STAGING_NO_RUNBOOKS');
  }
  for (const book of policy.runbooks) {
    if (!STAGING_KNOWN_RUNBOOKS.includes(book)) {
      throw new SovereignViolation(`كتاب تشغيل غير معروف: ${String(book)}`, 'CONFIG_STAGING_RUNBOOK_UNKNOWN');
    }
  }
  if (new Set(policy.runbooks).size !== policy.runbooks.length) {
    throw new SovereignViolation('كتاب معلن مرتين — عدّ مضلِّل', 'CONFIG_STAGING_RUNBOOK_DUPLICATE');
  }
  if (policy.require_independent_observer !== true) {
    throw new SovereignViolation(
      'المراقبة المستقلة شرط لا خيار (RULE-004)',
      'CONFIG_STAGING_OBSERVER_OPTIONAL',
    );
  }
  if (policy.halt_on_critical !== true) {
    throw new SovereignViolation(
      'حادث حرج في تشغيل مقيَّد يوجب التوقف الآمن ولا يُواصَل عليه (RULE-007)',
      'CONFIG_STAGING_CRITICAL_CONTINUES',
    );
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق نافذة لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_STAGING_BREACH_SILENT',
    );
  }

  const load = loadLoad(configDir).policy;
  if (window.tick_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'مسحة أسرع من أقصى زمن أمر معلن في load.yaml — تُنتج حادثًا حتميًّا لا حقيقيًّا',
      'CONFIG_STAGING_TICK_UNDER_CHANNEL_MAX',
    );
  }
  const chaos = loadChaos(configDir).policy;
  if (window.duration_ms < chaos.safe_stop_deadline_ms) {
    throw new SovereignViolation(
      'نافذة أقصر من مهلة التوقف الآمن — لا تُدرك توقفًا لو وقع حادث حرج',
      'CONFIG_STAGING_WINDOW_UNDER_SAFE_STOP',
    );
  }
  const quotas = loadQuotas(configDir);
  if (scope.max_agents > quotas.agents.population_max) {
    throw new SovereignViolation(
      'سقف سكان التشغيل المحدود فوق السقف السكاني المعلن — قيدٌ أرخى من الأصل',
      'CONFIG_STAGING_AGENTS_OVER_POPULATION',
    );
  }
  return raw;
}

// ════════════════════════════════════════════════════════════════════════════
// المرحلة 37 — سياسة التشغيل الاتحادي
//
// الفرق عن المرحلة 36 ليس في العدد بل في طبيعة الشرط: هناك «نافذة» لها مدة تنتهي،
// وهنا «مراقبة مستمرة» بلا مدة. فكل ما كان يُقاس بطول النافذة يُقاس هنا بالصمت
// المسموح وبفجوة إعادة التشغيل. والقاعدة نفسها: لكل رقم قيمةٌ تُسقط الإقلاع.
// ════════════════════════════════════════════════════════════════════════════

/** الماسحات المعروفة: حرّاس المرحلة 36 + الوحدات التي كانت تنتظر نداءً + المرور */
export type ScannerKind =
  | WatchKind
  | 'loads'
  | 'digital_unit'
  | 'factories'
  | 'hospitals'
  | 'retention'
  | 'passage';

export interface ProductionConfig {
  policy: {
    default: 'deny';
    observer_authority: string;
    supervision: {
      tick_ms: number;
      start_grace_ms: number;
      max_silence_ms: number;
      restart_gap_max_ms: number;
      min_sweeps: number;
      checkpoint_directory: string;
    };
    loads: { pending_max_ms: number };
    regions: {
      required: readonly string[];
      require_crown_passage: boolean;
      require_governor: boolean;
      passage_ttl_ms: number;
      max_suspended: number;
    };
    tolerance: {
      max_critical: number;
      max_unwatched: number;
      max_failed_sweeps: number;
      max_unpassed_action: number;
      min_bypass_proof: number;
    };
    severity: { critical: readonly IncidentKind[]; high: readonly IncidentKind[] };
    scanners: readonly ScannerKind[];
    require_runbook_execution: boolean;
    runbooks: readonly string[];
    require_independent_observer: boolean;
    halt_on_critical: boolean;
    escalate_on_breach: boolean;
  };
}

/** الماسحات المعروفة — ماسحٌ مجهول لا يُعرف ما يمسح فلا تُقاس شهادته */
export const PRODUCTION_KNOWN_SCANNERS: readonly ScannerKind[] = [
  'regions', 'audit_chain', 'scope', 'termination', 'king',
  'loads', 'digital_unit', 'factories', 'hospitals', 'retention', 'passage',
];

/**
 * الماسحات التي لا يُعدّ التشغيل الاتحادي مقبولًا بغيرها. شرط القبول نصًّا:
 * «كل الأقاليم تعمل تحت مرور التاج مع مراقبة مستمرة» — فـ«الأقاليم تعمل» توجب
 * ماسح الأقاليم، و«تحت مرور التاج» توجب ماسح المرور، و«مراقبة» لا تُبنى على سلسلة
 * غير مُتحقَّقة (audit_chain) ولا على نطاق غير محروس (scope).
 */
export const PRODUCTION_REQUIRED_SCANNERS: readonly ScannerKind[] = [
  'regions', 'passage', 'audit_chain', 'scope',
];

/** الحوادث المعروفة في التشغيل الاتحادي */
export const PRODUCTION_KNOWN_INCIDENTS: readonly IncidentKind[] = [
  ...STAGING_KNOWN_INCIDENTS,
  'unit_ledger_mismatch', 'command_loss_over_limit', 'critical_service_unverified',
  'crown_passage_bypass', 'region_action_without_passage',
];

/**
 * ما لا يجوز تصنيفه دون «حرج». يُضاف إلى قائمة المرحلة 36 فعلٌ إقليمي نفُذ بلا إذن
 * مرور: تصنيفه «جسيمًا» يُسقط شرط القبول ضمنًا — لأن الشرط هو ألّا ينفُذ.
 */
export const PRODUCTION_MUST_BE_CRITICAL: readonly IncidentKind[] = [
  ...STAGING_MUST_BE_CRITICAL,
  'region_action_without_passage',
];

/** كتب التشغيل المعروفة في الطور الاتحادي */
export const PRODUCTION_KNOWN_RUNBOOKS: readonly string[] = [
  'federated-operation', 'king-absence',
];

/** الجهات المشغّلة للتشغيل الاتحادي — المراقب ليس منها (RULE-004) */
export const PRODUCTION_OPERATORS: readonly string[] = STAGING_OPERATORS;

/**
 * يحمّل سياسة التشغيل الاتحادي ويرفض كل تهيئة تُسمّي المراقبة «مستمرة» وهي منقطعة،
 * أو تُسمّي الأقاليم «عاملة» وهي معلنة، أو تُسمّي المرور «مُنفَّذًا» بلا دليل رفض.
 */
export function loadProduction(configDir = resolveConfigDir()): ProductionConfig {
  const raw = loadYamlFile(join(configDir, 'production.yaml')) as unknown as ProductionConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة التشغيل الاتحادي غير معلنة', 'CONFIG_NO_PRODUCTION_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في التشغيل الاتحادي منعٌ لا سماح — لا يُرخى بعد التشغيل المحدود',
      'CONFIG_PRODUCTION_DEFAULT_ALLOW',
    );
  }
  if (!policy.observer_authority || policy.observer_authority.trim().length === 0) {
    throw new SovereignViolation(
      'لا مراقب معلن — تشغيلٌ يشهد لنفسه',
      'CONFIG_PRODUCTION_OBSERVER_AUTHORITY',
    );
  }
  if (PRODUCTION_OPERATORS.includes(policy.observer_authority)) {
    throw new SovereignViolation(
      'المراقب من المشغّلين — من يشغّل الاتحاد لا يشهد لنفسه أنه مراقَب (RULE-004)',
      'CONFIG_PRODUCTION_OBSERVER_IS_OPERATOR',
    );
  }

  const sup = policy.supervision;
  if (!sup) {
    throw new SovereignViolation(
      'لا مراقبة معلنة — «مستمرة» بلا أرقام دعوى',
      'CONFIG_PRODUCTION_NO_SUPERVISION',
    );
  }
  const positives: readonly [string, number][] = [
    ['tick_ms', sup.tick_ms],
    ['start_grace_ms', sup.start_grace_ms],
    ['max_silence_ms', sup.max_silence_ms],
    ['restart_gap_max_ms', sup.restart_gap_max_ms],
    ['min_sweeps', sup.min_sweeps],
    ['pending_max_ms', policy.loads?.pending_max_ms as number],
    ['passage_ttl_ms', policy.regions?.passage_ttl_ms as number],
  ];
  for (const [name, value] of positives) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير صالحة في سياسة التشغيل الاتحادي: «${name}»`,
        'CONFIG_PRODUCTION_SUPERVISION_VALUE',
      );
    }
  }
  if (sup.min_sweeps < 2) {
    throw new SovereignViolation(
      'مسحة واحدة لا تُسمّى مراقبة مستمرة — الاستمرار يُقاس بتكرارٍ لا بحدوث',
      'CONFIG_PRODUCTION_MIN_SWEEPS',
    );
  }
  if (sup.start_grace_ms < sup.tick_ms) {
    throw new SovereignViolation(
      'مهلة البدء أقصر من دورة المسح — خرقٌ حتميّ لا قياس',
      'CONFIG_PRODUCTION_GRACE_UNDER_TICK',
    );
  }
  if (sup.max_silence_ms <= sup.tick_ms) {
    throw new SovereignViolation(
      'الصمت المسموح لا يجاوز دورة المسح — فجوةٌ تُعلن في كل دورة سليمة',
      'CONFIG_PRODUCTION_SILENCE_UNDER_TICK',
    );
  }
  if (!sup.checkpoint_directory || sup.checkpoint_directory.trim().length === 0) {
    throw new SovereignViolation(
      'لا نقطة تفتيش معلنة — مراقبةٌ لا تعبر إعادة التشغيل ليست مستمرة',
      'CONFIG_PRODUCTION_NO_CHECKPOINT_DIR',
    );
  }

  const regions = policy.regions;
  if (!regions || !Array.isArray(regions.required) || regions.required.length === 0) {
    throw new SovereignViolation(
      'لا أقاليم مشترطة — «كل الأقاليم تعمل» بلا مرجع تُقاس عليه',
      'CONFIG_PRODUCTION_NO_REGIONS',
    );
  }
  const declared = new Set(loadRegions(configDir).regions.map((r) => r.id));
  const seenRegion = new Set<string>();
  for (const id of regions.required) {
    if (seenRegion.has(id)) {
      throw new SovereignViolation(
        `إقليم مشترط مكرّر: «${id}» — التكرار يُضخّم العدد ولا يُضيف عملًا`,
        'CONFIG_PRODUCTION_REGION_DUPLICATE',
      );
    }
    seenRegion.add(id);
    if (!declared.has(id)) {
      throw new SovereignViolation(
        `إقليم مشترط غير معلن في regions.yaml: «${id}» — شرطٌ يستحيل استيفاؤه`,
        'CONFIG_PRODUCTION_REGION_UNDECLARED',
      );
    }
  }
  if (regions.require_crown_passage !== true) {
    throw new SovereignViolation(
      'مرور التاج غير مشترط — تعطيله ينقض شرط القبول نصًّا',
      'CONFIG_PRODUCTION_PASSAGE_OPTIONAL',
    );
  }
  if (regions.require_governor !== true) {
    throw new SovereignViolation(
      'إقليم مفوَّض بلا حاكم سلطةٌ بلا مسؤول (المرحلة 24)',
      'CONFIG_PRODUCTION_GOVERNOR_OPTIONAL',
    );
  }
  if (regions.max_suspended !== 0) {
    throw new SovereignViolation(
      'إقليم موقوف مُحتمَل في تشغيل يُقال إنه اتحادي كامل',
      'CONFIG_PRODUCTION_SUSPENDED_TOLERATED',
    );
  }

  const tol = policy.tolerance;
  if (!tol) {
    throw new SovereignViolation(
      'لا حدود تحمّل معلنة — تشغيلٌ بلا سقف خرق',
      'CONFIG_PRODUCTION_NO_TOLERANCE',
    );
  }
  if (tol.max_critical !== 0) {
    throw new SovereignViolation(
      'حادث حرج مُحتمَل في تشغيل مستمر — الشرط لا يقبل استثناءً',
      'CONFIG_PRODUCTION_CRITICAL_TOLERATED',
    );
  }
  if (tol.max_unwatched !== 0) {
    throw new SovereignViolation(
      'ماسحٌ معلن لا يمسح مُحتمَل — قدرةٌ لا يناديها أحد (T-105)',
      'CONFIG_PRODUCTION_UNWATCHED_TOLERATED',
    );
  }
  if (tol.max_failed_sweeps !== 0) {
    throw new SovereignViolation(
      'مسحة منهارة مُحتمَلة — صمت الماسح يمرّ بلا أثر',
      'CONFIG_PRODUCTION_FAILED_SWEEP_TOLERATED',
    );
  }
  if (tol.max_unpassed_action !== 0) {
    throw new SovereignViolation(
      'فعل إقليمي بلا إذن مرور مُحتمَل — نقضُ الشرط نفسه',
      'CONFIG_PRODUCTION_UNPASSED_TOLERATED',
    );
  }
  if (typeof tol.min_bypass_proof !== 'number' || tol.min_bypass_proof < 1) {
    throw new SovereignViolation(
      'لا دليل رفض مشترط — «مُنفَّذ» بلا محاولة تجاوزٍ مرفوضة دعوى',
      'CONFIG_PRODUCTION_BYPASS_UNPROVEN',
    );
  }

  const severity = policy.severity;
  if (!severity || !Array.isArray(severity.critical) || severity.critical.length === 0) {
    throw new SovereignViolation(
      'لا حوادث حرجة معلنة — تصنيفٌ يُفرغ التوقف الآمن',
      'CONFIG_PRODUCTION_NO_CRITICAL_KINDS',
    );
  }
  const high = Array.isArray(severity.high) ? severity.high : [];
  for (const kind of [...severity.critical, ...high]) {
    if (!PRODUCTION_KNOWN_INCIDENTS.includes(kind)) {
      throw new SovereignViolation(
        `حادث مجهول في التصنيف: «${kind}» — ما لا يُعرف لا يُقاس`,
        'CONFIG_PRODUCTION_INCIDENT_UNKNOWN',
      );
    }
  }
  for (const kind of severity.critical) {
    if (high.includes(kind)) {
      throw new SovereignViolation(
        `حادث مصنّف حرجًا وجسيمًا معًا: «${kind}»`,
        'CONFIG_PRODUCTION_SEVERITY_CONTRADICTION',
      );
    }
  }
  for (const kind of PRODUCTION_MUST_BE_CRITICAL) {
    if (!severity.critical.includes(kind)) {
      throw new SovereignViolation(
        `حادثٌ لا يجوز تخفيفه: «${kind}» — تصنيفه دون حرج يُسقط شرط القبول`,
        'CONFIG_PRODUCTION_CRITICAL_DOWNGRADED',
      );
    }
  }

  if (!Array.isArray(policy.scanners) || policy.scanners.length === 0) {
    throw new SovereignViolation(
      'لا ماسحات معلنة — مراقبةٌ بلا ما تمسحه',
      'CONFIG_PRODUCTION_NO_SCANNERS',
    );
  }
  const seenScanner = new Set<string>();
  for (const scanner of policy.scanners) {
    if (!PRODUCTION_KNOWN_SCANNERS.includes(scanner)) {
      throw new SovereignViolation(
        `ماسح مجهول: «${scanner}»`,
        'CONFIG_PRODUCTION_SCANNER_UNKNOWN',
      );
    }
    if (seenScanner.has(scanner)) {
      throw new SovereignViolation(
        `ماسح مكرّر: «${scanner}» — التكرار يُضخّم عدد المسحات ولا يُضيف مراقبة`,
        'CONFIG_PRODUCTION_SCANNER_DUPLICATE',
      );
    }
    seenScanner.add(scanner);
  }
  for (const required of PRODUCTION_REQUIRED_SCANNERS) {
    if (!seenScanner.has(required)) {
      throw new SovereignViolation(
        `ماسح مشترط غائب: «${required}» — شرط القبول لا يُستوفى بدونه`,
        'CONFIG_PRODUCTION_REQUIRED_SCANNER_MISSING',
      );
    }
  }

  if (policy.require_runbook_execution !== true) {
    throw new SovereignViolation(
      'كتاب التشغيل يُنفَّذ لا يُقرأ (RULE-008)',
      'CONFIG_PRODUCTION_RUNBOOK_OPTIONAL',
    );
  }
  if (!Array.isArray(policy.runbooks) || policy.runbooks.length === 0) {
    throw new SovereignViolation(
      'لا كتب تشغيل معلنة — تنفيذٌ بلا مكتوب',
      'CONFIG_PRODUCTION_NO_RUNBOOKS',
    );
  }
  const seenBook = new Set<string>();
  for (const book of policy.runbooks) {
    if (!PRODUCTION_KNOWN_RUNBOOKS.includes(book)) {
      throw new SovereignViolation(
        `كتاب تشغيل مجهول: «${book}»`,
        'CONFIG_PRODUCTION_RUNBOOK_UNKNOWN',
      );
    }
    if (seenBook.has(book)) {
      throw new SovereignViolation(
        `كتاب تشغيل مكرّر: «${book}»`,
        'CONFIG_PRODUCTION_RUNBOOK_DUPLICATE',
      );
    }
    seenBook.add(book);
  }

  if (policy.require_independent_observer !== true) {
    throw new SovereignViolation(
      'المراقبة المستقلة غير مشترطة — شهادةٌ على النفس',
      'CONFIG_PRODUCTION_OBSERVER_OPTIONAL',
    );
  }
  if (policy.halt_on_critical !== true) {
    throw new SovereignViolation(
      'حادث حرج يوجب التوقف الآمن ولا يُواصَل عليه (RULE-007)',
      'CONFIG_PRODUCTION_CRITICAL_CONTINUES',
    );
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرقٌ لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_PRODUCTION_BREACH_SILENT',
    );
  }

  const load = loadLoad(configDir).policy;
  if (sup.tick_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'دورة مسح أسرع من أقصى زمن أمر معلن — تُنتج حادثًا حتميًّا لا حقيقيًّا',
      'CONFIG_PRODUCTION_TICK_UNDER_CHANNEL_MAX',
    );
  }
  if (policy.loads.pending_max_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'عمر الأمر المسموح أقصر من زمن مروره — أمرٌ يُعدّ مفقودًا قبل أن يُمهَل',
      'CONFIG_PRODUCTION_PENDING_UNDER_CHANNEL_MAX',
    );
  }
  const staging = loadStaging(configDir).policy;
  if (sup.tick_ms > staging.window.tick_ms) {
    throw new SovereignViolation(
      'مسح التشغيل الاتحادي أبطأ من مسح التشغيل المحدود — تدرّجٌ منقوض',
      'CONFIG_PRODUCTION_TICK_OVER_STAGING',
    );
  }
  const chaos = loadChaos(configDir).policy;
  if (sup.restart_gap_max_ms < chaos.safe_stop_deadline_ms) {
    throw new SovereignViolation(
      'فجوة إعادة التشغيل المسموحة أقصر من مهلة التوقف الآمن — توقفٌ نظاميّ يُعدّ خرقًا',
      'CONFIG_PRODUCTION_RESTART_GAP_UNDER_SAFE_STOP',
    );
  }
  return raw;
}
