/** Media rules shared by upload UI, server helpers and tests. */

/** Supabase Free plan: 50 MB per file (also enforced by the bucket). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const THUMB_MAX_PX = 480;
export const MEDIA_BUCKET = "media";

export const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export type MediaKind = "image" | "video" | "link";
export type MediaOwnerType = "trade" | "prep" | "debrief" | "playbook" | "event" | "weekly";

export function kindForMime(mime: string): "image" | "video" | null {
  if (!(ALLOWED_MIME as readonly string[]).includes(mime)) return null;
  return mime.startsWith("video/") ? "video" : "image";
}

export type FileCheck = { ok: true; kind: "image" | "video" } | { ok: false; reason: string };

export function checkFile(file: { type: string; size: number; name: string }): FileCheck {
  const kind = kindForMime(file.type);
  if (!kind) return { ok: false, reason: `${file.name}: unsupported file type` };
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      reason: `${file.name} is ${mb} MB — the limit is 50 MB. Upload it to YouTube (unlisted) or Google Drive and add the link instead.`,
    };
  }
  return { ok: true, kind };
}

/** Scale (w, h) to fit inside max × max, never upscaling. */
export function fitWithin(
  w: number,
  h: number,
  max: number = THUMB_MAX_PX,
): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h };
  const scale = max / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export function extensionFor(mime: string, fallbackName = ""): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return map[mime] ?? (fallbackName.split(".").pop() || "bin").toLowerCase();
}

export function storagePath(
  userId: string,
  ownerType: MediaOwnerType,
  ownerId: string,
  fileId: string,
  ext: string,
): string {
  return `${userId}/${ownerType}/${ownerId}/${fileId}.${ext}`;
}

/** YouTube watch/short/share URL → privacy-enhanced embed URL, else null. */
export function youtubeEmbedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] || null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
      id = m?.[1] ?? null;
    }
  }
  if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
