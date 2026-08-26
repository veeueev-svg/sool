/**
 * tests/governance/declaration_gate.test.ts — حاجزُ الإعلان (المرحلة 40، البند T-127)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_declaration.sh` و`version.json` و`COMPLETION_CRITERIA.md` و`ROADMAP.md` و`docs/royal-orders/`
 * المخرجات: تأكيدٌ أن الحاجز يمرّ على المستودع كما هو، ويسقط على كل دعوى إعلانٍ بلا سند
 * التبعيات: `node:child_process` (يشغّل الفحص كما تشغّله البوابة) · `node:fs`
 * الصلاحيات (RULE-004): الاختبار يقرأ ويعبث مؤقّتًا ويستعيد؛ لا يُرقّي نسبةً ولا يوقّع أمرًا
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: نسبة 100% مع فجوات · royal_approval غير pending · المرحلة 40 في
 *   phases_complete · حصيلةُ المعايير متأخّرة · عددُ ROADMAP متأخّر · أمرٌ ملكيٌّ بلا auditId ·
 *   أمرٌ موقَّعٌ مع بقاء فجوات (فلا يكفي وجودُ الأمر)
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40.md · COMPLETION_CRITERIA.md §«قاعدة الإعلان»
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الفحص لا يعيد كتابته**: يشغّل الملفَّ الصدفيَّ عينَه الذي تشغّله البوابة، فلا يمرّ
 *    اختبارٌ على منطقِ نسخةٍ ثانية ثم تسقط البوابة على الأصل (كأخيه criteria_status.test.ts).
 *
 * 2) **العبثُ مؤقّت ومُستعاد دائمًا**: كل حالةٍ سلبية تكتب نسخةً معطوبة ثم تُرجع الأصل في
 *    `finally` — ولو سقط التأكيد. وما أُنشئ من ملفٍّ يُحذف.
 *
 * 3) **المقيسُ رمزُ الخروج لا نصُّ الرسالة**: لو كان الحاجز يطبع ولا يُسقط الرمز لَمَرَّت دعوى
 *    الإعلان في البوابة — وتلك بالضبط علّةُ أخيه التي أوجبت هذا الملف.
 *
 * 4) **المسارُ الموجَب صار مُختبرًا على جذرٍ منسوخ (W-2026-005)**: كان يُعلن «غيرَ مُختبر» لأنّ
 *    اصطناعَه في المستودع يقتضي تزييفَ أحكامِ تدقيق. ولمّا صار الحاجزُ يقبل جذرًا موجَّهًا
 *    بـ`SOOL_DECL_ROOT` اختُبر القبولُ في **نسخةٍ في tmpdir** لا في المستودع — فبوابةٌ لا
 *    يُعرف لها بابٌ يُفتح جدارٌ، والجدارُ يُعطَّل أوّلَ ضيقٍ ثم يُحتفل بلا حَكَم.
 *
 * 5) **لا حالةَ سلبيّةً تلمس ملفًّا حقيقيًّا (W-2026-004)**: كانت الثمانيةُ الأُوَل تعبث
 *    بملفّات المستودع نفسِها (`version.json` · `COMPLETION_CRITERIA.md` · `ROADMAP.md` ·
 *    `docs/royal-orders/`)، وnode يشغّل ملفّاتِ الاختبار بالتوازي — فتقرأ إحداها ما حرّفته
 *    أخرى فتسقط بوابةُ CI بالاحتمال. فنُقلت كلُّها إلى **جذرٍ منسوخٍ في tmpdir**، ولم يبقَ
 *    على المستودع الحقيقيّ إلّا **المسارُ الموجَبُ القارئُ وحدَه** (لا يكتب حرفًا).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// جذرُ المستودع هو مكانُ تشغيل `npm test` (كما في tests/governance/criteria_status.test.ts)
const ROOT = process.cwd();
const SCRIPT = 'scripts/check_declaration.sh';
const VERSION = 'version.json';
const CRITERIA = 'COMPLETION_CRITERIA.md';
const ROADMAP = 'ROADMAP.md';
const ORDER = 'docs/royal-orders/2026-01-01-000-اختبار-حاجز.md';

function runCheck(): { code: number; out: string } {
  const r = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/**
 * يعبث بملفٍّ **في الجذر المنسوخ** لا في المستودع (W-2026-004).
 * لا `finally` يستعيد أصلًا هنا: فالمعبوثُ نسخةٌ في tmpdir تُحذف بتمامها في `withRoot`.
 */
