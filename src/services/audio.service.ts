import { Injectable, signal, effect, WritableSignal, computed } from '@angular/core';
import { Track } from '../models/track.model';

const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FFT_SIZE = 2048; // Increased for better frequency resolution as per research
const CROSSFADE_DURATION = 3.75; // seconds

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audioContext: AudioContext | null = null;
  private audioElement: HTMLAudioElement | null = null;
  
  private mediaElementSourceNode: MediaElementAudioSourceNode | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  
  private analyserNode: AnalyserNode | null = null;
  private gainNodes: BiquadFilterNode[] = [];
  private masterGainNode: GainNode | null = null;
  private animationFrameId: number | null = null;
  private pauseTimeout: any = null;

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

  constructor() {
    this.loadDefaultPlaylist();

    effect(() => {
      const track = this.currentTrack();
      const audioEl = this.audioElement;
      if (track && audioEl) {
        if (audioEl.src !== track.url) {
          if (!audioEl.paused) {
            audioEl.pause();
          }
          audioEl.src = track.url;
          audioEl.load();
        }
        
        if (this.isPlaying()) {
          this.playCurrentTrackWithFadeIn();
        }
      }
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
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.audioElement?.paused) {
        await this.audioElement?.play();
      }

      if (this.isCrossfadeEnabled() && this.masterGainNode && this.audioContext) {
        this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, this.audioContext.currentTime);
        this.masterGainNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + CROSSFADE_DURATION);
      } else if (this.masterGainNode) {
        this.masterGainNode.gain.value = 1;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // This can happen if the user rapidly clicks play/pause. The new state (e.g. paused) is the desired outcome, so we can ignore this error.
      } else {
        console.error("Play failed:", e);
        this.isPlaying.set(false);
      }
    }
  }

  private async initAudioContext() {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';

    this.mediaElementSourceNode = this.audioContext.createMediaElementSource(this.audioElement);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = FFT_SIZE;
    this.analyserNode.smoothingTimeConstant = 0.6; // Tuned for better responsiveness
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
    this.analyserNode.connect(this.audioContext.destination);

    this.audioElement.addEventListener('timeupdate', () => this.currentTime.set(this.audioElement?.currentTime || 0));
    this.audioElement.addEventListener('durationchange', () => this.duration.set(this.audioElement?.duration || 0));
    this.audioElement.addEventListener('ended', () => this.next());
  }

  private loadDefaultPlaylist() {
    this.playlist.set([
      { name: 'Ambient Classical Guitar', url: 'https://cdn.pixabay.com/audio/2022/08/04/audio_2dde6b9975.mp3', duration: '...' },
      { name: 'The Cradle of Your Soul', url: 'https://cdn.pixabay.com/audio/2022/01/20/audio_20a45d31a2.mp3', duration: '...' },
      { name: 'Smoke', url: 'https://cdn.pixabay.com/audio/2023/04/24/audio_b722a84376.mp3', duration: '...' }
    ]);
  }

  async loadFiles(files: FileList) {
    if (!this.audioContext) await this.initAudioContext();
    // Limit to 10 files
    const limitedFiles = Array.from(files).slice(0, 10);
    
    this.playlist().forEach(track => track.file && URL.revokeObjectURL(track.url));
    const newTracks: Track[] = limitedFiles
      .filter(file => file.type.startsWith('audio/') || file.type === 'video/mp4')
      .map(file => ({ file, name: file.name, url: URL.createObjectURL(file), duration: '...' }));
      
    this.playlist.set(newTracks);
    if (newTracks.length > 0) {
      this.currentTrackIndex.set(0);
      if (!this.isPlaying()) {
        this.togglePlay();
      }
    }
  }

  async selectTrack(index: number) {
    if (index >= 0 && index < this.playlist().length) {
      if (this.currentTrackIndex() === index) {
        await this.togglePlay();
      } else {
        const wasPlaying = this.isPlaying();
        
        if (this.pauseTimeout) {
          clearTimeout(this.pauseTimeout);
          this.pauseTimeout = null;
        }

        if (wasPlaying && this.isCrossfadeEnabled() && this.masterGainNode && this.audioContext) {
          this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
          this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, this.audioContext.currentTime);
          this.masterGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + CROSSFADE_DURATION);
          await new Promise(resolve => setTimeout(resolve, CROSSFADE_DURATION * 1000));
        }

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
    if (!this.audioContext) await this.initAudioContext();
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }

    this.isPlaying.update(p => !p);
    
    if (this.isPlaying()) {
      if (this.audioElement && this.audioElement.src !== this.currentTrack()!.url) {
        this.audioElement.src = this.currentTrack()!.url;
        await this.audioElement.load();
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

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    
    // Set the raw FFT data for spectrum-based visuals
    this.frequencyData.set(dataArray);

    // Update peak volume with smoothing
    const currentMax = Math.max(...dataArray) / 255;
    this.peakVolume.update(v => v * 0.95 + currentMax * 0.05);
    this.detectBeat(dataArray);
    this.detectTransient(dataArray);
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
      // Clear the bars when visualization stops
      this.frequencyData.set(new Uint8Array(FFT_SIZE / 2));
      this.lastFftFrame = null;
      this.beatHistory.bass.fill(0);
      this.beatHistory.mids.fill(0);
      this.beatTimes = [];
      this.transientTimes = [];
    }
  }
}