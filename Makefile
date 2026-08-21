.PHONY: install build test verify clean report
install:
	npm install
build:
	npm run build
test:
	npm test
verify:
	npm run verify
clean:
	npm run clean
report:
	@echo "حدّث PROGRESS.md و docs/test-reports/ قبل أي دفع — القاعدة الحاكمة RULE-000"
