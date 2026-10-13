import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { PAGE_HEIGHT, PAGE_WIDTH } from '@/lib/certificate/template';

export type CertificateExportOutcome = 'shared' | 'saved' | 'downloaded';

const MIME_BY_EXTENSION: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Inlines a bundled image asset as a data URL for the print WebView. */
export async function assetDataUrl(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const base64 = await new File(uri).base64();
  return `data:${MIME_BY_EXTENSION[asset.type.toLowerCase()] ?? 'image/png'};base64,${base64}`;
}

/** Native print WebViews apply the CSS ridge enhancement themselves, so no pre-processing is needed. */
export function enhanceMuzzlePattern(_source: string): Promise<string | null> {
  return Promise.resolve(null);
}

/** Renders the HTML to an A4 PDF, names it, then opens the share sheet (Files, Drive, WhatsApp…). */
export async function exportCertificatePdf(html: string, fileName: string): Promise<CertificateExportOutcome> {
  const { uri } = await Print.printToFileAsync({ html, width: PAGE_WIDTH, height: PAGE_HEIGHT, margins: { left: 0, right: 0, top: 0, bottom: 0 } });
  let target = new File(uri);
  try {
    const named = new File(Paths.cache, fileName);
    if (named.exists) named.delete();
    target.move(named);
    target = named;
  } catch (caught) {
    // Keep the generated file under its temporary name rather than failing the export.
    console.warn('Certificate rename failed', caught);
  }
  if (!(await Sharing.isAvailableAsync())) return 'saved';
  await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Save or share MOOZZLE certificate' });
  return 'shared';
}
