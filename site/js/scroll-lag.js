/* Scroll lag ----------------------------------------------------------------
   Writes a pixel value into --scroll-offset on an element and does nothing
   else. The CSS decides what to do with it:

       @property --scroll-offset {
           syntax: '<length>'; inherits: false; initial-value: 0px;
       }
       .banner-wrapper { transform: translateY(var(--scroll-offset, 0px)); }

   Registering it with inherits:false matters: custom properties inherit by
   default, so an unregistered one invalidates the whole subtree every frame.

   Scrolling drags the sticky element off its pinned position and the offset
   decays back to zero, so it trails the scroll and catches up once you stop.
   The element stays sticky throughout; sticky still pins it and releases it at
   the end of its container, and a transform does not affect layout.

   The lag is confined to the track, the path sticky moves the element along
   anyway, so it trails but never overshoots either end.

   One instance per target, below. Each runs only where its own media query
   matches, switching live as the window or the pointer changes. Nothing in the
   per-frame path touches layout.

   Lives for one page. Barba starts fresh ones after every transition.
-------------------------------------------------------------------------- */

/* Targets. Each names the element that receives --scroll-offset, the sticky
   element whose movement is being lagged, and the container bounding its
   travel.

   sticky and container are selectors matched with closest(), so a target can
   name an ancestor or, with null, the element itself.

   enabledQuery is the condition to RUN under, not the one to switch off for.
   Inverting a comma list means and-ing the negations, since not (A or B) is
   (not A) and (not B). */

const BANNER_LAG_TARGET = {
    selector: '.banner-wrapper',
    sticky: '.banner',
    container: '.project',
    enabledQuery: '(pointer: fine)',
};

const BULLET_LAG_TARGET = {
    selector: '.project-bullet',
    sticky: null,                // it does its own sticking
    container: '.bullet-track',
    // Landscape and wider than 450px, the inverse of the layouts that do not
    // want it. Range syntax, so the boundaries leave no gap.
    enabledQuery: '(pointer: fine) and (aspect-ratio > 1) and (width > 450px)',
};

// Fraction of the offset kept each frame. Higher trails further.
const LAG_DECAY = 0.4;

/* How fast the smoothed scroll speed reacts to the raw per-frame figure. The
   main thread samples scroll at frame boundaries while the compositor has
   moved on, so raw deltas arrive unevenly even at a locked frame rate. */
const LAG_VELOCITY_SMOOTHING = 0.3;

// Ceiling in px, so a flick or a jump to an anchor cannot fling it away.
const LAG_MAX_OFFSET = 150;

// Below this a value is treated as zero, in px.
const LAG_SETTLE = 0.1;

class ScrollLag {

    constructor(target) {
        this.target = target;

        /* Both conditions in one query, so its single change event covers a
           window crossing the width and a mouse being plugged into a touch
           device alike. */
        this.enabledQuery = window.matchMedia(target.enabledQuery);

        this.items = [];   // { el, stickyEl, container, stickyTop, trackTop, trackBottom, offset, written }
        this.lastScrollY = 0;
        this.smoothedVelocity = 0;
        this.frameId = null;
        this.enabled = false;

        this.handleQueryChange = this.handleQueryChange.bind(this);
        this.startLoop = this.startLoop.bind(this);
        this.step = this.step.bind(this);
    }

    start() {
        this.collect();
        if (this.items.length === 0) return;   // target not on this page

        this.handleQueryChange();
        this.enabledQuery.addEventListener('change', this.handleQueryChange);
    }

    stop() {
        this.enabledQuery.removeEventListener('change', this.handleQueryChange);
        this.disable();
        this.items = [];
    }

    // Called by the session when the page reflows: a resize or the font swap.
    refresh() {
        if (this.enabled) this.measure();
    }

    handleQueryChange() {
        if (this.enabledQuery.matches) {
            this.enable();
        } else {
            this.disable();
        }
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;

        // The layout may have changed while it was off, not least its width.
        this.measure();

        /* Start from where the page is now, or the first frame would treat all
           the scrolling done while switched off as one enormous jump. */
        this.lastScrollY = window.scrollY;
        this.smoothedVelocity = 0;

        this.items.forEach((item) => {
            item.offset = 0;
            this.write(item);
        });

        window.addEventListener('scroll', this.startLoop, { passive: true });
    }

    // Leaves the page exactly as it would be without this running.
    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        window.removeEventListener('scroll', this.startLoop);
        if (this.frameId !== null) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
        this.smoothedVelocity = 0;

