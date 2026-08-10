# Privacy Policy — Page Media Downloader

Effective date: August 11, 2026

Page Media Downloader is a browser extension that finds photos, direct video files, and direct audio files already exposed by the web page the user is viewing and lets the user download selected files.

## What the extension processes

Only after the user clicks the extension, it receives temporary access to the active tab and locally examines that page's URL, visible document structure, media elements, metadata, and direct media URLs. This information is used only to show downloadable candidates and perform the user's requested downloads.

During a batch download, the extension keeps short-lived operational status in Chrome session storage, such as counts, progress, the destination folder name, and recent download errors. It does not intentionally persist the page URL or discovered media URLs in extension storage.

## Where processing happens

Media discovery and selection happen locally in the user's browser. The extension has no developer-operated server, account system, analytics, advertising, or telemetry. Page and media information is not sent to the developer.

When popup results render, the browser may request discovered photo thumbnails and available video poster previews directly from the third-party media host. These preview requests use a no-referrer policy. When the user starts a download, Chrome also connects directly to the host that serves the selected media. The host and the user's browser or network provider may process these requests under their own policies; the extension developer does not receive them.

## Collection, sharing, sale, and retention

- The developer does not collect, sell, rent, or share user data.
- The extension does not use data for advertising, credit decisions, or unrelated purposes.
- Session-only job status is managed by the browser and expires with the browser session. In-memory job state ends when the extension service worker stops.
- Downloaded files remain under the user's control in the browser's Downloads location until the user removes them.

## Browser permissions

- `activeTab`: grants temporary access to the current tab only after the user invokes the extension.
- `scripting`: runs the bundled media collector in that user-invoked tab.
- `downloads`: saves media files the user selects and reports their download status.
- `storage`: keeps session-only batch-download progress so the popup can show the current state.

The extension does not request permanent access to all websites and does not execute remotely hosted code.

## User choices and limitations

The extension runs only when the user opens it or starts an action from its popup. Users can deselect any media item, stop a full-page download, remove downloaded files, clear browser session data, disable the extension, or uninstall it at any time.

The extension does not bypass DRM, paywalls, login controls, private APIs, or access restrictions. Users are responsible for downloading only content they own or are authorized to use.

## Contact

For privacy or support questions, open an issue at <https://github.com/KikuAI-Lab/page-media-downloader/issues>. Do not include private page URLs, media URLs, credentials, or personal data in a public issue.

Material changes to this policy will be documented in this repository and reflected in the Chrome Web Store listing before a corresponding extension update is published.

---

# Политика конфиденциальности — Page Media Downloader

Дата вступления в силу: 11 августа 2026 года

Page Media Downloader — браузерное расширение, которое находит фотографии, прямые видеофайлы и прямые аудиофайлы, уже раскрытые открытой пользователем веб-страницей, и позволяет скачать выбранные файлы.

## Что обрабатывает расширение

Только после клика пользователя расширение получает временный доступ к активной вкладке и локально проверяет адрес страницы, видимую структуру документа, медиаэлементы, метаданные и прямые URL медиа. Эти сведения используются только для показа доступных вариантов и выполнения выбранных пользователем загрузок.

Во время пакетной загрузки расширение временно хранит в сессионном хранилище Chrome технический статус: счётчики, прогресс, имя папки назначения и последние ошибки загрузки. Расширение намеренно не сохраняет адрес страницы или найденные URL медиа в своём хранилище.

## Где происходит обработка

Поиск и выбор медиа происходят локально в браузере пользователя. У расширения нет сервера разработчика, системы аккаунтов, аналитики, рекламы или телеметрии. Сведения о странице и медиа не отправляются разработчику.

При отображении результатов popup браузер может напрямую запросить у стороннего медиа-хоста миниатюры фото и доступные постеры видео. Для этих запросов действует политика `no-referrer`. После запуска загрузки Chrome также напрямую обращается к хосту, на котором находится выбранный файл. Хост, браузер или сетевой провайдер пользователя могут обрабатывать эти запросы по собственным правилам; разработчик расширения их не получает.

## Сбор, передача, продажа и хранение

- Разработчик не собирает, не продаёт, не сдаёт в аренду и не передаёт данные пользователей.
- Данные не используются для рекламы, кредитных решений или посторонних целей.
- Сессионный статус загрузки управляется браузером и исчезает после завершения сессии. Состояние в памяти исчезает после остановки фонового процесса расширения.
- Скачанные файлы остаются под контролем пользователя в папке загрузок, пока пользователь их не удалит.

## Разрешения браузера

- `activeTab`: временный доступ только к текущей вкладке после запуска расширения пользователем.
- `scripting`: запуск встроенного сборщика медиа в этой вкладке.
- `downloads`: сохранение выбранных файлов и получение статуса загрузки.
- `storage`: сессионное хранение прогресса пакетной загрузки для отображения в popup.

Расширение не запрашивает постоянный доступ ко всем сайтам и не исполняет удалённо размещённый код.

## Выбор пользователя и ограничения

Расширение работает только когда пользователь открывает его или запускает действие в popup. Можно снять выбор с любого файла, остановить загрузку всей страницы, удалить скачанные файлы, очистить данные сессии браузера, отключить или удалить расширение.

Расширение не обходит DRM, paywall, авторизацию, приватные API или ограничения доступа. Пользователь обязан скачивать только собственные материалы или контент, на использование которого у него есть разрешение.

## Связь

Вопрос о конфиденциальности или поддержке можно задать в Issues: <https://github.com/KikuAI-Lab/page-media-downloader/issues>. Не публикуйте там приватные адреса страниц, URL медиа, учётные данные или персональные сведения.

Существенные изменения этой политики будут отражены в репозитории и в описании Chrome Web Store до публикации соответствующего обновления расширения.
