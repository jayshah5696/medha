/**
 * Free port finder — scans a range and returns the first available port.
 * Uses Node.js net module directly (no npm dependency).
 */

import * as net from "net";

export function findFreePort(
  rangeStart: number = 18900,
  rangeEnd: number = 18999
): Promise<number> {
  return new Promise((resolve, reject) => {
    let current = rangeStart;

    function tryPort(port: number) {
      if (port > rangeEnd) {
        reject(new Error(`No free port found in range ${rangeStart}-${rangeEnd}`));
        return;
      }

      const server = net.createServer();
      server.once("error", () => {
        tryPort(port + 1);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    }

    tryPort(current);
  });
}
