/**
 * Thin wrapper around the qz-tray browser SDK. QZ Tray is a small local
 * service the shop installs on each PC that exposes system printers over a
 * localhost WebSocket, letting us pick a specific printer (TSC label vs
 * Epson invoice) instead of showing the browser's print dialog every time.
 *
 * ARCHITECTURE
 *
 *  - The SDK is dynamically imported so it never lands in the server bundle
 *    and only ships to browsers that actually hit a print page.
 *  - We run in **insecure mode**: setCertificatePromise / setSignaturePromise
 *    resolve to null so QZ doesn't require a signed request. On first use,
 *    QZ's tray icon pops a permission prompt asking the operator to allow
 *    this site; picking "Allow forever" persists the choice per device.
 *    This is appropriate for a LAN-only wholesale-shop deployment; a
 *    public/multi-tenant deploy should switch to signed requests.
 *  - `connect()` is idempotent so calling it from multiple print pages just
 *    reuses the open socket.
 *  - The wrapper only exposes what the app actually uses (list printers,
 *    print HTML). The rest of the qz-tray surface (raw commands, files,
 *    scanners) stays out of scope until we need it.
 */

'use client';

// SDK is cached after the first dynamic import so we only pay the JS parse
// cost once per page load, even if multiple print buttons trigger it.
let qzModule: QzModule | null = null;

// Loose typing for the parts of the SDK we touch. The published package
// ships no TS types, so authoring a full definition here would be busywork —
// this covers just the calls we make and lets `unknown` do the rest.
interface QzModule {
  websocket: {
    connect(opts?: unknown): Promise<void>;
    disconnect(): Promise<void>;
    isActive(): boolean;
  };
  printers: {
    find(): Promise<string | string[]>;
  };
  configs: {
    create(printer: string, opts?: { copies?: number }): unknown;
  };
  print(config: unknown, data: unknown[]): Promise<void>;
  security: {
    setCertificatePromise(
      fn: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => void,
    ): void;
    setSignaturePromise(
      fn: (toSign: string) => (resolve: (v: unknown) => void, reject: (e: unknown) => void) => void,
    ): void;
  };
}

async function loadQz(): Promise<QzModule> {
  if (qzModule) return qzModule;
  const mod = (await import('qz-tray')) as unknown as { default?: QzModule } & QzModule;
  const qz = (mod.default ?? mod) as QzModule;
  // Insecure mode — resolve both promises to null so QZ falls back to its
  // tray-prompt permission model instead of demanding a signature.
  qz.security.setCertificatePromise((resolve) => resolve(null));
  qz.security.setSignaturePromise(() => (resolve) => resolve(null));
  qzModule = qz;
  return qz;
}

/**
 * Check whether QZ Tray is reachable on this device. Returns quickly (no
 * multi-second retries) so a UI can decide whether to render QZ controls
 * or fall back to `window.print()`.
 */
export async function isAvailable(timeoutMs = 1500): Promise<boolean> {
  try {
    const qz = await loadQz();
    if (qz.websocket.isActive()) return true;
    await withTimeout(qz.websocket.connect(), timeoutMs);
    return qz.websocket.isActive();
  } catch {
    return false;
  }
}

export async function connect(): Promise<void> {
  const qz = await loadQz();
  if (qz.websocket.isActive()) return;
  await qz.websocket.connect();
}

export async function disconnect(): Promise<void> {
  const qz = await loadQz();
  if (!qz.websocket.isActive()) return;
  await qz.websocket.disconnect();
}

export async function listPrinters(): Promise<string[]> {
  await connect();
  const qz = await loadQz();
  const list = await qz.printers.find();
  return Array.isArray(list) ? list : [list];
}

export async function printHtml(
  printerName: string,
  html: string,
  options?: { copies?: number },
): Promise<void> {
  await connect();
  const qz = await loadQz();
  const config = qz.configs.create(printerName, { copies: options?.copies ?? 1 });
  // 'html' format 'plain' tells QZ to route the data through the OS print
  // spooler as-if the browser had opened its print dialog and picked this
  // printer. Works for both raw thermal printers (TSC via its Windows
  // driver) and page printers (Epson).
  await qz.print(config, [{ type: 'html', format: 'plain', data: html }]);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('qz timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
