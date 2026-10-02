/* Page lifecycle ------------------------------------------------------------
   Two scopes.

   Session: things outside the barba container that must be set up exactly
   once. Anything registering a listener that cannot be removed belongs here,
   or it stacks up a little more with every page.

   Page: everything inside the container. Torn down before barba swaps it out
   and rebuilt after the new one lands.

   The first page is started by the load handler at the bottom, not by barba,
   so a blocked CDN just means links do ordinary page loads.
-------------------------------------------------------------------------- */

/* Tooltips ----------------------------------------------------------------- */

class Tooltips {

    constructor() {
        this.instances = [];
    }

    start() {
        // Hover only, and tippy comes from a CDN that may not have loaded.
        if (isMobile() || typeof tippy === 'undefined') return;

        const shared = { placement: 'top-start', followCursor: true, arrow: false };

        /* Elements rather than selectors, so these are scoped to the page that
           is arriving. Tippy given a selector searches the whole document, and
           during a transition that includes the page on its way out. */
        const labelled = '[data-tippy-content]:not([data-tippy-content=""])';
        const root = activeContainer();

        this.instances = [].concat(
            tippy(Array.from(root.querySelectorAll(`${labelled}:not([data-click-copy])`)), shared),
            // Stays put on click, since clicking is how you copy.
            tippy(Array.from(root.querySelectorAll(`${labelled}[data-click-copy]`)),
                Object.assign({}, shared, { hideOnClick: false }))
        );
    }

    /* Destroyed rather than left to the garbage collector: tippy appends its
       tooltips to the body, which outlives the container they belong to. */
    stop() {
        this.instances.forEach((instance) => instance.destroy());
        this.instances = [];
    }
}

/* Click to copy ------------------------------------------------------------ */

class CopyButtons {

    constructor() {
        this.buttons = [];
        this.resetTimeoutId = null;
        this.handleClick = this.handleClick.bind(this);
    }

    start() {
        this.buttons = Array.from(activeContainer().querySelectorAll('[data-click-copy]'));
        this.buttons.forEach((button) => button.addEventListener('click', this.handleClick));
    }

    stop() {
        clearTimeout(this.resetTimeoutId);
        this.buttons.forEach((button) => button.removeEventListener('click', this.handleClick));
        this.buttons = [];
    }

    handleClick(event) {
        const button = event.currentTarget;
        navigator.clipboard.writeText(button.textContent);

        // Tippy stores its instance on the element, so this is the live one.
        const tooltip = button._tippy;
        if (!tooltip) return;

        tooltip.setContent('Copied!');
        clearTimeout(this.resetTimeoutId);
        this.resetTimeoutId = setTimeout(() => {
            tooltip.setContent(button.getAttribute('data-tippy-content'));
        }, 3000);
    }
}

/* Debug panel ---------------------------------------------------------------
   Development only, shown by adding ?debug to the URL. Exists to inspect the
   viewport and banner numbers on a phone without a cable.
-------------------------------------------------------------------------- */

class DebugPanel {

    constructor(viewportHeight, getPage) {
        this.viewportHeight = viewportHeight;
        this.getPage = getPage;
        this.el = null;
        this.render = this.render.bind(this);
    }

    start() {
        if (!new URLSearchParams(location.search).has('debug')) return;

        this.el = document.createElement('pre');
        this.el.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'z-index:99999',
            'margin:0', 'padding:6px 8px',
            'font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
            'background:rgba(0,0,0,0.85)', 'color:#0f0', 'pointer-events:none',
            // Wraps rather than running off the side of a phone screen.
            'white-space:pre-wrap', 'max-width:100vw', 'box-sizing:border-box',
        ].join(';');
        document.body.appendChild(this.el);

        window.addEventListener('scroll', this.render, { passive: true });
        window.addEventListener('resize', this.render);
        // The toolbar moving does not fire a window resize on iOS.
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this.render);
            window.visualViewport.addEventListener('scroll', this.render);
        }

        this.render();
    }

    render() {
        if (!this.el) return;

        const page = this.getPage();
        const banners = page ? page.bannerReveal.getStatus() : null;
        const viewport = this.viewportHeight.getStatus();
        const row = (label, value) => `${label.padEnd(14)}${value}`;

        const lines = [
            row('layout vh', document.documentElement.clientHeight),
            row('visual vh', window.visualViewport
                ? Math.round(window.visualViewport.height)
                : window.innerHeight),
            row('--svh', `${viewport.svh}px`),
            /* Equal means the browser is collapsing svh into dvh, which is why
               --svh exists. Apart means svh is trustworthy here. */
            row('svh vs lvh', viewport.distinct
                ? `${viewport.svh}/${viewport.lvh} distinct`
                : `${viewport.svh} COLLAPSED`),
        ];

        if (banners) {
            lines.push(
                '',
                row('auto reveal', banners.autoRevealActive ? 'on' : 'off (hover)'),
                row('open banner', banners.openBanners.length
                    ? banners.openBanners.join(', ')
                    : 'none'),
                row('banner line', banners.bannerLine === null ? 'n/a' : banners.bannerLine),
                row('root line', banners.rootLine),
                // Should be 0. Anything else means the entry line has drifted.
                row('OFFSET', banners.bannerLine === null
                    ? 'n/a'
                    : banners.rootLine - banners.bannerLine),
                row('to page end', `${banners.distanceToPageEnd}px`),
                row('near end', banners.nearPageEnd ? 'yes' : 'no')
            );
        }

        this.el.textContent = lines.join('\n');
    }
}

