import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from './services/audio.service';
import { EqualizerTheme } from './models/equalizer-theme.model';
import { FullscreenToggleComponent } from './fullscreen-toggle/fullscreen-toggle.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FullscreenToggleComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  audioService = inject(AudioService);
  
  // Expose signals from service for template binding
  playlist = this.audioService.playlist;
  currentTrackIndex = this.audioService.currentTrackIndex;
  isPlaying = this.audioService.isPlaying;
  currentTime = this.audioService.currentTime;
  duration = this.audioService.duration;
  gainValues = this.audioService.gainValues;
  currentTrack = this.audioService.currentTrack;

  sensitivity = signal(1.2);
  responseCurve = signal<'linear' | 'polynomial' | 'fractal'>('polynomial');
  backgroundImageUrl = signal<string | null>(null);
  private smoothedBars = new Array(64).fill(0);
  
  decayFactor = signal(0.94); // Base decay factor for visualizer bars
  private readonly resizeListener = () => this.updateDecayFactor();

  // --- Ticker Properties ---
  tickerMessages: string[] = [
    'Welcome to the Audio Oasis Equalizer...',
    'Tip: You can set a custom background for the visualizer.',
    'Tip: Tune the Graphic equalizer controls for an enhanced listening experience.',
    'Tip: Choose various styles from the drop down for an enhanced visual experience.',
    'By Mr. Muthukumaran Azhagesan ( Kumar ), https://linktr.ee/muthukumaran.azhagesan',
  ];

  currentTickerMessage = signal(this.tickerMessages[0]);
  tickerDirection = signal<'left' | 'right'>('left');
  private tickerInterval: any;
  animationClass = computed(() => 'animate-' + this.tickerDirection());
  
  // --- Auto-Switching Properties ---
  isAutoSwitching = signal(false);
  switchInterval = signal(10000); // ms
  switchMode = signal<'sequential' | 'random'>('sequential');
  private themeSwitchIntervalId: any = null;

  // --- LED Theme Controls ---
  ledBarSpacing = signal(0.5); // in px
  ledSegmentSpacing = signal(0.5); // in px
  ledSegmentWidth = signal(8); // in px was 8
  ledSegmentHeight = signal(4); // in px was 4
  isKaleidoscope = signal(false);
  kaleidoscopeHueShift = signal(0);
  private kaleidoscopeAnimFrameId: number | null = null;

  // --- Opportunistic Ticker ---
  showOpportunisticTicker = signal(false);
  opportunisticTickerMessage = signal('Audio Oasis :: Built by Muthukumaran Azhagesan (Kumar). check his Linktree for his many AI apps and projects');
  private showTickerTimeout: any;
  private hideTickerTimeout: any;

  constructor() {
    // Effect for Auto-Switching Themes
    effect(() => {
      if (this.isAutoSwitching()) {
        this.startAutoSwitching();
      } else {
        this.stopAutoSwitching();
      }
    });

    // Effect for Kaleidoscope Animation
    effect(() => {
      if (this.isKaleidoscope() && this.selectedTheme().type === 'led' && this.isPlaying()) {
        this.startKaleidoscope();
      } else {
        this.stopKaleidoscope();
      }
    });
  }

  ngOnInit(): void {
    this.updateDecayFactor();
    window.addEventListener('resize', this.resizeListener);
    this.setupTicker();
    this.scheduleOpportunisticTicker();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeListener);
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    this.stopAutoSwitching();
    this.stopKaleidoscope();
    clearTimeout(this.showTickerTimeout);
    clearTimeout(this.hideTickerTimeout);
  }

  private setupTicker(): void {
    this.tickerDirection.set(Math.random() > 0.5 ? 'left' : 'right');
    let messageIndex = 0;
    this.tickerInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % this.tickerMessages.length;
      this.currentTickerMessage.set(this.tickerMessages[messageIndex]);
    }, 15000);
  }

  private scheduleOpportunisticTicker(): void {
    clearTimeout(this.showTickerTimeout);
    clearTimeout(this.hideTickerTimeout);
    
    const randomDelay = Math.random() * 30000 + 15000; // Between 15s and 45s

    this.showTickerTimeout = setTimeout(() => {
      this.showOpportunisticTicker.set(true);
      
      this.hideTickerTimeout = setTimeout(() => {
        this.showOpportunisticTicker.set(false);
        this.scheduleOpportunisticTicker(); // Schedule the next one
      }, 12000); // Show for 12 seconds
    }, randomDelay);
  }

  private updateDecayFactor(): void {
    const width = window.innerWidth;
    const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
    const map = (val: number, in_min: number, in_max: number, out_min: number, out_max: number) =>
      ((val - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;

    const minWidth = 320;
    const maxWidth = 2560;
    const minDecay = 0.92;
    const maxDecay = 0.97;
    const decay = map(width, minWidth, maxWidth, minDecay, maxDecay);
    this.decayFactor.set(clamp(decay, minDecay, maxDecay));
  }

  visualizerBars = computed(() => {
    const data = this.audioService.frequencyData();
    const sensitivityValue = this.sensitivity();
    const responseCurveType = this.responseCurve();
    const baseDecay = this.decayFactor();
    const bars = 64;
    const output = new Array(bars);
    const logLength = Math.log(data.length);
    let lastIndex = 0;

    for (let i = 0; i < bars; i++) {
        let index = Math.floor(Math.exp(((i + 1) / bars) * logLength));
        if (index <= lastIndex) {
            index = lastIndex + 1;
        }
        index = Math.min(index, data.length);
        const slice = data.slice(lastIndex, index);
        let normalizedValue = 0;
        if (slice.length > 0) {
            const peak = Math.max(...slice);
            normalizedValue = Math.max(0, Math.min(1, (peak / 255) * sensitivityValue));
        }

        // Apply the response curve
        if (responseCurveType === 'polynomial') {
            normalizedValue = Math.pow(normalizedValue, 2); // Using x^2 for a punchy feel
        } else if (responseCurveType === 'fractal') {
            // Creates a wavy, organic-like modulation on the bars
            const modulation = 0.7 + 0.3 * Math.abs(Math.sin((i / bars) * Math.PI * 4));
            normalizedValue = Math.pow(normalizedValue, 1.2) * modulation;
        }
        
        const currentValue = this.smoothedBars[i];
        if (normalizedValue >= currentValue) {
            this.smoothedBars[i] = normalizedValue;
        } else {
            let finalDecay = baseDecay;
            if (i < bars * 0.15) {
                finalDecay = Math.min(0.99, baseDecay + 0.02);
            } else if (i > bars * 0.7) {
                finalDecay = Math.max(0.85, baseDecay - 0.08);
            }
            this.smoothedBars[i] = currentValue * finalDecay;
        }
        output[i] = this.smoothedBars[i];
        lastIndex = index;
    }
    return output;
  });

  fractalCircles = computed(() => {
    const bars = this.visualizerBars();
    const count = bars.length;
    const viewboxWidth = 640;
    const viewboxHeight = 160;

    const barWidth = viewboxWidth / count;
    const maxRadius = barWidth / 2 * 1.8; // Allow overlap

    return bars.map((height, i) => {
      const radius = Math.max(0.5, height * maxRadius);
      return {
        id: `circle-${i}`,
        cx: i * barWidth + barWidth / 2,
        cy: viewboxHeight - radius, // Position circle's bottom edge near the baseline
        r: radius,
      };
    });
  });

  ledBars = computed(() => {
    const bars = this.visualizerBars();
    const segments = 16;
    return bars.map(barHeight => Math.floor(barHeight * segments));
  });

  bandFrequencies = ['60', '170', '310', '600', '1k', '3k', '6k'];

  themes: EqualizerTheme[] = [
    { name: 'Onkyo', type: '3d', base: 'bg-black', display: 'bg-gray-900/70', bar: 'bg-gradient-to-t from-cyan-600 to-cyan-300 shadow-[0_0_4px_#22d3ee]', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-gray-300', text: 'text-gray-300', accent: 'text-cyan-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-800' },
    { name: 'Technics', type: '3d', base: 'bg-gray-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-amber-600 to-amber-400 shadow-[0_0_4px_#f59e0b]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-amber-500', text: 'text-amber-100', accent: 'text-amber-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-700/50' },
    { name: 'Pioneer', type: 'shadow', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-[-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'McIntosh', type: '3d', base: 'bg-gray-900', display: 'bg-black/90', bar: 'bg-gradient-to-t from-sky-600 to-sky-300 shadow-[0_0_5px_#38bdf8]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-green-500', text: 'text-green-400', accent: 'text-sky-400', button: 'bg-gray-800 border border-gray-600', buttonHover: 'hover:bg-gray-700', highlight: 'bg-gray-700/50' },
    { name: 'Cyberpunk', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bar-neon-glow bg-cyan-400', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-fuchsia-500', text: 'text-fuchsia-400 font-mono', accent: 'text-cyan-300', button: 'bg-gray-900 border border-fuchsia-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-fuchsia-600/50' },
    { name: 'Aqua Gloss', type: 'glossy', base: 'bg-gray-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-teal-500 to-cyan-400', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-cyan-300', text: 'text-gray-200', accent: 'text-cyan-300', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-cyan-600/50' },
    { name: 'Liquid Sky', type: 'glass', base: 'bg-gradient-to-b from-slate-900 to-sky-900', display: 'bg-black/20', bar: 'rounded-t-md', sliderTrack: 'bg-sky-800/50', sliderThumb: 'bg-slate-300', text: 'text-slate-200', accent: 'text-sky-300', button: 'bg-sky-900/50', buttonHover: 'hover:bg-sky-800/50', highlight: 'bg-sky-700/50' },
    { name: 'Matrix', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bg-gradient-to-t from-emerald-700 to-green-400 shadow-[-1px_0_4px_rgba(0,0,0,0.7)]', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-green-500', text: 'text-green-400 font-mono', accent: 'text-green-300', button: 'bg-gray-900 border border-green-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-green-600/50' },
    { name: 'Cosmic Rift', type: '3d', base: 'bg-gradient-to-br from-indigo-900 via-purple-900 to-black', display: 'bg-black/40', bar: 'bg-gradient-to-t from-fuchsia-600 to-cyan-400 shadow-[0_0_6px_#a855f7]', sliderTrack: 'bg-purple-800/50', sliderThumb: 'bg-fuchsia-500', text: 'text-purple-300', accent: 'text-cyan-300', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-fuchsia-500/50' },
    { name: 'Celestial Sphere', type: 'fractal', base: 'bg-gradient-to-br from-gray-900 via-blue-900 to-black', display: 'bg-black/40', bar: '', sliderTrack: 'bg-blue-800/50', sliderThumb: 'bg-sky-500', text: 'text-sky-300', accent: 'text-cyan-300', button: 'bg-blue-900/70', buttonHover: 'hover:bg-blue-800/70', highlight: 'bg-sky-500/50' },
    { name: 'Molten Core', type: 'glossy', base: 'bg-stone-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-red-700 via-orange-500 to-yellow-400', sliderTrack: 'bg-red-900/50', sliderThumb: 'bg-amber-400', text: 'text-amber-300', accent: 'text-orange-400', button: 'bg-orange-800/50', buttonHover: 'hover:bg-orange-700/50', highlight: 'bg-yellow-500/50' },
    { name: 'Ocean Floor', type: 'glass', base: 'bg-gradient-to-t from-blue-900 to-teal-900', display: 'bg-black/30', bar: 'rounded-t-md', sliderTrack: 'bg-cyan-800/50', sliderThumb: 'bg-teal-300', text: 'text-cyan-200', accent: 'text-teal-300', button: 'bg-cyan-900/60', buttonHover: 'hover:bg-cyan-800/60', highlight: 'bg-teal-600/50' },
    { name: 'Classic LED', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gray-700', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-400', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50' },
  ];
  selectedTheme: WritableSignal<EqualizerTheme> = signal(this.themes[0]);
  
  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.audioService.loadFiles(input.files);
    }
  }

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

  onPlayPauseClick(): void {
    if (!this.isPlaying() && this.currentTrack()) {
      if (window.innerWidth < 1024) {
        setTimeout(() => {
          document.getElementById('visualizer-section')?.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center'
          });
        }, 50);
      }
    }
    this.audioService.togglePlay();
  }

  onGainChange(event: Event, index: number) {
    const gain = parseFloat((event.target as HTMLInputElement).value);
    this.audioService.changeGain(index, gain);
  }

  onSeek(event: Event) {
    const time = parseFloat((event.target as HTMLInputElement).value);
    this.audioService.seek(time);
  }

  onSensitivityChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.sensitivity.set(value);
  }

  setResponseCurve(curve: 'linear' | 'polynomial' | 'fractal') {
    this.responseCurve.set(curve);
  }

  selectTheme(index: string) {
    const themeIndex = parseInt(index, 10);
    if (!isNaN(themeIndex) && themeIndex >= 0 && themeIndex < this.themes.length) {
      this.selectedTheme.set(this.themes[themeIndex]);
    }
  }
  
  toggleAutoSwitch() {
    this.isAutoSwitching.update(v => !v);
  }
  
  setSwitchInterval(event: Event) {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.switchInterval.set(value);
  }

  setSwitchMode(mode: 'sequential' | 'random') {
    this.switchMode.set(mode);
  }

  private startAutoSwitching(): void {
    this.stopAutoSwitching(); // Ensure no multiple intervals are running
    this.themeSwitchIntervalId = setInterval(() => {
        this.selectNextTheme();
    }, this.switchInterval());
  }

  private stopAutoSwitching(): void {
      if (this.themeSwitchIntervalId) {
          clearInterval(this.themeSwitchIntervalId);
          this.themeSwitchIntervalId = null;
      }
  }

  private selectNextTheme(): void {
    const currentTheme = this.selectedTheme();
    const currentIndex = this.themes.findIndex(t => t.name === currentTheme.name);
    let nextIndex: number;

    if (this.switchMode() === 'sequential') {
        nextIndex = (currentIndex + 1) % this.themes.length;
    } else { // random
        do {
            nextIndex = Math.floor(Math.random() * this.themes.length);
        } while (nextIndex === currentIndex && this.themes.length > 1);
    }

    this.selectedTheme.set(this.themes[nextIndex]);
  }

  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  // --- LED Control Methods ---
  incrementLedWidth() {
    this.ledSegmentWidth.update(w => Math.min(24, w + 1));
  }
  decrementLedWidth() {
    this.ledSegmentWidth.update(w => Math.max(2, w - 1));
  }
  incrementLedHeight() {
    this.ledSegmentHeight.update(h => Math.min(16, h + 1));
  }
  decrementLedHeight() {
    this.ledSegmentHeight.update(h => Math.max(1, h - 1));
  }
  toggleKaleidoscope() {
    this.isKaleidoscope.update(k => !k);
  }

  private startKaleidoscope() {
    if (this.kaleidoscopeAnimFrameId !== null) return;
    const animate = () => {
      this.kaleidoscopeHueShift.update(h => (h + 0.5) % 360);
      this.kaleidoscopeAnimFrameId = requestAnimationFrame(animate);
    };
    animate();
  }

  private stopKaleidoscope() {
    if (this.kaleidoscopeAnimFrameId !== null) {
      cancelAnimationFrame(this.kaleidoscopeAnimFrameId);
      this.kaleidoscopeAnimFrameId = null;
    }
  }
}