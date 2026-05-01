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
    // screen.orientation 'change' fires on Android Chrome for both physical and programmatic rotation
    (screen.orientation as any)?.addEventListener('change', this.fullscreenChangeHandler);
  }

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    (screen.orientation as any)?.removeEventListener('change', this.fullscreenChangeHandler);
  }

  toggleFullscreen(): void {
    const elem = document.getElementById(this.targetElementId());
    if (!elem) {
      console.error('Fullscreen target element not found:', this.targetElementId());
      return;
    }

    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isNativeFullscreen = !!document.fullscreenElement;
    const isIosFullscreen = elem.classList.contains('fullscreen-ios');

    if (isNativeFullscreen || isIosFullscreen) { // EXIT
      if (isIosFullscreen) {
        elem.classList.remove('fullscreen-ios');
        document.body.classList.remove('fullscreen-ios-body');
        this.isFullscreen.set(false); // Manually update for iOS
      }
      if (isNativeFullscreen && document.exitFullscreen) {
        document.exitFullscreen().then(() => {
          // Unlock orientation when leaving fullscreen
          try { (screen.orientation as any)?.unlock(); } catch (_) { }
        }).catch(() => { });
      }
    } else { // ENTER
      if (isIos) {
        elem.classList.add('fullscreen-ios');
        document.body.classList.add('fullscreen-ios-body');
        this.isFullscreen.set(true); // Manually update for iOS
      } else if (elem.requestFullscreen) {
        elem.requestFullscreen().then(() => {
          // Attempt to lock landscape on Android — silently ignore if unsupported
          try {
            (screen.orientation as any)?.lock('landscape').catch(() => { });
          } catch (_) { }
        }).catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
      }
    }
  }
}