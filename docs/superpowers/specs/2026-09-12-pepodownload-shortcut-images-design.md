# PepoDownload Shortcut Image Support

## Goal

Extend the authenticated iPhone Shortcut API to detect and return still images
without changing the existing Telegram, video, or GIF behavior.

## API Design

- `POST /api/shortcut/inspect` accepts `{ "url": "https://..." }` and returns
  `mediaType` (`video` or `image`) plus `itemCount`.
- `POST /api/shortcut/download` keeps `video` and `gif` unchanged and adds
  `format: "image"` with an optional zero-based `itemIndex`.
- Single-image posts require one download request. Carousels are downloaded one
  image at a time so iOS receives real JPEG/PNG/WebP files that `Save to Photo
  Album` can store directly.

## Extraction

- The shared media core remains authoritative.
- yt-dlp and the existing Instagram cookie file remain the first extraction
  path.
- Existing X/Twitter direct-media fallback is retained and made item-aware.
- gallery-dl is added only as a still-image fallback for sites where yt-dlp does
  not expose photo posts. It receives the same Netscape cookie file through an
  argument array and never through shell interpolation.
- Original image bytes are returned without recompression. ImageMagick verifies
  the generated file and determines its MIME type.

## Carousel Flow

The Shortcut first calls `inspect`. For images it repeats from 1 through
`itemCount`, calls `download` with `itemIndex` equal to the repeat index minus
one, and immediately saves each response. ZIP and multipart responses are not
used because Photos cannot reliably import them as separate assets.

## Safety And Cleanup

Both endpoints share Bearer authentication, body limits, URL validation,
timeouts, rate limiting, concise errors, logging, cancellation, and temporary
cleanup. Inspection results are cached briefly in memory to avoid extracting a
carousel again for every item.

## Compatibility And Tests

Telegram code is not changed. Tests cover image detection, one real still-image
download, MIME and file validity, carousel indexing where a public example is
available, existing video/GIF regressions, authentication, validation, and
temporary cleanup.
