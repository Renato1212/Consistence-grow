import { describe, expect, it } from "vitest";

import {
  checkFile,
  extensionFor,
  fitWithin,
  isHttpUrl,
  kindForMime,
  storagePath,
  youtubeEmbedUrl,
} from "./media";

describe("media rules", () => {
  it("classifies allowed types", () => {
    expect(kindForMime("image/png")).toBe("image");
    expect(kindForMime("video/quicktime")).toBe("video");
    expect(kindForMime("application/pdf")).toBeNull();
  });

  it("refuses files over 50 MB with a link suggestion", () => {
    const big = checkFile({ type: "video/mp4", size: 60 * 1024 * 1024, name: "trade.mp4" });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.reason).toMatch(/50 MB.*YouTube.*link/);
    expect(checkFile({ type: "video/mp4", size: 50 * 1024 * 1024, name: "ok.mp4" })).toEqual({
      ok: true,
      kind: "video",
    });
    expect(checkFile({ type: "text/plain", size: 10, name: "a.txt" }).ok).toBe(false);
  });

  it("fits thumbnails inside 480px without upscaling", () => {
    expect(fitWithin(1920, 1080)).toEqual({ w: 480, h: 270 });
    expect(fitWithin(1080, 1920)).toEqual({ w: 270, h: 480 });
    expect(fitWithin(300, 200)).toEqual({ w: 300, h: 200 });
  });

  it("builds per-user storage paths", () => {
    expect(storagePath("u1", "trade", "t1", "f1", "png")).toBe("u1/trade/t1/f1.png");
    expect(extensionFor("video/quicktime")).toBe("mov");
    expect(extensionFor("image/x-unknown", "shot.TIFF")).toBe("tiff");
  });

  it("turns YouTube links into privacy-enhanced embeds", () => {
    const e = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(e);
    expect(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe(e);
    expect(youtubeEmbedUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(e);
    expect(youtubeEmbedUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(e);
    expect(youtubeEmbedUrl("https://drive.google.com/file/d/abc/view")).toBeNull();
    expect(youtubeEmbedUrl("not a url")).toBeNull();
  });

  it("accepts only http(s) links", () => {
    expect(isHttpUrl("https://drive.google.com/x")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
  });
});
