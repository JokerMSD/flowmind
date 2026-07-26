import QRCode from "qrcode";

export async function toQrDataUrl(value?: string | null): Promise<string | null> {
  if (!value) return null;
  return QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}
