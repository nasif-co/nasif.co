/* Banner reveal -------------------------------------------------------------
   Opens and closes project banners as their projects scroll past.

   Two things can open a banner. On a fine pointer the CSS does it on hover.
   On mobile there is nothing to hover with, so the observers here take over.
   Both read the same pointer query, so they are never both on or both off.

   Three observers only record what they see. updateAll() makes every decision,
   because whether a banner may open depends on the projects above it.

   Lives for one page. Barba starts a fresh one after every transition.
-------------------------------------------------------------------------- */

/* How far the pill has travelled through the project, as a fraction of the
   project's own height. Fractions of the project rather than of the viewport
   is what keeps this working when short projects make the media grid collapse. */
const BANNER_EXPAND_AT_PROGRESS = 0.20;

/* When true a banner waits to open until every other banner has finished
   collapsing, so only one is ever on screen. When false it opens the moment
   the project above clears the centre. Applies in both scroll directions. */
const BANNER_WAIT_FOR_PREVIOUS_COLLAPSE = true;

/* Every banner closes near the end of the page. In practice only the last one
   is affected, since its project may never scroll far enough to clear the
   centre. Two distances rather than one, so settling on a single threshold
   cannot flip the banner open and shut. */
const BANNER_PAGE_END_CLOSE_WITHIN_PX = 10;
const BANNER_PAGE_END_REOPEN_BEYOND_PX = 30;

/* How far a root is grown past the viewport, so the viewport's own edges never
   clip what is being measured. Only needs to exceed the tallest project. */
const BANNER_ROOT_EXTENSION_PERCENT = 500;

const BANNER_ACTIVE_CLASS = 'banner-wrapper-active';

class BannerReveal {

    constructor() {
        // Every .banner-wrapper in document order. Order decides who may open.
        this.banners = [];
        this.states = new Map();

        this.entryObserver = null;
        this.centreObserver = null;
        this.pageEndObserver = null;

        // Decisions wait until all three have reported once.
        this.awaitingFirstReport = new Set();

        this.closeMarker = null;
        this.reopenMarker = null;
        this.closeMarkerInView = false;
        this.reopenMarkerInView = false;
        this.nearPageEnd = false;

        // How far the entry root's bottom is pulled up, to land on the pill.
        this.lineInsetPx = 0;

        // Whether the observers, rather than hover, are driving the banners.
        this.autoRevealActive = false;

        // Optional hook, called whenever a banner opens or closes.
        this.onChange = null;

        // Set while the page is leaving: no banner may open again.
        this.frozen = false;

        // Bound once, so they can be removed again.
        this.handleTransitionEnd = this.handleTransitionEnd.bind(this);
        this.handleEntryLine = this.handleEntryLine.bind(this);
        this.handleCentreLine = this.handleCentreLine.bind(this);
        this.handlePageEnd = this.handlePageEnd.bind(this);
        this.syncWithPointer = this.syncWithPointer.bind(this);
    }

    start() {
        this.banners = Array.from(activeContainer().querySelectorAll('.banner-wrapper'));
        if (this.banners.length === 0) return;

        this.banners.forEach((banner) => {
            this.states.set(banner, {
                currentState: banner.classList.contains(BANNER_ACTIVE_CLASS),
                isTransitioning: false,
                queuedState: null,
                graceTimeoutId: null,

                // Written by the observers, read by updateAll()
                reachedEntry: false,
                pastCentre: false,
            });

            // Attached once, rather than per transition.
            banner.addEventListener('transitionend', this.handleTransitionEnd);
        });

        this.syncWithPointer();

        /* Fires when the primary pointer changes without a reload, at the same
           moment the CSS switches. Removable, so the page can own it. */
        FINE_POINTER_QUERY.addEventListener('change', this.syncWithPointer);
    }