function withTampered(
  file: string,
  mutate: (text: string) => string,
  assertOn: (r: { code: number; out: string }) => void,
): void {
  withRoot((root) => editIn(root, file, mutate), assertOn);
}

test('T-127: الحاجز يمرّ على المستودع كما هو، ويعلن الدعوى والحال معًا', () => {
  const r = runCheck();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /الدعوى: النسبة/);
  assert.match(r.out, /الحال:/);
  assert.match(r.out, /الإعلانُ أثرٌ لا احتفال/);
});

test('T-127: نسبةُ 100% وثمّ صفٌّ ليس ✅ تُسقط البوابة', () => {
  withTampered(VERSION, (t) => t.replace(/"completion_percent": *[0-9.]+/, '"completion_percent": 100'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /فجوة واحدة مفتوحة = لا إعلان/);
    // ولا بندَ مفتوحًا يُبتلع: المزلقُ الآخر يُعلن في النفس الواحد
    assert.match(r.out, /بندًا مفتوحًا/);
  });
});

test('T-127: اعتمادٌ ملكيٌّ مدَّعًى في version.json بلا أمرٍ مقيَّد يُسقط البوابة', () => {
  withTampered(VERSION, (t) => t.replace(/"royal_approval": *"[^"]*"/, '"royal_approval": "granted"'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /بلا أمرٍ ملكيٍّ موقَّعٍ مقيَّد/);
  });
});

test('T-127: إدخالُ المرحلة 40 في phases_complete يُسقط البوابة', () => {
  withTampered(VERSION, (t) => t.replace('    38\n  ],', '    38,\n    40\n  ],'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /دعوى اكتمال/);
  });
});

/** يكتب أمرًا ملكيًّا تجريبيًّا **في الجذر المنسوخ** — ولا ملفَّ يُخلق في المستودع */
function writeTestOrder(root: string, subject: string, auditId: string): void {
  writeFileSync(
    join(root, ORDER),
    ['الرقم: 000', 'التاريخ: 2026-01-01', 'المُصدِر: الملك', `الموضوع: ${subject}`,
      'النص: لا أثرَ لهذا الملفِّ خارج الاختبار', 'الأثر على المراحل: لا شيء',
      `معرّف السجل في سلسلة التدقيق (auditId): ${auditId}`, ''].join('\n'),
  );
}

test('T-127: أمرٌ ملكيٌّ موقَّعٌ لا يكفي وحدَه ما بقيت فجوة', () => {
  withRoot(
    (root) => {
      writeTestOrder(root, 'اختبارُ الحاجز', 'audit-اختبار-000');
      editIn(root, VERSION, (t) => t.replace(/"completion_percent": *[0-9.]+/, '"completion_percent": 100'));
    },
    (r) => {
      assert.equal(r.code, 1, r.out);
      // الأمرُ موجودٌ ومقيَّد، ومع ذلك يسقط: لأنّ الفجواتَ والبنودَ باقية
      assert.doesNotMatch(r.out, /بلا أمرٍ ملكيٍّ موقَّعٍ مقيَّد/);
      assert.match(r.out, /فجوة واحدة مفتوحة = لا إعلان/);
    },
  );
});

test('T-127: أمرٌ ملكيٌّ بلا auditId لا يُعتدُّ به — الفارغُ ليس استيفاءً', () => {
  withRoot(
    (root) => writeTestOrder(root, 'أمرٌ بلا قيد', ''),
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /أمرٌ ملكيٌّ بلا auditId/);
    },
  );
});

