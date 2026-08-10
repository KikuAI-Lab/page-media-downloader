"use strict";

const assert = require("node:assert/strict");
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
  const start = source.indexOf("function putVideosFirst");
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

function loadBackground() {
  let messageListener = null;
  const downloads = [];
  const downloadListeners = new Set();
  let fetchCalls = 0;

  const context = {
    URL,
    Blob,
    console,
    setTimeout,
    clearTimeout,
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
          callback([{ id, state: "complete" }]);
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
  return { context, downloads, getFetchCalls: () => fetchCalls };
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
      { url: "video-1", type: "video" },
      { url: "photo-2", type: "photo" },
      { url: "video-2", type: "video" },
    ],
  });
  assert.deepEqual(
    Array.from(popupItems, (item) => item.url),
    ["video-1", "video-2", "photo-1", "photo-2"],
    "videos should render before photos while preserving order within each group"
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
    Array.from(popupGroups.photos, (item) => item.url),
    ["photo-1", "photo-2"],
    "photos remain in a separate group below videos"
  );
  assert.equal(popupModel.selectionButtonLabel(0), "Скачать выбранное · 0");
  assert.equal(popupModel.selectionButtonLabel(3), "Скачать выбранное · 3");
  assert.equal(popupModel.resultSummaryText(popupItems), "2 видео · 2 фото");

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
  assert.equal(background.extFromContentType("", videoUrl, "video"), "mp4");
  assert.equal(background.extFromContentType("image/jpeg", photoUrl, "photo"), "jpg");
  assert.equal(background.normalizeMediaItem({ url: videoUrl, type: "photo" }).type, "video");
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

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  const popupCss = fs.readFileSync(path.join(root, "popup.css"), "utf8");
  const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
  const iconSvg = fs.readFileSync(path.join(root, "icons/icon.svg"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "1.5.0");
  assert.equal(manifest.name, "Page Media Downloader");
  assert.ok([...manifest.description].length <= 132, "manifest description must fit the store limit");
  assert.match(manifest.description, /фото и прямые видео/);
  assert.doesNotMatch(manifest.description, /Instagram/i);
  assert.deepEqual(manifest.permissions, ["downloads", "activeTab", "scripting", "storage"]);
  assert.equal("host_permissions" in manifest, false);
  assert.equal("content_scripts" in manifest, false);
  assert.match(manifest.action.default_title, /Скачать фото и видео/);

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
    popupHtml.indexOf('id="videoSection"') < popupHtml.indexOf('id="photoSection"'),
    "video section must precede the photo section in the DOM"
  );
  assert.equal((popupHtml.match(/class="primary-action"/g) || []).length, 1);
  assert.doesNotMatch(popupHtml, /lazy-load|MV3|HLS|DASH|v1\.5\.0/);

  assert.match(popupCss, /\[hidden\]\s*{\s*display:\s*none\s*!important/);
  assert.match(popupCss, /:focus-visible/);
  assert.match(popupCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(popupCss, /min-height:\s*42px/);
  assert.match(popupCss, /body\.is-crawling #advanced\s*{\s*display:\s*none/);
  assert.doesNotMatch(popupCss, /linear-gradient/);
  assert.match(popupCss, /--accent:\s*oklch/);
  assert.match(popupCss, /--action:\s*oklch/);

  assert.match(popupJs, /`Выбрать видео \$\{position\}`/);
  assert.match(popupJs, /`Выбрать фото \$\{position\}`/);
  assert.match(popupJs, /type:\s*deep \? "SCROLL_LOAD_MORE" : "COLLECT_MEDIA"/);
  assert.match(popupJs, /btnStop\.hidden = !crawlRunning/);
  assert.match(popupJs, /setBusy\("crawl"\)/);
  assert.match(popupJs, /items,\s*folder,/s);

  assert.match(iconSvg, /<path/);
  assert.match(iconSvg, /#2563eb/i);
  assert.doesNotMatch(iconSvg, /gradient|camera/i);
  assert.match(readme, /открой конкретный пост\/Reel/i);
  assert.match(readme, /Скачать выбранное · N/);
  assert.match(readme, /Найти больше.*ничего не скачивает/i);
  assert.match(readme, /Постоянного `<all_urls>`.*нет/i);
  assert.match(readme, /DRM, paywall, login bypass, YouTube/i);

  console.log(
    `PASS: ${genericCases.length} generic page cases plus Instagram, grouped results, simplified UI, accessibility, download, and permission checks`
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
