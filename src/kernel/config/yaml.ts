/**
 * src/kernel/config/yaml.ts — محلّل المجموعة الآمنة من YAML
 * المالك: القيّم على المستودع | المرحلة: 2
 * المدخلات: نصّ YAML أو مسار ملف | المخرجات: خريطة قيم
 * حالات الفشل: ملف غير موجود ⇒ استثناء نظام الملفات؛ وسمٌ أو مرجع غير مدعوم ⇒ يُهمَل بقصد
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { readFileSync, statSync } from 'node:fs';
import { guardConfigFileBytes } from './declaration_budget';

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

/**
 * يقرأ ملفَّ تهيئةٍ ويحلّله — **وبينهما حاجزُ البايتات** (البند T-130).
 * ولِمَ قبل التحليل؟ لأنّ الملفَّ المنفوخَ لا يُردّ بعد أن يُصرف عليه محلّلٌ ويُبنى منه
 * كائنٌ في الذاكرة، بل يُردّ وهو رقمٌ على القرص. وهذا الحاجزُ يقع على **كلِّ** قراءةِ
 * ملفِّ تهيئةٍ في النواة (خمسةٌ وعشرون محمّلًا يمرّون من هنا) لا على مسار الإقلاع وحده.
 */
export function loadYamlFile(path: string): Record<string, unknown> {
  guardConfigFileBytes(path, statSync(path).size);
  return parseSimpleYaml(readFileSync(path, 'utf8'));
}
