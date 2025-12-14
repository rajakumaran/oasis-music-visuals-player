import { Injectable, signal, effect, WritableSignal, computed } from '@angular/core';
import { Track } from '../models/track.model';

const BANDS = [60, 170, 310, 600, 1000, 3000, 6000];
const FFT_SIZE = 512;

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audioContext: AudioContext | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNodes: BiquadFilterNode[] = [];
  private animationFrameId: number | null = null;

  // State Signals
  playlist = signal<Track[]>([]);
  currentTrackIndex = signal<number | null>(null);
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(0);
  
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
      if (track && this.audioElement) {
        this.audioElement.src = track.url;
        this.audioElement.load();
        if(this.isPlaying()) {
            this.audioElement.play();
        }
      }
    });

    effect(() => {
        const playing = this.isPlaying();
        if (this.audioElement) {
            if (playing) {
                this.audioElement.play().catch(e => console.error("Play failed:", e));
                this.startVisualization();
            } else {
                this.audioElement.pause();
                this.stopVisualization();
            }
        }
    });
  }

  private async initAudioContext() {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';

    this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = FFT_SIZE;
    
    // Create gain nodes for each band
    let lastNode: AudioNode = this.sourceNode;
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

    lastNode.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);

    this.audioElement.addEventListener('timeupdate', () => {
      this.currentTime.set(this.audioElement?.currentTime || 0);
    });
    this.audioElement.addEventListener('durationchange', () => {
      this.duration.set(this.audioElement?.duration || 0);
    });
    this.audioElement.addEventListener('ended', () => {
        this.next();
    });
  }

  loadDefaultPlaylist() {
    const defaultTracks: Track[] = [
    
      { name: 'AI Music Track1', url: 'assets/music/sample-ai-track1.mp3', duration: '...' },
      { name: 'AI Music Track2', url: 'assets/music/sample-ai-track2.mp3', duration: '...' },
      { name: 'AI Music Track3', url: 'assets/music/sample-ai-track3.mp3', duration: '...' },
      { name: 'AI Music Track4', url: 'assets/music/sample-ai-track4.mp3', duration: '...' },
      { name: 'AI Music Track5', url: 'assets/music/sample-ai-track5.mp3', duration: '...' },
      { name: 'AI Music Track6', url: 'assets/music/sample-ai-track6.mp3', duration: '...' },
      { name: 'AI Music Track7', url: 'assets/music/sample-ai-track7.mp3', duration: '...' },
      { name: 'AI Music Track8', url: 'assets/music/sample-ai-track8.mp3', duration: '...' },
      { name: 'AI Music Track9', url: 'assets/music/sample-ai-track9.mp3', duration: '...' },
      { name: 'AI Music Track10', url: 'assets/music/sample-ai-track10.mp3', duration: '...' },

    ];
    this.playlist.set(defaultTracks);
    if (defaultTracks.length > 0) {
      this.currentTrackIndex.set(0);
      this.isPlaying.set(false);
    }
  }

  async loadFiles(files: FileList) {
    await this.initAudioContext();
    
    // Revoke old object URLs, checking if they are from uploaded files
    this.playlist().forEach(track => {
      if (track.file) {
        URL.revokeObjectURL(track.url)
      }
    });
    
    const newTracks: Track[] = Array.from(files)
      .filter(file => file.type.startsWith('audio/') || file.type === 'video/mp4')
      .map(file => {
          const url = URL.createObjectURL(file);
          // Duration is tricky to get without loading, so we'll estimate or update later
          return { file, name: file.name, url, duration: '...' };
      });

    this.playlist.set(newTracks);
    if (newTracks.length > 0) {
      this.currentTrackIndex.set(0);
      this.isPlaying.set(true); // Auto-play uploaded tracks
    }
  }

  selectTrack(index: number) {
    if(index >= 0 && index < this.playlist().length) {
      const shouldPlay = this.isPlaying() || this.currentTrackIndex() !== index;
      this.currentTrackIndex.set(index);
      this.isPlaying.set(shouldPlay);
    }
  }

  togglePlay() {
      if (!this.audioContext) {
        this.initAudioContext();
      }
      if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume();
      }
      if (this.currentTrack() !== null) {
        this.isPlaying.update(p => !p);
      }
  }

  next() {
    const idx = this.currentTrackIndex();
    if (idx !== null && this.playlist().length > 1) {
      const newIndex = (idx + 1) % this.playlist().length;
      this.currentTrackIndex.set(newIndex);
      this.isPlaying.set(true);
    }
  }

  previous() {
    const idx = this.currentTrackIndex();
    if (idx !== null && this.playlist().length > 1) {
      const newIndex = (idx - 1 + this.playlist().length) % this.playlist().length;
      this.currentTrackIndex.set(newIndex);
      this.isPlaying.set(true);
    }
  }

  seek(time: number) {
      if (this.audioElement) {
          this.audioElement.currentTime = time;
      }
  }

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

  private visualize() {
    if (!this.analyserNode || !this.isPlaying()) {
      return;
    }
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    this.frequencyData.set(dataArray);
    this.animationFrameId = requestAnimationFrame(() => this.visualize());
  }

  private startVisualization() {
      if (this.animationFrameId === null) {
          this.visualize();
      }
  }

  private stopVisualization() {
      if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
          // Set to zero when stopped
          this.frequencyData.set(new Uint8Array(FFT_SIZE / 2));
      }
  }
}
