import { Asset } from 'expo-asset';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { remoteDataUrl } from '@/lib/certificate/data-url';
import { PAGE_HEIGHT, PAGE_WIDTH } from '@/lib/certificate/template';

export type CertificateExportOutcome = 'shared' | 'saved' | 'downloaded';

export async function assetDataUrl(moduleId: number): Promise<string> {
  return remoteDataUrl(Asset.fromModule(moduleId).uri);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Muzzle image could not be decoded.'));
    img.src = src;
  });
}

/**
 * html2canvas ignores CSS filters, so on web the ridge-and-groove view is computed here:
 * greyscale, then a contrast stretch around the mean luminance.
 */
export async function enhanceMuzzlePattern(src: string): Promise<string | null> {
  const img = await loadImage(src);
  const size = 360;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const scale = Math.max(size / img.width, size / img.height);
  context.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale);
  const pixels = context.getImageData(0, 0, size, size);
  const { data } = pixels;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const mean = sum / (data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = Math.max(0, Math.min(255, (luma - mean) * 2.6 + 128));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function waitForImages(doc: Document): Promise<void> {
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  return Promise.all(pending.map((img) => new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  }))).then(() => undefined);
}

/** Renders the certificate off-screen, rasterises it at 2x and downloads a real A4 PDF file. */
export async function exportCertificatePdf(html: string, fileName: string): Promise<CertificateExportOutcome> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-${PAGE_WIDTH + 200}px;top:0;width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;border:0;visibility:hidden;`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Certificate layout timed out.')), 15000);
      frame.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument;
    const page = doc?.getElementById('page');
    if (!doc || !page) throw new Error('Certificate layout could not be prepared.');
    await waitForImages(doc);
    const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: PAGE_WIDTH, height: PAGE_HEIGHT, windowWidth: PAGE_WIDTH, windowHeight: PAGE_HEIGHT });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    pdf.setProperties({ title: fileName.replace(/\.pdf$/, ''), subject: 'MOOZZLE Bovine Biometric Certificate', creator: 'MOOZZLE' });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
    pdf.save(fileName);
    return 'downloaded';
  } finally {
    frame.remove();
  }
}