test('T-127: حصيلةُ COMPLETION_CRITERIA.md المتأخّرةُ عن صفوفه تُسقط البوابة', () => {
  withTampered(CRITERIA, (t) => t.replace(/فجوة \*\*[0-9]+\*\*/, 'فجوة **0**'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /حصيلةُ COMPLETION_CRITERIA\.md تقول/);
  });
});

test('T-127: عددُ البنود المفتوحة في ROADMAP.md يُطابَق بجدول §2 لا بانتباه كاتب', () => {
  withTampered(ROADMAP, (t) => t.replace('| بنود مفتوحة معلنة | **', '| بنود مفتوحة معلنة | **1'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /والرقمُ المنقولُ يدويًّا يتأخّر/);
  });
});

/* ───────── W-2026-005: العائقُ المسمّى والدَّينُ المعلن — على جذرٍ منسوخٍ لا على المستودع ───────── */

const DECL_FILES = ['version.json', 'COMPLETION_CRITERIA.md', 'PROGRESS.md', 'ROADMAP.md'] as const;

/**
 * ينسخ ما يقرأه الحاجزُ إلى جذرٍ في tmpdir ثم يشغّله عليه بـ`SOOL_DECL_ROOT`.
 * والنسخُ **يُتحقَّق منه**: لو تسابق ملفُّ اختبارٍ آخرُ على `version.json` لحظةَ النسخ لَقِيسَ
 * عبثُ غيرِنا حكمًا لنا — فتُعاد المحاولةُ حتى تُقرأ نسخةٌ صحيحةُ البنية (RULE-007).
 */
function withRoot(
  mutate: (root: string) => void,
  assertOn: (r: { code: number; out: string }) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-decl-'));
  try {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt += 1) {
      for (const f of DECL_FILES) copyFileSync(join(ROOT, f), join(root, f));
      try {
        const v = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')) as { completion_percent?: number };
        ok = typeof v.completion_percent === 'number';
      } catch {
        ok = false;
      }
    }
    assert.ok(ok, 'لم تُقرأ نسخةٌ صحيحةُ البنية من version.json — لا يُحكم على قياسٍ مشكوكٍ فيه');
    const orders = join(root, 'docs/royal-orders');
    mkdirSync(orders, { recursive: true });
    const src = join(ROOT, 'docs/royal-orders');
    if (existsSync(src)) {
      for (const f of readdirSync(src)) {
        if (f.endsWith('.md')) copyFileSync(join(src, f), join(orders, f));
      }
    }
    mutate(root);
    const r = spawnSync('bash', [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, SOOL_DECL_ROOT: root },
    });
    assertOn({ code: r.status ?? -1, out: `${r.stdout}${r.stderr}` });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** يقرأ ملفًّا من الجذر المنسوخ ويكتبه بعد تعديلٍ يجب أن يُغيّر شيئًا */
function editIn(root: string, file: string, mutate: (t: string) => string): void {
  const p = join(root, file);
  const before = readFileSync(p, 'utf8');
  const after = mutate(before);
  assert.notEqual(after, before, `العبثُ لم يغيّر شيئًا في ${file} — فالتأكيدُ لا يقيس شيئًا`);
  writeFileSync(p, after);
}

/** يرقّي كلَّ صفٍّ إلى ✅ ويُصلح سطرَ الحصيلة معه — فحالُ «لا عائقَ مسمّى» يُصطنع في النسخة وحدَها */
function allCriteriaMet(root: string): void {
  editIn(root, 'COMPLETION_CRITERIA.md', (t) => {
    const rows = t.split('\n').map((l) => (l.startsWith('| C-')
      ? l.replace('| ⚠️ فجوة |', '| ✅ مستوفى |').replace('| 🟡 اكتُفي بتقرير المنفّذ |', '| ✅ مستوفى |')
      : l)).join('\n');
    const met = (rows.match(/\| ✅ مستوفى \|/g) ?? []).length;
    return rows.replace(
      /^\*\*الحصيلة اليوم:\*\*.*$/m,
      `**الحصيلة اليوم:** ✅ مستوفى **${met}** · ⚠️ فجوة **0** · 🟡 اكتُفي بتقرير المنفّذ **0**.`,
    );
  });
}