    stop() {
        FINE_POINTER_QUERY.removeEventListener('change', this.syncWithPointer);

        this.disconnectObservers();
        this.removePageEndMarkers();

        /* Unconditionally, unlike stopAutoReveal, which is for handing back to
           hover. A pending timer would otherwise fire on a detached banner. */
        this.banners.forEach((banner) => {
            const state = this.states.get(banner);
            if (state) clearTimeout(state.graceTimeoutId);
            banner.removeEventListener('transitionend', this.handleTransitionEnd);
        });

        this.banners = [];
        this.states = new Map();
        this.autoRevealActive = false;
        this.nearPageEnd = false;
    }

    /* Closes one project's banner and resolves once its circle has finished
       contracting. The page transition holds that banner back from the fade
       until this is done, so it reads as closing rather than dissolving.

       Every other banner is left exactly as it is and fades out with the rest
       of the content. Open means the class on touch, or :has(.media:hover) on a
       desktop; the transition switches pointer events off before calling this,
       so the hover rule has already stopped matching. */
    collapse(project) {
        /* Nothing may open again while the page is on its way out, including
           this banner once its own transition reports back. */
        this.frozen = true;

        const banner = project ? project.querySelector('.banner-wrapper') : null;
        if (!banner) return Promise.resolve();

        const wasOpen =
            banner.classList.contains(BANNER_ACTIVE_CLASS) ||
            project.querySelector('.media:hover') !== null;

        banner.classList.remove(BANNER_ACTIVE_CLASS);

        // Already closed, so there is nothing for the transition to wait on.
        if (!wasOpen) return Promise.resolve();

        /* A timer rather than transitionend: this banner is on its way out
           either way, and a transition that never fires would hang the whole
           navigation. */
        return new Promise((resolve) => setTimeout(resolve, this.circleDurationMs(banner)));
    }

    // Called by the session when the page reflows: a resize or the font swap.
    refresh() {
        if (this.autoRevealActive) this.buildObservers();
    }

    /* Switching between the two drivers ----------------------------------- */

    syncWithPointer() {
        if (isMobile()) {
            this.startAutoReveal();
        } else {
            this.stopAutoReveal();
        }
    }

    startAutoReveal() {
        if (this.autoRevealActive) return;
        this.autoRevealActive = true;

        // The first reports open whichever banner is in view straight away.
        this.buildObservers();
    }

    // Hands every banner back to the hover styles, closed and idle.
    stopAutoReveal() {
        if (!this.autoRevealActive) return;
        this.autoRevealActive = false;

        this.disconnectObservers();
        this.removePageEndMarkers();
        this.nearPageEnd = false;

        this.banners.forEach((banner) => {
            const state = this.states.get(banner);

            /* Clearing the queue as well as the timer. A transition still
               running fires transitionend later, and with isTransitioning
               false that is a no-op rather than starting what was queued. */
            if (state) {
                clearTimeout(state.graceTimeoutId);
                state.graceTimeoutId = null;
                state.currentState = false;
                state.isTransitioning = false;
                state.queuedState = null;
                state.reachedEntry = false;
                state.pastCentre = false;
            }

            banner.classList.remove(BANNER_ACTIVE_CLASS);
        });
    }

    /* Observers ------------------------------------------------------------ */

