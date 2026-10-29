# Local voice runtime

S-Loop keeps the real-time audio path in Rust and uses Tauri events as the typed boundary to the
React UI. Node.js and the agent server are not involved in microphone capture or audio playback.

## Capabilities

- On Windows, final local dictation uses the installed Windows SAPI speech recognizer; no Whisper model is downloaded. On non-Windows platforms, final dictation uses multilingual Whisper Base. The transcript is inserted into the draft and is never sent automatically.
- Streaming captions use sherpa-onnx with a bilingual Chinese/English Zipformer model.
- Voice activity detection uses sherpa-onnx with Silero VAD.
- Text-to-speech uses `best-tts`, a pure-Rust, offline Kokoro-82M INT8 implementation with the model and voice assets embedded in the binary. No separate TTS model download is needed. The default voice is `af_heart`.
- Whisper is an automatic speech recognition (ASR) model: it converts spoken audio into text. It is not a text-to-speech engine. On Windows, Orbito currently uses the installed Windows SAPI recognizer for final dictation, so Whisper is not downloaded or used for that path.
- Voice conversation mode follows `listening → thinking → speaking → listening`. A finalized user
  turn is sent to the current chat, the final assistant response is spoken, and listening resumes
  after playback.
- Clicking the call button while the assistant is speaking stops playback and resumes listening.
  This is the initial interruption mechanism; acoustic echo cancellation is intentionally a later
  layer.

Streaming hypotheses are visually distinct from finalized text because partial results can be
revised by the recognizer.

## Architecture

- `stt/` is a Tauri-independent Rust crate.
  - `lib.rs` owns CPAL capture and platform-specific final dictation: Windows SAPI or Whisper on non-Windows.
  - `voice_assets.rs` downloads, safely extracts, validates, and deletes optional voice models.
  - `realtime.rs` owns CPAL capture, linear resampling, Silero VAD, Zipformer decoding, endpointing,
    and partial/final events.
  - `tts.rs` owns the embedded `best-tts` engine, synthesis, CPAL playback, and playback cancellation. Synthesis itself is synchronous and cannot be interrupted mid-inference; a stop request prevents generated audio from being queued.
- `src-tauri/src/dictation.rs` exposes final local dictation.
- `src-tauri/src/voice.rs` exposes model management, streaming recognition, and speech playback.
- `src/utils/voiceRuntime.ts` is the typed frontend command/event boundary.
- `src/utils/voiceConversation.ts` owns the UI conversation state machine and converts assistant
  Markdown into speakable text.

Captured audio remains in memory while recording. Windows SAPI dictation uses a temporary WAV file that is removed after recognition; voice model files remain the only persistent voice data.

## Models

ASR and VAD models are downloaded only after explicit user action. The TTS model is embedded in the application binary, which increases native binary size but avoids a separate runtime download.

| Capability | Model | Source |
| --- | --- | --- |
| Final dictation (Windows) | Windows SAPI installed recognizer | Windows speech components; no bundled model |
| Final dictation (non-Windows) | Whisper Base multilingual | `ggerganov/whisper.cpp` |
| Streaming ASR | Streaming Zipformer bilingual zh/en | `k2-fsa/sherpa-onnx` releases |
| VAD | Silero VAD ONNX | `k2-fsa/sherpa-onnx` releases |
| TTS | `best-tts` / Kokoro-82M INT8 | [studio-ransom/best-tts-rust](https://github.com/studio-ransom/best-tts-rust), Apache-2.0; model is embedded in the application binary |

Downloads use temporary `.part` files. Archives are extracted into a staging directory, archive
paths are checked for traversal, required model files are validated, and only then is the model
activated. Interrupted downloads and installations never replace an active model.

## Events

- `dictation-download-progress`
- `voice-asset-progress`
- `voice-realtime`
  - `state`
  - `level`
  - `speech-start`
  - `speech-end`
  - `partial`
  - `final`
  - `error`
- `voice-playback`
  - `loading`
  - `speaking`
  - `idle`
  - `error`

## Native build requirements

On Windows, final dictation uses the installed SAPI speech recognizer and does not compile `whisper.cpp` or require LLVM/libclang for dictation. Non-Windows builds still compile `whisper-rs`. The streaming ASR, VAD, and TTS stack continues to use sherpa-onnx and Sonora native dependencies. The full-duplex processor additionally requires Rust 1.91 or newer.

These are build-time requirements only. Installed S-Loop users do not need Node.js, Git, Python,
LLVM, CMake, or Visual Studio for voice features.

Use `npm run tauri:dev`, `npm run tauri:build`, `npm run native:check`, or
`npm run native:test:speech` for native development. The shared launcher locates `libclang.dll`,
Visual Studio C++ headers, and the newest installed Windows SDK before starting Cargo when that
standalone toolchain is present. Whisper-specific Clang setup is not needed for Windows dictation.

## Full-duplex audio processing

Conversation mode keeps microphone recognition active while synthesized speech is playing. The
speaker callback publishes the PCM frames that were actually rendered, and the microphone path
uses those frames as the reverse stream for a 16 kHz, 10 ms WebRTC AEC3 pipeline provided by
Sonora. The processed path is:

`microphone -> AEC3 -> high-pass filter -> noise suppression -> AGC2 -> Silero VAD + Sherpa ASR`

When cleaned near-end speech persists for at least 250 ms, the VAD emits `speech-start`. During
assistant playback, the UI waits for 350 ms of AEC warm-up and requires a cleaned input level of
at least 0.025 before stopping TTS. Recognition remains active, so the user's interrupted turn can
continue without reopening the microphone.

AEC quality depends on the capture/render device pair, driver buffering, room acoustics, and
speaker volume. Headsets naturally produce the best result. Built-in laptop speakers, USB audio,
and Bluetooth devices should be included in release testing; Bluetooth profile changes and
separate input/output sound cards can still reduce cancellation quality.