/** أمرٌ ملكيٌّ مقيَّدٌ في السلسلة، يُذكر فيه الدَّينُ أو لا يُذكر */
function writeOrder(root: string, debtLine: string | null): void {
  const lines = ['الرقم: 000', 'التاريخ: 2026-01-01', 'المُصدِر: الملك', 'الموضوع: اختبارُ الحاجز',
    'النص: لا أثرَ لهذا الملفِّ خارج الاختبار', 'الأثر على المراحل: لا شيء',
    'معرّف السجل في سلسلة التدقيق (auditId): audit-اختبار-000'];
  if (debtLine !== null) lines.push(debtLine);
  writeFileSync(join(root, 'docs/royal-orders/2026-01-01-000-اختبار-حاجز.md'), `${lines.join('\n')}\n`);
}

test('W-2026-005: البندُ المفتوحُ صنفان مقيسان — عائقٌ مسمّى ودَينٌ معلن، والمُغلقُ لا يُحسب عائقًا', () => {
  withRoot(() => {}, (r) => {
    assert.equal(r.code, 0, r.out);
    // العائقُ يُسمّى بمعرّفه: بندٌ تذكره خانةُ «البند المفتوح» في صفٍّ ليس ✅ وهو مفتوحٌ في §2
    assert.match(r.out, /عائقٌ مسمّى:.*T-27/);
    assert.match(r.out, /ودَينٌ معلن: [0-9]+/);
    // T-16 وT-21 وT-23 وT-25 وT-31 تذكرها صفوفٌ غيرُ ✅ وقد أُغلقت — فلا تُحسب عائقًا
    const named = /عائقٌ مسمّى:([^·]*)·/.exec(r.out)?.[1] ?? '';
    for (const closed of ['T-16', 'T-21', 'T-23', 'T-25', 'T-31']) {
      assert.doesNotMatch(named, new RegExp(`${closed}(\\D|$)`), `${closed} مُغلقٌ فلا يكون عائقًا`);
    }
  });
});

test('W-2026-005: دعوى اكتمالٍ وعائقٌ مسمّى مفتوحٌ تُسقط البوابة وتُسمّيه', () => {
  withRoot((root) => {
    editIn(root, 'version.json', (t) => t.replace(/"royal_approval": *"[^"]*"/, '"royal_approval": "granted"'));
    writeOrder(root, null);
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /والعائقُ المسمّى يُغلق قبل الإعلان/);
    assert.match(r.out, /T-27/);
  });
});

test('W-2026-005: دَينٌ معلنٌ لا يُذكر عددُه في الأمر يُسقط البوابة — ولا بندَ يُبتلع في صمت', () => {
  withRoot((root) => {
    allCriteriaMet(root);
    editIn(root, 'version.json', (t) => t.replace(/"royal_approval": *"[^"]*"/, '"royal_approval": "granted"'));
    writeOrder(root, null);
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /لم يُذكر عددُه في أمرٍ ملكيٍّ مقيَّد \(لا أمرَ يذكره\)/);
    assert.match(r.out, /ولا بندَ مفتوحًا يُبتلع في صمت/);
    // ولا يُتّهم الأمرُ بالغياب: هو موجودٌ ومقيَّد، والمأخذُ أنّه ساكتٌ عن الدَّين
    assert.doesNotMatch(r.out, /بلا أمرٍ ملكيٍّ موقَّعٍ مقيَّد/);
  });
});

test('W-2026-005: عددُ الدَّين المذكورُ في الأمر إن خالف المقيس يُسقط البوابة', () => {
  withRoot((root) => {
    allCriteriaMet(root);
    editIn(root, 'version.json', (t) => t.replace(/"royal_approval": *"[^"]*"/, '"royal_approval": "granted"'));
    writeOrder(root, 'الدَّينُ المعلن عند الإعلان: 3 بندًا');
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /المعلنُ فيه: 3/);
  });
});

