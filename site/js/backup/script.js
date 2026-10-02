function runEachResize( callbackFunc, runOnLoad = true, fireOnOrientChange = true, delayAfterResize = 200 ) {

	let resizeTimer; //variable que va a guardar el contador del setTimeout;

	if ( document.readyState === "complete" ) { //Si ya todo ha cargado
		if ( runOnLoad ) callbackFunc();
		initRunEachResize();
	} else { //Sino
		window.addEventListener( 'load', function() { //Esperar a que el browser avise que todo cargó
			if ( runOnLoad ) callbackFunc();
			initRunEachResize();
		} );
	}

	function initRunEachResize() {
		window.addEventListener( 'resize', scheduleCallback );

		if ( fireOnOrientChange ) {
			window.addEventListener( 'orientationchange', scheduleCallback );
		}
	}

	function scheduleCallback() {
		clearTimeout( resizeTimer );
		resizeTimer = setTimeout( callbackFunc, delayAfterResize );
	}

}

function runOnceOnLoad( callbackFunc, timeAfterLoad = 0 ){
	if ( document.readyState === "complete" ) { //Si ya todo ha cargado
		if(timeAfterLoad == 0){
			callbackFunc();
		}else{
			setTimeout(callbackFunc, timeAfterLoad);
		}
	} else { //Sino
		window.addEventListener( 'load', function() { //Esperar a que el browser avise que todo cargó
			if(timeAfterLoad == 0){
				callbackFunc();
			}else{
				setTimeout(callbackFunc, timeAfterLoad);
			}
		} );
	}
}

function runASAP( callbackFunc, timeAfterLoad = 0 ) {
    if ( document.readyState === "interactive" ) { //Si el usuario ya puede interactuar con la página
		if(timeAfterLoad == 0){
			callbackFunc();
		}else{
			setTimeout(callbackFunc, timeAfterLoad);
		}
	} else { //Sino
		window.addEventListener( 'DOMContentLoaded', function() { //Esperar a que el browser avise que la página ya es interactiva
			if(timeAfterLoad == 0){
				callbackFunc();
			}else{
				setTimeout(callbackFunc, timeAfterLoad);
			}
		} );
	}
}

/* Viewport height -----------------------------------------------------------
   Publishes the small viewport height as --svh on :root, in pixels, so the
   CSS can use calc(var(--svh) ...) in place of the svh unit.

   The unit itself is only as trustworthy as the browser. Safari keeps the
   layout viewport still while its toolbar moves, so svh is stable and means
   what it says. Some other iOS browsers resize the layout viewport instead,
   which collapses svh, lvh and dvh into one moving number. Anything sized
   with it then changes height mid-scroll and shifts the whole page.

   Measured once, then refreshed only on a real resize: a rotation or a width
   change, never a toolbar move.

   In CSS, write it as calc(var(--svh, 100svh) ...) so there is still a
   sensible value before this runs, and if it never does.
-------------------------------------------------------------------------- */

let lastViewportWidth = 0;

// Kept for the debug panel; the gap between them says how much svh can be trusted.
let measuredSvh = 0;
let measuredLvh = 0;

function initViewportHeight() {
    measureViewportHeight();
    lastViewportWidth = window.innerWidth;

    /* On a phone only a rotation or a width change is a real resize. A
       toolbar sliding away fires resize too, and remeasuring on that is the
       exact thing this exists to prevent. On a desktop every resize is real. */
    runEachResize(() => {
        const widthChanged = window.innerWidth !== lastViewportWidth;
        if (!widthChanged && isMobile()) return;

        lastViewportWidth = window.innerWidth;
        measureViewportHeight();
    }, false);
}

function measureViewportHeight() {
    const probe = document.createElement('div');

    // Fixed and empty, so it adds nothing to the page's height or scroll area.
    probe.style.cssText =
        'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);

    probe.style.height = '100svh';
    measuredSvh = probe.getBoundingClientRect().height;

    probe.style.height = '100lvh';
    measuredLvh = probe.getBoundingClientRect().height;

    probe.remove();

    /* When the two read the same, the browser is not distinguishing them and
       this is simply the viewport as it stands. At load the toolbar is
       normally showing, so that is the small viewport in any case. */
    document.documentElement.style.setProperty('--svh', `${Math.round(measuredSvh)}px`);
}

/* The same query the CSS uses to decide between hover and touch styles. Kept
   as a list rather than a one-off check so anything can listen for changes,
   like a mouse being plugged into a touch device. */
const FINE_POINTER_QUERY = window.matchMedia('(pointer: fine)');

/* True for anything without a fine primary pointer. Checks "not fine" rather
   than "coarse" because pointer can also be "none", on devices with no
   pointing device at all, and those need the touch behaviour too. */
function isMobile() {
    return !FINE_POINTER_QUERY.matches;
}

function configure() {
    if(!isMobile()) {
        //init tippy
        tippy('[data-tippy-content]:not([data-tippy-content=""]):not([data-click-copy])', {
            placement: 'top-start',
            followCursor: true,
            arrow: false,
        });

        tippy('[data-tippy-content][data-click-copy]:not([data-tippy-content=""])', {
            placement: 'top-start',
            followCursor: true,
            arrow: false,
            hideOnClick: false,
        });
    }


    //Init click to copy
    document.querySelectorAll('[data-click-copy]').forEach((el) => {
        el.addEventListener('click', copyContentsToClipboard);
    });

    //Init banner reveals
    initBanners();

    //Dev only, enabled with ?debug in the URL
    initDebugPanel();
}

