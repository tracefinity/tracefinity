.PHONY: dev test-e2e test-e2e-ui

dev:
	@trap 'kill 0' EXIT; \
	(cd backend && . venv/bin/activate && uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && pnpm run dev) & \
	wait

test-e2e:
	cd frontend && E2E_TEST_MODE=1 GOOGLE_API_KEY=mock pnpm exec playwright test

test-e2e-ui:
	cd frontend && E2E_TEST_MODE=1 GOOGLE_API_KEY=mock pnpm exec playwright test --ui