test('W-2026-005: بابٌ يُفتح — كلُّ صفٍّ ✅ ولا عائقَ مسمًّى ودَينٌ مذكورٌ في أمرٍ مقيَّد', () => {
  withRoot((root) => {
    allCriteriaMet(root);
    const progress = readFileSync(join(root, 'PROGRESS.md'), 'utf8');
    const a = progress.split('\n').findIndex((l) => l.startsWith('## 2) ما تبقّى'));
    const b = progress.split('\n').findIndex((l) => l.startsWith('## 3) '));
    const debt = progress.split('\n').slice(a + 1, b).filter((l) => l.startsWith('| T-')).length;
    editIn(root, 'version.json', (t) => t.replace(/"royal_approval": *"[^"]*"/, '"royal_approval": "granted"'));
    writeOrder(root, `الدَّينُ المعلن عند الإعلان: ${debt} بندًا`);
  }, (r) => {
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /الأربعةُ مستوفاة/);
  });
});

test('W-2026-005: قسمُ الشروط الخارجيّة إن غاب أسقط الحاجزَ ولو لم تُدَّعَ نسبة', () => {
  withRoot((root) => {
    editIn(root, 'COMPLETION_CRITERIA.md', (t) => t.replace('### شروطٌ خارجيّة معلنة', '### شروطٌ (مُلغى العنوان)'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /صار عذرًا/);
  });
});

test('W-2026-005: صفُّ شرطٍ خارجيٍّ ناقصُ خانةٍ يُسقط الحاجز — الفارغُ ليس إعلانًا', () => {
  withRoot((root) => {
    editIn(root, 'COMPLETION_CRITERIA.md', (t) => t.replace(/^\| T-124 \|[^\n]*$/m,
      '| T-124 | بيئةُ تشغيلٍ حقيقيّةٌ لحاويات |  | تقريرُ إقلاعٍ | C-17 |'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /شرطٌ خارجيٌّ ناقصُ خانةٍ \(T-124\)/);
  });
});

test('W-2026-005: شرطٌ خارجيٌّ جهتُه من منفّذي المستودع ليس شرطًا خارجيًّا بل بندُ عمل', () => {
  withRoot((root) => {
    editIn(root, 'COMPLETION_CRITERIA.md', (t) => t.replace(/^\| T-124 \|[^\n]*$/m,
      '| T-124 | بيئةُ تشغيلٍ حقيقيّةٌ لحاويات | القيّم على المستودع | تقريرُ إقلاعٍ | C-17 |'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /فهو بندُ عملٍ لا شرطًا خارجيًّا/);
  });
});

test('W-2026-005: النسبةُ المعلنةُ إن خالفت مجموعَ أوزان المراحل المُغلقة تُسقط الحاجز', () => {
  withRoot((root) => {
    editIn(root, 'version.json', (t) => t.replace(/"completion_percent": *[0-9.]+/, '"completion_percent": 98.0'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ومجموعُ أوزان phases_complete/);
    // ونصفُ الوزن الذي كان مكتوبًا في ROADMAP.md كان يُنتج 98.00% بالضبط — فهذا هو البابُ الذي أُقفل
    assert.match(r.out, /يفترق بصمت/);
  });
});

test('W-2026-005: مرحلةٌ جزئيّةٌ ومكتملةٌ في وقتٍ واحد تُسقط الحاجز', () => {
  withRoot((root) => {
    editIn(root, 'version.json', (t) => t.replace('    38\n  ],', '    38,\n    39\n  ],'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /في phases_partial وphases_complete معًا/);
  });
});

test('W-2026-005: مرحلةٌ في phases_complete لا صفَّ لها في جدول ROADMAP.md تُسقط الحاجز', () => {
  withRoot((root) => {
    editIn(root, 'version.json', (t) => t.replace('    38\n  ],', '    38,\n    99\n  ],'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /لا صفَّ لها في جدول/);
  });
});
