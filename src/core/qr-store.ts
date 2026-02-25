/**
 * Module-level QR code store — bridges WhatsApp QR events to the WebChat /qr endpoint.
 * Used only in headless mode: WhatsApp connector calls setQrCode(), WebChat serves it.
 */

let _latestQr: string | null = null;

export function setQrCode(qr: string): void {
  _latestQr = qr;
}

export function getQrCode(): string | null {
  return _latestQr;
}