/* Banner reveal */

// Each banner's state data. Keyed by its .banner-wrapper element.
const bannerAnimationStates = new WeakMap();

/* Every .banner-wrapper, in document order. Order matters, because whether a
   banner may open depends on the projects above it. */
let bannersInOrder = [];

/* How far the pill has travelled through the project, as a fraction of the
   project's own height. 0 is the project's top edge, 1 is its bottom edge.
   Being fractions of the project rather than of the viewport is what keeps
   this working when short projects make the media grid collapse. */
const EXPAND_AT_PROGRESS = 0.20;

/* When true, a banner waits to open until every other banner has finished
   its collapse animation, so only one is ever on screen. When false, it opens
   the moment the project above clears the center line, while that project's
   banner is still animating closed. Applies in both scroll directions. */
const WAIT_FOR_PREVIOUS_COLLAPSE = true;

/* Every banner closes near the end of the page. In practice this only affects
   the last one, whose project may never scroll far enough to clear the center.
   Two distances rather than one, so hovering around a single threshold cannot
   flip the banner open and shut: it closes once within the first, and only
   reopens once scrolled back beyond the second. */
const PAGE_END_CLOSE_WITHIN_PX = 10;
const PAGE_END_REOPEN_BEYOND_PX = 30;

/* How far a root is grown past the viewport, so the viewport's own edges never
   clip what is being measured. Only needs to comfortably exceed the tallest
   project; percentages resolve against the viewport height on every
   measurement, so this needs no recalculating. */
const ROOT_EXTENSION_PERCENT = 500;

/* Three observers, shared by every project. They only record what they see;
   updateAllBanners() makes every decision, since each banner's rule depends
   on the projects above it.
   - entry line: has the project reached its entry line at the pill?
   - center line: has the project's bottom passed the middle of the viewport?
   - page end: two invisible markers near the end of the document */
let entryLineObserver = null;
let centerLineObserver = null;
let pageEndObserver = null;

/* Observers that have not delivered their first report yet. Decisions wait for
   all of them, because until then some signals still hold their defaults. */
let observersAwaitingFirstReport = new Set();

let pageEndCloseMarker = null;
let pageEndReopenMarker = null;
let isPageEndCloseMarkerInView = false;
let isPageEndReopenMarkerInView = false;
let isNearPageEnd = false;

// How far the root's bottom edge is pulled up, to land it on the pill's bottom.
let bannerLineInsetPx = 0;

/* Two things can open a banner. On a fine pointer the CSS does it on hover.
   On mobile there is nothing to hover with, so the observers open and close
   banners as their projects scroll past. Both read the same pointer query, so
   they can never both be active or both be off. */

// Whether the observers, rather than hover, are currently driving the banners.
let isAutoRevealActive = false;

function initBanners() {
    bannersInOrder = Array.from(document.querySelectorAll('.banner-wrapper'));
    if (bannersInOrder.length === 0) return;

    bannersInOrder.forEach((banner) => {
        bannerAnimationStates.set(banner, {
            currentState: banner.classList.contains('banner-wrapper-active'),
            isTransitioning: false,
            queuedState: null,
            graceTimeoutId: null,

            // Written by the observers, read by updateAllBanners()
            reachedEntry: false,
            pastCenter: false,
        });

        // Attached once, rather than per transition.
        banner.addEventListener('transitionend', onBannerTransitionEnd);
    });

    syncAutoRevealWithPointer();

    /* Fires when the primary pointer changes without a reload, for example a
       mouse plugged into a touch device, at the same moment the CSS switches. */
    FINE_POINTER_QUERY.addEventListener('change', syncAutoRevealWithPointer);

    /* rebuild observers on resize to modify the root margin, but only while
       they are the ones in charge. Otherwise a resize would switch them back on. */
    runEachResize(() => {
        if (isAutoRevealActive) buildBannerObservers();
    }, false);

    // The font swap can change the page's height, which moves the page-end markers.
    if (document.fonts) {
        document.fonts.ready.then(() => {
            if (isAutoRevealActive) buildBannerObservers();
        });
    }
}

function syncAutoRevealWithPointer() {
    debugPointerChecks++; // diagnostics: catches the pointer query flapping

    if (isMobile()) {
        startAutoReveal();
    } else {
        stopAutoReveal();
    }
}

function startAutoReveal() {
    if (isAutoRevealActive) return;
    isAutoRevealActive = true;

    // Their first reports open whichever banner is in view straight away.
    buildBannerObservers();
}

