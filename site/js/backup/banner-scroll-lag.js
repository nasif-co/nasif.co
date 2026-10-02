/* Lazy scroll following for the banners ------------------------------------
   EXPERIMENT. Writes a pixel value into --scroll-offset on every
   .banner-wrapper and does nothing else. The CSS decides what to do with it:

       @property --scroll-offset {
           syntax: '<length>'; inherits: false; initial-value: 0px;
       }
       .banner-wrapper { transform: translateY(var(--scroll-offset, 0px)); }

   Registering it with inherits:false matters: custom properties inherit by
   default, so an unregistered one invalidates style for the whole .banner
   subtree on every frame.

   Scrolling drags the banner off its pinned position, and the offset then
   decays back to zero, so it trails the scroll and catches up once you stop.

   The banner stays position:sticky. Sticky still handles the hard part, which
   is pinning it and releasing it at the end of its project, and a transform
   does not affect layout, so none of that changes.

   The lag is confined to the banner's track, the path sticky moves it along
   anyway, so it can trail behind but never overshoot either end of it.

   Active only with a fine pointer at 1200px wide or more. It switches on and
   off live as either condition changes, with no reload.

   Nothing in the per-frame path touches layout. Project geometry is cached in
   document space and refreshed only when the page can actually reflow.
-------------------------------------------------------------------------- */

