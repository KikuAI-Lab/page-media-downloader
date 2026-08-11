"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function attrElement(attributes = {}) {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function image(url, options = {}) {
  const attributes = {
    src: url,
    srcset: options.srcset || "",
    "data-src": options.dataSrc || "",
    "data-original": options.dataOriginal || "",
    "data-lazy-src": options.dataLazySrc || "",
  };
  return {
    ...attrElement(attributes),
    currentSrc: options.currentSrc === undefined ? url : options.currentSrc,
    src: url,
    srcset: options.srcset || "",
    naturalWidth: options.width ?? 1080,
    naturalHeight: options.height ?? 1080,
    width: options.width ?? 1080,
    height: options.height ?? 1080,
  };
}

function video({ currentSrc = "", src = "", poster = "", sources = [] } = {}) {
  return {
    ...attrElement({ src, "data-src": "", "data-video-url": "" }),
    currentSrc,
    src,
    poster,
    querySelectorAll(selector) {
      return selector === "source" ? sources : [];
    },
  };
}

function audio({ currentSrc = "", src = "", sources = [], paused = true, ended = false } = {}) {
  return {
    ...attrElement({ src, "data-src": "" }),
    currentSrc,
    src,
    paused,
    ended,
    querySelectorAll(selector) {
      return selector === "source" ? sources : [];
    },
  };
}

function source(src, type = "") {
  return {
    ...attrElement({ src, type }),
    src,
  };
}

function link(href) {
  return {
    ...attrElement({ href }),
    href,
  };
}

function backgroundElement(backgroundImage, width = 800, height = 600) {
  return {
    tagName: "DIV",
    offsetWidth: width,
    offsetHeight: height,
    clientWidth: width,
    clientHeight: height,
    computedStyle: { backgroundImage, overflowY: "visible" },
  };
}

function jsonScript(type, value) {
  return {
    ...attrElement({ type }),
    textContent: typeof value === "string" ? value : JSON.stringify(value),
  };
}

function collectFromFixture({
  url = "https://www.instagram.com/nasa/reel/test/",
  images = [],
  videos = [],
  audios = [],
  links = [],
  backgrounds = [],
  scripts = [],
  selectors = {},
} = {}) {
  let messageListener = null;
  const parsedUrl = new URL(url);
  const location = {
    href: parsedUrl.href,
    pathname: parsedUrl.pathname,
    hostname: parsedUrl.hostname,
  };
  const documentElement = {
    scrollHeight: 1200,
    offsetHeight: 1200,
    clientHeight: 800,
    appendChild() {},
  };
  const body = { scrollHeight: 1200, offsetHeight: 1200 };

  const document = {
    title: "NASA reel",
    documentElement,
    body,
    scrollingElement: documentElement,
    querySelectorAll(selector) {
      if (selector === "img") return images;
      if (selector === "video") return videos;
      if (selector === "audio") return audios;
      if (selector === "a[href]") return links;
      if (selector === "body, body *") return backgrounds;
      if (selector === "div") return [];
      if (selector.startsWith('script[type="application/json"]')) return scripts;
      return selectors[selector] || [];
    },
    querySelector(selector) {
      return (selectors[selector] || [])[0] || null;
    },
    getElementById() {
      return null;
    },
    createElement() {
      return {
        style: {},
        setAttribute() {},
      };
    },
  };

  const window = {
    location,
    innerHeight: 800,
    scrollY: 0,
    pageYOffset: 0,
    scrollBy() {},
    scrollTo() {},
  };

  const context = {
    URL,
    URLSearchParams,
    Map,
    Set,
    console,
    document,
    location,
    window,
    getComputedStyle() {
      const element = arguments[0];
      return element?.computedStyle || { backgroundImage: "", overflowY: "visible" };
    },
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
      },
    },
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, "content.js"), "utf8"), context, {
    filename: "content.js",
  });
  assert.equal(typeof messageListener, "function", "content listener should register");

  let response = null;
  messageListener({ type: "COLLECT_MEDIA" }, {}, (value) => {
    response = value;
  });
  assert.equal(response?.ok, true, response?.error || "collection should succeed");
  return response;
}

function loadPopupModel() {
  const source = fs.readFileSync(path.join(root, "popup.js"), "utf8");
  const start = source.indexOf("function orderMediaItems");
  const end = source.indexOf("\nfunction setPageSource", start);
  assert.ok(start >= 0 && end > start, "popup media model should remain testable");

  const context = {};
  vm.runInNewContext(
    `${source.slice(start, end)}\nmodel = { normaliseCollectedItems, splitMediaItems, selectionButtonLabel, resultSummaryText };`,
    context,
    { filename: "popup-model.js" }
  );
  return context.model;
}

