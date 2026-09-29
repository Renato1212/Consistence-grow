"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileVideo,
  ImageIcon,
  Link2,
  Loader2,
  Paperclip,
  PlayCircle,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Upload as TusUpload } from "tus-js-client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { logClientError } from "@/lib/client-errors";
import { publicEnv } from "@/lib/env";
import {
  MEDIA_BUCKET,
  THUMB_MAX_PX,
  checkFile,
  extensionFor,
  fitWithin,
  isHttpUrl,
  storagePath,
  youtubeEmbedUrl,
  type MediaOwnerType,
} from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "link";
  /** Signed URL (image/video) or external URL (link). */
  url: string | null;
  thumbUrl: string | null;
  caption: string | null;
  mime: string | null;
};

type QueueItem = {
  tempId: string;
  file: File;
  kind: "image" | "video";
  previewUrl: string;
  status: "waiting" | "uploading" | "error";
  progress: number;
  error?: string;
};

/** Render an image file to a WebP thumbnail (null when the browser can't decode it, e.g. HEIC). */
async function makeThumbnail(
  file: File,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const { w, h } = fitWithin(bmp.width, bmp.height, THUMB_MAX_PX);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.82));
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return blob ? { blob, ...size } : null;
  } catch {
    return null;
  }
}

/**
 * Media for one owner (trade, prep…): paste (⌘V) anywhere, drag & drop, file
 * picker (camera on phones), or a link. Uploads wait until the owner exists.
 */
