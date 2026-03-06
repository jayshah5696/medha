"""Health endpoint tests."""

import time

import pytest


@pytest.mark.asyncio
async def test_health_ok(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data == {"ok": True}


@pytest.mark.asyncio
async def test_health_fast(client):
    start = time.perf_counter()
    resp = await client.get("/health")
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert resp.status_code == 200
    assert elapsed_ms < 100, f"Health check took {elapsed_ms:.1f}ms, expected < 100ms"
