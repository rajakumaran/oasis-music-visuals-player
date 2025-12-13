import { Component, ChangeDetectionStrategy, input, signal, OnInit, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-fullscreen-toggle',
  standalone: true,
  template: `
    <button (click)="toggleFullscreen()" 
            [title]="isFullscreen() ? 'Exit Fullscreen' : 'Enter Fullscreen'" 
            class="absolute top-2 right-2 z-10 p-2 text-white/50 hover:text-white/90 transition-colors">
      <i class="fa-solid text-lg" [class]="isFullscreen() ? 'fa-compress' : 'fa-expand'"></i>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FullscreenToggleComponent implements OnInit, OnDestroy {
  targetElementId = input.required<string>();
  isFullscreen = signal(false);

  private readonly fullscreenChangeHandler = () => {
    this.isFullscreen.set(!!document.fullscreenElement);
  };

  ngOnInit() {
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
  }

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
  }

  toggleFullscreen(): void {
    const elem = document.getElementById(this.targetElementId());
    if (!elem) {
      console.error('Fullscreen target element not found:', this.targetElementId());
      return;
    }

    if (!document.fullscreenElement) {
      elem.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }
}