    buildObservers() {
        const projects = this.banners
            .map((banner) => banner.closest('.project'))
            .filter(Boolean);
        if (projects.length === 0) return;

        this.disconnectObservers();
        this.lineInsetPx = this.getLineInsetPx(this.banners[0]);

        /* Runs from far above the viewport down to the pill's bottom edge,
           which makes intersectionRatio equal the project's progress past the
           pill. The threshold sits exactly on the value we act on. */
        this.entryObserver = new IntersectionObserver(this.handleEntryLine, {
            rootMargin: `${BANNER_ROOT_EXTENSION_PERCENT}% 0px -${this.lineInsetPx}px 0px`,
            threshold: [BANNER_EXPAND_AT_PROGRESS],
        });

        /* Runs from the middle of the viewport to far below it, so the callback
           fires as a project's bottom crosses the centre. Extended downward so
           a fast scroll cannot carry a project from below the viewport to above
           the centre without ever intersecting, which would skip the callback. */
        this.centreObserver = new IntersectionObserver(this.handleCentreLine, {
            rootMargin: `-50% 0px ${BANNER_ROOT_EXTENSION_PERCENT}% 0px`,
        });

        this.placePageEndMarkers();
        this.pageEndObserver = new IntersectionObserver(this.handlePageEnd);

        projects.forEach((project) => {
            this.entryObserver.observe(project);
            this.centreObserver.observe(project);
        });
        this.pageEndObserver.observe(this.closeMarker);
        this.pageEndObserver.observe(this.reopenMarker);

        this.awaitingFirstReport = new Set([
            this.entryObserver,
            this.centreObserver,
            this.pageEndObserver,
        ]);
    }

    disconnectObservers() {
        [this.entryObserver, this.centreObserver, this.pageEndObserver]
            .forEach((observer) => { if (observer) observer.disconnect(); });

        this.entryObserver = null;
        this.centreObserver = null;
        this.pageEndObserver = null;
        this.awaitingFirstReport = new Set();
        this.closeMarkerInView = false;
        this.reopenMarkerInView = false;
    }

    handleEntryLine(entries, observer) {
        if (!this.autoRevealActive) return; // late callback from a disconnected observer

        entries.forEach((entry) => {
            const state = this.stateForProject(entry.target);
            if (!state) return;

            /* Once the project's bottom is above the pill line it has fully
               passed its entry line. Past that the root's top edge clips the
               slice instead of the project's top, so the ratio decays back
               down and would otherwise read as not reached. */
            const bottomPassed =
                entry.boundingClientRect.bottom < entry.rootBounds.bottom;

            /* Read the ratio rather than infer which way the threshold was
               crossed. A fast scroll can jump across it within one frame. */
            state.reachedEntry =
                bottomPassed || entry.intersectionRatio >= BANNER_EXPAND_AT_PROGRESS;
        });

        this.onObserverReport(observer);
    }

    handleCentreLine(entries, observer) {
        if (!this.autoRevealActive) return;

        entries.forEach((entry) => {
            const state = this.stateForProject(entry.target);
            if (!state) return;

            /* Geometry rather than isIntersecting, which is also false for a
               project so far below the viewport that it is beyond the root. */
            state.pastCentre = entry.boundingClientRect.bottom <= entry.rootBounds.top;
        });

        this.onObserverReport(observer);
    }

    handlePageEnd(entries, observer) {
        if (!this.autoRevealActive) return;

        entries.forEach((entry) => {
            if (entry.target === this.closeMarker) this.closeMarkerInView = entry.isIntersecting;
            if (entry.target === this.reopenMarker) this.reopenMarkerInView = entry.isIntersecting;
        });

        /* Between the two markers it keeps whatever it already was. That gap
           is what stops it flickering when the scroll settles on a threshold. */
        if (this.closeMarkerInView) {
            this.nearPageEnd = true;
        } else if (!this.reopenMarkerInView) {
            this.nearPageEnd = false;
        }

        this.onObserverReport(observer);
    }

    /* Holds decisions until all three have reported once. Deciding earlier, on
       default values, can open a banner for a frame before the report that
       should have kept it closed arrives. */
    onObserverReport(observer) {
        this.awaitingFirstReport.delete(observer);
        if (this.awaitingFirstReport.size > 0) return;

        this.updateAll();
        if (this.onChange) this.onChange();
    }

