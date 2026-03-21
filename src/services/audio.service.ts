import { Injectable, signal, effect, WritableSignal, computed } from '@angular/core';
import { Track } from '../models/track.model';

const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FFT_SIZE = 1024; // Smaller window = lower latency (~23ms vs ~46ms); resolution is still fine for bar visualizers
const CROSSFADE_DURATION = 3.75; // seconds

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audioContext: AudioContext | null = null;
  private audioElement: HTMLAudioElement | null = null;

  private mediaElementSourceNode: MediaElementAudioSourceNode | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;

  private analyserNode: AnalyserNode | null = null;
  private fftBuffer: Uint8Array<ArrayBuffer> | null = null;  // Pre-allocated to avoid per-frame GC
  private gainNodes: BiquadFilterNode[] = [];
  private masterGainNode: GainNode | null = null;
  private animationFrameId: number | null = null;
  private pauseTimeout: any = null;
  private playbackManagedByToggle = false;

  // --- Beat & Transient Detection ---
  private beatHistory = {
    bass: new Array(43).fill(0), // ~1s history for bass band at ~43fps
    mids: new Array(43).fill(0), // ~1s history for mids band
  };
  private beatHistoryIndex = 0;
  private lastBeatTime = 0;
  private lastFftFrame: Uint8Array | null = null;

  // --- "Smart" Mode Analysis ---
  private beatTimes: number[] = [];
  private transientTimes: number[] = [];
  private lastAnalysisTime = 0;
  private readonly ANALYSIS_WINDOW = 3000; // ms

  // State Signals
  playlist = signal<Track[]>([]);
  currentTrackIndex = signal<number | null>(null);
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);

  audioSource = signal<'file' | 'microphone'>('file');
  isMicrophonePermissionGranted = signal<boolean | null>(null);
  isCrossfadeEnabled = signal(true);

  gainValues = signal<number[]>(BANDS.map(() => 0));
  frequencyData: WritableSignal<Uint8Array> = signal(new Uint8Array(FFT_SIZE / 2));

  // --- Pre-Loading / Buffering Signals ---
  /**
   * Map from a track's final blob URL → load progress (0–100).
   * Only populated for user-uploaded tracks. CDN tracks are exempt.
   */
  trackLoadProgress = signal<Map<string, number>>(new Map());
  /**
   * Set of track blob URLs whose ArrayBuffer is fully loaded and ready.
   */
  isTrackReady = signal<Set<string>>(new Set());

  // --- Synergy Drive Signals ---
  beat = signal<{ strength: number, timestamp: number }>({ strength: 0, timestamp: 0 });
  transient = signal<{ intensity: number, timestamp: number }>({ intensity: 0, timestamp: 0 });
  detectedMusicProfile = signal<'atmosphere' | 'rhythm' | 'transient'>('rhythm');
  peakVolume = signal(0);

  currentTrack = computed(() => {
    const idx = this.currentTrackIndex();
    const list = this.playlist();
    return idx !== null && list[idx] ? list[idx] : null;
  });

  /** True when the current track is a CDN track or is fully buffered and ready to play. */
  currentTrackReady = computed(() => {
    const track = this.currentTrack();
    if (!track) return false;
    if (!track.isUserUpload) return true; // CDN tracks are always ready
    return this.isTrackReady().has(track.url);
  });

  constructor() {
    this.loadDefaultPlaylist();

    effect(() => {
      const track = this.currentTrack();
      const audioEl = this.audioElement;
      if (track && audioEl && track.url) { // Guard: skip placeholder tracks (url === '')
        if (audioEl.src !== track.url) {
          if (!audioEl.paused) {
            audioEl.pause();
          }
          audioEl.src = track.url;
          audioEl.load();
        }

        // Only auto-play from the effect when togglePlay/selectTrack isn't already handling it.
        // This prevents a race where both the effect and the manual call fire play() simultaneously.
        if (this.isPlaying() && this.currentTrackReady() && !this.playbackManagedByToggle) {
          this.playCurrentTrackWithFadeIn();
        }
      }
      // Reset the flag after the effect runs — the toggle's play call has already fired.
      this.playbackManagedByToggle = false;
    });

    effect(() => {
      if (this.audioSource() === 'microphone') {
        this.activateMicrophone();
      } else {
        this.deactivateMicrophone();
      }
    });
  }

  private async playCurrentTrackWithFadeIn() {
    try {
      this.ensureAudioContextRunning();

      if (this.audioElement?.paused) {
        await this.audioElement.play(); // play() is now directly within gesture scope
      }

      // Apply crossfade gain ramp AFTER play has started
      if (this.isCrossfadeEnabled() && this.masterGainNode && this.audioContext) {
        this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, this.audioContext.currentTime);
        this.masterGainNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + CROSSFADE_DURATION);
      } else if (this.masterGainNode) {
        this.masterGainNode.gain.value = 1;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // Rapid play/pause clicks — desired state (paused) already achieved.
      } else {
        console.error('Play failed:', e);
        this.isPlaying.set(false);
      }
    }
  }

  private async initAudioContext() {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();
    this.audioElement = new Audio();
    // NOTE: Do NOT set crossOrigin = 'anonymous' here.
    // On iOS Safari, CORS mode causes silent playback failure when the CDN
    // doesn't send matching Access-Control-Allow-Origin headers.
    // The MediaElementSourceNode Web Audio approach works without CORS mode.

    this.mediaElementSourceNode = this.audioContext.createMediaElementSource(this.audioElement);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = FFT_SIZE;
    this.analyserNode.smoothingTimeConstant = 0.3; // Low smoothing = bars track the music tightly
    this.masterGainNode = this.audioContext.createGain();

    let lastNode: AudioNode = this.mediaElementSourceNode;
    this.gainNodes = BANDS.map(frequency => {
      const filter = this.audioContext!.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.41; // A slightly tighter Q value for better separation
      filter.gain.value = 0;
      lastNode.connect(filter);
      lastNode = filter;
      return filter;
    });

    lastNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.analyserNode);

    // Brickwall limiter to prevent clipping and distortion jumps
    const limiter = this.audioContext.createDynamicsCompressor();
    limiter.threshold.value = -1.0; // Prevent pushing above 0dB (a little headroom)
    limiter.knee.value = 0.0;
    limiter.ratio.value = 20.0; // Hard limiting ratio
    limiter.attack.value = 0.005; // Quick attack to catch transients
    limiter.release.value = 0.050; // Quick release

    this.analyserNode.connect(limiter);
    limiter.connect(this.audioContext.destination);

    this.audioElement.addEventListener('timeupdate', () => this.currentTime.set(this.audioElement?.currentTime || 0));
    this.audioElement.addEventListener('durationchange', () => this.duration.set(this.audioElement?.duration || 0));
    this.audioElement.addEventListener('ended', () => this.next());
    this.audioElement.addEventListener('error', () => {
      console.warn('AudioService: audio element error', this.audioElement?.error);
      this.isPlaying.set(false);
    });
    this.audioElement.addEventListener('stalled', () => {
      console.warn('AudioService: audio stalled — will retry on next user action');
    });
  }

  /**
   * Pre-warms BOTH the AudioContext AND HTMLAudioElement on iOS.
   *
   * iOS Safari requires two separate unlocks, each within a user gesture:
   * 1. AudioContext must be created (and optionally resumed) during a gesture.
   * 2. HTMLAudioElement.play() must also be called during a gesture to make
   *    subsequent play() calls work without the NotAllowedError.
   *
   * We do a silent play→pause on the audio element to unlock it, then suspend
   * the AudioContext to save battery. Both happen within the first touchstart.
   */
  async prewarmForIos(): Promise<void> {
    if (this.audioContext) return; // Already initialized
    await this.initAudioContext();

    // Unlock the HTMLAudioElement by playing a tiny silent WAV.
    // Using a real data-URI source (instead of empty src) ensures iOS Safari
    // actually "unlocks" the element, allowing future play() calls without gesture.
    if (this.audioElement) {
      const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      this.audioElement.src = silentWav;
      this.audioElement.load();
      this.audioElement.play()
        .then(() => { this.audioElement!.pause(); this.audioElement!.src = ''; })
        .catch(() => { /* silence expected on some browsers */ });
    }

    // Suspend the AudioContext to save battery — resume() is called on Play.
    if (this.audioContext?.state === 'running') {
      this.audioContext.suspend();
    }
  }

  private loadDefaultPlaylist() {
    this.playlist.set([
      { name: 'Ambient Classical Guitar', url: 'https://cdn.pixabay.com/audio/2022/08/04/audio_2dde6b9975.mp3', duration: '...', isUserUpload: false },
      { name: 'The Cradle of Your Soul', url: 'https://cdn.pixabay.com/audio/2022/01/20/audio_20a45d31a2.mp3', duration: '...', isUserUpload: false },
      { name: 'Smoke', url: 'https://cdn.pixabay.com/audio/2023/04/24/audio_b722a84376.mp3', duration: '...', isUserUpload: false }
    ]);
  }

  async loadFiles(files: FileList) {
    if (!this.audioContext) await this.initAudioContext();
    // Limit to 10 files
    const limitedFiles = Array.from(files).slice(0, 10);

    // Revoke old user-upload blob URLs
    this.playlist().forEach(track => {
      if (track.isUserUpload && track.url) URL.revokeObjectURL(track.url);
    });

    // Reset progress state for the new batch
    this.trackLoadProgress.set(new Map());
    this.isTrackReady.set(new Set());

    const validFiles = limitedFiles.filter(
      file => file.type.startsWith('audio/') || file.type === 'video/mp4'
    );
    if (validFiles.length === 0) return;

    // Create placeholder tracks immediately so the playlist renders
    const placeholderTracks: Track[] = validFiles.map(file => ({
      file,
      name: file.name,
      url: '',          // Will be filled in once the ArrayBuffer is ready
      duration: '...',
      isUserUpload: true,
    }));
    this.playlist.set(placeholderTracks);
    this.currentTrackIndex.set(0);

    // Pre-buffer each file in parallel using ArrayBuffer so iOS gets
    // a fully-loaded Blob URL (no network streaming stalls).
    validFiles.forEach((file, i) => {
      this._preBufferFile(file, i);
    });
  }

  /**
   * Reads a File into an ArrayBuffer with progress tracking,
   * then sets the track's url to a fresh Blob URL backed by that buffer.
   * Once done, marks the track ready so the Play button becomes active.
   */
  private _preBufferFile(file: File, trackIndex: number): void {
    const reader = new FileReader();

    // Helper to mutate progress/ready signals immutably
    const setProgress = (url: string, pct: number) => {
      this.trackLoadProgress.update(map => {
        const next = new Map(map);
        next.set(url, pct);
        return next;
      });
    };

    const markReady = (url: string) => {
      this.isTrackReady.update(set => {
        const next = new Set(set);
        next.add(url);
        return next;
      });
    };

    // Use a temporary key based on the file name + size for progress tracking
    // before we have a real Blob URL.
    const tempKey = `__pending_${trackIndex}_${file.name}`;
    setProgress(tempKey, 0);

    reader.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setProgress(tempKey, pct);
        // Mirror progress onto the stable tempKey; swap to real url on completion.
        this.playlist.update(list => {
          const next = [...list];
          if (next[trackIndex]) {
            next[trackIndex] = { ...next[trackIndex] }; // trigger change detection
          }
          return next;
        });
      }
    };

    reader.onload = (e: ProgressEvent<FileReader>) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (!buffer) return;

      // Build a new Blob URL from the fully-loaded buffer
      const blob = new Blob([buffer], { type: file.type || 'audio/mpeg' });
      const blobUrl = URL.createObjectURL(blob);

      // Remove the temp progress key and add the real url
      this.trackLoadProgress.update(map => {
        const next = new Map(map);
        next.delete(tempKey);
        next.set(blobUrl, 100);
        return next;
      });

      // Update the track's url in the playlist
      this.playlist.update(list => {
        const next = [...list];
        if (next[trackIndex]) {
          next[trackIndex] = { ...next[trackIndex], url: blobUrl };
        }
        return next;
      });

      markReady(blobUrl);

      // If this track is the current one and was already set to src, reload it
      if (this.currentTrackIndex() === trackIndex && this.audioElement) {
        // The effect() in constructor will pick up the url change and call audioElement.load()
      }
    };

    reader.onerror = () => {
      console.error(`AudioService: failed to read file "${file.name}"`);
      this.trackLoadProgress.update(map => {
        const next = new Map(map);
        next.delete(tempKey);
        next.set(tempKey + '_error', -1);
        return next;
      });
    };

    reader.readAsArrayBuffer(file);
  }

  /**
   * Returns the load progress for a given track:
   * - null  → not a user-upload track (CDN / always ready)
   * - 0-99  → currently loading
   * - 100   → fully loaded and ready
   * - -1    → error
   */
  getTrackLoadProgress(track: Track): number | null {
    if (!track.isUserUpload) return null;
    const map = this.trackLoadProgress();
    // Check by final url
    if (track.url && map.has(track.url)) return map.get(track.url)!;
    // Check by temp key (while url is still empty/pending)
    if (!track.url || !map.has(track.url)) {
      // Find a pending entry via index — look for any value < 100 in the map
      // (The tempKey encodes the trackIndex in its name but we don't have index here;
      // instead just return 0 if url is empty, meaning 'not started or in progress')
      if (!track.url) return 0;
    }
    return null;
  }

  /** Returns true if a track is fully ready to play. */
  getTrackIsReady(track: Track): boolean {
    if (!track.isUserUpload) return true;
    return !!track.url && this.isTrackReady().has(track.url);
  }

  async selectTrack(index: number) {
    if (index >= 0 && index < this.playlist().length) {
      const targetTrack = this.playlist()[index];
      // Don't allow selecting a track that is still buffering (url is empty)
      if (targetTrack?.isUserUpload && !this.isTrackReady().has(targetTrack.url)) return;

      if (this.currentTrackIndex() === index) {
        await this.togglePlay();
      } else {
        const wasPlaying = this.isPlaying();

        if (this.pauseTimeout) {
          clearTimeout(this.pauseTimeout);
          this.pauseTimeout = null;
        }

        this.ensureAudioContextRunning();

        if (wasPlaying && this.isCrossfadeEnabled() && this.masterGainNode && this.audioContext) {
          this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
          this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, this.audioContext.currentTime);
          this.masterGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + CROSSFADE_DURATION);
          await new Promise(resolve => setTimeout(resolve, CROSSFADE_DURATION * 1000));
        }

        this.playbackManagedByToggle = true;
        this.currentTrackIndex.set(index);
        this.isPlaying.set(wasPlaying || true);
      }
    }
  }

  async togglePlay() {
    if (!this.currentTrack() && this.playlist().length > 0) {
      this.currentTrackIndex.set(0);
    }
    if (!this.currentTrack()) return;
    // Don't allow playing a user-uploaded track that hasn't finished buffering
    if (!this.currentTrackReady()) return;
    if (!this.audioContext) await this.initAudioContext();
    // Fire-and-forget resume — do NOT await. Awaiting breaks iOS gesture chain.
    this.ensureAudioContextRunning();
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }

    // Mark that togglePlay is handling playback so the constructor effect doesn't race.
    this.playbackManagedByToggle = true;
    this.isPlaying.update(p => !p);

    if (this.isPlaying()) {
      if (this.audioElement && this.audioElement.src !== this.currentTrack()!.url) {
        this.audioElement.src = this.currentTrack()!.url;
        this.audioElement.load(); // don't await — load is sync-enough for src assignment
      }
      this.playCurrentTrackWithFadeIn();
      this.startVisualization();
    } else {
      if (this.isCrossfadeEnabled() && this.masterGainNode && this.audioContext) {
        this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, this.audioContext.currentTime);
        this.masterGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + CROSSFADE_DURATION);
        this.pauseTimeout = setTimeout(() => {
          this.audioElement?.pause();
          this.pauseTimeout = null;
        }, CROSSFADE_DURATION * 1000);
      } else {
        this.audioElement?.pause();
      }
      this.stopVisualization();
    }
  }

  next() { this.currentTrackIndex.update(idx => idx !== null ? (idx + 1) % this.playlist().length : 0); }
  previous() { this.currentTrackIndex.update(idx => idx !== null ? (idx - 1 + this.playlist().length) % this.playlist().length : 0); }
  seek(time: number) { if (this.audioElement) this.audioElement.currentTime = time; }

  changeGain(bandIndex: number, gain: number) {
    if (this.gainNodes[bandIndex]) {
      this.gainNodes[bandIndex].gain.value = gain;
      this.gainValues.update(values => {
        const newValues = [...values];
        newValues[bandIndex] = gain;
        return newValues;
      });
    }
  }

  setAudioSource(source: 'file' | 'microphone') {
    this.audioSource.set(source);
  }

  /**
   * Ensures the AudioContext is in a running/resuming state.
   * Handles 'suspended' (normal), 'interrupted' (iOS backgrounding), and 'closed' (error).
   * Fire-and-forget — intentionally does NOT await, to preserve iOS gesture chain.
   */
  private ensureAudioContextRunning(): void {
    if (!this.audioContext) return;
    const state = this.audioContext.state as string; // 'interrupted' is iOS-only, not in TS types
    if (state === 'suspended' || state === 'interrupted') {
      this.audioContext.resume().catch(() => { });
    }
    if (state === 'closed') {
      console.warn('AudioService: AudioContext was closed — recreating');
      this.audioContext = null;
      this.initAudioContext();
    }
  }

  private async activateMicrophone() {
    if (!this.audioContext) await this.initAudioContext();
    if (this.audioContext!.state === 'suspended') this.audioContext!.resume();

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.isMicrophonePermissionGranted.set(true);

      if (this.isPlaying()) {
        await this.togglePlay(); // Pause file playback gracefully
      }

      this.micSourceNode = this.audioContext!.createMediaStreamSource(this.micStream);
      this.mediaElementSourceNode?.disconnect();
      this.micSourceNode.connect(this.gainNodes[0]);

      if (this.masterGainNode) {
        this.masterGainNode.gain.cancelScheduledValues(this.audioContext!.currentTime);
        this.masterGainNode.gain.value = 1;
      }

      this.startVisualization();

    } catch (err) {
      console.error('Microphone access denied:', err);
      this.isMicrophonePermissionGranted.set(false);
      this.audioSource.set('file'); // Revert to file source
    }
  }

  private deactivateMicrophone() {
    if (this.micStream) this.micStream.getTracks().forEach(track => track.stop());
    this.micStream = null;
    if (this.micSourceNode) this.micSourceNode.disconnect();
    this.micSourceNode = null;
    if (this.mediaElementSourceNode && this.gainNodes.length > 0) {
      this.mediaElementSourceNode.connect(this.gainNodes[0]);
    }
    if (!this.isPlaying()) this.stopVisualization();
  }

  private detectBeat(dataArray: Uint8Array) {
    const now = performance.now();
    // Cooldown to avoid beat "flutter" on things like bass rolls or very fast kicks
    if (now - this.lastBeatTime < 80) return;

    // --- Band Definitions (based on 1024 bins, ~23Hz/bin with 48k sample rate) ---
    const BASS_START = 1, BASS_END = 12;     // ~23Hz - 276Hz (Kick drum fundamental)
    const MIDS_START = 40, MIDS_END = 120; // ~920Hz - 2.7kHz (Snare "crack")

    let bassEnergy = 0;
    for (let i = BASS_START; i <= BASS_END; i++) {
      bassEnergy += dataArray[i];
    }
    bassEnergy /= (BASS_END - BASS_START + 1);

    let midsEnergy = 0;
    for (let i = MIDS_START; i <= MIDS_END; i++) {
      midsEnergy += dataArray[i];
    }
    midsEnergy /= (MIDS_END - MIDS_START + 1);

    // --- Dynamic Thresholding based on recent energy history ---
    const avgBass = this.beatHistory.bass.reduce((s, v) => s + v, 0) / this.beatHistory.bass.length;
    const avgMids = this.beatHistory.mids.reduce((s, v) => s + v, 0) / this.beatHistory.mids.length;

    const bassThreshold = avgBass * 1.3 + 20;
    const midsThreshold = avgMids * 1.3 + 15;

    let beatDetected = false;
    let beatStrength = 0;

    if (bassEnergy > bassThreshold) {
      beatDetected = true;
      beatStrength = (bassEnergy - avgBass) / 255 * 1.5;
    } else if (midsEnergy > midsThreshold) {
      beatDetected = true;
      beatStrength = (midsEnergy - avgMids) / 255;
    }

    if (beatDetected) {
      this.beat.set({ strength: Math.min(1.0, beatStrength), timestamp: now });
      this.lastBeatTime = now;
      this.beatTimes.push(now);
    }

    // Update history buffers
    this.beatHistory.bass[this.beatHistoryIndex] = bassEnergy;
    this.beatHistory.mids[this.beatHistoryIndex] = midsEnergy;
    this.beatHistoryIndex = (this.beatHistoryIndex + 1) % this.beatHistory.bass.length;
  }

  private detectTransient(dataArray: Uint8Array) {
    if (!this.lastFftFrame) {
      this.lastFftFrame = new Uint8Array(dataArray);
      return;
    }

    let flux = 0;
    const startBin = 180;
    for (let i = startBin; i < dataArray.length; i++) {
      const diff = dataArray[i] - this.lastFftFrame[i];
      if (diff > 0) flux += diff;
    }

    // Normalize the flux value for consistent reactivity
    const normalizedFlux = flux / (dataArray.length - startBin) / 255;

    // Adjusted sensitivity for the more volatile high-frequency range.
    if (normalizedFlux > 0.035) {
      const now = performance.now();
      this.transient.set({ intensity: Math.min(1, normalizedFlux * 20), timestamp: now });
      this.transientTimes.push(now);
    }
    this.lastFftFrame.set(dataArray);
  }

  private analyzeMusicProfile() {
    const now = performance.now();
    if (now - this.lastAnalysisTime < this.ANALYSIS_WINDOW) return;
    this.lastAnalysisTime = now;

    this.beatTimes = this.beatTimes.filter(t => now - t < this.ANALYSIS_WINDOW);
    this.transientTimes = this.transientTimes.filter(t => now - t < this.ANALYSIS_WINDOW);

    const transientDensity = this.transientTimes.length / (this.ANALYSIS_WINDOW / 1000);
    const beatCount = this.beatTimes.length;

    let rhythmScore = 0;
    if (beatCount > 2) {
      const intervals = [];
      for (let i = 1; i < this.beatTimes.length; i++) {
        intervals.push(this.beatTimes[i] - this.beatTimes[i - 1]);
      }
      const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      const stdDev = Math.sqrt(intervals.map(x => Math.pow(x - avgInterval, 2)).reduce((s, v) => s + v, 0) / intervals.length);
      const consistency = 1 - (stdDev / avgInterval);
      if (consistency > 0.5) { // Threshold for "consistent" rhythm
        rhythmScore = (beatCount / (this.ANALYSIS_WINDOW / 1000)) * consistency; // Beats per second, weighted by consistency
      }
    }

    if (transientDensity > 8) { // High transient density (e.g., DnB, Metal)
      this.detectedMusicProfile.set('transient');
    } else if (rhythmScore > 1.2) { // Consistent, strong beat (e.g., House, Pop)
      this.detectedMusicProfile.set('rhythm');
    } else { // Low transients, no clear beat (e.g., Ambient, Classical)
      this.detectedMusicProfile.set('atmosphere');
    }
  }

  private visualize() {
    if (!this.analyserNode) return;
    // This guard clause correctly stops the loop only for file mode when paused.
    if (this.audioSource() === 'file' && !this.isPlaying()) {
      this.stopVisualization();
      return;
    };

    // Reuse pre-allocated buffer to avoid GC pressure on mobile
    if (!this.fftBuffer || this.fftBuffer.length !== this.analyserNode.frequencyBinCount) {
      this.fftBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    }
    this.analyserNode.getByteFrequencyData(this.fftBuffer);

    // Set the raw FFT data for spectrum-based visuals
    this.frequencyData.set(this.fftBuffer);

    // Update peak volume with smoothing
    const currentMax = Math.max(...this.fftBuffer) / 255;
    this.peakVolume.update(v => v * 0.95 + currentMax * 0.05);
    this.detectBeat(this.fftBuffer);
    this.detectTransient(this.fftBuffer);
    this.analyzeMusicProfile();

    this.animationFrameId = requestAnimationFrame(() => this.visualize());
  }

  private startVisualization() {
    if (!this.analyserNode) return;
    if (this.animationFrameId === null) {
      this.visualize();
    }
  }

  private stopVisualization() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
      this.frequencyData.set(new Uint8Array(FFT_SIZE / 2));
      this.lastFftFrame = null;
      this.beatHistory.bass.fill(0);
      this.beatHistory.mids.fill(0);
      this.beatTimes = [];
      this.transientTimes = [];
    }
  }
}
