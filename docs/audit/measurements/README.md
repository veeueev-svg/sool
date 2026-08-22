# القياسات المُعادة — `docs/audit/measurements/`

**مُلئ في المرحلة 38** بالخرج **الخام** لكل قياسٍ أعاد ديوانُ التدقيق تشغيله بنفسه، لا بملخّصٍ عنه:

| الملف | الأمر المُنفَّذ | ما فيه |
|---|---|---|
| [`all-audit_probe.txt`](all-audit_probe.txt) | `node --max-old-space-size=6144 scripts/audit_probe.mjs` | 18 فحصًا · 17 ناجحًا · 1 ساقط (T-114) |
| [`C-19-npm_test.txt`](C-19-npm_test.txt) | `npm test` | 1480/1480 |
| [`C-06-verify_chain.txt`](C-06-verify_chain.txt) | `npm run verify` + `scripts/check_module_size.sh` | سلسلةٌ سليمة · 6 استثناءات معلنة |

- الصيغة: `<معيار>-<أداة>.txt` — مثال: `C-11-npm-test.txt`، `C-14-verify-audit-chain.txt`.
- يُرفَق الأمر المُنفَّذ وتاريخه في أول سطرين من الملف.
- **المزلق:** أن يُنسخ خرجٌ من تقرير منفّذٍ ويُسمّى قياسًا مُعادًا. القياس المُعاد يُشغّل من
  مستودعٍ نظيف عند بصمة التزامٍ معلنة.