/* Hands every banner back to the hover styles, closed and idle. */
function stopAutoReveal() {
    if (!isAutoRevealActive) return;
    isAutoRevealActive = false;

    disconnectBannerObservers();
    removePageEndMarkers();
    isNearPageEnd = false;

    bannersInOrder.forEach((banner) => {
        const state = bannerAnimationStates.get(banner);

        /* Clearing the queue as well as the timer. A transition still running
           will fire transitionend later, and with isTransitioning false that
           becomes a no-op instead of starting whatever was queued. */
        if (state) {
            clearTimeout(state.graceTimeoutId);
            state.graceTimeoutId = null;
            state.currentState = false;
            state.isTransitioning = false;
            state.queuedState = null;
            state.reachedEntry = false;
            state.pastCenter = false;
        }

        banner.classList.remove('banner-wrapper-active');
    });
}

function buildBannerObservers() {
    const projects = bannersInOrder
        .map((banner) => banner.closest('.project'))
        .filter(Boolean);
    if (projects.length === 0) return;

    disconnectBannerObservers();

    bannerLineInsetPx = getBannerLineInsetPx(bannersInOrder[0]);

    /* Root runs from far above the viewport down to the pill's bottom edge,
       which makes entry.intersectionRatio equal the project's progress past
       the pill. The threshold sits exactly on the value we act on, so the
       callback fires only at that crossing. */
    entryLineObserver = new IntersectionObserver(onEntryLineChanged, {
        rootMargin: `${ROOT_EXTENSION_PERCENT}% 0px -${bannerLineInsetPx}px 0px`,
        threshold: [EXPAND_AT_PROGRESS],
    });

    /* Root runs from the middle of the viewport to far below it. A project
       intersects it while any part of it is below the center, so the callback
       fires as its bottom crosses the center. Extended downward so that a fast
       scroll cannot carry a project from below the viewport to above the
       center without it ever intersecting, which would skip the callback. */
    centerLineObserver = new IntersectionObserver(onCenterLineChanged, {
        rootMargin: `-50% 0px ${ROOT_EXTENSION_PERCENT}% 0px`,
    });

    placePageEndMarkers();
    pageEndObserver = new IntersectionObserver(onPageEndChanged);

    projects.forEach((project) => {
        entryLineObserver.observe(project);
        centerLineObserver.observe(project);
    });
    pageEndObserver.observe(pageEndCloseMarker);
    pageEndObserver.observe(pageEndReopenMarker);

    observersAwaitingFirstReport = new Set([
        entryLineObserver,
        centerLineObserver,
        pageEndObserver,
    ]);

    updateDebugPanel();
}

function disconnectBannerObservers() {
    [entryLineObserver, centerLineObserver, pageEndObserver].forEach((observer) => {
        if (observer) observer.disconnect();
    });

    entryLineObserver = null;
    centerLineObserver = null;
    pageEndObserver = null;
    observersAwaitingFirstReport = new Set();
    isPageEndCloseMarkerInView = false;
    isPageEndReopenMarkerInView = false;
}

/* The gap between the bottom of the viewport and the bottom of the pill. Used
   as the root's bottom inset so the observer measures to the pill rather than
   to an arbitrary offset, which is what makes EXPAND_AT_PROGRESS mean the
   same thing on every device. */
function getBannerLineInsetPx(banner) {
    const bannerLine = getBannerLineFromViewportTop(banner);
    if (bannerLine === null) return 0;

    const inset = document.documentElement.clientHeight - bannerLine;
    return Math.max(0, Math.round(inset)); // a negative inset is not valid CSS
}

/* Two invisible 1px markers near the end of the document, one at each page-end
   distance. Positioned absolutely rather than appended to the flow, because
   the body's bottom padding would leave flowed markers short of the real end
   of the scroll. Re-placed on every rebuild, since the page's height changes
   with the viewport width and the font swap. */
function placePageEndMarkers() {
    if (!pageEndCloseMarker) {
        pageEndCloseMarker = createPageEndMarker();
        pageEndReopenMarker = createPageEndMarker();
    }

    /* Parked at the top before measuring. If the page got shorter since they
       were last placed, markers left at the old end would hold the document
       open at its old height and be measured as part of it. */
    pageEndCloseMarker.style.top = '0px';
    pageEndReopenMarker.style.top = '0px';

    const documentEnd = document.documentElement.scrollHeight;
    pageEndCloseMarker.style.top = `${documentEnd - PAGE_END_CLOSE_WITHIN_PX}px`;
    pageEndReopenMarker.style.top = `${documentEnd - PAGE_END_REOPEN_BEYOND_PX}px`;
}

function createPageEndMarker() {
    const marker = document.createElement('div');
    marker.setAttribute('aria-hidden', 'true');
    marker.style.cssText = 'position:absolute;left:0;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(marker);
    return marker;
}

function removePageEndMarkers() {
    [pageEndCloseMarker, pageEndReopenMarker].forEach((marker) => {
        if (marker) marker.remove();
    });
    pageEndCloseMarker = null;
    pageEndReopenMarker = null;
}

function getStateForProject(project) {
    const banner = project.querySelector('.banner-wrapper');
    return banner ? bannerAnimationStates.get(banner) : null;
}

