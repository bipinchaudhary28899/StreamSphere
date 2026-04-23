import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Coordinates playback priority across the page so only one source
 * plays audio at a time.
 *
 * Priority: hovered video-card preview  >  hero carousel
 *
 * Video-card previews are always muted, but they should still cause the
 * carousel to pause so the two don't fight for attention.  When the last
 * hovered card loses focus the carousel resumes automatically.
 */
@Injectable({ providedIn: 'root' })
export class MediaManagerService {
  /** Number of card thumbnails currently being hovered */
  private activeHovers = 0;

  private readonly _pauseCarousel$  = new Subject<void>();
  private readonly _resumeCarousel$ = new Subject<void>();

  /** Carousel should pause — emits when the first card hover starts */
  readonly pauseCarousel$  = this._pauseCarousel$.asObservable();

  /** Carousel may resume — emits when the last card hover ends */
  readonly resumeCarousel$ = this._resumeCarousel$.asObservable();

  /** Called by VideoCardComponent on mouseenter */
  cardHoverStart(): void {
    this.activeHovers++;
    if (this.activeHovers === 1) {
      this._pauseCarousel$.next();
    }
  }

  /** Called by VideoCardComponent on mouseleave */
  cardHoverEnd(): void {
    this.activeHovers = Math.max(0, this.activeHovers - 1);
    if (this.activeHovers === 0) {
      this._resumeCarousel$.next();
    }
  }
}
