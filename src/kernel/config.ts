/**
 * src/kernel/config.ts — تحميل تهيئة الدولة والتحقق من ثوابتها
 * المالك: القيّم على المستودع | المرحلة: 2
 * المدخلات: ملفات config/*.yaml | المخرجات: كائنات تهيئة مُتحقَّق منها
 * حالات الفشل: ملف ناقص أو ملكان أو مسار جانبي مسموح ⇒ فشل مغلق (fail-closed)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { SovereignViolation } from './types';

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
      if (content.startsWith('{')) {
        arr.push(inlineMap(content));
      } else if (/^[^:]+:/.test(content)) {
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
  sovereign_actions: string[];
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
  return raw;
}