function onEntryLineChanged(entries, observer) {
    // A late callback from an observer that was just disconnected.
    if (!isAutoRevealActive) return;

    entries.forEach((entry) => {
        // Diagnostics only; records where the observer's line actually was.
        if (entry.rootBounds) lastRootBounds = entry.rootBounds;

        const state = getStateForProject(entry.target);
        if (!state) return;

        /* Once the project's bottom edge is above the pill line, the project has
           fully passed its entry line. Past that point the root's top edge
           starts clipping the slice instead of the project's top edge, so the
           ratio decays back down and would otherwise read as not reached. */
        const projectBottomPassed =
            entry.boundingClientRect.bottom < entry.rootBounds.bottom;

        /* Read the ratio rather than inferring which way the threshold was
           crossed. A fast scroll can jump across it within one frame. */
        state.reachedEntry =
            projectBottomPassed || entry.intersectionRatio >= EXPAND_AT_PROGRESS;
    });

    onObserverReport(observer);
}

function onCenterLineChanged(entries, observer) {
    // A late callback from an observer that was just disconnected.
    if (!isAutoRevealActive) return;

    entries.forEach((entry) => {
        const state = getStateForProject(entry.target);
        if (!state) return;

        /* Read from the geometry rather than isIntersecting, which is also false
           for a project so far below the viewport that it is beyond the root. */
        state.pastCenter = entry.boundingClientRect.bottom <= entry.rootBounds.top;
    });

    onObserverReport(observer);
}

function onPageEndChanged(entries, observer) {
    // A late callback from an observer that was just disconnected.
    if (!isAutoRevealActive) return;

    entries.forEach((entry) => {
        if (entry.target === pageEndCloseMarker) isPageEndCloseMarkerInView = entry.isIntersecting;
        if (entry.target === pageEndReopenMarker) isPageEndReopenMarkerInView = entry.isIntersecting;
    });

    /* Between the two markers it keeps whatever it already was. That gap is
       what stops it flickering when the scroll settles right on a threshold. */
    if (isPageEndCloseMarkerInView) {
        isNearPageEnd = true;
    } else if (!isPageEndReopenMarkerInView) {
        isNearPageEnd = false;
    }

    onObserverReport(observer);
}

/* Holds decisions until every observer has reported once. Deciding earlier,
   on default values, can open a banner for a single frame before the report
   that should have kept it closed arrives. */
function onObserverReport(observer) {
    observersAwaitingFirstReport.delete(observer);
    if (observersAwaitingFirstReport.size > 0) return;

    updateAllBanners();
    updateDebugPanel();
}

/* Decides every banner at once, top to bottom. A banner is open when:
     - its project has reached its entry line
     - its project's bottom has not passed the center of the viewport
     - the project above it has passed the center, so that banner has closed
     - the page is not at its end
   At most one banner can meet all four at a time. A banner needs the project
   above it past the center, and every project higher up is past it too, so
   none of their banners can be open. */
function updateAllBanners() {
    if (!isAutoRevealActive) return;

    const shouldBeOpen = bannersInOrder.map((banner, index) => {
        const state = bannerAnimationStates.get(banner);
        const stateAbove = index > 0
            ? bannerAnimationStates.get(bannersInOrder[index - 1])
            : null;

        return (
            state.reachedEntry &&
            !state.pastCenter &&
            (stateAbove === null || stateAbove.pastCenter) &&
            !isNearPageEnd
        );
    });

    /* Closing first, so a banner that has just started collapsing already
       counts as on screen when the open decisions below are made. */
    bannersInOrder.forEach((banner, index) => {
        if (!shouldBeOpen[index]) requestBannerState(banner, false);
    });

    bannersInOrder.forEach((banner, index) => {
        if (!shouldBeOpen[index]) return;

        const state = bannerAnimationStates.get(banner);

        /* currentState is where the banner is headed, so true means open or
           already opening. Waiting only ever holds back an opening; it never
           closes a banner that is already out. */
        const mustWait =
            WAIT_FOR_PREVIOUS_COLLAPSE &&
            !state.currentState &&
            isAnotherBannerOnScreen(banner);

        /* Waiting is an explicit request to stay closed rather than no request
           at all, so an open request left in the queue cannot slip through. */
        requestBannerState(banner, !mustWait);
    });
}

// Open, opening, or still animating closed all count as on screen.
function isAnotherBannerOnScreen(banner) {
    return bannersInOrder.some((other) => {
        if (other === banner) return false;
        const state = bannerAnimationStates.get(other);
        return state.currentState || state.isTransitioning;
    });
}

function requestBannerState(banner, newState) {
    const state = bannerAnimationStates.get(banner);

    // If it is currently animating
    if (state.isTransitioning) {
        // Save this state to animate to once it is done
        state.queuedState = newState;

    // If it is not animating and the state doesn't match the current one
    } else if (newState !== state.currentState) {
        // Initiate a transition
        startBannerTransition(banner, newState);
    }
}

function startBannerTransition(banner, newState) {
    const state = bannerAnimationStates.get(banner);

    state.currentState = newState;
    state.isTransitioning = true;
    state.queuedState = null;

    banner.classList.toggle('banner-wrapper-active', newState);
    debugTransitionStarted(banner, newState);

    // No transitionend arrives if the transition never actually runs, which
    // would leave this banner marked as transitioning forever.
    clearTimeout(state.graceTimeoutId);
    state.graceTimeoutId = setTimeout(() => {
        debugTransitionEnded(banner, 'timer');
        endBannerTransition(banner);
    }, getCircleTransitionDurationMs(banner) + 100);
}

