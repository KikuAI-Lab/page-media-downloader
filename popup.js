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
  return `Скачать выбранное · ${count}`;
}

function resultSummaryText(items) {
  const { videos, audios, photos } = splitMediaItems(items);
  return `${videos.length} видео · ${audios.length} аудио · ${photos.length} фото`;
}

function setPageSource(value) {
  pageSourceEl.textContent = String(value || "Текущая вкладка");
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
  btnSelectAll.textContent = allChecked ? "Снять всё" : "Выбрать всё";
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
    return "Готово к скачиванию";
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
    poster.src = item.poster;
    poster.alt = "";
    poster.loading = "lazy";
    poster.referrerPolicy = "no-referrer";
    poster.addEventListener("error", () => poster.remove());
    thumb.appendChild(poster);
  }
  const play = document.createElement("span");
  play.className = "play-mark";
  thumb.appendChild(play);

  const copy = document.createElement("span");
  copy.className = "video-copy";
  const title = document.createElement("strong");
  title.textContent = `Видео ${position}`;
  const source = document.createElement("span");
  source.textContent = itemSourceLabel(item.url);
  copy.append(title, source);

  option.append(
    thumb,
    copy,
    createMediaCheckbox(itemIndex, `Выбрать видео ${position}`)
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
  title.textContent = `Аудио ${position}`;
  heading.appendChild(title);
  if (item.playing) {
    const badge = document.createElement("span");
    badge.className = "playing-badge";
    badge.textContent = "Сейчас играет";
    heading.appendChild(badge);
  }
  const source = document.createElement("span");
  source.className = "audio-source";
  source.textContent = itemSourceLabel(item.url);
  copy.append(heading, source);

  option.append(
    thumb,
    copy,
    createMediaCheckbox(itemIndex, `Выбрать аудио ${position}`)
  );
  return option;
}

function createPhotoOption(item, itemIndex, position) {
  const option = document.createElement("label");
  option.className = "media-option photo-option";
  const checkbox = createMediaCheckbox(itemIndex, `Выбрать фото ${position}`);
  const image = document.createElement("img");
  image.src = item.url;
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
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
    deep ? "Ищу ниже по странице…" : "Ищу медиа…",
    deep ? "Немного прокручиваю страницу, ничего не скачиваю" : "Проверяю текущую страницу",
    "loading"
  );

  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      resultsEl.hidden = true;
      setStatus("Нет активной вкладки", "Открой страницу и попробуй снова", "error");
      return;
    }
    if (!isSupportedPageUrl(tab.url || "")) {
      resultsEl.hidden = true;
      advancedEl.hidden = true;
      setStatus("Эта вкладка не поддерживается", "Открой обычную веб-страницу", "error");
      return;
    }

    prepareSupportedPage(tab);
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: deep ? "SCROLL_LOAD_MORE" : "COLLECT_MEDIA",
      rounds: 4,
    });

    if (!response?.ok) {
      setStatus("Не удалось проверить страницу", response?.error || "Обнови вкладку и повтори поиск", "error");
      return;
    }

    const items = normaliseCollectedItems(response);
    lastData = { ...response, items };
    setPageSource(response.sourceName || response.username || sourceNameFromUrl(response.pageUrl || tab.url));
    renderResults(items);

    if (items.length === 0) {
      setStatus(
        "Медиа не найдено",
        response.isInstagram
          ? "Открой конкретный пост или Reel и повтори поиск"
          : "Запусти видео или догрузи страницу и попробуй снова",
        "error"
      );
      return;
    }

    const { videos, audios } = splitMediaItems(items);
    const readyTitle =
      videos.length > 0 && audios.length > 0
        ? "Видео и аудио найдены"
        : videos.length > 0
          ? "Видео найдено"
          : audios.length > 0
            ? "Аудио найдено"
            : "Медиа готово к выбору";
    setStatus(
      readyTitle,
      "",
      "ok"
    );
  } catch (error) {
    setStatus("Не удалось проверить страницу", `Обнови вкладку и повтори поиск. ${error.message || error}`, "error");
  } finally {
    if (!btnScan.hidden) advancedEl.hidden = false;
    setBusy(null);
  }
}

