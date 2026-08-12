function message(key, substitutions = [], fallback = "") {
  const value = globalThis.chrome?.i18n?.getMessage?.(key, substitutions);
  return value || fallback;
}

function localizeDocument() {
  const uiLocale = globalThis.chrome?.i18n?.getUILanguage?.() || "en";
  const baseLocale = uiLocale.toLowerCase().split(/[-_]/)[0];
  document.documentElement.lang = ["ru", "uk"].includes(baseLocale) ? baseLocale : "en";
  document.title = message("popupTitle", [], "Media on this page");

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = message(element.dataset.i18n);
    if (value) element.textContent = value;
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    const value = message(element.dataset.i18nTitle);
    if (value) element.title = value;
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const value = message(element.dataset.i18nAriaLabel);
    if (value) element.setAttribute("aria-label", value);
  });
}

localizeDocument();

const $ = (id) => document.getElementById(id);

const pageSourceEl = $("pageSource");
const statusEl = $("status");
const statusActivityEl = $("statusActivity");
const statusTitleEl = $("statusTitle");
const statusDetailEl = $("statusDetail");
const resultsEl = $("results");
const summaryTextEl = $("summaryText");
const videoSectionEl = $("videoSection");
const videoListEl = $("videoList");
const videoCountEl = $("videoCount");
const audioSectionEl = $("audioSection");
const audioListEl = $("audioList");
const audioCountEl = $("audioCount");
const photoSectionEl = $("photoSection");
const photoGridEl = $("photoGrid");
const photoCountEl = $("photoCount");
const advancedEl = $("advanced");
const btnScan = $("btnScan");
const btnSelectAll = $("btnSelectAll");
const btnDownload = $("btnDownload");
const btnScanMore = $("btnScanMore");
const btnCrawl = $("btnCrawl");
const btnStop = $("btnStop");

let lastData = null;
let busyMode = null;

function isInstagramUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "instagram.com" || u.hostname.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

function isSupportedPageUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function sourceNameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || "page";
  } catch {
    return "page";
  }
}