function loadPopupPagePolicy() {
  const sourceText = fs.readFileSync(path.join(root, "popup.js"), "utf8");
  const start = sourceText.indexOf("function isInstagramUrl");
  const end = sourceText.indexOf("\nasync function getActiveTab", start);
  assert.ok(start >= 0 && end > start, "popup page policy should remain testable");

  const context = { URL, Date };
  vm.runInNewContext(
    `${sourceText.slice(start, end)}\npolicy = { isInstagramUrl, isSupportedPageUrl, buildDownloadFolder };`,
    context,
    { filename: "popup-page-policy.js" }
  );
  return context.policy;
}

function loadBackground({ initialDownloadState = "complete", controlledTimers = false } = {}) {
  let messageListener = null;
  const downloads = [];
  const downloadListeners = new Set();
  const scheduledTimeouts = new Map();
  let downloadState = initialDownloadState;
  let downloadError = "";
  let fetchCalls = 0;
  let timeoutId = 0;

  const scheduleTimeout = controlledTimers
    ? (callback) => {
        const id = ++timeoutId;
        scheduledTimeouts.set(id, callback);
        return id;
      }
    : setTimeout;
  const cancelTimeout = controlledTimers
    ? (id) => {
        scheduledTimeouts.delete(id);
      }
    : clearTimeout;

  const context = {
    URL,
    URLSearchParams,
    Blob,
    console,
    setTimeout: scheduleTimeout,
    clearTimeout: cancelTimeout,
    setInterval,
    clearInterval,
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("background fetch should not run for direct downloads");
    },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage() {
          return Promise.resolve();
        },
        getPlatformInfo(callback) {
          callback({ os: "mac" });
        },
      },
      storage: { session: { set() {} } },
      downloads: {
        download(options, callback) {
          downloads.push(options);
          callback(downloads.length);
        },
        search({ id }, callback) {
          callback(
            downloadState === null
              ? []
              : [{ id, state: downloadState, ...(downloadError ? { error: downloadError } : {}) }]
          );
        },
        onChanged: {
          addListener(listener) {
            downloadListeners.add(listener);
          },
          removeListener(listener) {
            downloadListeners.delete(listener);
          },
        },
      },
      tabs: { sendMessage() {} },
      scripting: { executeScript: async () => {} },
    },
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context, {
    filename: "background.js",
  });
  assert.equal(typeof messageListener, "function", "background listener should register");
  return {
    context,
    downloads,
    getFetchCalls: () => fetchCalls,
    downloadListenerCount: () => downloadListeners.size,
    pendingTimeoutCount: () => scheduledTimeouts.size,
    setDownloadState(state, error = "") {
      downloadState = state;
      downloadError = error;
    },
    emitDownloadChange(delta) {
      [...downloadListeners].forEach((listener) => listener(delta));
    },
    async runNextTimeout() {
      const next = scheduledTimeouts.entries().next();
      assert.equal(next.done, false, "a controlled timeout should be scheduled");
      const [id, callback] = next.value;
      scheduledTimeouts.delete(id);
      await callback();
    },
  };
}

