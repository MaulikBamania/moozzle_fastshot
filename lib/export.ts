import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';
import { logAudit } from '@/store/useBovineStore';

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\n');
}

/**
 * Shares (native) or copies (web) an export and records it in the audit trail.
 * The data passed in is already limited to what the server returned for the active role.
 */
export async function shareExport(title: string, csv: string, rowCount: number): Promise<'shared' | 'copied'> {
  if (Platform.OS === 'web') {
    await Clipboard.setStringAsync(csv);
  } else {
    await Share.share({ title, message: csv });
  }
  await logAudit('export.records', '', `${title}: ${rowCount} rows`, 'success');
  return Platform.OS === 'web' ? 'copied' : 'shared';
}
