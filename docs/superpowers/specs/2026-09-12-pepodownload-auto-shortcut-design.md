# PepoDownload Automatic Shortcut API

## Goal

Reduce the iPhone Shortcut to one authenticated request followed by saving the
returned files. Media detection, format selection, carousel traversal, download,
and iPhone-compatible normalization belong to the server.

## Contract

`POST /api/shortcut/auto` accepts JSON containing only `url`. It authenticates
with the existing Bearer token, validates the URL, prepares every media item,
and returns a top-level JSON array of short-lived, single-use HTTPS URLs. This
lets Shortcuts pass the response directly to `Repeat with Each`, without any
dictionary parsing. The old `/download` and `/inspect` routes remain available
for compatibility but are not part of the new Shortcut.

Each temporary URL streams one JPEG, PNG, WebP, or MP4 with an accurate MIME type
and attachment filename. Tokens are random, expire after ten minutes, cannot
select arbitrary paths, and are removed after a successful transfer. A periodic
cleanup removes expired groups and their files.

## Media Processing

The shared media core inspects a submitted URL once. Still images are downloaded
without recompression. Videos are selected at the best practical quality under
the existing size limit and remuxed or transcoded only when needed for H.264/AAC
MP4 compatibility. Instagram carousels and X posts preserve source order and may
contain both photos and videos when the extractor exposes both.

The Telegram handler is unchanged and continues using the existing Video/GIF
workflow. GIF remains supported there and on the legacy endpoint, but the new
automatic endpoint never creates GIFs.

## Performance And Safety

Timings cover metadata extraction, time to first yt-dlp output, source transfer,
normalization, server processing, and temporary-file transfer. Metadata is not
extracted repeatedly for carousel items. Existing Bearer authentication, body
limits, rate limits, concurrency limits, cookies, command argument arrays, and
temporary cleanup remain in force.

## Shortcut

The Shortcut posts the shared URL once, repeats directly over the returned list,
downloads each URL, and passes each response to `Save to Photo
Album`. The phone does not inspect media types, choose formats, calculate indexes,
or understand carousel metadata.