    /* Deciding --------------------------------------------------------------

       A banner is open when:
         - its project has reached its entry line
         - its project's bottom has not passed the centre of the viewport
         - the project above has passed the centre, so that banner has closed
         - the page is not at its end

       At most one banner can meet all four. A banner needs the project above
       it past the centre, and every project higher up is past it too, so none
       of their banners can be open. */
    updateAll() {
        if (!this.autoRevealActive || this.frozen) return;

        const shouldBeOpen = this.banners.map((banner, index) => {
            const state = this.states.get(banner);
            const above = index > 0 ? this.states.get(this.banners[index - 1]) : null;

            return (
                state.reachedEntry &&
                !state.pastCentre &&
                (above === null || above.pastCentre) &&
                !this.nearPageEnd
            );
        });

        /* Closing first, so a banner that has just started collapsing already
           counts as on screen when the open decisions below are made. */
        this.banners.forEach((banner, index) => {
            if (!shouldBeOpen[index]) this.requestState(banner, false);
        });

        this.banners.forEach((banner, index) => {
            if (!shouldBeOpen[index]) return;

            const state = this.states.get(banner);

            /* currentState is where the banner is headed, so true means open or
               already opening. Waiting only ever holds back an opening, it
               never closes a banner that is already out. */
            const mustWait =
                BANNER_WAIT_FOR_PREVIOUS_COLLAPSE &&
                !state.currentState &&
                this.isAnotherBannerOnScreen(banner);

            /* Waiting is an explicit request to stay closed rather than no
               request, so an open request left queued cannot slip through. */
            this.requestState(banner, !mustWait);
        });
    }

    // Open, opening, or still animating closed all count as on screen.
    isAnotherBannerOnScreen(banner) {
        return this.banners.some((other) => {
            if (other === banner) return false;
            const state = this.states.get(other);
            return state.currentState || state.isTransitioning;
        });
    }

    /* Animating ------------------------------------------------------------ */

    requestState(banner, newState) {
        const state = this.states.get(banner);

        if (state.isTransitioning) {
            // Remembered, and applied once the running one finishes.
            state.queuedState = newState;
        } else if (newState !== state.currentState) {
            this.startTransition(banner, newState);
        }
    }

    startTransition(banner, newState) {
        const state = this.states.get(banner);

        state.currentState = newState;
        state.isTransitioning = true;
        state.queuedState = null;
        banner.classList.toggle(BANNER_ACTIVE_CLASS, newState);

        /* No transitionend arrives if the transition never actually runs,
           which would leave this banner marked as transitioning forever. */
        clearTimeout(state.graceTimeoutId);
        state.graceTimeoutId = setTimeout(
            () => this.endTransition(banner),
            this.circleDurationMs(banner) + 100
        );
    }

    handleTransitionEnd(event) {
        const banner = event.currentTarget;

        /* transitionend fires for every animated property and bubbles, so most
           of what arrives here is the text, not the circle. */
        const isExpandingCircle =
            event.target === banner &&
            event.pseudoElement === '::before' &&
            event.propertyName === 'transform';

        if (isExpandingCircle) this.endTransition(banner);
    }

    endTransition(banner) {
        const state = this.states.get(banner);
        if (!state || !state.isTransitioning) return; // already ended by the timer

        clearTimeout(state.graceTimeoutId);
        state.isTransitioning = false;

        const requested = state.queuedState;
        state.queuedState = null;

        if (requested !== null && requested !== state.currentState) {
            this.startTransition(banner, requested);
        }

        /* This banner finishing can be exactly what another is waiting for, so
           every banner is reconsidered. */
        this.updateAll();
        if (this.onChange) this.onChange();
    }

    // Read from the stylesheet, so the duration never has to be kept in sync.
    circleDurationMs(banner) {
        const circle = getComputedStyle(banner, '::before');
        const duration = parseFloat(circle.transitionDuration) || 0;
        const delay = parseFloat(circle.transitionDelay) || 0;
        return (duration + delay) * 1000;
    }

    /* Geometry ------------------------------------------------------------- */