/* Page --------------------------------------------------------------------- */

class Page {

    constructor() {
        this.bannerReveal = new BannerReveal();
        this.bannerLag = new ScrollLag(BANNER_LAG_TARGET);
        this.bulletLag = new ScrollLag(BULLET_LAG_TARGET);
        this.tooltips = new Tooltips();
        this.copyButtons = new CopyButtons();
        this.scrollHint = new ScrollHint();
        this.videoVisibility = new VideoVisibility();
        this.imageLoading = new ImageLoading();

        this.features = [
            this.bannerReveal,
            this.bannerLag,
            this.bulletLag,
            this.tooltips,
            this.copyButtons,
            this.scrollHint,
            this.videoVisibility,
            this.imageLoading,
        ];
    }

    /* Banners are left out: after a transition they should only start once
       the page has finished fading in, so the caller starts them. */
    start() {
        this.features.forEach((feature) => {
            if (feature !== this.bannerReveal) feature.start();
        });
    }

    startBanners() {
        this.bannerReveal.start();
    }

    // Reverse order, so anything depending on another is torn down first.
    stop() {
        this.features.slice().reverse().forEach((feature) => feature.stop());
    }

    // Called when the page reflows, from the session's single resize hook.
    refresh() {
        this.features.forEach((feature) => {
            if (feature.refresh) feature.refresh();
        });
    }
}

/* Lifecycle ---------------------------------------------------------------- */

// How long to let a run of reflows settle before remeasuring.
const PAGE_REFLOW_DEBOUNCE_MS = 150;

const viewportHeight = new ViewportHeight();
let debugPanel = null;
let currentPage = null;
let pageTransition = null;

function setupSession() {
    debugPanel = new DebugPanel(viewportHeight, () => currentPage);
    debugPanel.start();

    /* One resize hook for the whole session. runEachResize cannot be undone,
       so registering it per page would stack listeners. */
    runEachResize(() => {
        if (currentPage) currentPage.refresh();
    }, false);

    // The font swap changes the page height, which moves the page-end markers.
    if (document.fonts) {
        document.fonts.ready.then(() => {
            if (currentPage) currentPage.refresh();
        });
    }

    watchPageHeight();
}

/* A lazy image arriving changes the page height long after everything has
   measured itself against it, and a cached track is then wrong for the rest of
   the page. Watching the body covers that, and anything else that reflows,
   without each feature having to notice for itself.

   Debounced, so a burst of images loading is one refresh, and so the work
   happens outside the observer's own callback rather than inside it. */
function watchPageHeight() {
    if (!window.ResizeObserver) return;

    let pending = null;

    const observer = new ResizeObserver(() => {
        clearTimeout(pending);
        pending = setTimeout(() => {
            if (currentPage) currentPage.refresh();
        }, PAGE_REFLOW_DEBOUNCE_MS);
    });

    // The body, not the container: it outlives every barba swap.
    observer.observe(document.body);
}

function startPage() {
    currentPage = new Page();
    if (debugPanel) currentPage.bannerReveal.onChange = debugPanel.render;
    currentPage.start();
}

function startBanners() {
    if (currentPage) currentPage.startBanners();
}

function collapseBanner(project) {
    return currentPage ? currentPage.bannerReveal.collapse(project) : Promise.resolve();
}

function stopPage() {
    if (!currentPage) return;
    currentPage.stop();
    currentPage = null;
}

function startBarba() {
    /* Guarded, so a blocked CDN just means links do ordinary page loads and
       every load initialises through the handler below. */
    if (typeof barba === 'undefined') return;

    /* Without transitions.js the pages still swap, just instantly. Barba's
       afterEnter does not fire on the first load, only its own once hook does,
       so page one stays with the load handler and nothing is set up twice. */
    if (typeof PageTransition === 'undefined') {
        barba.hooks.beforeLeave(stopPage);
        barba.hooks.afterEnter(() => {
            window.scrollTo(0, 0); // barba leaves the scroll where it was
            startPage();
            startBanners();
        });
        barba.init();
        return;
    }

    /* Handed a set of callbacks rather than the Page itself, so the transition
       knows nothing about how any of this is put together. */
    pageTransition = new PageTransition({
        collapseBanner: collapseBanner,
        stop: stopPage,
        start: startPage,
        startBanners: startBanners,
    });

    barba.init(pageTransition.barbaConfig());
}

// Before paint, so nothing sized against --svh shifts once it lands.
runASAP(() => viewportHeight.start());

runOnceOnLoad(() => {
    setupSession();
    startPage();

    /* Straight away on the first load. On every load after this one the
       transition starts them, once the page has finished fading in. */
    startBanners();

    startBarba();
});
