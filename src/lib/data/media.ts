import "server-only";

import { MEDIA_BUCKET, type MediaOwnerType } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";
import type { MediaItem } from "@/components/trade/media-manager";

const SIGNED_URL_TTL = 60 * 60; // 1 h

/** Live media for owners, with short-lived signed URLs (bucket is private). */
export async function loadMedia(
  ownerType: MediaOwnerType,
  ownerIds: string[],
): Promise<Record<string, MediaItem[]>> {
  const out: Record<string, MediaItem[]> = {};
  if (ownerIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media")
    .select(
      "id, owner_id, kind, storage_path, thumb_path, url, caption, mime, width, height, size_bytes, sort",
    )
    .eq("owner_type", ownerType)
    .in("owner_id", ownerIds)
    .is("deleted_at", null)
    .order("sort")
    .order("created_at");
  if (error) throw error;

  const paths = [
    ...new Set(
      (data ?? []).flatMap((m) => [m.storage_path, m.thumb_path]).filter((p): p is string => !!p),
    ),
  ];
  const signed = new Map<string, string>();
  if (paths.length) {
    const r = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
    if (r.error) throw r.error;
    for (const s of r.data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }

  for (const m of data ?? []) {
    (out[m.owner_id] ??= []).push({
      id: m.id,
      kind: m.kind as MediaItem["kind"],
      url: m.kind === "link" ? m.url : m.storage_path ? (signed.get(m.storage_path) ?? null) : null,
      thumbUrl: m.thumb_path ? (signed.get(m.thumb_path) ?? null) : null,
      caption: m.caption,
      mime: m.mime,
    });
  }
  return out;
}
