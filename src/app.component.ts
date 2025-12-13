import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from './services/audio.service';
import { EqualizerTheme } from './models/equalizer-theme.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  audioService = inject(AudioService);

  themes: EqualizerTheme[] = [
    { name: 'Onkyo', type: '3d', base: 'bg-black', display: 'bg-gray-900/70', bar: 'bg-cyan-400 shadow-cyan-400/50', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-gray-300', text: 'text-gray-300', accent: 'text-cyan-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-800' },
    { name: 'Technics', type: '3d', base: 'bg-gray-800', display: 'bg-black/50', bar: 'bg-amber-500 shadow-amber-500/50', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-amber-500', text: 'text-amber-100', accent: 'text-amber-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-700/50' },
    { name: 'Pioneer', type: '3d', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-blue-400 shadow-blue-400/50', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Spectrum', type: '3d', base: 'bg-gray-900', display: 'bg-black/50', bar: 'bg-gradient-to-t from-purple-500 to-red-500', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-white', text: 'text-gray-200', accent: 'text-purple-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-800' },
    { name: 'Marantz', type: '3d', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-blue-500 shadow-blue-500/50', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'McIntosh', type: '3d', base: 'bg-gray-900', display: 'bg-black/90', bar: 'bg-sky-400 shadow-sky-400/40', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-green-500', text: 'text-green-400', accent: 'text-sky-400', button: 'bg-gray-800 border border-gray-600', buttonHover: 'hover:bg-gray-700', highlight: 'bg-gray-700/50' },
    { name: 'Retro Sunset', type: '3d', base: 'bg-indigo-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-pink-500 via-orange-500 to-yellow-400', sliderTrack: 'bg-purple-800', sliderThumb: 'bg-pink-400', text: 'text-cyan-300', accent: 'text-yellow-400', button: 'bg-pink-600/50', buttonHover: 'hover:bg-pink-600/80', highlight: 'bg-purple-700/50' },
    { name: 'Yamaha', type: '3d', base: 'bg-slate-300', display: 'bg-gray-800/80', bar: 'bg-orange-400 shadow-orange-400/50', sliderTrack: 'bg-gray-500', sliderThumb: 'bg-gray-800', text: 'text-gray-900', accent: 'text-orange-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-400' },
    { name: 'Azure Glow', type: '3d', base: 'bg-gray-800', display: 'bg-gray-900', bar: 'bg-gradient-to-t from-blue-500 to-cyan-300 shadow-[0_0_4px_#38bdf8]', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-blue-400', text: 'text-gray-300', accent: 'text-cyan-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-blue-600/50' },
    { name: 'Gold Standard', type: '3d', base: 'bg-[#f0e6d2]', display: 'bg-[#2c2c2c]', bar: 'bg-gradient-to-t from-blue-600 to-blue-400 shadow-[0_0_4px_#60a5fa]', sliderTrack: 'bg-gray-500', sliderThumb: 'bg-[#d4af37]', text: 'text-white', accent: 'text-blue-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-blue-500/50' },
    { name: 'Emerald Mono', type: '3d', base: 'bg-black', display: 'bg-gray-900 border border-gray-700', bar: 'bg-gradient-to-t from-[#00bfff] to-[#00ffff] shadow-[0_0_4px_#00ffff]', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-green-500', text: 'text-green-400 font-mono', accent: 'text-green-400', button: 'bg-gray-800', buttonHover: 'hover:bg-gray-700', highlight: 'bg-cyan-500/50' },
    { name: 'Retro Sunset', type: '3d', base: 'bg-gradient-to-b from-[#0f0c29] via-[#302b63] to-[#24243e]', display: 'bg-black/30', bar: 'bg-gradient-to-t from-pink-500 via-purple-500 to-yellow-500 shadow-[0_0_4px_#ec4899]', sliderTrack: 'bg-purple-900/50', sliderThumb: 'bg-pink-500', text: 'text-cyan-300', accent: 'text-yellow-400', button: 'bg-purple-800/50', buttonHover: 'hover:bg-purple-700/50', highlight: 'bg-pink-500/50' },
    { name: 'Amber Classic', type: '3d', base: 'bg-gray-300', display: 'bg-gray-800', bar: 'bg-gradient-to-t from-amber-500 to-yellow-300 shadow-[0_0_4px_#f59e0b]', sliderTrack: 'bg-gray-500', sliderThumb: 'bg-gray-200', text: 'text-gray-200', accent: 'text-amber-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-amber-500/50' },
    { name: 'Fireside', type: '3d', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gradient-to-t from-amber-600 to-amber-400 shadow-[0_0_4px_#fbbf24]', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-amber-500', text: 'text-gray-300', accent: 'text-amber-500', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-amber-600/50' },
    { name: 'Classic LED', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gray-700', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-400', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50' },
    { name: 'Studio Shadow', type: 'shadow', base: 'bg-gray-800', display: 'bg-gray-900', bar: 'bg-gradient-to-t from-gray-400 to-gray-200 shadow-[-3px_0_6px_rgba(0,0,0,0.5)]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-300', text: 'text-gray-300', accent: 'text-white', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-600/50' },
    { name: 'Crimson Deep', type: 'shadow', base: 'bg-black', display: 'bg-stone-900', bar: 'bg-gradient-to-t from-red-700 to-orange-500 shadow-[-3px_0_6px_rgba(0,0,0,0.5)]', sliderTrack: 'bg-red-900/50', sliderThumb: 'bg-orange-500', text: 'text-orange-300', accent: 'text-red-500', button: 'bg-red-800/50', buttonHover: 'hover:bg-red-700/50', highlight: 'bg-red-600/50' },
    { name: 'Oceanic Depth', type: 'shadow', base: 'bg-slate-900', display: 'bg-black/50', bar: 'bg-gradient-to-t from-teal-600 to-cyan-400 shadow-[-3px_0_6px_rgba(0,0,0,0.5)]', sliderTrack: 'bg-teal-900/50', sliderThumb: 'bg-cyan-400', text: 'text-cyan-200', accent: 'text-teal-300', button: 'bg-cyan-800/50', buttonHover: 'hover:bg-cyan-700/50', highlight: 'bg-cyan-600/50' }
  ];

// selectedTheme = signal(this.themes[0]);
selectedTheme: WritableSignal<EqualizerTheme> = signal(this.themes[0]);
  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.audioService.loadFiles(input.files);
    }
  }
  // Expose signals from service for template binding
  playlist = this.audioService.playlist;
  currentTrackIndex = this.audioService.currentTrackIndex;
  isPlaying = this.audioService.isPlaying;
  currentTime = this.audioService.currentTime;
  duration = this.audioService.duration;
  gainValues = this.audioService.gainValues;
  currentTrack = this.audioService.currentTrack;

  sensitivity = signal(1.2);
  backgroundImageUrl = signal<string | null>(null);
  private smoothedBars = new Array(64).fill(0);
  
  decayFactor = signal(0.94); // Base decay factor for visualizer bars
  private readonly resizeListener = () => this.updateDecayFactor();

  // --- Ticker Properties ---
  // V V V - EDIT THESE LINES FOR YOUR CUSTOM TICKER TEXT - V V V
  tickerMessages: string[] = [
    'Welcome to the Audio Oasis Equalizer...',
    'Built with Angular and a passion for classic Hi-Fi.',
    '',
    'Tip1: You can set a custom background for the visualizer.',
    'Tip2: Tune the Graphic equalizer controls for an enhanced listening experience.',
    'Tip3: Choose the various styles from the drop down for an enhanced visual experience.',
    'By Mr. Muthukumaran Azhagesan ( Kumar ), https://linktr.ee/muthukumaran.azhagesan',
  ];
  // ^ ^ ^ - END OF USER-EDITABLE TEXT - ^ ^ ^

  currentTickerMessage = signal(this.tickerMessages[0]);
  tickerDirection = signal<'left' | 'right'>('left');
  private tickerInterval: any;
  animationClass = computed(() => 'animate-' + this.tickerDirection());

  ngOnInit(): void {
    this.updateDecayFactor();
    window.addEventListener('resize', this.resizeListener);
    this.setupTicker();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeListener);
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
    }
  }

  private setupTicker(): void {
    // Set random scroll direction
    this.tickerDirection.set(Math.random() > 0.5 ? 'left' : 'right');

    // Cycle through messages
    let messageIndex = 0;
    this.tickerInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % this.tickerMessages.length;
      this.currentTickerMessage.set(this.tickerMessages[messageIndex]);
    }, 15000); // Change message every 15 seconds
  }

  private updateDecayFactor(): void {
    const width = window.innerWidth;
    const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
    const map = (val: number, in_min: number, in_max: number, out_min: number, out_max: number) =>
      ((val - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;

    // Adjust decay based on screen width for better visual feel
    const minWidth = 320;   // Mobile
    const maxWidth = 2560;  // Large desktop
    const minDecay = 0.92;  // Faster decay on small screens
    const maxDecay = 0.97;  // Slower decay on large screens

    const decay = map(width, minWidth, maxWidth, minDecay, maxDecay);
    this.decayFactor.set(clamp(decay, minDecay, maxDecay));
  }

  // Use a smaller portion of frequency data for visualization
  visualizerBars = computed(() => {
    const freqData = this.audioService.frequencyData();
    const sensitivityValue = this.sensitivity();
    const baseDecay = this.decayFactor();
    const barCount = 64;
    const data = new Array(barCount);
    const logLength = Math.log(freqData.length);

    let lastIndex = 0;

    for (let i = 0; i < barCount; i++) {
      // Use a logarithmic scale for better visual distribution
      const index = Math.floor(Math.pow(1.05, i) * (freqData.length / Math.pow(1.05, barCount)));
      data[i] = freqData[Math.min(index, freqData.length -1)] / 255;
    }
    return data;
  });

  ledBars = computed(() => {
    const bars = this.visualizerBars();
    const segments = 16; // 16 segments per bar
    return bars.map(barHeight => Math.floor(barHeight * segments));
  });

  bandFrequencies = ['60', '170', '310', '600', '1k', '3k', '6k'];

  onBgImageChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const oldUrl = this.backgroundImageUrl();
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }
      const newUrl = URL.createObjectURL(input.files[0]);
      this.backgroundImageUrl.set(newUrl);
    }
  }

  onGainChange(event: Event, index: number) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.audioService.changeGain(index, value);
  }

  onSeek(event: Event) {
    const time = parseFloat((event.target as HTMLInputElement).value);
    this.audioService.seek(time);
  }

  onSensitivityChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.sensitivity.set(value);
}  
  //formatTime(seconds: number): string {
  //  if (isNaN(seconds) || seconds < 0) return '00:00';
  //  const min = Math.floor(seconds / 60);
  //  const sec = Math.floor(seconds % 60);
  //  return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
  //}

  selectTheme(theme: EqualizerTheme) {
    this.selectedTheme.set(theme);
  }
  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}