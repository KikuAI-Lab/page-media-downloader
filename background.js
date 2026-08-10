/**
 * User-invoked current-page batch + crawl downloads.
 * Crawl: collect → download new → scroll → repeat; dedupe by mediaKey.
 */

const MAX_RETRIES = 3;
const CONCURRENCY = 3;
const RETRY_DELAY_MS = 450;
const DOWNLOAD_WATCHDOG_MS = 45000;
const VOLATILE_QUERY_KEYS = new Set([
  "access_token",
  "auth",
  "auth_token",
  "expire",
  "expires",
  "expiry",
  "key-pair-id",
  "keypairid",
  "policy",
  "sig",
  "signature",
  "token",
]);

/** @type {any} */
let job = null;

function safeFilename(name) {
  return String(name || "file")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function mediaTypeFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (
      /\.(mp4|webm|mov|m4v)$/i.test(parsed.pathname) ||
      /(?:^|[?&])(?:mime_type|type)=video(?:%2F|\/)/i.test(parsed.search)
    ) {
      return "video";
    }
    if (
      /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(parsed.pathname) ||
      /(?:^|[?&])(?:mime_type|type)=audio(?:%2F|\/)/i.test(parsed.search)
    ) {
      return "audio";
    }
  } catch {
    if (/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(String(url || ""))) return "video";
    if (/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)(?:[?#]|$)/i.test(String(url || ""))) {
      return "audio";
    }
  }
  return "photo";
}

function stableMediaQuery(parsed) {
  const entries = [...parsed.searchParams.entries()].filter(([key]) => {
    const normalized = key.toLowerCase();
    return (
      !VOLATILE_QUERY_KEYS.has(normalized) &&
      !normalized.startsWith("x-amz-") &&
      !normalized.startsWith("x-goog-")
    );
  });
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  });
  const query = new URLSearchParams();
  entries.forEach(([key, value]) => query.append(key, value));
  return query.toString();
}

function mediaKey(url, type = mediaTypeFromUrl(url)) {
  try {
    const p = new URL(url);
    const path = p.pathname
      .replace(/\/s\d+x\d+\//g, "/")
      .replace(/\/c\d+\.\d+\.\d+\.\d+\//g, "/");
    const query = stableMediaQuery(p);
    return `${type}:${p.origin}${path}${query ? `?${query}` : ""}`;
  } catch {
    return `${type}:${url}`;
  }
}

function normalizeMediaItem(value) {
  const raw = typeof value === "string" ? { url: value } : value;
  if (!raw || typeof raw.url !== "string" || !/^https?:\/\//i.test(raw.url)) return null;
  const declared = ["video", "audio", "photo"].includes(raw.type) ? raw.type : null;
  const type = declared || mediaTypeFromUrl(raw.url);
  return {
    url: raw.url,
    type,
    key: raw.key || mediaKey(raw.url, type),
    ...(typeof raw.poster === "string" && raw.poster ? { poster: raw.poster } : {}),
    ...(raw.playing === true ? { playing: true } : {}),
  };
}

function extFromContentType(ct, url, typeHint = mediaTypeFromUrl(url)) {
  const t = (ct || "").toLowerCase();
  if (t.includes("audio/mpeg")) return "mp3";
  if (t.includes("audio/mp4") || t.includes("audio/x-m4a")) return "m4a";
  if (t.includes("audio/aac")) return "aac";
  if (t.includes("audio/wav") || t.includes("audio/x-wav")) return "wav";
  if (t.includes("audio/ogg")) return "ogg";
  if (t.includes("audio/flac")) return "flac";
  if (t.includes("audio/opus")) return "opus";
  if (t.includes("video/mp4")) return "mp4";
  if (t.includes("video/webm")) return "webm";
  if (t.includes("quicktime")) return "mov";
  if (t.includes("x-m4v")) return "m4v";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("avif")) return "avif";
  if (t.includes("bmp")) return "bmp";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".png")) return "png";
    if (path.endsWith(".webp")) return "webp";
    if (path.endsWith(".gif")) return "gif";
    if (path.endsWith(".avif")) return "avif";
    if (path.endsWith(".bmp")) return "bmp";
    if (path.endsWith(".mp4")) return "mp4";
    if (path.endsWith(".webm")) return "webm";
    if (path.endsWith(".mov")) return "mov";
    if (path.endsWith(".m4v")) return "m4v";
    if (path.endsWith(".mp3")) return "mp3";
    if (path.endsWith(".m4a")) return "m4a";
    if (path.endsWith(".aac")) return "aac";
    if (path.endsWith(".wav")) return "wav";
    if (path.endsWith(".ogg") || path.endsWith(".oga")) return "ogg";
    if (path.endsWith(".flac")) return "flac";
    if (path.endsWith(".opus")) return "opus";
  } catch {
    /* ignore */
  }
  if (typeHint === "video") return "mp4";
  if (typeHint === "audio") return "mp3";
  return "jpg";
}

