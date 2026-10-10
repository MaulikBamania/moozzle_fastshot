declare module 'upng-js' {
  interface DecodedPng {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: unknown[];
    tabs: Record<string, unknown>;
    data: ArrayBuffer;
  }
  const UPNG: {
    decode(buffer: ArrayBuffer): DecodedPng;
    toRGBA8(img: DecodedPng): ArrayBuffer[];
  };
  export default UPNG;
}