function onBannerTransitionEnd(event) {
    const banner = event.currentTarget;

    // Transitionend runs for every animated property on any child, so we need
    // to confirm this is referring to the actual overlay's animation
    const isExpandingOverlay =
        event.target === banner &&
        event.pseudoElement === '::before' &&
        event.propertyName === 'transform';

    // If this is not the banner's animation, return
    if (!isExpandingOverlay) return;

    debugTransitionEnded(banner, 'event');
    endBannerTransition(banner);
}

function endBannerTransition(banner) {
    const state = bannerAnimationStates.get(banner);
    if (!state || !state.isTransitioning) return; // animation already ended with the timer.

    clearTimeout(state.graceTimeoutId);
    state.isTransitioning = false;

    // Check if there is a queued state and apply it.
    const requestedState = state.queuedState;
    state.queuedState = null;

    const hasOutstandingRequest =
        requestedState !== null && requestedState !== state.currentState;

    if (hasOutstandingRequest) startBannerTransition(banner, requestedState);

    /* This banner finishing can be exactly what another one is waiting for,
       when WAIT_FOR_PREVIOUS_COLLAPSE is on, so every banner is reconsidered. */
    updateAllBanners();
}

/* Read from the stylesheet, so the duration never has to be kept in sync
   between the CSS and here. */
function getCircleTransitionDurationMs(banner) {
    const circleStyle = getComputedStyle(banner, '::before');
    const durationSeconds = parseFloat(circleStyle.transitionDuration) || 0;
    const delaySeconds = parseFloat(circleStyle.transitionDelay) || 0;
    return (durationSeconds + delaySeconds) * 1000;
}

/* Where the pill's bottom edge sits, measured down from the top of the
   viewport, while the banner is stuck. Derived from the same CSS that
   positions it, so it stays correct if that CSS changes, and it works whether
   or not the banner happens to be stuck at the time.

   getBoundingClientRect() is deliberately not used here: it reports the
   banner's current position, which is its in-flow one until it sticks. */
function getBannerLineFromViewportTop(banner) {
    const stickyParent = banner.closest('.banner');
    if (!stickyParent) return null;

    const stickyTop = getRestingTop(stickyParent);
    return stickyTop + banner.offsetTop + banner.offsetHeight;
}

/* The sticky top as the stylesheet sets it. When an animation is driving
   `top`, getComputedStyle reports the animated value instead, so the entry
   line would depend on where the page happened to be scrolled at the moment
   this ran, such as straight after a reload restores the scroll position.
   Switching the animation off for the read and straight back on happens
   before the browser paints, so nothing visibly changes. With no animation
   present this is a plain read. */
function getRestingTop(element) {
    if (element.getAnimations().length === 0) {
        return parseFloat(getComputedStyle(element).top) || 0;
    }

    const previousAnimationName = element.style.animationName;
    element.style.animationName = 'none';
    const restingTop = parseFloat(getComputedStyle(element).top) || 0;
    element.style.animationName = previousAnimationName;

    return restingTop;
}

/* Diagnostics ---------------------------------------------------------------
   Development only. Add ?debug to the URL to show a fixed readout, which is
   how to inspect this on a phone without remote debugging. Safe to delete.
-------------------------------------------------------------------------- */

let debugPanel = null;
let lastRootBounds = null;

/* Transition diagnostics.

   Records what actually happened to each banner transition, so a jump can be
   told apart from a transition that ran but was never painted. All of it is
   inert unless ?debug is in the URL.

   Reading a log line, for example "open1  502/500 f30 ev st:y":
     open1   which banner, and which way it went
     502/500 how long it really took, against what the stylesheet asked for
     f30     animation frames seen while it ran
     ev      transitionend fired. tm means our grace timer had to finish it
     st:y    the browser fired transitionstart, so a transition did exist
     SAME    the ::before transform did not change when the class toggled
     JUMP    it finished in well under the declared time

   A skipped animation with st:n means the browser never created a transition,
   so the cause is in the style change itself. With st:y and a full duration
   but very few frames, the transition existed and was not being painted. */
const DEBUG_LOG_LENGTH = 3;

const debugRunningTransitions = new WeakMap();
const debugLastEndedAt = new WeakMap();
let debugTransitionLog = [];
let debugLastTrace = null;
let debugCounts = { started: 0, noTransition: 0, jumped: 0, byTimer: 0 };
let debugPointerChecks = 0;

/* Redrawing the panel every frame costs frames, and this is measuring frames.
   Off by default; add &live to the URL for the frame-by-frame readout, but
   treat the frame counts it produces as pessimistic. */
let debugLiveUpdates = false;

function debugIsOn() {
    return debugPanel !== null;
}

// What the circle should end up at, per the stylesheet.
function debugTargetScale() {
    const banner = bannersInOrder[0];
    if (!banner) return 'n/a';

    return getComputedStyle(banner).getPropertyValue('--reveal-scale').trim() || 'unset';
}

