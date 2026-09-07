# Voice Fullscreen, Recovery, and Push-to-Talk

Date: 2026-09-06

## Scope

Improve the existing canonical WebRTC voice client without adding a second call
implementation:

1. Native fullscreen for a camera or screen-share tile.
2. Per-peer connection recovery and readable diagnostics.
3. Optional push-to-talk while retaining open microphone as the default.

## Fullscreen

`VoiceStage` keeps rendering the existing `MediaStream` in its existing video
element. The expand control requests element fullscreen when supported; the
desktop bridge hides window chrome as a fallback and the existing CSS expanded
tile keeps the video as the sole visible surface. Escape, browser fullscreen
change and the desktop fullscreen event all restore the previous stage.

No second `<video>`, clone stream, iframe or new media player is created.
Audio remains owned by `VoiceAudioSink`, so fullscreen cannot create a second
audio path.

## Connection recovery

`VoiceClient` records each peer's initiator role, retry count, state and a
human-readable diagnostic. A peer that remains disconnected briefly or enters
`failed` is recovered by the original offerer only: its old peer connection is
closed, the same audio/camera/screen tracks are attached to a new connection,
and a fresh offer is signaled. A responder asks the original offerer to retry
through the already-authorized `voice:signal` path.

Retries are throttled and capped. The stage exposes a retry action for a failed
participant; it does not leave the channel, restart other working peers or
reacquire media devices. Socket reconnect remains the existing channel-level
rejoin path.

## Push-to-talk

Audio settings persist `transmissionMode` (`voice` by default or `ptt`) and a
keyboard code (default `KeyV`). In PTT mode the microphone stream stays open
but its track is enabled only while the selected key is held. This avoids media
permission prompts, peer replacement and WebRTC renegotiation for every phrase.

Keyboard handling ignores text inputs/content-editable controls, releases on
blur/hidden page, respects server mute/deafen/manual mute, and displays a
short local transmitting state. Speaking detection remains active and only
reports speech while transmission is actually enabled.

## Validation

- Existing Electron smoke and full-screen kiosk smoke still pass.
- Production client build succeeds.
- Manual two-account call: camera and remote screen fullscreen, one audio path,
  Escape exit, PTT hold/release, open microphone default, manual mute and server
  mute.
- Simulated failed/disconnected peer retries without stopping local camera/screen
  or another healthy peer.