function broadcastProgress() {
  if (!job) return;
  const payload = {
    type: "DOWNLOAD_PROGRESS",
    id: job.id,
    mode: job.mode || "batch",
    phase: job.phase || "",
    total: job.total,
    done: job.done,
    ok: job.ok,
    failed: job.failed,
    skipped: job.skipped || 0,
    seen: job.seen || 0,
    round: job.round || 0,
    folder: job.folder,
    running: job.running,
    errors: (job.errors || []).slice(0, 8),
    stopRequested: !!job.stopRequested,
  };
  chrome.runtime.sendMessage(payload).catch(() => {});
  try {
    chrome.storage.session.set({ downloadJob: payload });
  } catch {
    /* ignore */
  }
}

function searchDownload(id) {
  return new Promise((resolve) => {
    chrome.downloads.search({ id }, (items) => resolve(items && items[0] ? items[0] : null));
  });
}

function chromeDownload(url, filename) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let downloadId = -1;
    let timer = null;

    const cleanup = () => {
      chrome.downloads.onChanged.removeListener(onChanged);
      if (timer !== null) clearTimeout(timer);
    };

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(arg);
    };

    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state) {
        if (delta.state.current === "complete") finish(resolve, downloadId);
        else if (delta.state.current === "interrupted") {
          finish(reject, new Error(delta.error?.current || "download interrupted"));
        }
      }
      if (delta.error && delta.error.current) {
        finish(reject, new Error(delta.error.current));
      }
    };

    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: "uniquify",
        saveAs: false,
      },
      async (id) => {
        if (chrome.runtime.lastError) {
          finish(reject, new Error(chrome.runtime.lastError.message));
          return;
        }
        downloadId = id;
        chrome.downloads.onChanged.addListener(onChanged);

        const item = await searchDownload(downloadId);
        if (item) {
          if (item.state === "complete") finish(resolve, downloadId);
          else if (item.state === "interrupted") {
            finish(reject, new Error(item.error || "interrupted"));
          }
        }

        if (settled) return;
        const watchDownload = async () => {
          const late = await searchDownload(downloadId);
          if (settled) return;
          if (late?.state === "complete") {
            finish(resolve, downloadId);
          } else if (late?.state === "interrupted") {
            finish(reject, new Error(late.error || "download interrupted"));
          } else if (late?.state === "in_progress") {
            timer = setTimeout(watchDownload, DOWNLOAD_WATCHDOG_MS);
          } else {
            finish(reject, new Error(late?.error || "download status unavailable"));
          }
        };
        timer = setTimeout(watchDownload, DOWNLOAD_WATCHDOG_MS);
      }
    );
  });
}

