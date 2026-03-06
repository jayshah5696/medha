import asyncio
import time

async def heartbeat():
    """A task that runs every 0.1s and reports its latency."""
    start = time.perf_counter()
    while True:
        await asyncio.sleep(0.1)
        now = time.perf_counter()
        elapsed = now - start
        if elapsed > 0.15:
            print(f"⚠️ Heartbeat delayed! Lasted {elapsed:.2f}s instead of 0.1s")
        start = now

def blocking_io():
    """Simulates a blocking I/O operation (like reading a file)."""
    print("  [sync] Starting blocking I/O...")
    time.sleep(0.5)
    print("  [sync] Finished blocking I/O.")

async def main():
    print("--- Phase 1: Running blocking I/O directly in async route ---")
    hb = asyncio.create_task(heartbeat())
    await asyncio.sleep(0.2) # Let heartbeat run a bit

    start = time.perf_counter()
    blocking_io()
    duration = time.perf_counter() - start
    print(f"Blocking call took {duration:.2f}s")

    await asyncio.sleep(0.2)
    hb.cancel()

    print("\n--- Phase 2: Running blocking I/O via asyncio.to_thread ---")
    hb = asyncio.create_task(heartbeat())
    await asyncio.sleep(0.2)

    start = time.perf_counter()
    await asyncio.to_thread(blocking_io)
    duration = time.perf_counter() - start
    print(f"Threaded call took {duration:.2f}s")

    await asyncio.sleep(0.2)
    hb.cancel()

if __name__ == "__main__":
    asyncio.run(main())
