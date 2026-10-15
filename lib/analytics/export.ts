import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export type ReportExportOutcome = 'shared' | 'saved' | 'downloaded';

function writeCacheFile(fileName: string, contents: string): File {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  return file;
}

async function share(uri: string, mimeType: string, uti: string, dialogTitle: string): Promise<ReportExportOutcome> {
  if (!(await Sharing.isAvailableAsync())) return 'saved';
  await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle });
  return 'shared';
}

/** Renders the report HTML to a multi-page A4 PDF and opens the share sheet. */
export async function exportReportPdf(html: string, fileName: string): Promise<ReportExportOutcome> {
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  let target = new File(uri);
  try {
    const named = new File(Paths.cache, fileName);
    if (named.exists) named.delete();
    target.move(named);
    target = named;
  } catch (caught) {
    console.warn('Report rename failed', caught);
  }
  return share(target.uri, 'application/pdf', 'com.adobe.pdf', 'Save or share FRR / FAR report');
}

/** Writes the CSV to the cache directory and opens the share sheet. */
export async function exportCsvFile(csv: string, fileName: string): Promise<ReportExportOutcome> {
  const file = writeCacheFile(fileName, csv);
  return share(file.uri, 'text/csv', 'public.comma-separated-values-text', 'Save or share scan telemetry');
}