function debugTransitionStarted(banner, isOpening) {
    if (!debugIsOn()) return;

    const record = {
        banner: bannersInOrder.indexOf(banner) + 1,
        direction: isOpening ? 'open' : 'shut',
        bannerEl: banner,
        startedAt: performance.now(),
        declaredMs: Math.round(getCircleTransitionDurationMs(banner)),

        /* Where the circle actually is as this begins. An open starting from
           anything but nearly zero means the previous close never brought it
           back down, and there is almost nothing left to animate. */
        scaleAtStart: debugCurrentScale(banner),

        // How long since this same banner last finished a transition.
        sinceLastMs: debugLastEndedAt.has(banner)
            ? Math.round(performance.now() - debugLastEndedAt.get(banner))
            : null,

        /* The circle's actual scale on the first rendered frame, and again at
           the halfway point. A transition that is really running reads near 0
           then near half the target. One that jumped reads at the target both
           times, whatever the clock says. */
        scaleFirst: null,
        scaleHalf: null,

        // Every frame's scale, so the shape of the change can be seen.
        trace: [],

        sawStartEvent: false,
        cancels: 0,
        frames: 0,
        endedBy: null,
        elapsedMs: null,
    };

    debugRunningTransitions.set(banner, record);
    debugCounts.started++;
    debugCountFrames(record);
    updateDebugPanel();
}

/* Samples the circle's real scale as the transition runs, and refreshes the
   panel each frame so the live rows move too. The samples are what tell a
   transition that genuinely animated apart from one that arrived instantly,
   no matter what the clock says. */
