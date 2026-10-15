import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export type ReportExportOutcome = 'shared' | 'saved' | 'downloaded';

const PAGE_WIDTH = 794;

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Lays the report out off-screen, rasterises it and slices it into A4 pages. */
export async function exportReportPdf(html: string, fileName: string): Promise<ReportExportOutcome> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-${PAGE_WIDTH + 200}px;top:0;width:${PAGE_WIDTH}px;height:1200px;border:0;visibility:hidden;`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Report layout timed out.')), 15000);
      frame.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      frame.srcdoc = html;
    });
    const page = frame.contentDocument?.getElementById('page');
    if (!page) throw new Error('Report layout could not be prepared.');
    const height = page.scrollHeight;
    frame.style.height = `${height}px`;
    const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', logging: false, width: PAGE_WIDTH, height, windowWidth: PAGE_WIDTH, windowHeight: height });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    pdf.setProperties({ title: fileName.replace(/\.pdf$/, ''), subject: 'MOOZZLE Biometric Scan Analytics', creator: 'MOOZZLE' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const sliceHeightPx = Math.floor((canvas.width * pageH) / pageW);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    const context = slice.getContext('2d');
    if (!context) throw new Error('This browser cannot render the PDF.');
    for (let offset = 0, index = 0; offset < canvas.height; offset += sliceHeightPx, index += 1) {
      const h = Math.min(sliceHeightPx, canvas.height - offset);
      slice.height = h;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, slice.width, h);
      context.drawImage(canvas, 0, offset, canvas.width, h, 0, 0, canvas.width, h);
      if (index > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (h * pageW) / canvas.width);
    }
    pdf.save(fileName);
    return 'downloaded';
  } finally {
    frame.remove();
  }
}

export async function exportCsvFile(csv: string, fileName: string): Promise<ReportExportOutcome> {
  triggerDownload(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), fileName);
  return 'downloaded';
}
