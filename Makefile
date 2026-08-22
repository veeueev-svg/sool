.PHONY: install build test verify size clean report
install:
	npm install
build:
	npm run build
test:
	npm test
verify:
	npm run verify
size:
	bash scripts/check_module_size.sh
clean:
	npm run clean
report:
	@echo "حدّث ARCHITECTURE.md إن تغيّرت حدود الوحدات، و PROGRESS.md و docs/test-reports/ قبل أي دفع — القاعدة الحاكمة RULE-000"