        /* Removed rather than set to 0px. The CSS registers --scroll-offset
           with an initial value of 0px, so this falls back to that and leaves
           no inline style behind. */
        this.items.forEach((item) => {
            item.offset = 0;
            item.written = null;
            item.el.style.removeProperty('--scroll-offset');
        });
    }

    /* Three roles, often three different boxes. The offset is written to el,
       but the sticky offset has to be read from whatever actually sticks: for
       a banner that is the .banner ancestor, since the wrapper it moves is
       absolute with top:0. */
    collect() {
        const target = this.target;

        this.items = Array.from(activeContainer().querySelectorAll(target.selector)).map((el) => ({
            el: el,
            stickyEl: target.sticky ? el.closest(target.sticky) : el,
            container: el.closest(target.container),
            stickyTop: 0,
            trackTop: 0,
            trackBottom: Infinity,
            offset: 0,
            written: null,
        }));
    }

    /* Measures the track: the stretch of page the sticky box travels along.
       trackTop is where it sits before pinning, trackBottom where sticky lets
       go, both as its top edge in document space.

       Stored in document space so the per-frame work is arithmetic against
       scrollY rather than a getBoundingClientRect call every frame. */
    measure() {
        const scrollY = window.scrollY;
        const px = (value) => parseFloat(value) || 0;

        this.items.forEach((item) => {
            const stickyStyle = getComputedStyle(item.stickyEl);
            item.stickyTop = px(stickyStyle.top);

            if (!item.container) return;

            const rect = item.container.getBoundingClientRect();
            const containerStyle = getComputedStyle(item.container);

            // Sticky keeps the margin box inside the container's content box.
            const contentTop = rect.top + scrollY
                + px(containerStyle.borderTopWidth) + px(containerStyle.paddingTop);
            const contentBottom = rect.bottom + scrollY
                - px(containerStyle.borderBottomWidth) - px(containerStyle.paddingBottom);

            item.trackTop = contentTop + px(stickyStyle.marginTop);

            /* Its own height matters: sticky lets go once its bottom edge, not
               its top, reaches the end of the container. A computed height is
               a layout value, so transforms do not affect it. */
            item.trackBottom = Math.max(
                item.trackTop,
                contentBottom - px(stickyStyle.marginBottom) - px(stickyStyle.height)
            );
        });
    }

    /* The track in viewport coordinates, plus where sticky is holding the box
       before any lag: the sticky line while pinned, or whichever end of the
       track it has run into. */
    trackOnScreen(item, scrollY) {
        const top = item.trackTop - scrollY;
        const bottom = item.trackBottom - scrollY;
        return {
            top: top,
            bottom: bottom,
            resting: Math.min(Math.max(item.stickyTop, top), bottom),
        };
    }

    startLoop() {
        if (this.frameId === null) this.frameId = requestAnimationFrame(this.step);
    }

    step() {
        this.frameId = null;

        /* Read from the page rather than accumulating scroll events, so a
           frame that swallowed several still lands in the right place. */
        const scrollY = window.scrollY;
        const delta = scrollY - this.lastScrollY;
        this.lastScrollY = scrollY;

        // Feed the filtered speed to the items, never the raw delta.
        this.smoothedVelocity += (delta - this.smoothedVelocity) * LAG_VELOCITY_SMOOTHING;

        let stillMoving = false;

        this.items.forEach((item) => {
            const track = this.trackOnScreen(item, scrollY);
            const isPinned = track.top <= item.stickyTop && item.stickyTop <= track.bottom;

            /* Only a pinned box is held against the scroll, so only it has
               anything to lag behind. An unpinned one already travels with the
               page. It keeps decaying, so it eases back to rest rather than
               snapping the moment it comes unpinned.

               Negative because scrolling down should leave it behind, higher
               up the screen. Flip the sign in the CSS to reverse it. */
            if (isPinned) item.offset -= this.smoothedVelocity;

            // The catching up.
            item.offset *= LAG_DECAY;
            item.offset = Math.min(LAG_MAX_OFFSET, Math.max(-LAG_MAX_OFFSET, item.offset));

            /* Never let the lag carry it off its track. Just after it pins, the
               container's top has only cleared the sticky line by a little
               while the smoothed speed is already at full scroll speed, so the
               lag would lift it above where it sat a moment ago. The limits
               move smoothly with the scroll, so a clamped item slides along
               them rather than jumping. */
            const mostUpward = track.top - track.resting;
            const mostDownward = track.bottom - track.resting;
            item.offset = Math.min(mostDownward, Math.max(mostUpward, item.offset));

            if (Math.abs(item.offset) < LAG_SETTLE) {
                item.offset = 0;
            } else {
                stillMoving = true;
            }

            this.write(item);
        });

        if (stillMoving || Math.abs(this.smoothedVelocity) >= LAG_SETTLE) {
            this.frameId = requestAnimationFrame(this.step);
        } else {
            // Everything has come to rest; idle until the next scroll.
            this.smoothedVelocity = 0;
        }
    }

    // Skipped when unchanged, which is every frame for a parked item.
    write(item) {
        const value = `${item.offset.toFixed(2)}px`;
        if (value === item.written) return;

        item.written = value;
        item.el.style.setProperty('--scroll-offset', value);
    }
}