async function downloadOne(item, basePath, index, pad) {
  const { url, type } = item;
  let lastError = null;
  const ext = extFromContentType("", url, type);
  const filename = `${basePath}/${String(index).padStart(pad, "0")}.${ext}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await chromeDownload(url, filename);
      return { ok: true };
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  return {
    ok: false,
    error: String(lastError && lastError.message ? lastError.message : lastError),
  };
}

async function downloadBatch(items, dir, startIndex, pad) {
  // items: {url, key, type}[]
  let cursor = 0;
  const results = new Array(items.length);

  async function worker() {
    while (cursor < items.length) {
      if (job && job.stopRequested) return;
      const i = cursor++;
      const item = items[i];
      const fileNum = startIndex + i;
      const result = await downloadOne(item, dir, fileNum, pad);
      results[i] = { ...result, key: item.key, url: item.url, type: item.type, fileNum };
      job.done += 1;
      if (result.ok) job.ok += 1;
      else {
        job.failed += 1;
        if (result.error && job.errors.length < 12) {
          job.errors.push(`#${fileNum}: ${result.error}`);
        }
      }
      broadcastProgress();
    }
  }

  const n = Math.min(CONCURRENCY, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function tabSend(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureContent(tabId) {
  try {
    await tabSend(tabId, { type: "PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

async function banner(tabId, text) {
  try {
    await tabSend(tabId, { type: "CRAWL_BANNER", text });
  } catch {
    /* ignore */
  }
}

function itemsFromCollect(data) {
  if (data && Array.isArray(data.items) && data.items.length) {
    return data.items.map(normalizeMediaItem).filter(Boolean);
  }
  const urls = (data && data.urls) || [];
  return urls.map(normalizeMediaItem).filter(Boolean);
}

async function runBatchJob(media, folder) {
  const dir = safeFilename(folder || "page_media");
  const uniqueMap = new Map();
  for (const value of media) {
    const item = normalizeMediaItem(value);
    if (!item) continue;
    const prev = uniqueMap.get(item.key);
    if (!prev || item.url.length > prev.url.length) uniqueMap.set(item.key, item);
  }
  const items = [...uniqueMap.values()];
  const pad = Math.max(3, String(items.length).length);

  job = {
    id: `${Date.now()}`,
    mode: "batch",
    phase: "download",
    total: items.length,
    done: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    seen: items.length,
    round: 1,
    folder: dir,
    running: true,
    stopRequested: false,
    errors: [],
  };
  broadcastProgress();

  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 15000);
  try {
    await downloadBatch(items, dir, 1, pad);
  } finally {
    clearInterval(keepAlive);
    job.running = false;
    job.phase = "done";
    broadcastProgress();
  }

  return {
    ok: true,
    mode: "batch",
    started: job.ok,
    failed: job.failed,
    total: job.total,
    folder: job.folder,
    errors: job.errors.slice(0, 8),
  };
}

/**
 * Full profile crawl: scroll → collect → download only new keys → repeat.
 */
async function runCrawlJob(tabId, folder, options = {}) {
  const dir = safeFilename(folder || "page_media");
  const maxRounds = Math.min(options.maxRounds || 120, 250);
  const maxEmptyStreak = options.maxEmptyStreak || 5;
  const scrollSteps = options.scrollSteps || 4;
  const scrollWaitMs = options.scrollWaitMs || 950;
  const pad = 4; // 0001… plenty for big profiles

  /** @type {Set<string>} */
  const downloadedKeys = new Set();
  /** @type {Set<string>} keys we already tried (success or fail) — no re-queue */
  const processedKeys = new Set();
  /** @type {Map<string,{url:string,key:string,type:"photo"|"video"|"audio"}>} key → best item seen */
  const seenMedia = new Map();

  let fileIndex = 0;
  let emptyStreak = 0;
  let round = 0;

  job = {
    id: `${Date.now()}`,
    mode: "crawl",
    phase: "init",
    total: 0,
    done: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    seen: 0,
    round: 0,
    folder: dir,
    running: true,
    stopRequested: false,
    errors: [],
  };
  broadcastProgress();

  await ensureContent(tabId);
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 12000);

  try {
    // start from top so we don't miss upper grid after user scrolled
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollTo(0, 0),
      });
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      /* ignore */
    }

    while (job.running && !job.stopRequested && round < maxRounds) {
      round += 1;
      job.round = round;
      job.phase = "collect";
      broadcastProgress();
      await banner(
        tabId,
        `Media Downloader · раунд ${round} · скачано ${job.ok} · видно ${seenMedia.size}`
      );

      let data;
      try {
        data = await tabSend(tabId, { type: "COLLECT_MEDIA" });
      } catch (e) {
        await ensureContent(tabId);
        data = await tabSend(tabId, { type: "COLLECT_MEDIA" });
      }
      if (!data || !data.ok) {
        job.errors.push(data?.error || "collect failed");
        emptyStreak += 1;
      } else {
        const items = itemsFromCollect(data);
        let newCount = 0;
        const toDownload = [];

        for (const it of items) {
          const prev = seenMedia.get(it.key);
          if (!prev || it.url.length > prev.url.length) seenMedia.set(it.key, it);

          if (!processedKeys.has(it.key)) {
            toDownload.push(seenMedia.get(it.key));
            processedKeys.add(it.key); // reserve so parallel rounds don't double
            newCount += 1;
          }
        }

        job.seen = seenMedia.size;
        job.skipped = Math.max(0, seenMedia.size - downloadedKeys.size - (job.failed || 0));

        let downloadedThisRound = 0;
        if (toDownload.length) {
          job.phase = "download";
          job.total = job.ok + job.failed + toDownload.length;
          broadcastProgress();
          await banner(
            tabId,
            `Скачиваю ${toDownload.length} новых · всего ок ${job.ok} · раунд ${round}`
          );

          const startIndex = fileIndex + 1;
          const batchResults = await downloadBatch(toDownload, dir, startIndex, pad);
          for (const r of batchResults) {
            if (!r) continue;
            fileIndex = Math.max(fileIndex, r.fileNum || fileIndex);
            if (r.ok) {
              downloadedKeys.add(r.key);
              downloadedThisRound += 1;
            }
          }
          fileIndex = startIndex + toDownload.length - 1;
          job.seen = seenMedia.size;
        }

        // reset empty streak if we found anything new this collect
        if (toDownload.length > 0 || downloadedThisRound > 0) {
          emptyStreak = 0;
        }
      }

      if (job.stopRequested) break;

      // Scroll to load more even if we found new ones
      job.phase = "scroll";
      broadcastProgress();
      await banner(
        tabId,
        `Скролл… раунд ${round} · скачано ${job.ok} · уникальных ${seenMedia.size}`
      );

      let scrolled;
      try {
        scrolled = await tabSend(tabId, {
          type: "SCROLL_PAGE",
          steps: scrollSteps,
          waitMs: scrollWaitMs,
        });
      } catch (e) {
        await ensureContent(tabId);
        scrolled = await tabSend(tabId, {
          type: "SCROLL_PAGE",
          steps: scrollSteps,
          waitMs: scrollWaitMs,
        });
      }

      let newFromScroll = 0;
      if (scrolled && scrolled.ok) {
        for (const it of itemsFromCollect(scrolled)) {
          const prev = seenMedia.get(it.key);
          if (!prev || it.url.length > prev.url.length) seenMedia.set(it.key, it);
          if (!processedKeys.has(it.key)) newFromScroll += 1;
        }
        job.seen = seenMedia.size;
      }

      const pending = [...seenMedia.keys()].filter((k) => !processedKeys.has(k)).length;
      if (pending > 0 || newFromScroll > 0) {
        emptyStreak = 0;
      } else {
        // no new media after this scroll → toward end of feed
        emptyStreak += 1;
      }

      if (emptyStreak >= maxEmptyStreak) {
        break;
      }

      broadcastProgress();
    }
  } finally {
    clearInterval(keepAlive);
    job.running = false;
    job.phase = job.stopRequested ? "stopped" : "done";
    job.seen = seenMedia.size;
    job.total = Math.max(job.total, job.ok + job.failed);
    broadcastProgress();
    await banner(
      tabId,
      job.stopRequested
        ? `Остановлено · скачано ${job.ok} · папка ${dir}`
        : `Готово · скачано ${job.ok}/${seenMedia.size} · ${dir}`
    );
    // hide banner after a few seconds
    setTimeout(() => banner(tabId, ""), 8000);
  }

  return {
    ok: true,
    mode: "crawl",
    started: job.ok,
    failed: job.failed,
    total: job.ok + job.failed,
    seen: seenMedia.size,
    rounds: round,
    folder: job.folder,
    stopped: !!job.stopRequested,
    errors: job.errors.slice(0, 8),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "GET_DOWNLOAD_STATUS") {
    sendResponse({ ok: true, job });
    return false;
  }

  if (msg.type === "STOP_DOWNLOAD") {
    if (job && job.running) {
      job.stopRequested = true;
      job.phase = "stopping";
      broadcastProgress();
      sendResponse({ ok: true, stopping: true });
    } else {
      sendResponse({ ok: true, stopping: false });
    }
    return false;
  }

  if (msg.type === "DOWNLOAD_MEDIA" || msg.type === "DOWNLOAD_PHOTOS") {
    const { items, urls, folder } = msg;
    const media = Array.isArray(items) && items.length ? items : urls;
    if (!Array.isArray(media) || media.length === 0) {
      sendResponse({ ok: false, error: "No media URLs" });
      return false;
    }
    if (job && job.running) {
      sendResponse({ ok: false, error: "Уже идёт скачивание. Стоп или дождись конца." });
      return false;
    }
    runBatchJob(media, folder)
      .then((result) => sendResponse(result))
      .catch((e) =>
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
      );
    return true;
  }

  if (msg.type === "CRAWL_DOWNLOAD") {
    const { tabId, folder, options } = msg;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tabId" });
      return false;
    }
    if (job && job.running) {
      sendResponse({ ok: false, error: "Уже идёт скачивание. Стоп или дождись конца." });
      return false;
    }
    runCrawlJob(tabId, folder, options || {})
      .then((result) => sendResponse(result))
      .catch((e) =>
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
      );
    return true;
  }
});