async function downloadSelected() {
  const items = getSelectedItems();
  if (!items.length) {
    setStatus("Ничего не выбрано", "Отметь хотя бы один файл", "error");
    return;
  }

  setBusy("download");
  setStatus("Начинаю загрузку…", `Выбрано файлов: ${items.length}`, "loading");
  const folder = buildDownloadFolder(lastData);

  try {
    const result = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_MEDIA",
      items,
      folder,
    });
    if (!result?.ok) {
      setStatus("Не удалось начать загрузку", result?.error || "Попробуй ещё раз", "error");
      return;
    }
    const started = result.started || 0;
    const failed = result.failed || 0;
    setStatus(
      started > 0 ? "Загрузка началась" : "Файлы не отправлены",
      `${started}/${result.total || items.length} → Downloads/${result.folder || folder}` +
        (failed ? ` · ошибок: ${failed}` : ""),
      failed ? "error" : "ok"
    );
  } catch (error) {
    setStatus(
      "Связь с popup прервалась",
      `Уже начатые файлы продолжат загружаться. ${error.message || ""}`.trim(),
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
        "Скачиваю всю страницу…",
        `Раунд ${progress.round || 0} · найдено ${progress.seen || 0} · отправлено ${progress.ok || 0}` +
          (progress.failed ? ` · ошибок: ${progress.failed}` : ""),
        "loading"
      );
    } else {
      setStatus(
        "Скачиваю выбранное…",
        `${progress.done || 0}/${progress.total || 0} · успешно ${progress.ok || 0}` +
          (progress.failed ? ` · ошибок: ${progress.failed}` : ""),
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
      stopped ? "Загрузка остановлена" : progress.ok ? "Загрузка началась" : "Файлы не отправлены",
      `${progress.ok || 0} файлов` +
        (progress.seen ? ` · найдено ${progress.seen}` : "") +
        (failed ? ` · ошибок: ${failed}` : "") +
        (progress.folder ? ` · Downloads/${progress.folder}` : ""),
      failed ? "error" : stopped ? "neutral" : "ok"
    );
  }
}

async function crawlAll() {
  if (busyMode !== null) return;
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("Нет активной вкладки", "Открой страницу и попробуй снова", "error");
    return;
  }
  if (!isSupportedPageUrl(tab.url || "")) {
    setStatus("Эта вкладка не поддерживается", "Открой обычную веб-страницу", "error");
    return;
  }

  setBusy("crawl");
  advancedEl.open = false;
  setStatus("Скачиваю всю страницу…", "Автоскролл запущен; popup можно закрыть", "loading");
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
      setStatus("Автоскролл не запустился", result?.error || "Попробуй ещё раз", "error");
      return;
    }

    setStatus(
      result.stopped ? "Загрузка остановлена" : "Загрузка началась",
      `${result.started || 0} файлов` +
        (result.seen ? ` · найдено ${result.seen}` : "") +
        (result.failed ? ` · ошибок: ${result.failed}` : "") +
        ` · Downloads/${result.folder || folder}`,
      result.failed ? "error" : result.stopped ? "neutral" : "ok"
    );
  } catch (error) {
    setStatus(
      "Связь с popup прервалась",
      `Автоскролл может продолжаться в фоне. ${error.message || ""}`.trim(),
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
  setStatus("Останавливаю…", "Текущий файл будет завершён", "loading");
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
    setStatus("Открой popup расширения", "Локальный просмотр не подключён к активной вкладке", "neutral");
    return;
  }

  try {
    const tab = await getActiveTab();
    if (!tab || !isSupportedPageUrl(tab.url || "")) {
      resultsEl.hidden = true;
      advancedEl.hidden = true;
      setStatus("Открой обычную веб-страницу", "Затем снова нажми иконку расширения", "error");
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
    setStatus("Не удалось открыть текущую вкладку", error.message || "Попробуй ещё раз", "error");
  }
}

initialise();