async function main() {
  const genericPage = "https://example.test/articles/page";
  const genericCases = [
    {
      name: "absolute img",
      fixture: { url: genericPage, images: [image("https://cdn.example.test/photo.jpg")] },
      check: (data) => assert.equal(data.photoCount, 1),
    },
    {
      name: "relative img",
      fixture: { url: genericPage, images: [image("/media/photo.png")] },
      check: (data) => assert.equal(data.items[0].url, "https://example.test/media/photo.png"),
    },
    {
      name: "largest srcset candidate",
      fixture: {
        url: genericPage,
        images: [
          image("/media/small.jpg", {
            srcset: "/media/small.jpg 320w, /media/large.jpg 1600w",
          }),
        ],
      },
      check: (data) =>
        assert.ok(data.items.some((item) => item.url.endsWith("/media/large.jpg"))),
    },
    {
      name: "lazy data-src",
      fixture: { url: genericPage, images: [image("", { dataSrc: "/lazy/photo.webp" })] },
      check: (data) => assert.equal(data.items[0].url, "https://example.test/lazy/photo.webp"),
    },
    {
      name: "small image excluded",
      fixture: { url: genericPage, images: [image("/icons/tiny.png", { width: 64, height: 64 })] },
      check: (data) => assert.equal(data.photoCount, 0),
    },
    {
      name: "data image excluded",
      fixture: { url: genericPage, images: [image("data:image/png;base64,AAAA")] },
      check: (data) => assert.equal(data.photoCount, 0),
    },
    {
      name: "blob image excluded",
      fixture: { url: genericPage, images: [image("blob:https://example.test/image")] },
      check: (data) => assert.equal(data.photoCount, 0),
    },
    {
      name: "extensionless video element",
      fixture: {
        url: genericPage,
        videos: [video({ currentSrc: "https://media.example.test/play?id=42" })],
      },
      check: (data) => assert.equal(data.videoCount, 1),
    },
    {
      name: "relative source element",
      fixture: { url: genericPage, videos: [video({ sources: [source("/media/clip.webm")] })] },
      check: (data) => assert.equal(data.items[0].url, "https://example.test/media/clip.webm"),
    },
    {
      name: "blob video excluded",
      fixture: { url: genericPage, videos: [video({ currentSrc: "blob:https://example.test/player" })] },
      check: (data) => assert.equal(data.videoCount, 0),
    },
    {
      name: "playing extensionless audio element",
      fixture: {
        url: genericPage,
        audios: [audio({ currentSrc: "https://media.example.test/listen?id=42", paused: false })],
      },
      check: (data) => {
        assert.equal(data.audioCount, 1);
        assert.equal(data.items[0].type, "audio");
        assert.equal(data.items[0].playing, true);
      },
    },
    {
      name: "paused relative audio source",
      fixture: { url: genericPage, audios: [audio({ sources: [source("/media/track.m4a")] })] },
      check: (data) => {
        assert.equal(data.audioCount, 1);
        assert.equal(data.items[0].url, "https://example.test/media/track.m4a");
        assert.equal(data.items[0].playing, undefined);
      },
    },
    {
      name: "native WebM audio keeps explicit context",
      fixture: {
        url: genericPage,
        audios: [audio({ currentSrc: "https://media.example.test/audio/track.webm" })],
      },
      check: (data) => {
        assert.equal(data.audioCount, 1);
        assert.equal(data.items[0].type, "audio");
      },
    },
    {
      name: "native MP4 audio source keeps explicit context",
      fixture: {
        url: genericPage,
        audios: [audio({ sources: [source("/media/track.mp4", "audio/mp4")] })],
      },
      check: (data) => {
        assert.equal(data.audioCount, 1);
        assert.equal(data.items[0].type, "audio");
      },
    },
    {
      name: "playing state survives audio deduplication",
      fixture: {
        url: genericPage,
        audios: [
          audio({ currentSrc: "https://media.example.test/track.mp3" }),
          audio({ currentSrc: "https://media.example.test/track.mp3", paused: false }),
        ],
      },
      check: (data) => {
        assert.equal(data.audioCount, 1);
        assert.equal(data.items[0].playing, true);
      },
    },
    {
      name: "blob audio excluded",
      fixture: { url: genericPage, audios: [audio({ currentSrc: "blob:https://example.test/audio" })] },
      check: (data) => assert.equal(data.audioCount, 0),
    },
    {
      name: "absolute CSS background",
      fixture: {
        url: genericPage,
        backgrounds: [backgroundElement('url("https://cdn.example.test/hero.jpg")')],
      },
      check: (data) => assert.equal(data.photoCount, 1),
    },
    {
      name: "relative CSS background",
      fixture: { url: genericPage, backgrounds: [backgroundElement("url('/media/hero.avif')")] },
      check: (data) => assert.equal(data.items[0].url, "https://example.test/media/hero.avif"),
    },
    {
      name: "small CSS background excluded",
      fixture: {
        url: genericPage,
        backgrounds: [backgroundElement("url('/media/icon.png')", 32, 32)],
      },
      check: (data) => assert.equal(data.photoCount, 0),
    },
    {
      name: "Open Graph image",
      fixture: {
        url: genericPage,
        selectors: {
          'meta[property="og:image"]': [attrElement({ content: "/social/cover.jpg" })],
        },
      },
      check: (data) => assert.equal(data.items[0].url, "https://example.test/social/cover.jpg"),
    },
    {
      name: "Twitter image",
      fixture: {
        url: genericPage,
        selectors: {
          'meta[name="twitter:image"]': [attrElement({ content: "/social/card.webp" })],
        },
      },
      check: (data) => assert.equal(data.photoCount, 1),
    },
    {
      name: "Open Graph extensionless video",
      fixture: {
        url: genericPage,
        selectors: {
          'meta[property="og:video"]': [
            attrElement({ content: "https://media.example.test/watch?id=7" }),
          ],
        },
      },
      check: (data) => assert.equal(data.videoCount, 1),
    },
    {
      name: "Open Graph extensionless audio",
      fixture: {
        url: genericPage,
        selectors: {
          'meta[property="og:audio"]': [
            attrElement({ content: "https://media.example.test/listen?id=7" }),
          ],
        },
      },
      check: (data) => assert.equal(data.audioCount, 1),
    },
    {
      name: "direct image link",
      fixture: { url: genericPage, links: [link("/downloads/original.jpeg")] },
      check: (data) => assert.equal(data.photoCount, 1),
    },
    {
      name: "direct video link",
      fixture: { url: genericPage, links: [link("/downloads/original.mp4?token=1")] },
      check: (data) => assert.equal(data.videoCount, 1),
    },
    {
      name: "direct audio link",
      fixture: { url: genericPage, links: [link("/downloads/original.mp3?token=1")] },
      check: (data) => assert.equal(data.audioCount, 1),
    },
    {
      name: "direct audio MIME query link",
      fixture: {
        url: genericPage,
        links: [link("https://media.example.test/download?id=9&type=audio%2Fmpeg")],
      },
      check: (data) => assert.equal(data.audioCount, 1),
    },
    {
      name: "HLS audio link ignored",
      fixture: { url: genericPage, links: [link("/streams/audio.m3u8")] },
      check: (data) => assert.equal(data.audioCount, 0),
    },
    {
      name: "JSON-LD VideoObject",
      fixture: {
        url: genericPage,
        scripts: [
          jsonScript("application/ld+json", {
            "@type": "VideoObject",
            contentUrl: "/structured/movie.mp4",
          }),
        ],
      },
      check: (data) => assert.equal(data.videoCount, 1),
    },
    {
      name: "JSON-LD ImageObject",
      fixture: {
        url: genericPage,
        scripts: [
          jsonScript("application/ld+json", {
            "@type": "ImageObject",
            contentUrl: "/structured/photo.jpg",
          }),
        ],
      },
      check: (data) => assert.equal(data.photoCount, 1),
    },
    {
      name: "JSON-LD AudioObject",
      fixture: {
        url: genericPage,
        scripts: [
          jsonScript("application/ld+json", {
            "@type": "AudioObject",
            contentUrl: "/structured/episode.ogg",
          }),
        ],
      },
      check: (data) => assert.equal(data.audioCount, 1),
    },
    {
      name: "JSON-LD MusicRecording audio object",
      fixture: {
        url: genericPage,
        scripts: [
          jsonScript("application/ld+json", {
            "@type": "MusicRecording",
            audio: { contentUrl: "/structured/song.flac" },
          }),
        ],
      },
      check: (data) => {
        assert.equal(data.audioCount, 1);
        assert.equal(data.items[0].url, "https://example.test/structured/song.flac");
      },
    },
    {
      name: "generic application/json ignored",
      fixture: {
        url: genericPage,
        scripts: [jsonScript("application/json", { video_url: "/private/state.mp4" })],
      },
      check: (data) => assert.equal(data.items.length, 0),
    },
    {
      name: "ordinary link ignored",
      fixture: { url: genericPage, links: [link("/another-page")] },
      check: (data) => assert.equal(data.items.length, 0),
    },
    {
      name: "SVG excluded",
      fixture: { url: genericPage, images: [image("/art/vector.svg")] },
      check: (data) => assert.equal(data.items.length, 0),
    },
    {
      name: "signed query variants deduplicate",
      fixture: {
        url: genericPage,
        images: [
          image("https://cdn.example.test/photo.jpg?token=1"),
          image("https://cdn.example.test/photo.jpg?token=longer-token"),
        ],
      },
      check: (data) => assert.equal(data.photoCount, 1),
    },
    {
      name: "stable query identifiers remain distinct",
      fixture: {
        url: genericPage,
        audios: [
          audio({ currentSrc: "https://media.example.test/listen?id=track-one" }),
          audio({ currentSrc: "https://media.example.test/listen?id=track-two" }),
        ],
      },
      check: (data) => assert.equal(data.audioCount, 2),
    },
    {
      name: "volatile token changes do not split a stable query item",
      fixture: {
        url: genericPage,
        audios: [
          audio({ currentSrc: "https://media.example.test/listen?id=track-one&token=short" }),
          audio({ currentSrc: "https://media.example.test/listen?token=longer&id=track-one" }),
        ],
      },
      check: (data) => assert.equal(data.audioCount, 1),
    },
    {
      name: "query ordering does not change media identity",
      fixture: {
        url: genericPage,
        images: [
          image("https://cdn.example.test/photo.jpg?album=summer&id=7"),
          image("https://cdn.example.test/photo.jpg?id=7&album=summer"),
        ],
      },
      check: (data) => assert.equal(data.photoCount, 1),
    },
    {
      name: "same basename on different origins remains distinct",
      fixture: {
        url: genericPage,
        images: [
          image("https://one.example.test/assets/photo.jpg"),
          image("https://two.example.test/assets/photo.jpg"),
        ],
      },
      check: (data) => assert.equal(data.photoCount, 2),
    },
    {
      name: "video poster retained as metadata",
      fixture: {
        url: genericPage,
        videos: [
          video({
            currentSrc: "https://media.example.test/clip.mp4",
            poster: "https://media.example.test/poster.jpg",
          }),
        ],
      },
      check: (data) => {
        assert.equal(data.videoCount, 1);
        assert.equal(data.items[0].poster, "https://media.example.test/poster.jpg");
      },
    },
  ];

  for (const testCase of genericCases) {
    const data = collectFromFixture(testCase.fixture);
    try {
      testCase.check(data);
    } catch (error) {
      error.message = `${testCase.name}: ${error.message}`;
      throw error;
    }
  }

  const photoUrl = "https://scontent.cdninstagram.com/v/media_42_n.jpg?token=photo";
  const videoUrl = "https://instagram.example.fna.fbcdn.net/v/media_42_n.mp4?token=a&x=1";
  const alternateVideoUrl =
    "https://instagram.example.fna.fbcdn.net/v/media_42_n.mp4?token=longer-variant&x=1";
  const embedded = JSON.stringify({
    display_url: photoUrl,
    video_versions: [{ type: 101, url: videoUrl }, { type: 102, url: alternateVideoUrl }],
    video_dash_manifest:
      '<MPD><BaseURL>https://instagram.example.fna.fbcdn.net/v/audio_track.mp4?token=dash</BaseURL></MPD>',
  })
    .replaceAll("/", "\\/")
    .replaceAll("&", "\\u0026");

  const collected = collectFromFixture({
    images: [image(photoUrl)],
    videos: [video({ currentSrc: "blob:https://www.instagram.com/transient-player" })],
    scripts: [{ textContent: embedded }],
  });

  assert.equal(collected.photoCount, 1, "photo collection should remain intact");
  assert.equal(
    collected.videoCount,
    1,
    "embedded video variants deduplicate without collecting separate DASH tracks"
  );
  assert.equal(collected.items.length, 2, "photo and video with the same stem stay distinct");
  const collectedVideo = collected.items.find((item) => item.type === "video");
  assert.ok(collectedVideo, "typed video item should exist");
  assert.match(collectedVideo.url, /^https:\/\//);
  assert.match(collectedVideo.url, /\.mp4\?/);
  assert.ok(!collectedVideo.url.startsWith("blob:"), "blob player URLs are not downloadable");
  assert.ok(collectedVideo.url.includes("&x=1"), "signed query parameters are preserved");
  assert.match(collectedVideo.key, /^video:/);
  assert.match(collected.items.find((item) => item.type === "photo").key, /^photo:/);

  const metaVideoUrl = "https://video.cdninstagram.com/v/meta_clip.webm?token=meta";
  const metaCollected = collectFromFixture({
    videos: [video({ currentSrc: "blob:https://www.instagram.com/another-player" })],
    selectors: {
      'meta[property="og:video"]': [attrElement({ content: metaVideoUrl })],
    },
  });
  assert.equal(metaCollected.videoCount, 1, "Open Graph video is a fallback");
  assert.equal(metaCollected.items[0].url, metaVideoUrl);

  const popupModel = loadPopupModel();
  const popupItems = popupModel.normaliseCollectedItems({
    items: [
      { url: "photo-1", type: "photo" },
      { url: "audio-paused", type: "audio" },
      { url: "video-1", type: "video" },
      { url: "audio-playing", type: "audio", playing: true },
      { url: "photo-2", type: "photo" },
      { url: "video-2", type: "video" },
    ],
  });
  assert.deepEqual(
    Array.from(popupItems, (item) => item.url),
    ["video-1", "video-2", "audio-playing", "audio-paused", "photo-1", "photo-2"],
    "results should render as video, audio, photo with playing audio first"
  );
  assert.deepEqual(
    Array.from(popupModel.normaliseCollectedItems({ urls: ["legacy-photo"] }), (item) => item.type),
    ["photo"],
    "legacy photo-only responses remain supported"
  );
  const popupGroups = popupModel.splitMediaItems(popupItems);
  assert.deepEqual(
    Array.from(popupGroups.videos, (item) => item.url),
    ["video-1", "video-2"],
    "videos have their own deterministic result group"
  );
  assert.deepEqual(
    Array.from(popupGroups.audios, (item) => item.url),
    ["audio-playing", "audio-paused"],
    "audio has its own deterministic group below video"
  );
  assert.deepEqual(
    Array.from(popupGroups.photos, (item) => item.url),
    ["photo-1", "photo-2"],
    "photos remain in a separate group below videos"
  );
  assert.equal(popupModel.selectionButtonLabel(0), "Скачать выбранное · 0");
  assert.equal(popupModel.selectionButtonLabel(3), "Скачать выбранное · 3");
  assert.equal(popupModel.resultSummaryText(popupItems), "2 видео · 2 аудио · 2 фото");

  const popupPolicy = loadPopupPagePolicy();
  assert.equal(popupPolicy.isSupportedPageUrl("https://example.test/page"), true);
  assert.equal(popupPolicy.isSupportedPageUrl("http://example.test/page"), true);
  assert.equal(popupPolicy.isSupportedPageUrl("chrome://extensions"), false);
  assert.equal(popupPolicy.isSupportedPageUrl("file:///tmp/example.html"), false);
  assert.equal(popupPolicy.isInstagramUrl("https://www.instagram.com/nasa/"), true);
  assert.match(
    popupPolicy.buildDownloadFolder({
      pageUrl: "https://example.test/page",
      sourceName: "example.test",
      isInstagram: false,
    }),
    /^media_example\.test_\d{6}$/
  );

  const { context: background, downloads, getFetchCalls } = loadBackground();
  assert.equal(background.extFromContentType("video/mp4", "https://cdn/x", "video"), "mp4");
  assert.equal(background.extFromContentType("video/webm", "https://cdn/x", "video"), "webm");
  assert.equal(background.extFromContentType("video/quicktime", "https://cdn/x", "video"), "mov");
  assert.equal(background.extFromContentType("audio/mpeg", "https://cdn/x", "audio"), "mp3");
  assert.equal(background.extFromContentType("audio/mp4", "https://cdn/x", "audio"), "m4a");
  assert.equal(background.extFromContentType("audio/ogg", "https://cdn/x", "audio"), "ogg");
  assert.equal(
    background.extFromContentType("", "https://media.example.test/track.webm", "audio"),
    "webm"
  );
  assert.equal(background.extFromContentType("", videoUrl, "video"), "mp4");
  assert.equal(
    background.extFromContentType("", "https://media.example.test/track.m4a", "audio"),
    "m4a"
  );
  assert.equal(background.extFromContentType("image/jpeg", photoUrl, "photo"), "jpg");
  assert.equal(background.normalizeMediaItem({ url: videoUrl, type: "photo" }).type, "photo");
  assert.equal(
    background.normalizeMediaItem({ url: "https://media.example.test/listen?id=8", type: "audio" }).type,
    "audio"
  );
  assert.equal(
    background.normalizeMediaItem("https://media.example.test/track.mp3").type,
    "audio"
  );
  assert.equal(
    background.normalizeMediaItem({
      url: "https://media.example.test/track.webm",
      type: "audio",
    }).type,
    "audio"
  );
  assert.equal(
    background.normalizeMediaItem({
      url: "https://media.example.test/track.mp4",
      type: "audio",
    }).type,
    "audio"
  );
  assert.notEqual(
    background.mediaKey(photoUrl, "photo"),
    background.mediaKey(videoUrl, "video"),
    "media type participates in dedup identity"
  );
  assert.notEqual(
    background.mediaKey("https://one.example.test/assets/photo.jpg", "photo"),
    background.mediaKey("https://two.example.test/assets/photo.jpg", "photo"),
    "origin participates in generic dedup identity"
  );
  assert.notEqual(
    background.mediaKey("https://media.example.test/listen?id=one", "audio"),
    background.mediaKey("https://media.example.test/listen?id=two", "audio"),
    "stable query identifiers participate in dedup identity"
  );
  assert.equal(
    background.mediaKey("https://media.example.test/listen?id=one&token=short", "audio"),
    background.mediaKey("https://media.example.test/listen?token=longer&id=one", "audio"),
    "volatile signing parameters do not split one media item"
  );
  assert.equal(
    background.mediaKey("https://media.example.test/listen?album=a&id=one", "audio"),
    background.mediaKey("https://media.example.test/listen?id=one&album=a", "audio"),
    "query ordering is canonical"
  );

  const monitoredDownload = loadBackground({
    initialDownloadState: "in_progress",
    controlledTimers: true,
  });
  let monitoredSettlement = "pending";
  const monitoredPromise = monitoredDownload.context
    .chromeDownload("https://media.example.test/large-video.mp4", "media_test/large-video.mp4")
    .then(
      (id) => {
        monitoredSettlement = "resolved";
        return id;
      },
      (error) => {
        monitoredSettlement = "rejected";
        throw error;
      }
    );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(monitoredDownload.pendingTimeoutCount(), 1);
  assert.equal(monitoredDownload.downloadListenerCount(), 1);
  await monitoredDownload.runNextTimeout();
  await Promise.resolve();
  assert.equal(monitoredSettlement, "pending", "in-progress downloads must not resolve early");
  assert.equal(monitoredDownload.pendingTimeoutCount(), 1, "the watchdog should continue monitoring");
  assert.equal(monitoredDownload.downloadListenerCount(), 1, "the completion listener stays attached");
  monitoredDownload.emitDownloadChange({ id: 1, state: { current: "complete" } });
  assert.equal(await monitoredPromise, 1);
  assert.equal(monitoredDownload.downloadListenerCount(), 0);
  assert.equal(monitoredDownload.pendingTimeoutCount(), 0);

  const interruptedDownload = loadBackground({
    initialDownloadState: "in_progress",
    controlledTimers: true,
  });
  const interruptedPromise = interruptedDownload.context.chromeDownload(
    "https://media.example.test/interrupted.mp4",
    "media_test/interrupted.mp4"
  );
  await Promise.resolve();
  await Promise.resolve();
  await interruptedDownload.runNextTimeout();
  const interruptionCheck = assert.rejects(interruptedPromise, /NETWORK_FAILED/);
  interruptedDownload.setDownloadState("interrupted", "NETWORK_FAILED");
  await interruptedDownload.runNextTimeout();
  await interruptionCheck;
  assert.equal(interruptedDownload.downloadListenerCount(), 0);
  assert.equal(interruptedDownload.pendingTimeoutCount(), 0);

  const directResult = await background.downloadOne(
    background.normalizeMediaItem({ url: videoUrl, type: "video" }),
    "instagram_test",
    1,
    3
  );
  assert.equal(directResult.ok, true);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, videoUrl);
  assert.equal(downloads[0].filename, "instagram_test/001.mp4");
  assert.equal(getFetchCalls(), 0, "direct video download avoids buffering in the worker");

  const directPhotoResult = await background.downloadOne(
    background.normalizeMediaItem({ url: "https://cdn.example.test/photo.webp", type: "photo" }),
    "media_example",
    2,
    3
  );
  assert.equal(directPhotoResult.ok, true);
  assert.equal(downloads[1].url, "https://cdn.example.test/photo.webp");
  assert.equal(downloads[1].filename, "media_example/002.webp");
  assert.equal(getFetchCalls(), 0, "direct photo download needs no cross-origin fetch");

  const directAudioUrl = "https://media.example.test/track.m4a?token=audio";
  const directAudioResult = await background.downloadOne(
    background.normalizeMediaItem({ url: directAudioUrl, type: "audio", playing: true }),
    "media_example",
    3,
    3
  );
  assert.equal(directAudioResult.ok, true);
  assert.equal(downloads[2].url, directAudioUrl);
  assert.equal(downloads[2].filename, "media_example/003.m4a");
  assert.equal(getFetchCalls(), 0, "direct audio download needs no cross-origin fetch");

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  const popupCss = fs.readFileSync(path.join(root, "popup.css"), "utf8");
  const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
  const runtimeSource = ["background.js", "content.js", "popup.js"]
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  const iconSvg = fs.readFileSync(path.join(root, "icons/icon.svg"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const privacyPolicy = fs.readFileSync(path.join(root, "PRIVACY.md"), "utf8");
  const license = fs.readFileSync(path.join(root, "LICENSE.md"), "utf8");
  const commercial = fs.readFileSync(path.join(root, "COMMERCIAL.md"), "utf8");
  const packageScript = fs.readFileSync(path.join(root, "scripts/package-chrome.sh"), "utf8");
  const storePack = fs.readFileSync(path.join(root, "store/chrome/README.md"), "utf8");
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "1.6.1");
  assert.equal(manifest.name, "Page Media Downloader");
  assert.ok([...manifest.description].length <= 132, "manifest description must fit the store limit");
  assert.match(manifest.description, /фото, прямые видео и аудио/);
  assert.doesNotMatch(manifest.description, /Instagram/i);
  assert.deepEqual(manifest.permissions, ["downloads", "activeTab", "scripting", "storage"]);
  assert.equal("host_permissions" in manifest, false);
  assert.equal("content_scripts" in manifest, false);
  assert.equal("optional_permissions" in manifest, false);
  assert.match(manifest.action.default_title, /Скачать фото, видео и аудио/);

  assert.match(popupHtml, /<h1>Медиа со страницы<\/h1>/);
  assert.match(popupHtml, /id="status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(popupHtml, /id="btnDownload" class="primary-action"/);
  assert.match(popupHtml, /Скачать выбранное · 0/);
  assert.match(popupHtml, /id="btnScanMore"[^>]+class="secondary-action"/);
  assert.match(popupHtml, /Немного прокрутит страницу и обновит список\. Ничего не скачивает\./);
  assert.match(popupHtml, /сразу отправит найденные файлы в Downloads без предварительного выбора/);
  assert.match(popupHtml, /id="btnStop" class="danger-action job-stop" hidden/);
  assert.match(popupHtml, /id="advanced" class="disclosure" hidden/);
  assert.ok(
    popupHtml.indexOf('id="videoSection"') < popupHtml.indexOf('id="audioSection"') &&
      popupHtml.indexOf('id="audioSection"') < popupHtml.indexOf('id="photoSection"'),
    "DOM order must be video, audio, photo"
  );
  assert.equal((popupHtml.match(/class="primary-action"/g) || []).length, 1);
  assert.doesNotMatch(popupHtml, /lazy-load|MV3|HLS|DASH|v1\.6\.0/);

  assert.match(popupCss, /\[hidden\]\s*{\s*display:\s*none\s*!important/);
  assert.match(popupCss, /:focus-visible/);
  assert.match(popupCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(popupCss, /min-height:\s*42px/);
  assert.match(popupCss, /body\.is-crawling #advanced\s*{\s*display:\s*none/);
  assert.doesNotMatch(popupCss, /linear-gradient/);
  assert.match(popupCss, /--accent:\s*oklch/);
  assert.match(popupCss, /--action:\s*oklch/);

  assert.match(popupJs, /`Выбрать видео \$\{position\}`/);
  assert.match(popupJs, /`Выбрать аудио \$\{position\}`/);
  assert.match(popupJs, /`Выбрать фото \$\{position\}`/);
  assert.match(popupJs, /badge\.textContent = "Сейчас играет"/);
  assert.ok(
    popupJs.indexOf('poster.referrerPolicy = "no-referrer"') <
      popupJs.indexOf("poster.src = item.poster"),
    "video poster referrer policy must be set before its URL"
  );
  assert.ok(
    popupJs.indexOf('image.referrerPolicy = "no-referrer"') <
      popupJs.indexOf("image.src = item.url"),
    "photo referrer policy must be set before its URL"
  );
  assert.match(popupJs, /type:\s*deep \? "SCROLL_LOAD_MORE" : "COLLECT_MEDIA"/);
  assert.match(popupJs, /btnStop\.hidden = !crawlRunning/);
  assert.match(popupJs, /setBusy\("crawl"\)/);
  assert.match(popupJs, /items,\s*folder,/s);

  assert.doesNotMatch(runtimeSource, /\bfetch\s*\(/, "runtime must not fetch or proxy media");
  assert.doesNotMatch(runtimeSource, /MediaRecorder|captureStream/, "runtime must not record the tab");
  assert.doesNotMatch(runtimeSource, /chrome\.cookies|webRequest/, "runtime must not inspect cookies or traffic");

  assert.match(iconSvg, /<path/);
  assert.match(iconSvg, /#2563eb/i);
  assert.doesNotMatch(iconSvg, /gradient|camera/i);
  assert.match(readme, /открой конкретный пост\/Reel/i);
  assert.match(readme, /Сейчас играет/);
  assert.match(readme, /MP3.*M4A.*AAC.*WAV.*OGG.*FLAC.*OPUS/is);
  assert.match(readme, /Скачать выбранное · N/);
  assert.match(readme, /Найти больше.*ничего не скачивает/i);
  assert.match(readme, /Постоянного `<all_urls>`.*нет/i);
  assert.match(readme, /DRM, paywall, login bypass, YouTube/i);
  assert.match(readme, /превью.*стороннему медиа-хосту/is);
  assert.match(readme, /source-available.*не является OSI open source/is);
  assert.match(readme, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(readme, /коммерческого использования требуется отдельное письменное соглашение/i);

  assert.match(privacyPolicy, /photo thumbnails and available video poster previews/is);
  assert.match(privacyPolicy, /миниатюры фото и доступные постеры видео/is);
  assert.match(privacyPolicy, /does not receive (?:these requests|them)/i);
  assert.match(privacyPolicy, /разработчик расширения их не получает/i);

  assert.equal(
    crypto.createHash("sha256").update(license).digest("hex"),
    "c0ea4a896d2c8c394b29f9427589996db826cd501c512279ff0ed3ef48fabbe5",
    "LICENSE.md must remain byte-identical to the official PolyForm Noncommercial 1.0.0 text"
  );
  assert.match(commercial, /Commercial use is not granted by this repository license/);
  assert.match(commercial, /does not itself grant any commercial rights/);
  assert.match(commercial, /не разрешает коммерческое использование/);
  assert.match(packageScript, /\n\s+LICENSE\.md\n/);

  const shortDescription = storePack.match(/### Short description\s+([^\n]+)/)?.[1];
  assert.equal(shortDescription, manifest.description, "store and manifest descriptions must match");
  assert.match(storePack, /direct audio files already exposed/i);
  assert.match(storePack, /photo thumbnails and available video-poster previews/is);
  assert.doesNotMatch(storePack, /Developer collection\/remote transmission: none/i);
  assert.match(storePack, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(storePack, /коммерческое использование требует отдельного письменного соглашения/i);
  assert.match(storePack, /Chrome Web Store Developer Agreement/);
  assert.match(storePack, /sections 5\.1 and 5\.2/);
  assert.match(storePack, /prohibits enabling unauthorized downloads of streaming content or media/i);
  assert.match(storePack, /page-media-downloader-1\.6\.1-chrome\.zip/);

  console.log(
    `PASS: ${genericCases.length} generic page cases plus Instagram, video-audio-photo grouping, accessibility, direct downloads, and permission checks`
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
