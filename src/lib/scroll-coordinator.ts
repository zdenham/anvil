/**
 * ScrollCoordinator — single source of truth for auto-scroll decisions.
 *
 * Replaces the two competing effects in useVirtualList:
 * - followCountChange (count increase → smooth scroll)
 * - followOutput subscriber (height change → auto scroll)
 *
 * Key property: multiple signals in the same frame → single scrollTo call.
 * Last behavior wins (onItemAdded "smooth" vs onContentGrew "auto").
 */

export interface ScrollCoordinatorOptions {
  onStickyChange?: (sticky: boolean) => void;
  /** Distance from bottom to count as "near bottom" for re-engage */
  reengageThreshold?: number;
}

export class ScrollCoordinator {
  private _sticky = true;
  private _rafId: number | null = null;
  private _pendingBehavior: ScrollBehavior | null = null;
  private _scrollElement: HTMLElement | null = null;
  private _reengageThreshold: number;
  private _onStickyChange?: (sticky: boolean) => void;

  constructor(options: ScrollCoordinatorOptions = {}) {
    this._onStickyChange = options.onStickyChange;
    this._reengageThreshold = options.reengageThreshold ?? 20;
  }

  get isSticky(): boolean {
    return this._sticky;
  }

  attach(el: HTMLElement): void {
    this._scrollElement = el;
  }

  detach(): void {
    this._scrollElement = null;
    this._cancelPending();
  }

  /** Content height increased (ResizeObserver / height measurement).
   *  Use "auto" (instant) to avoid visible lag during streaming. */
  onContentGrew(): void {
    if (!this._sticky) return;
    this._schedule("auto");
  }

  /** New item added (count increased).
   *  Use "smooth" for a polished transition when new blocks appear. */
  onItemAdded(): void {
    if (!this._sticky) return;
    this._schedule("smooth");
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
    this._onStickyChange?.(value);
  }

  private _schedule(behavior: ScrollBehavior): void {
    this._pendingBehavior = behavior;
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      const b = this._pendingBehavior;
      this._pendingBehavior = null;
      if (!b || !this._scrollElement) return;
      const el = this._scrollElement;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap > 1) {
        el.scrollTo({ top: el.scrollHeight, behavior: b });
      }
    });
  }

  private _cancelPending(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._pendingBehavior = null;
  }
}
