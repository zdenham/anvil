/**
 * ScrollCoordinator — single source of truth for auto-scroll decisions.
 *
 * Uses a custom exponential-decay animation loop instead of browser
 * smooth scroll. Browser `scrollTo({ behavior: "smooth" })` gets
 * cancelled and restarted on every content change during streaming,
 * causing visible jumpiness. This animation loop simply retargets
 * to the new scrollHeight each frame, producing fluid motion.
 */

export interface ScrollCoordinatorOptions {
  onStickyChange?: (sticky: boolean) => void;
  /** Distance from bottom to count as "near bottom" for re-engage */
  reengageThreshold?: number;
  /** Fraction of remaining gap closed per frame (0–1). Higher = snappier. Default 0.22 */
  lerpFactor?: number;
}

export class ScrollCoordinator {
  private _sticky = true;
  private _animationId: number | null = null;
  private _scrollElement: HTMLElement | null = null;
  private _reengageThreshold: number;
  private _lerpFactor: number;
  private _onStickyChange?: (sticky: boolean) => void;

  constructor(options: ScrollCoordinatorOptions = {}) {
    this._onStickyChange = options.onStickyChange;
    this._reengageThreshold = options.reengageThreshold ?? 20;
    this._lerpFactor = options.lerpFactor ?? 0.22;
  }

  get isSticky(): boolean {
    return this._sticky;
  }

  attach(el: HTMLElement): void {
    this._scrollElement = el;
  }

  detach(): void {
    this._scrollElement = null;
    this._stopAnimation();
  }

  /** Content height increased — ensure animation is chasing the new bottom. */
  onContentGrew(): void {
    if (!this._sticky) return;
    this._ensureAnimating();
  }

  /** New item added — ensure animation is chasing the new bottom. */
  onItemAdded(): void {
    if (!this._sticky) return;
    this._ensureAnimating();
  }

  /** User explicitly scrolled up (wheel or scrollbar drag). */
  onUserScrolledUp(): void {
    this._setSticky(false);
  }

  /** Called on every scroll event with the current gap from bottom. */
  onScrollPositionChanged(gap: number): void {
    if (!this._sticky && gap <= this._reengageThreshold) {
      this._setSticky(true);
    }
  }

  /** Programmatic re-engage (e.g., "scroll to bottom" button). */
  setSticky(value: boolean): void {
    this._setSticky(value);
  }

  // -- Private --

  private _setSticky(value: boolean): void {
    if (this._sticky === value) return;
    this._sticky = value;
    if (!value) this._stopAnimation();
    this._onStickyChange?.(value);
  }

  private _ensureAnimating(): void {
    if (this._animationId !== null) return;
    this._animationId = requestAnimationFrame(this._tick);
  }

  private _tick = (): void => {
    const el = this._scrollElement;
    if (!el || !this._sticky) {
      this._animationId = null;
      return;
    }

    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap <= 0.5) {
      this._animationId = null;
      return;
    }

    el.scrollTop += Math.ceil(gap * this._lerpFactor);

    this._animationId = requestAnimationFrame(this._tick);
  };

  private _stopAnimation(): void {
    if (this._animationId !== null) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
  }
}
