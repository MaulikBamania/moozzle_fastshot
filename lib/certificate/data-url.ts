/** Reads a Blob into a `data:` URL (FileReader exists on web and in React Native). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Image could not be encoded.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** Downloads a remote (e.g. signed storage) image and inlines it so the PDF never depends on the network. */
export async function remoteDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed (HTTP ${response.status}).`);
  return blobToDataUrl(await response.blob());
}