(function () {
    'use strict';

    /* Fraction of the offset kept each frame. Higher trails further and takes
       longer to settle; lower is tighter. */
    const DECAY = 0.4;

    /* How quickly the smoothed scroll speed reacts to the raw per-frame
       figure. The main thread samples scroll at frame boundaries while the
       compositor has already moved on, so raw deltas arrive unevenly even at
       a locked frame rate. Filtering them is what removes the small jumps.
       Lower is smoother and slower to respond. */
    const VELOCITY_SMOOTHING = 0.3;

    // Ceiling in px, so a flick or a jump to an anchor cannot fling it away.
    const MAX_OFFSET = 150;

    // Below this a value is treated as zero, in px.
    const SETTLE = 0.1;

    /* Only runs with a fine pointer on a wide screen, and is fully off
       otherwise. Both conditions live in one query, so its single change
       event fires when either changes, whether the window is resized across
       1200px or a mouse is plugged into a touch device.

       A query rather than isMobile() from script.js: the width condition has
       to be part of it, and it needs to be something that can be listened to,
       which a function returning a boolean is not. It also keeps this file
       free of any dependency on script.js loading first. */
    const ENABLED_QUERY = window.matchMedia('(pointer: fine) and (min-width: 1200px)');

    let banners = [];   // { el, sticky, project, stickyTop, trackTop, trackBottom, offset, written }
    let lastScrollY = 0;
    let smoothedVelocity = 0;
    let frameId = null;
    let isEnabled = false;

    function init() {
        collect();
        if (banners.length === 0) return;

        /* Anything that can reflow the page invalidates the cached geometry.
           Images are covered by their width/height attributes, which reserve
           space before they decode, so load is mostly a safety net. The font
           swap is the one that genuinely moves things. Skipped while switched
           off, since enable() measures fresh anyway. */
        window.addEventListener('resize', measureIfEnabled);
        window.addEventListener('load', measureIfEnabled);
        if (document.fonts) document.fonts.ready.then(measureIfEnabled);

        syncWithQuery();
        ENABLED_QUERY.addEventListener('change', syncWithQuery);
    }

    function syncWithQuery() {
        if (ENABLED_QUERY.matches) {
            enable();
        } else {
            disable();
        }
    }

    function enable() {
        if (isEnabled) return;
        isEnabled = true;

        // The layout may have changed while it was off, not least its width.
        measure();

        /* Start from where the page is now. Otherwise the first frame would
           treat all the scrolling done while switched off as one enormous
           jump and fling the banners. */
        lastScrollY = window.scrollY;
        smoothedVelocity = 0;

        banners.forEach((banner) => {
            banner.offset = 0;
            write(banner);
        });

        window.addEventListener('scroll', startLoop, { passive: true });
    }

    /* Stops everything and leaves the banners exactly as they would be
       without this script. */
    function disable() {
        if (!isEnabled) return;
        isEnabled = false;

        window.removeEventListener('scroll', startLoop);
        if (frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
        }
        smoothedVelocity = 0;

        /* Removed rather than set to 0px. The CSS registers --scroll-offset
           with an initial value of 0px, so this falls back to that and leaves
           no inline style behind. */
        banners.forEach((banner) => {
            banner.offset = 0;
            banner.written = null;
            banner.el.style.removeProperty('--scroll-offset');
        });
    }

    function measureIfEnabled() {
        if (isEnabled) measure();
    }

    // Built once, so measure() can refresh geometry without losing offsets.
    function collect() {
        /* Two different elements. The offset is written to the wrapper, which
           is what moves, but the sticky offset has to be read from .banner,
           which is the element that actually sticks. The wrapper is
           position:absolute with top:0, so reading top from it gives 0. */
        banners = Array.from(document.querySelectorAll('.banner-wrapper')).map((el) => ({
            el: el,
            sticky: el.closest('.banner'),
            project: el.closest('.project'),
            stickyTop: 0,
            trackTop: 0,
            trackBottom: Infinity,
            offset: 0,
            written: null,
        }));
    }

    /* Measures the track: the stretch of the page the sticky .banner travels
       along. trackTop is where it sits before it pins, trackBottom is where
       sticky leaves it once released, both as the .banner's top edge in
       document space.

       Stored in document space so the per-frame work is arithmetic against
       scrollY rather than a getBoundingClientRect() call, which would force
       layout on every frame. */
    function measure() {
        const scrollY = window.scrollY;

        banners.forEach((banner) => {
            const stickyEl = banner.sticky || banner.el;
            banner.stickyTop = parseFloat(getComputedStyle(stickyEl).top) || 0;

            if (!banner.project) return;

            const rect = banner.project.getBoundingClientRect();
            const projectStyle = getComputedStyle(banner.project);
            const stickyStyle = getComputedStyle(stickyEl);
            const px = (value) => parseFloat(value) || 0;

            // Sticky keeps the .banner's margin box inside the project's content box.
            const contentTop = rect.top + scrollY
                + px(projectStyle.borderTopWidth) + px(projectStyle.paddingTop);
            const contentBottom = rect.bottom + scrollY
                - px(projectStyle.borderBottomWidth) - px(projectStyle.paddingBottom);

            banner.trackTop = contentTop + px(stickyStyle.marginTop);

            /* The .banner's own height matters here. Sticky lets go once its
               bottom edge, not its top, reaches the end of the project, so
               the release happens a full banner height before the project's
               bottom meets the sticky line. offsetHeight is a layout value,
               so the transforms on and inside the banner don't affect it. */
            banner.trackBottom = Math.max(
                banner.trackTop,
                contentBottom - px(stickyStyle.marginBottom) - stickyEl.offsetHeight
            );
        });
    }

    /* The track converted to viewport coordinates for the current scroll,
       plus where sticky is holding the banner right now before any lag. It
       rests at the sticky line while pinned, and at whichever end of the
       track it has run into otherwise. */
    function getTrackOnScreen(banner, scrollY) {
        const top = banner.trackTop - scrollY;
        const bottom = banner.trackBottom - scrollY;
        const resting = Math.min(Math.max(banner.stickyTop, top), bottom);
        return { top: top, bottom: bottom, resting: resting };
    }

    function startLoop() {
        if (frameId === null) frameId = requestAnimationFrame(step);
    }

    function step() {
        frameId = null;

        /* Read from the page rather than accumulating scroll events, so a
           frame that swallowed several events still lands on the right place. */
        const scrollY = window.scrollY;
        const delta = scrollY - lastScrollY;
        lastScrollY = scrollY;

        // Feed the filtered speed to the banners, never the raw delta.
        smoothedVelocity += (delta - smoothedVelocity) * VELOCITY_SMOOTHING;

        let stillMoving = false;

        banners.forEach((banner) => {
            const track = getTrackOnScreen(banner, scrollY);
            const isPinned = track.top <= banner.stickyTop && banner.stickyTop <= track.bottom;

            /* Only a pinned banner is being held in place against the scroll,
               so only it has anything to lag behind. An unpinned one is
               already travelling with the page, and offsetting it just makes
               it wobble. It keeps decaying, so it eases back to rest rather
               than snapping the moment it comes unpinned.

               Negative because scrolling down should leave the banner behind,
               higher up the screen, before it settles back down to its pinned
               spot. Flip the sign in the CSS if the opposite reads better. */
            if (isPinned) banner.offset -= smoothedVelocity;

            // The catching up.
            banner.offset *= DECAY;
            banner.offset = Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, banner.offset));

            /* Never let the lag carry the banner off its track. Right after it
               pins, the project's top has only just passed the sticky line, but
               the smoothed speed is already at full scroll speed, so the lag
               would lift the banner above where it sat a moment ago. The same
               happens in reverse at the bottom. Clamping the drawn position to
               the track means the banner can trail behind, but only within the
               path it would travel anyway. The limits move smoothly with the
               scroll, so a clamped banner slides along them rather than
               jumping. */
            const mostUpward = track.top - track.resting;
            const mostDownward = track.bottom - track.resting;
            banner.offset = Math.min(mostDownward, Math.max(mostUpward, banner.offset));

            if (Math.abs(banner.offset) < SETTLE) {
                banner.offset = 0;
            } else {
                stillMoving = true;
            }

            write(banner);
        });

        if (stillMoving || Math.abs(smoothedVelocity) >= SETTLE) {
            frameId = requestAnimationFrame(step);
        } else {
            // Everything has come to rest; idle until the next scroll.
            smoothedVelocity = 0;
        }
    }

    /* Skips the write when the value has not changed, which is every frame for
       a parked banner and for any frame the rounding swallowed. */
    function write(banner) {
        const value = `${banner.offset.toFixed(2)}px`;
        if (value === banner.written) return;

        banner.written = value;
        banner.el.style.setProperty('--scroll-offset', value);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