function debugCountFrames(record) {
    const tick = () => {
        if (record.endedBy !== null) return;

        record.frames++;
        const elapsed = performance.now() - record.startedAt;
        const sample = debugSampleCircle(record.bannerEl);

        if (record.scaleFirst === null) record.scaleFirst = sample.scale;
        if (record.scaleHalf === null && elapsed >= record.declaredMs / 2) {
            record.scaleHalf = sample.scale;
        }

        // Capped, so a transition that somehow never ends cannot grow forever.
        if (record.trace.length < 200) {
            record.trace.push(Object.assign({ at: Math.round(elapsed) }, sample));
        }

        if (debugLiveUpdates) updateDebugPanel();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

// The scale factor the circle's transform currently resolves to.
function debugCurrentScale(banner) {
    if (!banner) return NaN;

    const applied = getComputedStyle(banner, '::before').transform;
    if (applied === 'none') return 1;

    const matrix = applied.match(/matrix\(\s*([-\d.]+)/);
    return matrix ? parseFloat(matrix[1]) : NaN;
}

/* The running transition itself, as an animation object. A CSS transition is
   inspectable this way, which lets us read its own clock rather than guessing
   from wall time. */
function debugFindCircleTransition(banner) {
    if (!banner.getAnimations) return null;

    return banner.getAnimations({ subtree: true }).find((animation) =>
        animation.transitionProperty === 'transform' &&
        animation.effect &&
        animation.effect.pseudoElement === '::before'
    ) || null;
}

/* One reading of everything that could explain a jump, taken together so the
   values all come from the same moment:
     scale     what the circle is actually at
     target    what it is heading for, in case that moves mid-transition
     duration  in case the declared duration changes
     animMs    the transition's own clock
     state     running, finished, idle */
function debugSampleCircle(banner) {
    const style = getComputedStyle(banner, '::before');
    const applied = style.transform;
    const matrix = applied === 'none' ? null : applied.match(/matrix\(\s*([-\d.]+)/);
    const transition = debugFindCircleTransition(banner);
    const clock = transition ? transition.currentTime : null;

    return {
        scale: applied === 'none' ? 1 : matrix ? parseFloat(matrix[1]) : NaN,
        target: parseFloat(style.getPropertyValue('--reveal-scale')),
        durationMs: Math.round((parseFloat(style.transitionDuration) || 0) * 1000),
        animMs: typeof clock === 'number' ? Math.round(clock) : null,
        state: transition ? transition.playState : 'none',
    };
}

function debugNumber(value) {
    if (value === null) return '?';
    return Number.isFinite(value) ? value.toFixed(1) : 'NaN';
}

/* A transition being cancelled part way, rather than finishing, is one way
   the circle could snap to its end value. */
function onBannerTransitionCancel(event) {
    if (!debugIsOn()) return;

    const banner = event.currentTarget;
    if (event.target !== banner || event.pseudoElement !== '::before') return;
    if (event.propertyName !== 'transform') return;

    const record = debugRunningTransitions.get(banner);
    if (record) record.cancels++;
}

/* Whether the browser created a transition at all. This is the single most
   useful signal: a jump with no transitionstart is a completely different
   problem from a jump with one. */
function onBannerTransitionStart(event) {
    if (!debugIsOn()) return;

    const banner = event.currentTarget;
    const isExpandingOverlay =
        event.target === banner &&
        event.pseudoElement === '::before' &&
        event.propertyName === 'transform';
    if (!isExpandingOverlay) return;

    const record = debugRunningTransitions.get(banner);
    if (record) record.sawStartEvent = true;
}

function debugTransitionEnded(banner, endedBy) {
    if (!debugIsOn()) return;

    const record = debugRunningTransitions.get(banner);
    if (!record || record.endedBy !== null) return;

    record.endedBy = endedBy;
    record.elapsedMs = Math.round(performance.now() - record.startedAt);

    if (!record.sawStartEvent) debugCounts.noTransition++;
    if (record.elapsedMs < record.declaredMs / 2) debugCounts.jumped++;
    if (endedBy === 'timer') debugCounts.byTimer++;

    debugLastEndedAt.set(banner, performance.now());
    debugLastTrace = record;
    debugTransitionLog.unshift(record);
    debugTransitionLog = debugTransitionLog.slice(0, DEBUG_LOG_LENGTH);
    debugRunningTransitions.delete(banner);
    updateDebugPanel();
}

/* Draws the frame-by-frame trace of the last transition, so the shape of the
   change is visible rather than inferred from two samples.

   A smooth ramp means the value really interpolated. A flat run followed by a
   single step means it leapt, and the numbers underneath say when and how big
   the step was. The largest gap between frames separates the two causes: a
   step with a normal ~16ms gap is the value itself jumping, while a step that
   spans a long gap means the page simply stopped rendering for that long. */
function debugFormatTrace(record) {
    if (!record || record.trace.length === 0) return ['(no trace yet)'];

    const target = parseFloat(debugTargetScale());
    const peak = Math.max(...record.trace.map((point) => point.scale), 0);
    const top = Number.isFinite(target) && target > 0 ? target : peak || 1;

    const blocks = ' ▁▂▃▄▅▆▇█';
    const columns = 26;
    const step = Math.max(1, Math.ceil(record.trace.length / columns));

    let spark = '';
    for (let i = 0; i < record.trace.length; i += step) {
        const level = Math.min(8, Math.max(0, Math.round((record.trace[i].scale / top) * 8)));
        spark += blocks[level];
    }

    // The biggest one-frame change, and how far apart the frames landed.
    let biggestStep = 0;
    let biggestStepAt = 0;
    const gaps = [];
    for (let i = 1; i < record.trace.length; i++) {
        const jump = Math.abs(record.trace[i].scale - record.trace[i - 1].scale) / top;
        if (jump > biggestStep) {
            biggestStep = jump;
            biggestStepAt = record.trace[i].at;
        }
        gaps.push(record.trace[i].at - record.trace[i - 1].at);
    }

    const sorted = [...gaps].sort((a, b) => a - b);
    const typicalGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const worstGap = sorted.length ? sorted[sorted.length - 1] : 0;
    const fps = record.elapsedMs > 0
        ? Math.round((record.frames / record.elapsedMs) * 1000)
        : 0;

    const percentOfDuration = record.declaredMs
        ? Math.round((biggestStepAt / record.declaredMs) * 100)
        : 0;

    /* What the transition itself was doing across the jump. If its own clock
       leaps forward, the animation was pushed to its end. If the clock moves
       one frame's worth while the value covers everything, the clock is fine
       and the value it produced is wrong. */
    const jumpIndex = record.trace.findIndex((point) => point.at === biggestStepAt);
    const before = jumpIndex > 0 ? record.trace[jumpIndex - 1] : null;
    const after = jumpIndex >= 0 ? record.trace[jumpIndex] : null;

    /* Reported across the whole trace rather than only across a step, so it
       still says something when the value never moved at all. */
    const first = record.trace[0];
    const last = record.trace[record.trace.length - 1];
    const scales = record.trace.map((point) => point.scale);

    const scaleLine =
        `scale ${debugNumber(record.scaleAtStart)}>` +
        `${debugNumber(first.scale)}>${debugNumber(last.scale)} ` +
        `(lo ${debugNumber(Math.min(...scales))} hi ${debugNumber(Math.max(...scales))})`;

    const sinceLine = `since last ${record.sinceLastMs === null ? 'first' : record.sinceLastMs + 'ms'}`;

    const clockLine = before && after
        ? `clock ${before.animMs}>${after.animMs}ms  ${before.state}>${after.state}`
        : `clock ${first.animMs}>${last.animMs}ms  ${first.state}>${last.state}`;

    // Anything moving underneath the transition would also explain a jump.
    const targets = new Set(record.trace.map((point) => debugNumber(point.target)));
    const durations = new Set(record.trace.map((point) => point.durationMs));
    const steadyLine =
        `target ${targets.size > 1 ? [...targets].join('>') : 'steady'}` +
        `  dur ${durations.size > 1 ? [...durations].join('>') : `${[...durations][0]}ms`}`;

    return [
        `${record.direction}${record.banner} ${record.elapsedMs}ms target ${debugNumber(top)}`,
        spark,
        `${record.frames} frames = ${fps}fps`,
        scaleLine,
        sinceLine,
        `gap typical ${Math.round(typicalGap)}ms worst ${Math.round(worstGap)}ms`,
        `step ${Math.round(biggestStep * 100)}% at ${biggestStepAt}ms (${percentOfDuration}%)`,
        clockLine,
        steadyLine,
    ];
}

function debugFormatTransition(record) {
    const flags = [
        record.sawStartEvent ? '' : 'NOSTART',
        record.cancels > 0 ? `cancel${record.cancels}` : '',
        record.elapsedMs < record.declaredMs / 2 ? 'SHORT' : '',
    ].filter(Boolean).join(' ');

    return (
        `${record.direction}${record.banner} ` +
        `${String(record.elapsedMs).padStart(4)}/${record.declaredMs} ` +
        `f${String(record.frames).padStart(2)} ` +
        `${record.endedBy === 'event' ? 'ev' : 'tm'} ` +
        `s${debugNumber(record.scaleFirst)}>${debugNumber(record.scaleHalf)} ${flags}`
    ).trimEnd();
}

function initDebugPanel() {
    const params = new URLSearchParams(location.search);
    if (!params.has('debug')) return;

    debugLiveUpdates = params.has('live');

    debugPanel = document.createElement('pre');
    debugPanel.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'z-index:99999',
        'margin:0', 'padding:6px 8px',
        'font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
        'background:rgba(0,0,0,0.85)', 'color:#0f0',
        'pointer-events:none',
        // Wraps rather than running off the side of a phone screen.
        'white-space:pre-wrap', 'max-width:100vw', 'box-sizing:border-box',
    ].join(';');
    document.body.appendChild(debugPanel);

    // Only the log below needs these, so they are attached with the panel.
    bannersInOrder.forEach((banner) => {
        banner.addEventListener('transitionstart', onBannerTransitionStart);
        banner.addEventListener('transitioncancel', onBannerTransitionCancel);
    });

    // The bottom bar animating does not fire window resize on iOS.
    window.addEventListener('scroll', updateDebugPanel, { passive: true });
    window.addEventListener('resize', updateDebugPanel);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateDebugPanel);
        window.visualViewport.addEventListener('scroll', updateDebugPanel);
    }
    updateDebugPanel();
}

function updateDebugPanel() {
    if (!debugPanel) return;

    const layoutHeight = document.documentElement.clientHeight;
    const visualHeight = window.visualViewport
        ? Math.round(window.visualViewport.height)
        : window.innerHeight;

    const banner = document.querySelector('.banner-wrapper');
    const bannerLine = banner ? getBannerLineFromViewportTop(banner) : null;

    /* Computed live from the layout viewport, which is what the rootMargin
       resolves against. The rootBounds row below is the observer's own
       reading, but it only refreshes on a threshold crossing, so it lags. */
    const rootLine = layoutHeight - bannerLineInsetPx;

    const row = (label, value) => `${label.padEnd(14)}${value}`;

    // Measured against the layout viewport, the same one the observers use.
    const distanceToPageEnd =
        document.documentElement.scrollHeight - window.scrollY - layoutHeight;

    // Which banners are open or opening, by position on the page, counting from 1.
    const openBanners = bannersInOrder
        .map((wrapper, index) => (bannerAnimationStates.get(wrapper)?.currentState ? index + 1 : null))
        .filter((position) => position !== null);

    debugPanel.textContent = [
        row('layout vh', layoutHeight),
        row('visual vh', visualHeight),
        row('--svh', `${Math.round(measuredSvh)}px`),
        /* Equal means the browser is collapsing svh into dvh, which is the
           whole reason --svh exists. Apart means svh is trustworthy here. */
        row('svh vs lvh', Math.abs(measuredLvh - measuredSvh) > 1
            ? `${Math.round(measuredSvh)}/${Math.round(measuredLvh)} distinct`
            : `${Math.round(measuredSvh)} COLLAPSED`),
        '',
        row('root line', rootLine),
        row('banner line', bannerLine === null ? 'n/a' : Math.round(bannerLine)),
        row('OFFSET', bannerLine === null ? 'n/a' : Math.round(rootLine - bannerLine)),
        '',
        row('auto reveal', isAutoRevealActive ? 'on' : 'off (hover)'),
        row('open banner', openBanners.length ? openBanners.join(', ') : 'none'),
        row('to page end', `${Math.round(distanceToPageEnd)}px`),
        row('near end', isNearPageEnd ? 'yes' : 'no'),
        '',
        row('ran', `${debugCounts.started}`),
        row('no transition', `${debugCounts.noTransition}`),
        row('jumped', `${debugCounts.jumped}`),
        row('ended by timer', `${debugCounts.byTimer}`),
        row('pointer checks', `${debugPointerChecks}`),
        row('page', document.visibilityState),
        row('target scale', debugTargetScale()),
        row('scale now', debugNumber(debugCurrentScale(bannersInOrder[0]))),
        '',
        '-- last transition, frame by frame --',
        ...debugFormatTrace(debugLastTrace),
        '',
        '-- transitions, newest first --',
        'dir ms/declared f end sFirst>sHalf',
        ...(debugTransitionLog.length
            ? debugTransitionLog.map(debugFormatTransition)
            : ['(none yet)']),
    ].join('\n');
}

function copyContentsToClipboard(e) {
    const el = e.currentTarget;
    navigator.clipboard.writeText(el.textContent);

    const instance = el._tippy;
    if(instance != undefined) {
        instance.setContent('Copied!');
        setTimeout(() => {
            instance.setContent(el.getAttribute('data-tippy-content'));
        }, 3000);
    }
}

// Before paint, so nothing sized against it shifts once it lands.
runASAP(initViewportHeight);

runOnceOnLoad(configure);



