# PepoDownload Shortcut API

## Goal

Allow an iPhone Shortcut to send a shared media URL and receive either an MP4
or GIF directly, while preserving the existing Telegram conversation and inline
button flow.

## Architecture

- `media-core.mjs` owns URL inspection, yt-dlp cookie use, format selection,
  ffmpeg normalization/conversion, output metadata, and temporary cleanup.
- The Telegram callbacks and the HTTP API call the same `downloadMedia`
  function.
- `panel.mjs` exposes `POST /api/shortcut/download` because the panel remains
  running independently from the controllable Telegram child process.
- The existing Discord HTTP service forwards only this route to the bot
  container over Umbrel's private Docker network. The proxy streams requests
  and responses and does not know the API token.

## Security And Limits

- Authentication uses `SHORTCUT_API_TOKEN` and a Bearer header.
- JSON bodies are limited to 16 KiB and accept only HTTP(S) URLs plus the
  `video` and `gif` formats.
- Downloader and converter processes use argument arrays, never a shell.
- At most two Shortcut downloads run concurrently, with eight starts per
  source in ten minutes.
- Jobs time out after twelve minutes and generated media is limited to 49 MiB.
- Temporary directories are removed after streaming, errors, or aborted
  requests.
- API errors are concise; command output and secrets remain server-side.

## Response

Successful requests stream one file with `video/mp4` or `image/gif`, a safe
attachment filename, explicit length, no-store caching, and MIME sniffing
disabled. Errors return JSON and an appropriate HTTP status before streaming
starts.
