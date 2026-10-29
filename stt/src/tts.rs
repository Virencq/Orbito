use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    SampleFormat, Stream, StreamConfig,
};
use serde::Serialize;
use best_tts::{Engine, Options};
use sherpa_onnx::LinearResampler;

use crate::{
    playback::PlaybackReference,
    voice_assets::{VoiceAssetKind, VoiceAssets},
};

const OUTPUT_DRAIN_GRACE: Duration = Duration::from_millis(120);
const DEFAULT_VOICE: &str = "af_heart";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpeechPlaybackState {
    Loading,
    Speaking,
    Idle,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPlaybackEvent {
    pub request_id: u64,
    pub state: SpeechPlaybackState,
    pub progress: f32,
    pub message: Option<String>,
}

pub struct SpeechSynthesizer {
    assets: Arc<VoiceAssets>,
    playback_reference: Arc<PlaybackReference>,
    engine: Mutex<Option<Arc<Engine>>>,
    generation: AtomicU64,
    current_request: Arc<AtomicU64>,
    speaking: AtomicBool,
    playback: Mutex<Option<Arc<PlaybackControl>>>,
}

impl SpeechSynthesizer {
    pub fn new(assets: Arc<VoiceAssets>, playback_reference: Arc<PlaybackReference>) -> Self {
        Self {
            assets,
            playback_reference,
            engine: Mutex::new(None),
            generation: AtomicU64::new(0),
            current_request: Arc::new(AtomicU64::new(0)),
            speaking: AtomicBool::new(false),
            playback: Mutex::new(None),
        }
    }

    pub fn is_speaking(&self) -> bool {
        self.speaking.load(Ordering::SeqCst)
    }

    pub fn speak(
        self: &Arc<Self>,
        text: String,
        speed: f32,
        speaker_id: Option<i32>,
        on_event: Arc<dyn Fn(SpeechPlaybackEvent) + Send + Sync>,
    ) -> Result<u64, String> {
        let text = text.trim().to_owned();
        if text.is_empty() {
            return Err("There is no text to speak.".to_owned());
        }
        if !self.assets.is_installed(VoiceAssetKind::Tts) {
            return Err("Install the local text-to-speech model in Settings first.".to_owned());
        }
        let _ = speaker_id; // Kept for Tauri API compatibility; the built-in engine uses its default voice.

        self.stop();
        let request_id = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.current_request.store(request_id, Ordering::SeqCst);
        self.speaking.store(true, Ordering::SeqCst);
        on_event(SpeechPlaybackEvent {
            request_id,
            state: SpeechPlaybackState::Loading,
            progress: 0.0,
            message: None,
        });

        let synthesizer = self.clone();
        thread::spawn(move || {
            if let Err(error) =
                synthesizer.run_speech(request_id, &text, speed, speaker, on_event.clone())
            {
                if synthesizer.current_request.load(Ordering::SeqCst) == request_id {
                    let _ = synthesizer.stop();
                    on_event(SpeechPlaybackEvent {
                        request_id,
                        state: SpeechPlaybackState::Error,
                        progress: 0.0,
                        message: Some(error),
                    });
                }
            }
        });
        Ok(request_id)
    }

    fn run_speech(
        &self,
        request_id: u64,
        text: &str,
        speed: f32,
        _speaker_id: Option<i32>,
        on_event: Arc<dyn Fn(SpeechPlaybackEvent) + Send + Sync>,
    ) -> Result<(), String> {
        let engine = self.load_engine()?;
        if self.current_request.load(Ordering::SeqCst) != request_id {
            return Ok(());
        }

        // best-tts performs inference synchronously; cancellation is checked immediately
        // after generation, before any audio is sent to the output device.
        let audio = engine
            .say_with(
                text,
                DEFAULT_VOICE,
                Options { speed: speed.clamp(0.7, 1.4), ..Options::default() },
            )
            .map_err(|error| format!("Text-to-speech generation failed: {error}"))?;
        if self.current_request.load(Ordering::SeqCst) != request_id {
            return Ok(());
        }
        if audio.samples.is_empty() {
            return Err("Text-to-speech generated no audio.".to_owned());
        }

        let (output_stream, playback, output_sample_rate) =
            create_audio_output(self.playback_reference.clone())?;
        if let Ok(mut active) = self.playback.lock() {
            *active = Some(playback.clone());
        }
        output_stream
            .play()
            .map_err(|error| format!("Could not start audio playback: {error}"))?;

        let input_sample_rate = audio.sample_rate as u32;
        let samples = if input_sample_rate == output_sample_rate {
            audio.samples
        } else {
            let mut resampler = LinearResampler::create(
                input_sample_rate as i32,
                output_sample_rate as i32,
            ).ok_or_else(|| "Could not create the speaker resampler.".to_owned())?;
            resampler.resample(&audio.samples, true)
        };
        if self.current_request.load(Ordering::SeqCst) != request_id {
            playback.stop();
            return Ok(());
        }

        on_event(SpeechPlaybackEvent {
            request_id,
            state: SpeechPlaybackState::Speaking,
            progress: 0.0,
            message: None,
        });
        let total_samples = samples.len().max(1) as f32;
        playback.push(&samples);
        while !playback.is_empty()
            && !playback.is_stopped()
            && self.current_request.load(Ordering::SeqCst) == request_id
        {
            let remaining = playback.samples.lock().map(|queue| queue.len()).unwrap_or(0);
            on_event(SpeechPlaybackEvent {
                request_id,
                state: SpeechPlaybackState::Speaking,
                progress: (1.0 - remaining as f32 / total_samples).clamp(0.0, 1.0),
                message: None,
            });
            thread::sleep(Duration::from_millis(25));
        }
        if !playback.is_stopped() && self.current_request.load(Ordering::SeqCst) == request_id {
            thread::sleep(OUTPUT_DRAIN_GRACE);
        }

        if self.current_request.load(Ordering::SeqCst) == request_id {
            self.speaking.store(false, Ordering::SeqCst);
            if let Ok(mut active) = self.playback.lock() {
                *active = None;
            }
            on_event(SpeechPlaybackEvent {
                request_id,
                state: SpeechPlaybackState::Idle,
                progress: 1.0,
                message: None,
            });
        }
        drop(output_stream);
        Ok(())
    }

    fn load_engine(&self) -> Result<Arc<Engine>, String> {
        let mut cached = self.engine
            .lock()
            .map_err(|_| "The text-to-speech engine is unavailable.".to_owned())?;
        if let Some(engine) = cached.as_ref() {
            return Ok(engine.clone());
        }
        let engine = Arc::new(
            Engine::embedded()
                .map_err(|error| format!("Could not initialize the built-in TTS engine: {error}"))?,
        );
        *cached = Some(engine.clone());
        Ok(engine)
    }

    pub fn stop(&self) -> u64 {
        let request_id = self.current_request.swap(0, Ordering::SeqCst);
        self.speaking.store(false, Ordering::SeqCst);
        if let Ok(mut active) = self.playback.lock() {
            if let Some(playback) = active.take() {
                playback.stop();
            }
        }
        request_id
    }

    pub fn reset_model(&self) {
        let _ = self.stop();
        if let Ok(mut engine) = self.engine.lock() {
            *engine = None;
        }
    }
}

struct PlaybackControl {
    samples: Mutex<VecDeque<f32>>,
    stopped: AtomicBool,
}

impl PlaybackControl {
    fn new() -> Self {
        Self {
            samples: Mutex::new(VecDeque::new()),
            stopped: AtomicBool::new(false),
        }
    }

    fn push(&self, samples: &[f32]) {
        if samples.is_empty() || self.is_stopped() {
            return;
        }
        if let Ok(mut queued) = self.samples.lock() {
            queued.extend(samples.iter().copied());
        }
    }

    fn is_empty(&self) -> bool {
        self.samples
            .lock()
            .map(|samples| samples.is_empty())
            .unwrap_or(true)
    }

    fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Ok(mut samples) = self.samples.lock() {
            samples.clear();
        }
    }
}