    /* The gap between the bottom of the viewport and the bottom of the pill,
       used as the entry root's bottom inset. Measuring to the pill rather than
       to an arbitrary offset is what makes the progress threshold mean the
       same thing on every device. */
    getLineInsetPx(banner) {
        const line = this.getBannerLineFromViewportTop(banner);
        if (line === null) return 0;

        const inset = document.documentElement.clientHeight - line;
        return Math.max(0, Math.round(inset)); // a negative inset is not valid CSS
    }

    /* Where the pill's bottom edge sits while the banner is stuck, measured
       down from the top of the viewport. Derived from the CSS that positions
       it, so it works whether or not the banner happens to be stuck.

       getBoundingClientRect is deliberately not used: it reports the banner's
       current position, which is its in-flow one until it sticks. */
    getBannerLineFromViewportTop(banner) {
        const sticky = banner.closest('.banner');
        if (!sticky) return null;

        return this.getRestingTop(sticky) + banner.offsetTop + banner.offsetHeight;
    }

    /* The sticky top as the stylesheet sets it. If an animation is driving
       `top`, getComputedStyle reports the animated value, which would make the
       entry line depend on where the page happened to be scrolled. Switching
       the animation off for the read and back on happens before paint. */
    getRestingTop(element) {
        if (element.getAnimations().length === 0) {
            return parseFloat(getComputedStyle(element).top) || 0;
        }

        const previousName = element.style.animationName;
        element.style.animationName = 'none';
        const restingTop = parseFloat(getComputedStyle(element).top) || 0;
        element.style.animationName = previousName;

        return restingTop;
    }

    stateForProject(project) {
        const banner = project.querySelector('.banner-wrapper');
        return banner ? this.states.get(banner) : null;
    }

    /* Page-end markers ------------------------------------------------------

       Two invisible 1px markers near the end of the document, one at each
       page-end distance. Positioned absolutely rather than placed in the flow,
       because the body's bottom padding would leave flowed markers short of
       the real end of the scroll. */
    placePageEndMarkers() {
        if (!this.closeMarker) {
            this.closeMarker = this.createPageEndMarker();
            this.reopenMarker = this.createPageEndMarker();
        }

        /* Parked at the top before measuring. Markers left at the old end
           would hold a shortened page open at its old height. */
        this.closeMarker.style.top = '0px';
        this.reopenMarker.style.top = '0px';

        const documentEnd = document.documentElement.scrollHeight;
        this.closeMarker.style.top = `${documentEnd - BANNER_PAGE_END_CLOSE_WITHIN_PX}px`;
        this.reopenMarker.style.top = `${documentEnd - BANNER_PAGE_END_REOPEN_BEYOND_PX}px`;
    }

    createPageEndMarker() {
        const marker = document.createElement('div');
        marker.setAttribute('aria-hidden', 'true');
        marker.style.cssText =
            'position:absolute;left:0;width:1px;height:1px;pointer-events:none;';
        document.body.appendChild(marker);
        return marker;
    }

    removePageEndMarkers() {
        [this.closeMarker, this.reopenMarker].forEach((marker) => {
            if (marker) marker.remove();
        });
        this.closeMarker = null;
        this.reopenMarker = null;
    }

    // For the debug panel.
    getStatus() {
        const banner = this.banners[0] || null;
        const line = banner ? this.getBannerLineFromViewportTop(banner) : null;
        const layoutHeight = document.documentElement.clientHeight;

        return {
            autoRevealActive: this.autoRevealActive,
            bannerLine: line === null ? null : Math.round(line),
            rootLine: layoutHeight - this.lineInsetPx,
            nearPageEnd: this.nearPageEnd,
            distanceToPageEnd: Math.round(
                document.documentElement.scrollHeight - window.scrollY - layoutHeight
            ),
            openBanners: this.banners
                .map((b, i) => (this.states.get(b).currentState ? i + 1 : null))
                .filter((position) => position !== null),
        };
    }
}
