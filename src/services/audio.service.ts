import { Injectable, signal, effect, WritableSignal, computed } from '@angular/core';
import { Track } from '../models/track.model';

const BANDS = [60, 170, 310, 600, 1000, 3000, 6000];
const FFT_SIZE = 512;
const CROSSFADE_DURATION = 0.75; // seconds

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
        // Stop current playback before changing source
        if (!audioEl.paused) {
          audioEl.pause();
        }
        audioEl.src = track.url;
        audioEl.load();
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
      await this.audioElement?.play();
      if (this.isCrossfadeEnabled() && this.masterGainNode && this.audioContext) {
        this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.masterGainNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + CROSSFADE_DURATION);
      } else if (this.masterGainNode) {
        this.masterGainNode.gain.value = 1;
      }
    } catch (e) {
      console.error("Play failed:", e);
      this.isPlaying.set(false);
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
    this.masterGainNode = this.audioContext.createGain();
    
    let lastNode: AudioNode = this.mediaElementSourceNode;
    this.gainNodes = BANDS.map(frequency => {
      const filter = this.audioContext!.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1;
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

  selectTrack(index: number) {
    if (index >= 0 && index < this.playlist().length) {
      if (this.currentTrackIndex() === index) {
        this.togglePlay();
      } else {
        const wasPlaying = this.isPlaying();
        const changeTrack = () => {
          this.currentTrackIndex.set(index);
          this.isPlaying.set(wasPlaying || true);
        };

        if (wasPlaying && this.isCrossfadeEnabled() && this.masterGainNode && this.audioContext) {
          this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
          this.masterGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + CROSSFADE_DURATION);
          setTimeout(changeTrack, CROSSFADE_DURATION * 1000);
        } else {
          changeTrack();
        }
      }
    }
  }
  
  async togglePlay() {
    if (!this.currentTrack() && this.playlist().length > 0) {
        this.currentTrackIndex.set(0);
    }
    if (!this.currentTrack()) return;

    if (!this.audioContext) {
      await this.initAudioContext();
    }
    
    if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
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
         this.masterGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + CROSSFADE_DURATION);
         setTimeout(() => this.audioElement?.pause(), CROSSFADE_DURATION * 1000);
      } else {
         this.audioElement?.pause();
      }
      this.stopVisualization();
    }
  }

  private changeTrack(newIndex: number) {
      const change = () => {
          this.currentTrackIndex.set(newIndex);
          this.isPlaying.set(true);
      };
      if (this.isPlaying() && this.isCrossfadeEnabled() && this.audioContext && this.masterGainNode) {
          this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
          this.masterGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + CROSSFADE_DURATION);
          setTimeout(change, CROSSFADE_DURATION * 1000);
      } else {
          change();
      }
  }

  next() {
    const idx = this.currentTrackIndex();
    if (idx !== null && this.playlist().length > 1) {
      const newIndex = (idx + 1) % this.playlist().length;
      this.changeTrack(newIndex);
    }
  }

  previous() {
    const idx = this.currentTrackIndex();
    if (idx !== null && this.playlist().length > 1) {
      const newIndex = (idx - 1 + this.playlist().length) % this.playlist().length;
      this.changeTrack(newIndex);
    }
  }

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
        this.togglePlay(); // Pause file playback gracefully
      }

      this.micSourceNode = this.audioContext!.createMediaStreamSource(this.micStream);
      this.mediaElementSourceNode?.disconnect(); // Disconnect file source
      this.micSourceNode.connect(this.gainNodes[0]); // Connect mic to filter chain
      
      // *** BUG FIX: Set master gain to 1 for microphone input ***
      if (this.masterGainNode) {
        this.masterGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
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
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.micSourceNode) {
      this.micSourceNode.disconnect();
      this.micSourceNode = null;
    }
    // Reconnect file source if it exists
    if (this.mediaElementSourceNode && this.gainNodes.length > 0) {
      this.mediaElementSourceNode.connect(this.gainNodes[0]);
    }

    if (!this.isPlaying()) {
        this.stopVisualization();
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
    this.frequencyData.set(dataArray);
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
    }
  }
}
