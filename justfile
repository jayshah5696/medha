# Medha: local-first SQL IDE for flat files
# Usage: just <recipe>

set dotenv-load := false

# Default: list available recipes
default:
    @just --list

# Install all dependencies (backend + frontend)
install:
    cd backend && uv sync
    cd frontend && NODE_ENV=development npm install

# Start backend dev server (port 18900)
backend:
    cd backend && uv run uvicorn app.main:app --port 18900 --reload

# Start frontend dev server (port 5173)
frontend:
    cd frontend && npm run dev

# Start both (requires overmind or two terminals, use tmux pane split)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    
    # Kill any lingering processes holding our ports
    lsof -ti:18900,5173 | xargs kill -9 2>/dev/null || true
    
    trap 'kill 0' EXIT
    (cd backend && uv run uvicorn app.main:app --port 18900 --reload) &
    
    # Wait for the backend to be healthy before starting the frontend
    while ! nc -z localhost 18900 2>/dev/null; do sleep 0.1; done
    
    (cd frontend && NODE_ENV=development npm run dev) &
    wait

# Run backend tests
test:
    cd backend && uv run pytest tests/ -v

# Run tests with coverage
test-cov:
    cd backend && uv run pytest tests/ -v --cov=app --cov-report=term-missing

# Build frontend for production
build-frontend:
    cd frontend && NODE_ENV=development npm run build

# Type-check frontend
typecheck:
    cd frontend && npx tsc --noEmit

# Format backend (ruff)
fmt:
    cd backend && uv run ruff format app/ tests/

# Lint backend
lint:
    cd backend && uv run ruff check app/ tests/

# Clean build artifacts
clean:
    rm -rf frontend/dist
    rm -rf backend/.venv
    find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Verify full stack: install, test, build
ci:
    just install
    just test
    just build-frontend
    just typecheck

# Run frontend tests
test-frontend:
    cd frontend && NODE_ENV=development npx vitest run

# Run all tests (backend + frontend)
test-all:
    just test
    just test-frontend
