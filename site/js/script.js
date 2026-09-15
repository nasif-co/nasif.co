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

function isMobile() {
    let mql = window.matchMedia("(pointer: coarse)");
    return mql.matches;
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

/* How far the pill has travelled through the project, as a fraction of the
   project's own height. 0 is the project's top edge, 1 is its bottom edge.
   Being fractions of the project rather than of the viewport is what keeps
   this working when short projects make the media grid collapse. */
const EXPAND_AT_PROGRESS = 0.20;
const COLLAPSE_AT_PROGRESS = 0.95;

/* Grows the root upward, far past the top of the viewport, so the measured
   slice is never clipped at the viewport's top edge. That clipping is what
   would otherwise freeze the ratio partway through a tall project. Only needs
   to comfortably exceed the tallest project; percentages resolve against the
   viewport height on every measurement, so this needs no recalculating. */
const ROOT_HEIGHT_PERCENT_ABOVE_VIEWPORT = 500;

// One observer, shared by every project. Rebuilt whenever the pill moves.
let projectProgressObserver = null;

// How far the root's bottom edge is pulled up, to land it on the pill's bottom.
let bannerLineInsetPx = 0;

function initBanners() {
    const banners = document.querySelectorAll('.banner-wrapper');
    if (banners.length === 0) return;

    banners.forEach((banner) => {
        bannerAnimationStates.set(banner, {
            currentState: banner.classList.contains('banner-wrapper-active'),
            isTransitioning: false,
            queuedState: null,
            graceTimeoutId: null,
        });

        // Attached once, rather than per transition.
        banner.addEventListener('transitionend', onBannerTransitionEnd);
    });

    buildProjectObserver();

    /* rootMargin is fixed when an observer is created, so moving the pill means
       building a new one. Only a real resize or rotation moves it: the mobile
       address bar does not, since the layout viewport and the pill's svh-based
       position both hold steady through that. */
    runEachResize(buildProjectObserver, false);
}

function buildProjectObserver() {
    const banners = document.querySelectorAll('.banner-wrapper');
    if (banners.length === 0) return;

    if (projectProgressObserver) projectProgressObserver.disconnect();

    bannerLineInsetPx = getBannerLineInsetPx(banners[0]);

    /* Root runs from far above the viewport down to the pill's bottom edge,
       which makes entry.intersectionRatio equal the project's progress past
       the pill. Thresholds sit exactly on the two values we act on, so the
       callback fires only at those crossings. */
    projectProgressObserver = new IntersectionObserver(onProjectProgressChanged, {
        rootMargin: `${ROOT_HEIGHT_PERCENT_ABOVE_VIEWPORT}% 0px -${bannerLineInsetPx}px 0px`,
        threshold: [EXPAND_AT_PROGRESS, COLLAPSE_AT_PROGRESS],
    });

    banners.forEach((banner) => {
        const project = banner.closest('.project');
        if (project) projectProgressObserver.observe(project);
    });

    updateDebugPanel();
}

/* The gap between the bottom of the viewport and the bottom of the pill. Used
   as the root's bottom inset so the observer measures to the pill rather than
   to an arbitrary offset, which is what makes COLLAPSE_AT_PROGRESS mean the
   same thing on every device. */
function getBannerLineInsetPx(banner) {
    const bannerLine = getBannerLineFromViewportTop(banner);
    if (bannerLine === null) return 0;

    const inset = document.documentElement.clientHeight - bannerLine;
    return Math.max(0, Math.round(inset)); // a negative inset is not valid CSS
}

function onProjectProgressChanged(entries) {
    entries.forEach((entry) => {
        // Diagnostics only; records where the observer's line actually was.
        if (entry.rootBounds) {
            lastRootBounds = entry.rootBounds;
            updateDebugPanel();
        }

        // Get the banner wrapper element
        const banner = entry.target.querySelector('.banner-wrapper');
        if (!banner) return;

        // Get the states object for this banner
        const state = bannerAnimationStates.get(banner);
        if (!state) return;

        /* Once the project's bottom edge is above the banner line the project
           is finished. Past that point the root's top edge starts clipping the
           slice instead of the project's top edge, so the ratio decays back
           down and would re-cross both thresholds far off screen. */
        const projectBottomPassed =
            entry.boundingClientRect.bottom < entry.rootBounds.bottom;

        /* Read the ratio rather than inferring which threshold fired. A fast
           scroll can cross both within one frame, producing a single callback. */
        const progress = entry.intersectionRatio;

        // Derive banner status from how far the banner line is into the project
        const newState =
            !projectBottomPassed &&
            progress >= EXPAND_AT_PROGRESS &&
            progress < COLLAPSE_AT_PROGRESS;

        // If it is currently animating
        if (state.isTransitioning) {
            // Save this state to animate to once it is done
            state.queuedState = newState;

        // If it is not animating and the state doesn't match the current one    
        } else if (newState !== state.currentState) {
            // Initiate a transition
            startBannerTransition(banner, newState);
        }
    });
}

function startBannerTransition(banner, newState) {
    const state = bannerAnimationStates.get(banner);

    state.currentState = newState;
    state.isTransitioning = true;
    state.queuedState = null;
    banner.classList.toggle('banner-wrapper-active', newState);

    // No transitionend arrives if the transition never actually runs, which
    // would leave this banner marked as transitioning forever.
    clearTimeout(state.graceTimeoutId);
    state.graceTimeoutId = setTimeout(
        () => endBannerTransition(banner),
        getCircleTransitionDurationMs(banner) + 100
    );
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

    const stickyTop = parseFloat(getComputedStyle(stickyParent).top) || 0;
    return stickyTop + banner.offsetTop + banner.offsetHeight;
}

/* Diagnostics ---------------------------------------------------------------
   Development only. Add ?debug to the URL to show a fixed readout, which is
   how to inspect this on a phone without remote debugging. Safe to delete.
-------------------------------------------------------------------------- */

let debugPanel = null;
let lastRootBounds = null;

function initDebugPanel() {
    if (!new URLSearchParams(location.search).has('debug')) return;

    debugPanel = document.createElement('pre');
    debugPanel.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'z-index:99999',
        'margin:0', 'padding:8px 10px',
        'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
        'background:rgba(0,0,0,0.82)', 'color:#0f0',
        'pointer-events:none', 'white-space:pre',
    ].join(';');
    document.body.appendChild(debugPanel);

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

    debugPanel.textContent = [
        row('layout vh', layoutHeight),
        row('visual vh', visualHeight),
        '',
        row('root line', rootLine),
        row('banner line', bannerLine === null ? 'n/a' : Math.round(bannerLine)),
        row('OFFSET', bannerLine === null ? 'n/a' : Math.round(rootLine - bannerLine)),
        '',
        '-- observer, lags until a crossing --',
        row('rootBnds btm', lastRootBounds ? Math.round(lastRootBounds.bottom) : 'awaiting'),
        row('rootBnds h', lastRootBounds ? Math.round(lastRootBounds.height) : 'awaiting'),
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

runOnceOnLoad(configure);