export function MediaManager({
  ownerType,
  ownerId,
  ready,
  initial,
  pasteTarget,
}: {
  ownerType: MediaOwnerType;
  ownerId: string;
  ready: boolean;
  initial: MediaItem[];
  pasteTarget?: "window";
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<MediaItem[]>(initial);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const enqueue = useCallback((files: File[]) => {
    const accepted: QueueItem[] = [];
    for (const file of files) {
      const check = checkFile(file);
      if (!check.ok) {
        toast.error(check.reason, { duration: 8000 });
        continue;
      }
      accepted.push({
        tempId: crypto.randomUUID(),
        file,
        kind: check.kind,
        previewUrl: URL.createObjectURL(file),
        status: "waiting",
        progress: 0,
      });
    }
    if (accepted.length) setQueue((q) => [...q, ...accepted]);
  }, []);

  // ⌘V anywhere on the page, and drag & drop anywhere.
  useEffect(() => {
    if (pasteTarget !== "window") return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return; // plain text paste: leave it alone
      e.preventDefault();
      enqueue(files);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragging(false);
      enqueue(Array.from(e.dataTransfer.files));
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [enqueue, pasteTarget]);

  const uploadOne = useCallback(
    async (q: QueueItem, userId: string, accessToken: string) => {
      const fileId = crypto.randomUUID();
      const ext = extensionFor(q.file.type, q.file.name);
      const path = storagePath(userId, ownerType, ownerId, fileId, ext);
      const setProgress = (progress: number) =>
        setQueue((all) => all.map((x) => (x.tempId === q.tempId ? { ...x, progress } : x)));

      let thumbPath: string | null = null;
      let width: number | null = null;
      let height: number | null = null;

      if (q.kind === "image") {
        const thumb = await makeThumbnail(q.file);
        const up = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(path, q.file, { contentType: q.file.type, upsert: false });
        if (up.error) throw up.error;
        setProgress(0.8);
        if (thumb) {
          width = thumb.width;
          height = thumb.height;
          const tp = storagePath(userId, ownerType, ownerId, `${fileId}_thumb`, "webp");
          const t = await supabase.storage
            .from(MEDIA_BUCKET)
            .upload(tp, thumb.blob, { contentType: "image/webp", upsert: false });
          if (!t.error) thumbPath = tp; // a missing thumbnail is not fatal
        }
      } else {
        // Resumable (TUS) upload: survives flaky mobile connections, reports progress.
        const env = publicEnv();
        await new Promise<void>((resolve, reject) => {
          const upload = new TusUpload(q.file, {
            endpoint: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            headers: { authorization: `Bearer ${accessToken}`, "x-upsert": "false" },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            chunkSize: 6 * 1024 * 1024, // required by Supabase
            metadata: {
              bucketName: MEDIA_BUCKET,
              objectName: path,
              contentType: q.file.type,
              cacheControl: "3600",
            },
            onProgress: (sent, total) => setProgress(total ? (sent / total) * 0.95 : 0),
            onError: reject,
            onSuccess: () => resolve(),
          });
          upload.findPreviousUploads().then((prev) => {
            if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
            upload.start();
          }, reject);
        });
      }

      const { data, error } = await supabase
        .from("media")
        .insert({
          owner_type: ownerType,
          owner_id: ownerId,
          kind: q.kind,
          storage_path: path,
          thumb_path: thumbPath,
          mime: q.file.type,
          size_bytes: q.file.size,
          width,
          height,
          sort: Date.now() % 2147483647,
        })
        .select("id")
        .single();
      if (error) throw error;

      setItems((all) => [
        ...all,
        {
          id: data.id,
          kind: q.kind,
          url: q.previewUrl,
          thumbUrl: q.previewUrl,
          caption: null,
          mime: q.file.type,
        },
      ]);
      setQueue((all) => all.filter((x) => x.tempId !== q.tempId));
    },
    [supabase, ownerId, ownerType],
  );

  // Process the queue sequentially once the owner exists.
  useEffect(() => {
    if (!ready || busy.current) return;
    const next = queue.find((q) => q.status === "waiting");
    if (!next) return;
    busy.current = true;
    void (async () => {
      setQueue((all) =>
        all.map((x) => (x.tempId === next.tempId ? { ...x, status: "uploading" } : x)),
      );
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) throw new Error("Not signed in");
        await uploadOne(next, session.user.id, session.access_token);
      } catch (e) {
        logClientError("media.upload", e, { ownerId, kind: next.kind, size: next.file.size });
        setQueue((all) =>
          all.map((x) =>
            x.tempId === next.tempId ? { ...x, status: "error", error: "Upload failed" } : x,
          ),
        );
      } finally {
        busy.current = false;
        setQueue((all) => [...all]); // re-run the effect for the next item
      }
    })();
  }, [ready, queue, supabase, uploadOne, ownerId]);

  function retry(tempId: string) {
    setQueue((all) =>
      all.map((x) =>
        x.tempId === tempId ? { ...x, status: "waiting", progress: 0, error: undefined } : x,
      ),
    );
  }

  function dropFromQueue(tempId: string) {
    setQueue((all) => all.filter((x) => x.tempId !== tempId));
  }

  async function addLink() {
    const url = linkUrl.trim();
    if (!isHttpUrl(url)) {
      toast.error("Enter a full link starting with https://");
      return;
    }
    if (!ready) {
      toast.error("Save the trade first (fill the required fields), then add the link.");
      return;
    }
    const { data, error } = await supabase
      .from("media")
      .insert({
        owner_type: ownerType,
        owner_id: ownerId,
        kind: "link",
        url,
        sort: Date.now() % 2147483647,
      })
      .select("id")
      .single();
    if (error) {
      logClientError("media.link", error, { ownerId });
      toast.error("Something failed, retry.");
      return;
    }
    setItems((all) => [
      ...all,
      { id: data.id, kind: "link", url, thumbUrl: null, caption: null, mime: null },
    ]);
    setLinkUrl("");
  }

  async function saveCaption(id: string, caption: string) {
    const value = caption.trim() || null;
    setItems((all) => all.map((m) => (m.id === id ? { ...m, caption: value } : m)));
    const { error } = await supabase.from("media").update({ caption: value }).eq("id", id);
    if (error) {
      logClientError("media.caption", error, { id });
      toast.error("Caption not saved — retry.");
    }
  }

  async function remove(item: MediaItem) {
    const { error } = await supabase
      .from("media")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) {
      logClientError("media.delete", error, { id: item.id });
      toast.error("Something failed, retry.");
      return;
    }
    setItems((all) => all.filter((m) => m.id !== item.id));
    toast("Media removed", {
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await supabase.from("media").update({ deleted_at: null }).eq("id", item.id);
          if (!r.error) setItems((all) => [...all, item]);
        },
      },
    });
  }

  return (
    <section aria-label="Media" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="heading-caps text-muted-foreground text-[10px]">Screenshots & videos</h2>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip aria-hidden /> Add
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            multiple
            className="sr-only"
            aria-label="Add screenshots or videos"
            data-testid="media-file-input"
            onChange={(e) => {
              enqueue(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div
        className={cn(
          "text-muted-foreground rounded-lg border border-dashed p-3 text-center text-xs transition-colors",
          dragging && "border-primary bg-primary/10 text-foreground",
        )}
      >
        Paste a screenshot (⌘V), drop files here, or tap Add. Videos up to 50 MB — longer ones as a
        link.
      </div>

      {(items.length > 0 || queue.length > 0) && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="media-list">
          {items.map((m) => (
            <li
              key={m.id}
              className="bg-card space-y-2 rounded-lg border p-2"
              data-testid="media-item"
            >
              <MediaThumb item={m} onOpen={() => setOpen(m)} />
              <div className="flex items-center gap-1">
                <Input
                  aria-label="Caption"
                  placeholder="Caption"
                  defaultValue={m.caption ?? ""}
                  className="h-8 text-xs"
                  onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== m.caption)
                      void saveCaption(m.id, e.target.value);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove media"
                  onClick={() => void remove(m)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
          {queue.map((q) => (
            <li
              key={q.tempId}
              className="bg-card space-y-2 rounded-lg border p-2"
              data-testid="media-queued"
            >
              <div className="bg-muted relative flex aspect-video items-center justify-center overflow-hidden rounded-md">
                {q.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img
                    src={q.previewUrl}
                    alt=""
                    className="h-full w-full object-cover opacity-60"
                  />
                ) : (
                  <FileVideo className="text-muted-foreground size-8" aria-hidden />
                )}
                {q.status === "uploading" && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <div
                      className="bg-primary h-full transition-[width]"
                      style={{ width: `${Math.round(q.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                {q.status === "waiting" && (
                  <span className="text-muted-foreground">
                    {ready ? "Queued…" : "Uploads once the trade is saved"}
                  </span>
                )}
                {q.status === "uploading" && (
                  <span className="flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" aria-hidden />{" "}
                    {Math.round(q.progress * 100)}%
                  </span>
                )}
                {q.status === "error" && (
                  <>
                    <span className="text-destructive flex items-center gap-1">
                      <TriangleAlert className="size-3" aria-hidden /> {q.error}
                    </span>
                    <span className="flex gap-1">
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => retry(q.tempId)}
                      >
                        Retry
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="text-muted-foreground h-auto p-0 text-xs"
                        onClick={() => dropFromQueue(q.tempId)}
                      >
                        Remove
                      </Button>
                    </span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          aria-label="Video or chart link"
          placeholder="Paste a YouTube / Drive link"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addLink();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={() => void addLink()}>
          <Link2 aria-hidden /> Add link
        </Button>
      </div>

      <MediaLightbox item={open} onClose={() => setOpen(null)} />
    </section>
  );
}

export function MediaThumb({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={item.caption ? `Open ${item.caption}` : `Open ${item.kind}`}
      className="bg-muted focus-visible:ring-ring/50 relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md outline-none focus-visible:ring-[3px]"
    >
      {item.kind === "image" && (item.thumbUrl || item.url) ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URLs from private storage
        <img
          src={item.thumbUrl ?? item.url ?? ""}
          alt={item.caption ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : item.kind === "video" ? (
        <PlayCircle className="text-muted-foreground size-8" aria-hidden />
      ) : item.kind === "link" ? (
        <span className="text-muted-foreground flex flex-col items-center gap-1 px-2 text-center text-[11px] break-all">
          <Link2 className="size-5" aria-hidden />
          {youtubeEmbedUrl(item.url ?? "")
            ? "YouTube video"
            : new URL(item.url ?? "https://link").hostname}
        </span>
      ) : (
        <ImageIcon className="text-muted-foreground size-8" aria-hidden />
      )}
    </button>
  );
}

export function MediaLightbox({ item, onClose }: { item: MediaItem | null; onClose: () => void }) {
  const embed = item?.kind === "link" ? youtubeEmbedUrl(item.url ?? "") : null;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(96vw,1200px)] p-3 sm:max-w-[min(96vw,1200px)]">
        <DialogTitle className="sr-only">{item?.caption ?? "Media"}</DialogTitle>
        {item?.kind === "image" && item.url && (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL
          <img
            src={item.url}
            alt={item.caption ?? ""}
            className="max-h-[80vh] w-full object-contain"
          />
        )}
        {item?.kind === "video" && item.url && (
          <video src={item.url} controls playsInline className="max-h-[80vh] w-full" />
        )}
        {item?.kind === "link" && embed && (
          <iframe
            src={embed}
            title={item.caption ?? "Video"}
            className="aspect-video w-full"
            allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {item?.kind === "link" && !embed && item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-ink break-all underline"
          >
            Open {item.url}
          </a>
        )}
        {item?.caption && <p className="text-muted-foreground text-sm">{item.caption}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** Read-only gallery (journal detail panel). */
export function MediaGallery({ items }: { items: MediaItem[] }) {
  const [open, setOpen] = useState<MediaItem | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="media-gallery">
        {items.map((m) => (
          <li key={m.id} className="space-y-1">
            <MediaThumb item={m} onOpen={() => setOpen(m)} />
            {m.caption && <p className="text-muted-foreground truncate text-xs">{m.caption}</p>}
          </li>
        ))}
      </ul>
      <MediaLightbox item={open} onClose={() => setOpen(null)} />
    </>
  );
}
