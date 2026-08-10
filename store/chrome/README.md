# Chrome Web Store submission pack — 1.6.0

This is the single live owner handoff for the first public Chrome release. Update it whenever the manifest, privacy behavior, listing claims, URLs, or store questionnaire changes.

## Release position

- Price: free
- In-app purchases: none
- Ads, affiliates, analytics, telemetry: none
- Primary language: Russian
- Initial audience: Russian-speaking desktop Chrome users; Brave remains compatible but is not a Chrome Web Store review claim
- Category: Tools
- Visibility at launch: Public
- Regions: all regions permitted by the publisher account

## Listing copy

### Name

Page Media Downloader

### Short description

Находит фото, прямые видео и аудио на текущей странице и скачивает выбранные файлы — локально, без аккаунта и аналитики.

### Detailed description

Page Media Downloader помогает сохранить фотографии, прямые видеофайлы и прямые аудиофайлы, которые уже доступны открытой веб-странице.

Как это работает:

- открой обычную HTTP(S)-страницу и нажми иконку расширения;
- результаты появляются в порядке «Видео → Аудио → Фото»;
- воспроизводимое аудио помечается «Сейчас играет» и показывается первым среди аудио;
- выбери нужные фото, видео и аудио и запусти загрузку;
- если страница ещё не догрузила медиа, используй дополнительный поиск;
- для Instagram открой конкретный пост или Reel, а не только сетку профиля.

Расширение работает локально, без аккаунта, сервера разработчика, аналитики, рекламы и телеметрии. Постоянный доступ ко всем сайтам не запрашивается: временный доступ к текущей вкладке появляется только после действия пользователя.

Честные ограничения: расширение не записывает вкладку, не реконструирует HLS/DASH-потоки, не обходит DRM, paywall, авторизацию, приватные API или ограничения доступа и не поддерживает YouTube. `blob:` можно скачать только если сама страница дополнительно раскрывает прямой незашифрованный URL.

Page Media Downloader не связан с Instagram, Meta или владельцами поддерживаемых сайтов; упоминание сервиса описывает только совместимость.

Скачивай только собственный контент или материалы, на использование которых у тебя есть разрешение. Пользователь несёт ответственность за соблюдение авторских прав, условий сайта и применимого законодательства.

## Public URLs

These URLs work only after the owner switches the verified repository to public. Confirm each one in a signed-out browser before entering it in the dashboard.

- Homepage: <https://github.com/KikuAI-Lab/page-media-downloader>
- Support: <https://github.com/KikuAI-Lab/page-media-downloader/issues>
- Privacy policy: <https://github.com/KikuAI-Lab/page-media-downloader/blob/main/PRIVACY.md>
- Publisher website: <https://kikuai.dev>

Do not add Telegram, unrelated products, affiliate links, donations, or paid-upgrade copy to the v1 listing.

## Single purpose

Find photos, direct video files, and direct audio files already exposed by the user-invoked current web page, let the user choose among them, and download the selected files through the browser's download manager.

## Permission justifications

### `activeTab`

Provides temporary access only to the tab on which the user invokes the extension. The extension needs this to inspect that page for media and never requests continuous access to browsing across all sites.

### `scripting`

Injects the extension's bundled `content.js` collector into the user-invoked active tab. No remote script or arbitrary code is loaded.

### `downloads`

Saves only the media items selected by the user, or the items found after the user explicitly starts the full-page download action, and reads download completion/error status.

### `storage`

Stores session-only batch-download progress so reopening the popup can show counts, state, destination folder name, and recent errors. It is not used for browsing history, profiles, advertising, or analytics.

## Remote code declaration

No. All executable JavaScript is packaged in the extension ZIP. The extension does not use `eval`, `new Function`, remote modules, remotely hosted scripts, WebAssembly, or a remote configuration capable of changing executable behavior.

## User-data questionnaire

Use the dashboard's current wording; the conservative declarations for this build are:

- Website content: handled locally because the extension examines visible page structure, media elements, metadata, and direct media URLs after user invocation.
- Web history/current page URL: handled locally only to identify the current page/source and build a download folder label; it is not collected by the developer or retained as browsing history.
- Authentication, personal communications, location, financial/payment, health, and personally identifiable information: not requested or intentionally handled.
- Data sale or transfer: none.
- Advertising, credit, or unrelated secondary use: none.
- Developer collection/remote transmission: none. Selected download requests go directly from Chrome to the third-party media host, not to the developer.

Certify these answers only after comparing the uploaded ZIP to this exact commit. Chrome's legal/privacy certifications must be accepted by the owner, not an agent.

## Reviewer instructions

No account, login, paid feature, or special test credential is required.

1. Open a normal public HTTP(S) page containing an `img`, a native `video`, and a native `audio` or `source`, each with a direct HTTP(S) media URL.
2. Click the extension icon. It automatically scans only the active page.
3. Confirm that results appear as **Видео**, **Аудио**, then **Фото**, and that a playing native audio element is marked **Сейчас играет**.
4. Deselect an item and press **Скачать выбранное · N**. Chrome should start downloads only for selected items.
5. Expand **Больше медиа со страницы** and press **Найти больше** to verify that the page scrolls briefly and refreshes results without downloading.
6. The separate full-page action is intentionally explicit because it scrolls and begins downloading discovered items.

If testing Instagram, open a public post or Reel itself. Detection depends on the public page exposing a direct media URL; the extension does not bypass login or private access.

## Assets

- Store icon: `icons/icon128.png` — 128x128 PNG
- Product screenshot: `store/chrome/assets/screenshot-results-1280x800.png`
- Small promotional tile: `store/chrome/assets/small-promo-440x280.png`
- Marquee promotional tile: intentionally omitted for v1

## Owner submission checklist

- [ ] Review `PRIVACY.md`, publisher identity, rights statement, regions, and any trader/legal status personally.
- [ ] Make the GitHub repository public and verify Homepage, Support, and Privacy URLs while signed out.
- [ ] Rebuild from the final public commit and match the ZIP SHA-256 to the verification receipt.
- [ ] Upload `dist/page-media-downloader-1.6.0-chrome.zip` and the mapped image assets.
- [ ] Copy the listing, single-purpose, permission, remote-code, and data-use answers above into the current dashboard.
- [ ] Confirm there is no unexpected registration fee or account warning; do not pay or change provider settings automatically.
- [ ] Save as draft and inspect the complete dashboard readback.
- [ ] Personally accept required declarations and click the final review/publication control.
- [ ] After approval, record the publication date as the launch-experiment trigger; evaluate aggregate evidence after 30 days and at least 100 installs.
