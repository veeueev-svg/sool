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
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, allCriteriaMet, editIn, runCheck, withRoot, withTampered, writeOrder,
} from './helpers';

const VERSION = 'version.json';
const CRITERIA = 'COMPLETION_CRITERIA.md';
const ROADMAP = 'ROADMAP.md';
const ORDER = 'docs/royal-orders/2026-01-01-000-اختبار-حاجز.md';

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
    const lines = readFileSync(join(root, 'PROGRESS.md'), 'utf8').split('\n');
    const a = lines.findIndex((l: string) => l.startsWith('## 2) ما تبقّى'));
    const b = lines.findIndex((l: string) => l.startsWith('## 3) '));
    const debt = lines.slice(a + 1, b).filter((l: string) => l.startsWith('| T-')).length;
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

/*
 * (T-142 · W-2026-012) تصنيفُ العائق كان يتّكئ على خانةٍ يكتبها إنسان بلا حاجزٍ يقيسها:
 * حذفُ `T-85` من خانة `C-17` نقل عائقًا حقيقيًّا مفتوحًا إلى الدَّينِ المُعلَن **ورمزُ الخروج 0**.
 * والخمسةُ أدناه تقيس الأحكامَ الخمسةَ **برمز الخروج** لا بنصِّ رسالة.
 */

test('T-142/DC-01: رأسُ جدولٍ لا يُعلن عمودَ «البند المفتوح» يُسقط الحاجزَ — فلا يُقرأ عمودٌ برقمٍ مغروس', () => {
  withTampered(CRITERIA, (t) => t.replace('| البند المفتوح |', '| البند المتبقّي |'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[DC-01\]/);
    assert.match(r.out, /موضعُ الخانةِ لا يُقاس/);
  });
});

test('T-142/DC-02: صفٌّ غيرُ ✅ خانتُه «—» يُسقط الحاجزَ ويُسمّى — وهذه العلّةُ المقيسةُ عينُها', () => {
  withTampered(CRITERIA, (t) => t.replace('| T-85 |', '| — |'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[DC-02\] C-17/);
    // ولا يُطبع ✓ الخِتام: فالرمزُ والخِتامُ يتوافقان
    assert.doesNotMatch(r.out, /✓ حاجزُ الإعلان/);
  });
});

test('T-142/DC-03: بندٌ يذكره حكمُ التدقيق ولا تذكره الخانةُ يُسقط الحاجزَ — والحكمُ سندُ الصفّ', () => {
  // C-08 يسمّي T-27 وT-29؛ فيُحذف الثاني من **الخانة** وحدَها: فلا تفرغ الخانةُ (فلا DC-02)
  withTampered(CRITERIA, (t) => t.replace('| T-27 · T-29 |', '| T-27 |'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[DC-03\] C-08/);
    assert.match(r.out, /T-29/);
    assert.doesNotMatch(r.out, /\[DC-02\]/);
  });
});

test('T-142/DC-04: معرَّفٌ لا صفَّ له في §2 ولا استثناءَ معلنًا يُسقط الحاجز', () => {
  withTampered(CRITERIA, (t) => t.replace('| T-115 |', '| T-115 · T-9001 |'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[DC-04\] C-18 يسمّي T-9001/);
    assert.match(r.out, /يسقط من العائق ومن الدَّين معًا/);
  });
});

test('T-142/DC-04: الاستثناءُ المعلنُ يُطبع بسببِه في كلِّ تشغيلة — لا يُطوى', () => {
  const r = runCheck();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ℹ \[DC-04\] استثناءٌ معلن: T-25/);
  assert.match(r.out, /لا صفَّ له في PROGRESS\.md §2 قطُّ/);
  // وT-23 **ليس** استثناءً: له صفٌّ مشطوبٌ مُغلقٌ في §2 يجمعه بغيره
  assert.doesNotMatch(r.out, /استثناءٌ معلن: T-23/);
});

test('T-142/DC-04: خانةُ صفٍّ مشطوبٍ تجمع بندَين — والثاني جذرٌ كالأوّل', () => {
  // «| ~~T-31~~ · ~~T-23~~ |» مقيسٌ في PROGRESS.md: فقراءةُ أوّلِ معرَّفٍ وحدَه تجعل T-23
  // يبدو بلا جذرٍ فيُطلب له استثناءٌ لا يستحقُّه — وهذا خطأٌ وقع فعلًا وصُحِّح بالقياس.
  const r = runCheck();
  assert.equal(r.code, 0, r.out);
  const m = r.out.match(/مشطوبًا مُغلقًا \[([^\]]*)\]/);
  assert.ok(m, `تفصيلُ المشطوب غائب:\n${r.out}`);
  assert.match(m[1] ?? '', /T-23/);
});

test('T-142/DC-05: صفوفٌ غيرُ ✅ ولا معرَّفَ واحدٌ استُخرج ⇒ رفضٌ — فلا ✓ على حصرٍ لم يقع', () => {
  withRoot((root) => {
    editIn(root, CRITERIA, (t) => t.split('\n').map((l) => (l.startsWith('| C-') && !l.includes('✅ مستوفى')
      ? l.replace(/\| [^|]*\|$/, '| — |') : l)).join('\n'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[DC-05\] 9 صفًّا ليس ✅ ولم يُستخرج معرَّفُ بندٍ واحد/);
  });
});

test('T-142/DC-05: استخراجٌ يتخطّى صفًّا تعدُّه الحصيلةُ يُسقط الحاجز', () => {
  // معرَّفُ صفٍّ لا يقرؤه التصنيفُ وحالتُه تُعدُّ في الحصيلة: فالمقروءُ 8 والمعدودُ 9
  withTampered(CRITERIA, (t) => t.replace('| C-17 |', '| X-17 |'), (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[DC-05\] التصنيفُ قرأ/);
  });
});

test('T-142: خرجُ التصنيف يُظهر ما كان يسقط صمتًا — مفتوحٌ ومشطوبٌ وبلا صفّ', () => {
  const r = runCheck();
  assert.equal(r.code, 0, r.out);
  const m = r.out.match(/والمسمّى في الصفوف: (\d+) معرَّفًا = (\d+) مفتوحًا · (\d+) مشطوبًا مُغلقًا/);
  assert.ok(m, `سطرُ التصنيف الموسَّع غائب:\n${r.out}`);
  const [total, open, closed] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const unrooted = Number((r.out.match(/· (\d+) بلا صفٍّ باستثناءٍ معلن/) ?? [])[1]);
  assert.equal(open + closed + unrooted, total, `المجموعُ لا يُطابق التفصيل: ${r.out}`);
  assert.ok(total > 0, 'صفرُ معرَّفٍ مسمًّى مع صفوفٍ غيرِ ✅ حصرٌ لم يقع');
});

test('T-142/DC-02: الخانةُ الفارغةُ تُسقط الحاجزَ وحدَها — ولو وافقها حكمُ الملفّ فلم يُنبِّه DC-03', () => {
  // العزلُ مقصود: مطفَّرُ «DC-02 بلا fail» نجا أوّلًا لأنّ DC-03 كان يُسقط الرمزَ عنه.
  withRoot((root) => {
    editIn(root, CRITERIA, (t) => t.replace('| T-85 |', '| — |'));
    editIn(root, 'docs/audit/criteria/C-17.md', (t) => t.replace(/T-85/g, 'بندٍ لم يُسمَّ'));
  }, (r) => {
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[DC-02\] C-17/);
    assert.doesNotMatch(r.out, /\[DC-03\]/);
  });
});
