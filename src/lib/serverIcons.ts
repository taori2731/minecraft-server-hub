export const DEFAULT_SERVER_ICON = "/assets/voxel-server-island.png";

const STORAGE_KEY = "server-hub:server-icons:v1";
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 700_000;
const MAX_DIMENSION = 512;
const FALLBACK_DIMENSION = 320;
const SAFE_SERVER_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
type ServerIconMime = "image/png" | "image/jpeg" | "image/webp";

export type ServerIconMap = Record<string, string>;
export type ServerIconErrorCode = "type" | "size" | "decode" | "storage";

export class ServerIconError extends Error {
  constructor(public readonly code: ServerIconErrorCode) {
    super(code);
  }
}

export function readServerIcons(): ServerIconMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.entries(parsed).reduce<ServerIconMap>((icons, [serverId, value]) => {
      if (SAFE_SERVER_ID.test(serverId)
        && typeof value === "string"
        && value.length <= MAX_DATA_URL_LENGTH
        && SAFE_IMAGE_DATA.test(value)) icons[serverId] = value;
      return icons;
    }, {});
  } catch {
    return {};
  }
}

export function withServerIcon(current: ServerIconMap, serverId: string, dataUrl?: string): ServerIconMap {
  if (!SAFE_SERVER_ID.test(serverId)) throw new ServerIconError("storage");
  const next = { ...current };
  if (dataUrl == null) {
    delete next[serverId];
  } else if (dataUrl.length <= MAX_DATA_URL_LENGTH && SAFE_IMAGE_DATA.test(dataUrl)) {
    next[serverId] = dataUrl;
  } else {
    throw new ServerIconError("storage");
  }
  return next;
}

export function storeServerIcons(icons: ServerIconMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(icons));
  } catch {
    throw new ServerIconError("storage");
  }
}

export function detectServerIconMime(bytes: Uint8Array): ServerIconMime | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function readFileAsDataUrl(file: File, mime: ServerIconMime): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new ServerIconError("decode"));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new ServerIconError("decode"));
        return;
      }
      resolve(`data:${mime};base64,${reader.result.slice(separator + 1)}`);
    };
    reader.onerror = () => reject(new ServerIconError("decode"));
    reader.onabort = () => reject(new ServerIconError("decode"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ServerIconError("decode"));
    image.src = dataUrl;
  });
}

function renderImage(image: HTMLImageElement, maximum: number, quality: number): string {
  const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new ServerIconError("decode");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/webp", quality);
}

export async function prepareServerIcon(file: File): Promise<string> {
  if (file.size === 0 || file.size > MAX_SOURCE_BYTES) throw new ServerIconError("size");
  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = detectServerIconMime(signature);
  if (!mime) throw new ServerIconError("type");
  const image = await loadImage(await readFileAsDataUrl(file, mime));
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 16_384 || image.naturalHeight > 16_384) {
    throw new ServerIconError("decode");
  }
  let dataUrl = renderImage(image, MAX_DIMENSION, 0.88);
  if (dataUrl.length > MAX_DATA_URL_LENGTH) dataUrl = renderImage(image, FALLBACK_DIMENSION, 0.8);
  if (dataUrl.length > MAX_DATA_URL_LENGTH || !SAFE_IMAGE_DATA.test(dataUrl)) throw new ServerIconError("storage");
  return dataUrl;
}