function buildDownloadFolder(data) {
  const prefix = data?.isInstagram ? "instagram" : "media";
  const source = String(
    data?.sourceName || data?.username || sourceNameFromUrl(data?.pageUrl || "")
  )
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "page";
  return `${prefix}_${source}_${Date.now().toString().slice(-6)}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  }
}

function orderMediaItems(items) {
  return [
    ...items.filter((item) => item.type === "video"),
    ...items.filter((item) => item.type === "audio" && item.playing === true),
    ...items.filter((item) => item.type === "audio" && item.playing !== true),
    ...items.filter((item) => item.type === "photo"),
  ];
}

function normaliseCollectedItems(data) {
  let items;
  if (Array.isArray(data?.items) && data.items.length) {
    items = data.items
      .filter((item) => item && typeof item.url === "string")
      .map((item) => ({
        ...item,
        type: ["video", "audio", "photo"].includes(item.type) ? item.type : "photo",
      }));
  } else {
    items = (data?.urls || []).filter(Boolean).map((url) => ({ url, type: "photo" }));
  }
  return orderMediaItems(items);
}

function splitMediaItems(items) {
  return {
    videos: items.filter((item) => item.type === "video"),
    audios: items.filter((item) => item.type === "audio"),
    photos: items.filter((item) => item.type === "photo"),
  };
}

function selectionButtonLabel(count) {
  return message("downloadSelected", [count]);
}

function resultSummaryText(items) {
  const { videos, audios, photos } = splitMediaItems(items);
  return message("resultSummary", [videos.length, audios.length, photos.length]);
}

function setPageSource(value) {
  pageSourceEl.textContent = String(value || message("currentTab"));
  pageSourceEl.title = pageSourceEl.textContent;
}

function setStatus(title, detail = "", kind = "neutral") {
  statusTitleEl.textContent = title;
  statusDetailEl.textContent = detail;
  statusDetailEl.hidden = !detail;
  statusActivityEl.hidden = kind !== "loading";
  statusEl.className = `status is-${kind}`;
}

function mediaCheckboxes() {
  return Array.from(resultsEl.querySelectorAll('input[data-media-index]'));
}

function getSelectedItems() {
  if (!lastData) return [];
  return mediaCheckboxes()
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => lastData.items[Number(checkbox.dataset.mediaIndex)])
    .filter(Boolean);
}

function updateSelectionControls() {
  const checkboxes = mediaCheckboxes();
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  const allChecked = checkboxes.length > 0 && selectedCount === checkboxes.length;

  btnDownload.textContent = selectionButtonLabel(selectedCount);
  btnDownload.disabled = busyMode !== null || selectedCount === 0;
  btnSelectAll.textContent = message(allChecked ? "deselectAll" : "selectAll");
  btnSelectAll.disabled = busyMode !== null || checkboxes.length === 0;
}

function setBusy(mode = null) {
  busyMode = mode;
  const busy = mode !== null;
  const crawlRunning = mode === "crawl";

  document.body.classList.toggle("is-crawling", crawlRunning);

  btnScan.disabled = busy;
  btnScanMore.disabled = busy;
  btnCrawl.disabled = busy;
  btnStop.hidden = !crawlRunning;
  btnStop.disabled = !crawlRunning;
  resultsEl.setAttribute("aria-busy", String(busy));
  mediaCheckboxes().forEach((checkbox) => {
    checkbox.disabled = busy;
  });
  updateSelectionControls();
}

function itemSourceLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return message("readyToDownload");
  }
}

function createMediaCheckbox(itemIndex, label) {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.dataset.mediaIndex = String(itemIndex);
  checkbox.setAttribute("aria-label", label);
  return checkbox;
}

function createVideoOption(item, itemIndex, position) {
  const option = document.createElement("label");
  option.className = "media-option video-option";

  const thumb = document.createElement("span");
  thumb.className = "video-thumb";
  thumb.setAttribute("aria-hidden", "true");
  if (item.poster) {
    const poster = document.createElement("img");
    poster.alt = "";
    poster.loading = "lazy";
    poster.referrerPolicy = "no-referrer";
    poster.src = item.poster;
    poster.addEventListener("error", () => poster.remove());
    thumb.appendChild(poster);
  }
  const play = document.createElement("span");
  play.className = "play-mark";
  thumb.appendChild(play);

  const copy = document.createElement("span");
  copy.className = "video-copy";
  const title = document.createElement("strong");
  title.textContent = message("videoItem", [position]);
  const source = document.createElement("span");
  source.textContent = itemSourceLabel(item.url);
  copy.append(title, source);

  option.append(
    thumb,
    copy,
    createMediaCheckbox(itemIndex, message("selectVideo", [position]))
  );
  return option;
}

function createAudioOption(item, itemIndex, position) {
  const option = document.createElement("label");
  option.className = `media-option audio-option${item.playing ? " is-playing" : ""}`;

  const thumb = document.createElement("span");
  thumb.className = "audio-thumb";
  thumb.setAttribute("aria-hidden", "true");
  thumb.textContent = "♪";

  const copy = document.createElement("span");
  copy.className = "audio-copy";
  const heading = document.createElement("span");
  heading.className = "audio-heading";
  const title = document.createElement("strong");
  title.textContent = message("audioItem", [position]);
  heading.appendChild(title);
  if (item.playing) {
    const badge = document.createElement("span");
    badge.className = "playing-badge";
    badge.textContent = message("nowPlaying");
    heading.appendChild(badge);
  }
  const source = document.createElement("span");
  source.className = "audio-source";
  source.textContent = itemSourceLabel(item.url);
  copy.append(heading, source);

  option.append(
    thumb,
    copy,
    createMediaCheckbox(itemIndex, message("selectAudio", [position]))
  );
  return option;
}

function createPhotoOption(item, itemIndex, position) {
  const option = document.createElement("label");
  option.className = "media-option photo-option";
  const checkbox = createMediaCheckbox(itemIndex, message("selectPhoto", [position]));
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.src = item.url;
  image.addEventListener("error", () => {
    checkbox.checked = false;
    option.classList.add("is-broken");
    updateSelectionControls();
  });
  option.append(checkbox, image);
  return option;
}

function renderResults(items) {
  videoListEl.replaceChildren();
  audioListEl.replaceChildren();
  photoGridEl.replaceChildren();

  const indexedItems = items.map((item, index) => ({ item, index }));
  const videoEntries = indexedItems.filter(({ item }) => item.type === "video");
  const audioEntries = indexedItems.filter(({ item }) => item.type === "audio");
  const photoEntries = indexedItems.filter(({ item }) => item.type === "photo");

  videoEntries.forEach(({ item, index }, position) => {
    videoListEl.appendChild(createVideoOption(item, index, position + 1));
  });
  audioEntries.forEach(({ item, index }, position) => {
    audioListEl.appendChild(createAudioOption(item, index, position + 1));
  });
  photoEntries.forEach(({ item, index }, position) => {
    photoGridEl.appendChild(createPhotoOption(item, index, position + 1));
  });

  videoCountEl.textContent = String(videoEntries.length);
  audioCountEl.textContent = String(audioEntries.length);
  photoCountEl.textContent = String(photoEntries.length);
  videoSectionEl.hidden = videoEntries.length === 0;
  audioSectionEl.hidden = audioEntries.length === 0;
  photoSectionEl.hidden = photoEntries.length === 0;
  resultsEl.hidden = items.length === 0;
  document.body.classList.toggle("has-results", items.length > 0);
  summaryTextEl.textContent = resultSummaryText(items);
  updateSelectionControls();
}

function prepareSupportedPage(tab) {
  setPageSource(sourceNameFromUrl(tab?.url || ""));
  btnScan.hidden = false;
}

async function scan({ deep = false } = {}) {
  if (busyMode !== null) return;

  setBusy("scan");
  setStatus(
    message(deep ? "scanDeepTitle" : "searchingMedia"),
    message(deep ? "scanDeepDetail" : "checkingCurrentPage"),
    "loading"
  );

  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      resultsEl.hidden = true;
      setStatus(message("noActiveTabTitle"), message("openPageRetryDetail"), "error");
      return;
    }
    if (!isSupportedPageUrl(tab.url || "")) {
      resultsEl.hidden = true;
      advancedEl.hidden = true;
      setStatus(message("unsupportedTabTitle"), message("openNormalPageDetail"), "error");
      return;
    }

    prepareSupportedPage(tab);
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: deep ? "SCROLL_LOAD_MORE" : "COLLECT_MEDIA",
      rounds: 4,
    });

    if (!response?.ok) {
      setStatus(message("scanFailedTitle"), response?.error || message("refreshRetryDetail"), "error");
      return;
    }

    const items = normaliseCollectedItems(response);
    lastData = { ...response, items };
    setPageSource(response.sourceName || response.username || sourceNameFromUrl(response.pageUrl || tab.url));
    renderResults(items);

    if (items.length === 0) {
      setStatus(
        message("mediaNotFoundTitle"),
        response.isInstagram
          ? message("openInstagramPostDetail")
          : message("playOrLoadDetail"),
        "error"
      );
      return;
    }

    const { videos, audios } = splitMediaItems(items);
    const readyTitle =
      videos.length > 0 && audios.length > 0
        ? message("videoAudioFoundTitle")
        : videos.length > 0
          ? message("videoFoundTitle")
          : audios.length > 0
            ? message("audioFoundTitle")
            : message("mediaReadyTitle");
    setStatus(
      readyTitle,
      "",
      "ok"
    );
  } catch (error) {
    setStatus(
      message("scanFailedTitle"),
      message("scanFailedWithErrorDetail", [error.message || error]),
      "error"
    );
  } finally {
    if (!btnScan.hidden) advancedEl.hidden = false;
    setBusy(null);
  }
}

async function downloadSelected() {
  const items = getSelectedItems();
  if (!items.length) {
    setStatus(message("nothingSelectedTitle"), message("selectOneDetail"), "error");
    return;
  }

  setBusy("download");
  setStatus(message("startingDownloadTitle"), message("selectedFilesDetail", [items.length]), "loading");
  const folder = buildDownloadFolder(lastData);

  try {
    const result = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_MEDIA",
      items,
      folder,
    });
    if (!result?.ok) {
      setStatus(message("downloadStartFailedTitle"), result?.error || message("tryAgainDetail"), "error");
      return;
    }
    const started = result.started || 0;
    const failed = result.failed || 0;
    setStatus(
      message(started > 0 ? "downloadStartedTitle" : "filesNotSentTitle"),
      message("downloadResultBase", [started, result.total || items.length, result.folder || folder]) +
        (failed ? message("errorCountSuffix", [failed]) : ""),
      failed ? "error" : "ok"
    );
  } catch (error) {
    setStatus(
      message("popupDisconnectedTitle"),
      message("downloadsContinueDetail", [error.message || ""]).trim(),
      "error"
    );
  } finally {
    setBusy(null);
  }
}

function applyProgress(progress) {
  if (!progress) return;

  if (progress.running) {
    const isCrawl = progress.mode === "crawl";
    setBusy(isCrawl ? "crawl" : "download");
    if (isCrawl) {
      advancedEl.hidden = false;
      advancedEl.open = false;
      setStatus(
        message("crawlProgressTitle"),
        message("crawlProgressBase", [progress.round || 0, progress.seen || 0, progress.ok || 0]) +
          (progress.failed ? message("errorCountSuffix", [progress.failed]) : ""),
        "loading"
      );
    } else {
      setStatus(
        message("downloadProgressTitle"),
        message("downloadProgressBase", [
          progress.done || 0,
          progress.total || 0,
          progress.ok || 0,
        ]) + (progress.failed ? message("errorCountSuffix", [progress.failed]) : ""),
        "loading"
      );
    }
    return;
  }

  if (progress.phase === "done" || progress.phase === "stopped" || progress.total || progress.ok) {
    setBusy(null);
    const stopped = progress.phase === "stopped" || progress.stopRequested;
    const failed = progress.failed || 0;
    setStatus(
      message(stopped ? "downloadStoppedTitle" : progress.ok ? "downloadStartedTitle" : "filesNotSentTitle"),
      message("downloadedCountDetail", [progress.ok || 0]) +
        (progress.seen ? message("foundCountSuffix", [progress.seen]) : "") +
        (failed ? message("errorCountSuffix", [failed]) : "") +
        (progress.folder ? message("folderSuffix", [progress.folder]) : ""),
      failed ? "error" : stopped ? "neutral" : "ok"
    );
  }
}

async function crawlAll() {
  if (busyMode !== null) return;
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus(message("noActiveTabTitle"), message("openPageRetryDetail"), "error");
    return;
  }
  if (!isSupportedPageUrl(tab.url || "")) {
    setStatus(message("unsupportedTabTitle"), message("openNormalPageDetail"), "error");
    return;
  }

  setBusy("crawl");
  advancedEl.open = false;
  setStatus(message("crawlProgressTitle"), message("crawlStartedDetail"), "loading");
  const folder = buildDownloadFolder(
    lastData || {
      pageUrl: tab.url,
      sourceName: sourceNameFromUrl(tab.url || ""),
      isInstagram: isInstagramUrl(tab.url || ""),
    }
  );

  try {
    await ensureContentScript(tab.id);
    const result = await chrome.runtime.sendMessage({
      type: "CRAWL_DOWNLOAD",
      tabId: tab.id,
      folder,
      options: {
        maxRounds: isInstagramUrl(tab.url || "") ? 120 : 40,
        maxEmptyStreak: isInstagramUrl(tab.url || "") ? 5 : 3,
        scrollSteps: 4,
        scrollWaitMs: 950,
      },
    });

    if (!result?.ok) {
      setStatus(message("crawlStartFailedTitle"), result?.error || message("tryAgainDetail"), "error");
      return;
    }

    setStatus(
      message(result.stopped ? "downloadStoppedTitle" : "downloadStartedTitle"),
      message("downloadedCountDetail", [result.started || 0]) +
        (result.seen ? message("foundCountSuffix", [result.seen]) : "") +
        (result.failed ? message("errorCountSuffix", [result.failed]) : "") +
        message("folderSuffix", [result.folder || folder]),
      result.failed ? "error" : result.stopped ? "neutral" : "ok"
    );
  } catch (error) {
    setStatus(
      message("popupDisconnectedTitle"),
      message("crawlContinueDetail", [error.message || ""]).trim(),
      "error"
    );
  } finally {
    const current = await chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_STATUS" }).catch(() => null);
    if (current?.job?.running) {
      applyProgress(current.job);
    } else {
      setBusy(null);
    }
  }
}

async function stopJob() {
  btnStop.disabled = true;
  await chrome.runtime.sendMessage({ type: "STOP_DOWNLOAD" });
  setStatus(message("stoppingTitle"), message("currentFileCompletesDetail"), "loading");
}

btnSelectAll.addEventListener("click", () => {
  const checkboxes = mediaCheckboxes();
  const shouldSelect = checkboxes.some((checkbox) => !checkbox.checked);
  checkboxes.forEach((checkbox) => {
    checkbox.checked = shouldSelect;
  });
  updateSelectionControls();
});

resultsEl.addEventListener("change", (event) => {
  if (event.target.matches('input[data-media-index]')) updateSelectionControls();
});

btnScan.addEventListener("click", () => scan());
btnScanMore.addEventListener("click", () => scan({ deep: true }));
btnDownload.addEventListener("click", downloadSelected);
btnCrawl.addEventListener("click", crawlAll);
btnStop.addEventListener("click", stopJob);

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "DOWNLOAD_PROGRESS") applyProgress(message);
  });
}

async function initialise() {
  if (!globalThis.chrome?.tabs?.query || !globalThis.chrome?.runtime?.sendMessage) {
    setStatus(
      message("openPopupTitle", [], "Open the extension popup"),
      message("localPreviewDetail", [], "Local preview is not connected to the active tab"),
      "neutral"
    );
    return;
  }

  try {
    const tab = await getActiveTab();
    if (!tab || !isSupportedPageUrl(tab.url || "")) {
      resultsEl.hidden = true;
      advancedEl.hidden = true;
      setStatus(message("openNormalPageTitle"), message("clickExtensionAgainDetail"), "error");
      return;
    }

    prepareSupportedPage(tab);
    const current = await chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_STATUS" }).catch(() => null);
    if (current?.job?.running) {
      applyProgress(current.job);
      return;
    }
    await scan();
  } catch (error) {
    setStatus(message("openCurrentFailedTitle"), error.message || message("tryAgainDetail"), "error");
  }
}

initialise();
