/**
 * Collects direct image, video, and audio URLs exposed by the user-invoked current page.
 * Instagram keeps a host-specific embedded-data fallback for blob-backed players.
 */

(function () {
  "use strict";

  if (window.__pageMediaDlLoaded) return;
  window.__pageMediaDlLoaded = true;

  const MIN_SIZE = 150;
  const MAX_BACKGROUND_ELEMENTS = 5000;
  const hostname = (() => {
    try {
      return new URL(location.href).hostname;
    } catch {
      return location.hostname || "";
    }
  })();
  const IS_INSTAGRAM = /(^|\.)instagram\.com$/i.test(hostname);
  const SKIP_PATTERNS = [
    /sprite/i,
    /emoji/i,
    /favicon/i,
    /(?:^|[/_.-])spacer(?:[/_.?-]|$)/i,
    /tracking[-_]?pixel/i,
    /\.svg(\?|$)/i,
  ];
  const INSTAGRAM_SKIP_PATTERNS = [
    /static\.cdninstagram\.com\/rsrc/i,
    /\/rsrc\.php/i,
    /\/s(?:32|40|50|60|64|75|100|150)x(?:32|40|50|60|64|75|100|150)\//i,
    /profile_pic/i,
  ];

  function normalizeUrl(url) {
    if (!url || typeof url !== "string") return false;
    const value = url.trim();
    if (!value || /^(?:data|blob|javascript):/i.test(value)) return false;
    try {
      const parsed = new URL(value, location.href);
      if (!/^https?:$/.test(parsed.protocol)) return false;
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return false;
    }
  }

  function isDirectMediaUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return false;
    if (SKIP_PATTERNS.some((re) => re.test(normalized))) return false;
    if (IS_INSTAGRAM && INSTAGRAM_SKIP_PATTERNS.some((re) => re.test(normalized))) return false;
    return true;
  }

  function isLikelyVideoUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return false;
    try {
      const parsed = new URL(normalized);
      return (
        /\.(mp4|webm|mov|m4v)$/i.test(parsed.pathname) ||
        /(?:^|[?&])mime_type=video(?:%2F|\/)/i.test(parsed.search) ||
        /(?:^|[?&])type=video(?:%2F|\/)/i.test(parsed.search)
      );
    } catch {
      return /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(normalized);
    }
  }

  function isLikelyAudioUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return false;
    try {
      const parsed = new URL(normalized);
      return (
        /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(parsed.pathname) ||
        /(?:^|[?&])mime_type=audio(?:%2F|\/)/i.test(parsed.search) ||
        /(?:^|[?&])type=audio(?:%2F|\/)/i.test(parsed.search)
      );
    } catch {
      return /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)(?:[?#]|$)/i.test(normalized);
    }
  }

  function isLikelyPhotoUrl(url) {
    return isDirectMediaUrl(url) && !isLikelyVideoUrl(url) && !isLikelyAudioUrl(url);
  }

  function directMediaType(url) {
    const normalized = normalizeUrl(url);
    if (!normalized || !isDirectMediaUrl(normalized)) return null;
    if (isLikelyVideoUrl(normalized)) return "video";
    if (isLikelyAudioUrl(normalized)) return "audio";
    try {
      const pathname = new URL(normalized).pathname;
      if (/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(pathname)) return "photo";
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Stable identity for dedup across scrolls / size variants. */
  function mediaKey(url, type = "photo") {
    try {
      const p = new URL(url);
      const path = p.pathname
        .replace(/\/s\d+x\d+\//g, "/")
        .replace(/\/c\d+\.\d+\.\d+\.\d+\//g, "/");
      return `${type}:${p.origin}${path}`;
    } catch {
      return `${type}:${url}`;
    }
  }

  function scoreUrl(url) {
    let score = url.length;
    const m = url.match(/\/s(\d+)x(\d+)\//);
    if (m) score += parseInt(m[1], 10) + parseInt(m[2], 10);
    if (/\/e15\/|\/e35\/|_n\.|_o\./i.test(url)) score += 500;
    if (/stp=dst-jpg/i.test(url)) score += 50;
    return score;
  }

  function pickFromSrcset(srcset) {
    if (!srcset) return null;
    const parts = srcset
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let best = null;
    let bestScore = -1;
    for (const part of parts) {
      const m = part.match(/^(\S+)\s+(\d+)(w|x)?$/i) || part.match(/^(\S+)$/);
      if (!m) continue;
      const url = m[1];
      let score = 1;
      if (m[2]) score = parseInt(m[2], 10) * (m[3] === "x" ? 1000 : 1);
      if (isLikelyPhotoUrl(url) && score >= bestScore) {
        bestScore = score;
        best = normalizeUrl(url);
      }
    }
    return best;
  }

  function addMedia(bucket, url, type = "photo", extra = {}) {
    const n = normalizeUrl(url);
    if (!n || !isDirectMediaUrl(n)) return;
    if (type === "photo" && (isLikelyVideoUrl(n) || isLikelyAudioUrl(n))) return;
    if (type === "video" && isLikelyAudioUrl(n)) return;
    if (type === "audio" && isLikelyVideoUrl(n)) return;
    const key = mediaKey(n, type);
    const prev = bucket.get(key);
    const bestUrl = !prev || scoreUrl(n) > scoreUrl(prev.url) ? n : prev.url;
    bucket.set(key, {
      url: bestUrl,
      key,
      type,
      ...(extra.poster || prev?.poster ? { poster: extra.poster || prev.poster } : {}),
      ...(extra.playing || prev?.playing ? { playing: true } : {}),
    });
  }

  function collectFromImg(img, bucket) {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w && h && (w < MIN_SIZE || h < MIN_SIZE)) {
      const probe = img.currentSrc || img.src || "";
      if (!/t51\.|t52\.|t64\./.test(probe)) return;
    }
    const fromSet = pickFromSrcset(img.getAttribute("srcset") || img.srcset);
    if (fromSet) addMedia(bucket, fromSet, "photo");
    if (img.currentSrc) addMedia(bucket, img.currentSrc, "photo");
    if (img.src) addMedia(bucket, img.src, "photo");
    for (const attribute of ["data-src", "data-original", "data-lazy-src"]) {
      addMedia(bucket, img.getAttribute(attribute), "photo");
    }
  }

  function collectFromVideo(video, bucket) {
    const poster = isLikelyPhotoUrl(video.poster) ? normalizeUrl(video.poster) : "";
    const add = (url) => addMedia(bucket, url, "video", { poster });
    add(video.currentSrc);
    add(video.src);
    add(video.getAttribute("src"));
    add(video.getAttribute("data-src"));
    add(video.getAttribute("data-video-url"));
    video.querySelectorAll("source").forEach((source) => {
      add(source.src);
      add(source.getAttribute("src"));
    });
  }

  function collectFromAudio(audio, bucket) {
    const playing = audio.paused === false && audio.ended !== true;
    const add = (url) => addMedia(bucket, url, "audio", { playing });
    add(audio.currentSrc);
    add(audio.src);
    add(audio.getAttribute("src"));
    add(audio.getAttribute("data-src"));
    audio.querySelectorAll("source").forEach((source) => {
      add(source.src);
      add(source.getAttribute("src"));
    });
  }

  function collectFromBackground(el, bucket) {
    try {
      const w = el.offsetWidth || el.clientWidth || 0;
      const h = el.offsetHeight || el.clientHeight || 0;
      if (w && h && (w < MIN_SIZE || h < MIN_SIZE)) return;
      const bg = getComputedStyle(el).backgroundImage || "";
      for (const match of bg.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        addMedia(bucket, match[1], "photo");
      }
    } catch {
      /* inaccessible or detached element */
    }
  }

  function collectInstagramMediaFromJson(
    value,
    bucket,
    mediaContext = null,
    state = { nodes: 0 }
  ) {
    state.nodes += 1;
    if (state.nodes > 100000 || value == null) return;
    if (typeof value === "string") {
      if (mediaContext) addMedia(bucket, value, mediaContext);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectInstagramMediaFromJson(item, bucket, mediaContext, state));
      return;
    }
    if (typeof value !== "object") return;

    for (const [key, item] of Object.entries(value)) {
      const isVideoField =
        /^(video_versions?|video_urls?|video_resources?)$/i.test(key) ||
        /^(video_url|videoUrl|playback_url|playbackUrl|content_url|contentUrl)$/i.test(key);
      const isPhotoField =
        /^(display_url|displayUrl|image_url|imageUrl|thumbnail_url|thumbnailUrl)$/i.test(key) ||
        /^(image_versions?|image_versions2|image_resources?|display_resources?)$/i.test(key);
      const keepsContext = /^(url|src|candidates?|resources?)$/i.test(key);
      const nextContext = isVideoField
        ? "video"
        : isPhotoField
          ? "photo"
          : keepsContext
            ? mediaContext
            : null;
      collectInstagramMediaFromJson(item, bucket, nextContext, state);
    }
  }

  function addStructuredValue(bucket, value, type) {
    if (typeof value === "string") {
      addMedia(bucket, value, type);
    } else if (Array.isArray(value)) {
      value.forEach((item) => addStructuredValue(bucket, item, type));
    } else if (value && typeof value === "object") {
      for (const key of ["contentUrl", "content_url", "url", "src"]) {
        if (key in value) addStructuredValue(bucket, value[key], type);
      }
    }
  }

  function collectJsonLdMedia(value, bucket, state = { nodes: 0 }) {
    state.nodes += 1;
    if (state.nodes > 20000 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => collectJsonLdMedia(item, bucket, state));
      return;
    }
    if (typeof value !== "object") return;

    const declaredTypes = Array.isArray(value["@type"])
      ? value["@type"].join(" ")
      : String(value["@type"] || "");
    const objectType = /audioobject|musicrecording|podcastepisode|audiobook/i.test(declaredTypes)
      ? "audio"
      : /videoobject|video/i.test(declaredTypes)
        ? "video"
        : /imageobject|photograph|image/i.test(declaredTypes)
          ? "photo"
          : null;

    if (objectType) {
      for (const key of ["contentUrl", "content_url", "url"]) {
        if (key in value) addStructuredValue(bucket, value[key], objectType);
      }
    }
    for (const key of ["thumbnailUrl", "thumbnail_url", "imageUrl", "image_url"]) {
      if (key in value) addStructuredValue(bucket, value[key], "photo");
    }
    if (typeof value.image === "string" || Array.isArray(value.image)) {
      addStructuredValue(bucket, value.image, "photo");
    }
    if (typeof value.video === "string" || Array.isArray(value.video)) {
      addStructuredValue(bucket, value.video, "video");
    }
    if ("audio" in value) {
      addStructuredValue(bucket, value.audio, "audio");
    }

    for (const item of Object.values(value)) {
      if (item && typeof item === "object") collectJsonLdMedia(item, bucket, state);
    }
  }

  function collectFromScripts(bucket) {
    const scripts = document.querySelectorAll(
      'script[type="application/json"], script[type="application/ld+json"]'
    );
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text || text.length > 10000000) continue;
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        continue;
      }
      const type = script.getAttribute ? script.getAttribute("type") : "";
      if (type === "application/ld+json") {
        collectJsonLdMedia(value, bucket);
      } else if (IS_INSTAGRAM) {
        collectInstagramMediaFromJson(value, bucket);
      }
    }
  }

  function collectDirectLinks(bucket) {
    document.querySelectorAll("a[href]").forEach((link) => {
      const url = link.href || link.getAttribute("href");
      const type = directMediaType(url);
      if (type) addMedia(bucket, url, type);
    });
  }

  function collectBackgrounds(bucket) {
    const elements = document.querySelectorAll("body, body *");
    const limit = Math.min(elements.length, MAX_BACKGROUND_ELEMENTS);
    for (let i = 0; i < limit; i += 1) {
      const element = elements[i];
      const tag = String(element.tagName || "").toLowerCase();
      if (["img", "video", "audio", "source", "script", "style", "meta", "link"].includes(tag)) {
        continue;
      }
      collectFromBackground(element, bucket);
    }
  }

  function collectMeta(bucket) {
    for (const selector of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="og:image:secure_url"]',
    ]) {
      document
        .querySelectorAll(selector)
        .forEach((el) => addMedia(bucket, el.getAttribute("content"), "photo"));
    }
    for (const selector of [
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[property="og:video:secure_url"]',
      'link[rel="preload"][as="video"]',
    ]) {
      document.querySelectorAll(selector).forEach((el) => {
        addMedia(bucket, el.getAttribute("content") || el.getAttribute("href"), "video");
      });
    }
    for (const selector of [
      'meta[property="og:audio"]',
      'meta[property="og:audio:url"]',
      'meta[property="og:audio:secure_url"]',
      'link[rel="preload"][as="audio"]',
    ]) {
      document.querySelectorAll(selector).forEach((el) => {
        addMedia(bucket, el.getAttribute("content") || el.getAttribute("href"), "audio");
      });
    }
    document.querySelectorAll('meta[name="twitter:player:stream"]').forEach((el) => {
      const url = el.getAttribute("content");
      addMedia(bucket, url, directMediaType(url) === "audio" ? "audio" : "video");
    });
  }

  function collectAll() {
    /** @type {Map<string, {url:string,key:string,type:"photo"|"video"|"audio",poster?:string,playing?:boolean}>} */
    const bucket = new Map();
    document.querySelectorAll("img").forEach((img) => collectFromImg(img, bucket));
    document.querySelectorAll("video").forEach((video) => collectFromVideo(video, bucket));
    document.querySelectorAll("audio").forEach((audio) => collectFromAudio(audio, bucket));
    collectDirectLinks(bucket);
    collectBackgrounds(bucket);
    collectMeta(bucket);
    collectFromScripts(bucket);

    const items = [...bucket.values()];
    return {
      items,
      urls: items.map((i) => i.url),
      photoCount: items.filter((i) => i.type === "photo").length,
      videoCount: items.filter((i) => i.type === "video").length,
      audioCount: items.filter((i) => i.type === "audio").length,
      pageType: detectPageType(),
      sourceName: extractSourceName(),
      username: extractSourceName(),
      isInstagram: IS_INSTAGRAM,
      pageUrl: location.href,
      title: document.title || hostname || "page",
      scrollY: window.scrollY || window.pageYOffset || 0,
      pageHeight: getPageHeight(),
    };
  }

  function getPageHeight() {
    const el = document.documentElement;
    const b = document.body;
    return Math.max(
      el.scrollHeight,
      el.offsetHeight,
      b ? b.scrollHeight : 0,
      b ? b.offsetHeight : 0,
      window.innerHeight
    );
  }

  /** Prefer the real scroll root (IG sometimes uses nested containers). */
  function getScrollRoot() {
    const candidates = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
    ].filter(Boolean);

    let best = document.scrollingElement || document.documentElement;
    let bestScore = 0;
    for (const el of candidates) {
      try {
        const canScroll = el.scrollHeight - el.clientHeight;
        if (canScroll > bestScore) {
          bestScore = canScroll;
          best = el;
        }
      } catch {
        /* ignore */
      }
    }
    // also scan large overflow containers
    document.querySelectorAll("div").forEach((el) => {
      try {
        const st = getComputedStyle(el);
        if (
          (st.overflowY === "auto" || st.overflowY === "scroll") &&
          el.scrollHeight - el.clientHeight > bestScore &&
          el.clientHeight > 200
        ) {
          bestScore = el.scrollHeight - el.clientHeight;
          best = el;
        }
      } catch {
        /* ignore */
      }
    });
    return best;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function scrollPage(opts = {}) {
    const steps = Math.min(Math.max(opts.steps || 4, 1), 20);
    const waitMs = Math.min(Math.max(opts.waitMs || 900, 200), 4000);
    const root = getScrollRoot();
    const beforeH = getPageHeight();
    const beforeY =
      root === document.body || root === document.documentElement || root === document.scrollingElement
        ? window.scrollY || window.pageYOffset || 0
        : root.scrollTop;
    const beforeCount = collectAll().urls.length;

    for (let i = 0; i < steps; i++) {
      const delta =
        (root.clientHeight || window.innerHeight || 800) * 0.92;
      if (
        root === document.body ||
        root === document.documentElement ||
        root === document.scrollingElement
      ) {
        window.scrollBy(0, delta);
        // nudge to absolute bottom every other step — triggers IG infinite loader
        if (i % 2 === 1) {
          window.scrollTo(0, getPageHeight());
        }
      } else {
        root.scrollTop = Math.min(root.scrollTop + delta, root.scrollHeight);
        if (i % 2 === 1) root.scrollTop = root.scrollHeight;
      }
      await sleep(waitMs);
    }

    // final settle
    await sleep(Math.max(waitMs, 700));

    const afterH = getPageHeight();
    const afterData = collectAll();
    const afterY =
      root === document.body || root === document.documentElement || root === document.scrollingElement
        ? window.scrollY || window.pageYOffset || 0
        : root.scrollTop;

    return {
      ok: true,
      grew: afterH > beforeH + 40 || afterData.urls.length > beforeCount,
      heightBefore: beforeH,
      heightAfter: afterH,
      scrollBefore: beforeY,
      scrollAfter: afterY,
      countBefore: beforeCount,
      countAfter: afterData.urls.length,
      ...afterData,
    };
  }

  function detectPageType() {
    if (!IS_INSTAGRAM) return "web";
    const path = location.pathname;
    if (/\/p\//.test(path)) return "post";
    if (/\/reel\//.test(path) || /\/reels\//.test(path)) return "reel";
    if (/\/stories\//.test(path)) return "stories";
    if (/\/explore\//.test(path)) return "explore";
    if (/^\/[^/]+\/?$/.test(path) && path !== "/") return "profile";
    return "other";
  }

  function extractSourceName() {
    if (!IS_INSTAGRAM) return hostname.replace(/^www\./i, "") || "page";
    const m = location.pathname.match(/^\/([A-Za-z0-9._]+)\/?/);
    if (
      m &&
      !["p", "reel", "reels", "stories", "explore", "accounts", "direct"].includes(m[1])
    ) {
      return m[1];
    }
    const og = document.querySelector('meta[property="og:title"]');
    if (og) {
      const t = og.getAttribute("content") || "";
      const um = t.match(/@([A-Za-z0-9._]+)/) || t.match(/^([A-Za-z0-9._]+)\s*[•(]/);
      if (um) return um[1];
    }
    return "instagram";
  }

  // ── on-page status banner for crawl mode ──────────────────────────
  function ensureBanner() {
    let el = document.getElementById("page-media-dl-banner");
    if (el) return el;
    el = document.createElement("div");
    el.id = "page-media-dl-banner";
    el.setAttribute(
      "style",
      [
        "position:fixed",
        "top:12px",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:2147483646",
        "background:linear-gradient(135deg,#833ab4,#e1306c,#f77737)",
        "color:#fff",
        "font:600 13px/1.35 system-ui,-apple-system,sans-serif",
        "padding:10px 16px",
        "border-radius:12px",
        "box-shadow:0 8px 28px rgba(0,0,0,.35)",
        "max-width:min(520px,92vw)",
        "text-align:center",
        "pointer-events:none",
        "display:none",
      ].join(";")
    );
    document.documentElement.appendChild(el);
    return el;
  }

  function showBanner(text) {
    const el = ensureBanner();
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "CRAWL_BANNER") {
      showBanner(msg.text || "");
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "COLLECT_MEDIA" || msg.type === "COLLECT_PHOTOS") {
      try {
        sendResponse({ ok: true, ...collectAll() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
      return false;
    }

    if (msg.type === "SCROLL_LOAD_MORE") {
      scrollPage({ steps: Math.min(msg.rounds || 4, 12), waitMs: 500 })
        .then((data) => sendResponse({ ok: true, ...data }))
        .catch((e) =>
          sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
        );
      return true;
    }

    if (msg.type === "SCROLL_PAGE") {
      scrollPage({
        steps: msg.steps || 4,
        waitMs: msg.waitMs || 900,
      })
        .then((data) => sendResponse(data))
        .catch((e) =>
          sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
        );
      return true;
    }
  });
})();