fn create_audio_output(
    playback_reference: Arc<PlaybackReference>,
) -> Result<(Stream, Arc<PlaybackControl>, u32), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No speaker is available. Check the system sound settings.".to_owned())?;
    let supported = device
        .default_output_config()
        .map_err(|error| format!("Could not open the default speaker: {error}"))?;
    let config: StreamConfig = supported.clone().into();
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0;
    let playback = Arc::new(PlaybackControl::new());
    let stream = build_output_stream(
        &device,
        &config,
        supported.sample_format(),
        channels,
        playback.clone(),
        playback_reference,
    )?;
    Ok((stream, playback, sample_rate))
}

fn build_output_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    channels: usize,
    playback: Arc<PlaybackControl>,
    playback_reference: Arc<PlaybackReference>,
) -> Result<Stream, String> {
    let on_error = |error| eprintln!("[s-loop-speech] speaker stream error: {error}");
    let sample_rate = config.sample_rate.0;
    match sample_format {
        SampleFormat::F32 => device
            .build_output_stream(
                config,
                move |data: &mut [f32], _| {
                    fill_output(
                        data,
                        channels,
                        &playback,
                        &playback_reference,
                        sample_rate,
                        |sample| sample,
                    );
                },
                on_error,
                None,
            )
            .map_err(|error| format!("Could not create speaker stream: {error}")),
        SampleFormat::I16 => device
            .build_output_stream(
                config,
                move |data: &mut [i16], _| {
                    fill_output(
                        data,
                        channels,
                        &playback,
                        &playback_reference,
                        sample_rate,
                        |sample| (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16,
                    );
                },
                on_error,
                None,
            )
            .map_err(|error| format!("Could not create speaker stream: {error}")),
        SampleFormat::U16 => device
            .build_output_stream(
                config,
                move |data: &mut [u16], _| {
                    fill_output(
                        data,
                        channels,
                        &playback,
                        &playback_reference,
                        sample_rate,
                        |sample| ((sample.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16,
                    );
                },
                on_error,
                None,
            )
            .map_err(|error| format!("Could not create speaker stream: {error}")),
        other => Err(format!("Unsupported speaker sample format: {other:?}")),
    }
}

fn fill_output<T: Copy>(
    data: &mut [T],
    channels: usize,
    playback: &PlaybackControl,
    playback_reference: &PlaybackReference,
    sample_rate: u32,
    convert: impl Fn(f32) -> T,
) {
    let frame_count = data.len() / channels.max(1);
    let mut played = Vec::with_capacity(frame_count);
    let mut queued = playback.samples.lock().ok();
    for frame in data.chunks_mut(channels.max(1)) {
        let sample = if playback.is_stopped() {
            0.0
        } else {
            queued
                .as_mut()
                .and_then(|samples| samples.pop_front())
                .unwrap_or(0.0)
        };
        frame.fill(convert(sample));
        played.push(sample);
    }
    drop(queued);
    playback_reference.publish(sample_rate, &played);
}

