/* Page transitions ----------------------------------------------------------
   Fades the page out and back in around a barba swap.

   Leaving, two things happen at once. Everything fades out immediately, so a
   click is answered straight away, except the clicked project's banner: that
   one retracts fully and only then fades, which reads as a banner closing
   rather than dissolving half open. Other banners get no special treatment and
   go with the content. The bullet stays put through all of it, because the
   doppelganger is sitting on top of it.

   Entering, the page waits for its hero to be showable and then fades in as
   one piece.

   Runs with sync:false, barba's default: leave finishes, the old container is
   taken out of layout, and only then is the new one added. sync:true is a one
   word change and everything below works either way, but false is the better
   default here. It starts the fade the instant a link is clicked rather than
   waiting on the fetch, and the new container lands at the top of the document
   instead of below the outgoing one, which is what lets autoplay and lazy
   loading behave as they would on a normal page load.

   Optional in both directions. Without this file page.js falls back to an
   instant swap, and without bullet-doppelganger.js the transition simply runs
   without it.
-------------------------------------------------------------------------- */

const FADE_DURATION_MS = 280;
const FADE_EASING = 'cubic-bezier(0.33, 0, 0.2, 1)';

/* How long to give the incoming hero before fading in regardless. Long on
   purpose: arriving with the video already running is worth the wait, and
   passing it means falling back to the poster, not to nothing. */
const HERO_WAIT_LIMIT_MS = 3000;

/* How long the hero has to take before the doppelganger starts pulsing. Below
   this a pulse would only register as a glitch. */
const HERO_BREATHE_AFTER_MS = 300;

/* Matches .is-loading in the stylesheet, which the document head adds. */
const LOADING_CLASS = 'is-loading';

/* A hidden page must never stay hidden. Load waits on every eager image, and
   one that never finishes would otherwise hold the whole page back. */
const FIRST_PAINT_LIMIT_MS = 8000;

const TRANSITION_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

/* Null rather than the document fallback activeContainer() gives, since the
   caller sets a style on whatever comes back. */
function transitionContainer() {
    const found = activeContainer();
    return found === document ? null : found;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Everything in the container except one element that has to outlast it.

   Walks from the held element up to the container, collecting every sibling
   passed on the way. The elements on that path are not faded themselves, but
   they are only wrappers, and everything they show is among the siblings.

   Nothing is named, so whatever the markup grows is carried along, and an
   opacity is never applied inside another one and compounded. With nothing to
   hold back it is just the container, faded as one piece. */
function everythingBut(container, held) {
    if (!held || held === container || !container.contains(held)) return [container];

    const group = [];

    for (let node = held; node !== container; node = node.parentElement) {
        Array.from(node.parentElement.children).forEach((sibling) => {
            if (sibling !== node) group.push(sibling);
        });
    }

    return group;
}

/* Animated with the Web Animations API rather than CSS transitions: the timing
   stays out of the stylesheet, which owns the runtime look of the site, and
   finished is a reliable end signal where transitionend has not always been on
   iOS. A cancelled animation rejects, and a cut short fade is not an error. */
function settled(animations) {
    return Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
}

// No cleanup: these are on a container that is about to be thrown away.
function fadeOut(elements) {
    return settled(elements.map((el) => el.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: FADE_DURATION_MS, easing: FADE_EASING, fill: 'forwards' }
    )));
}

/* Ends by handing the element back to the stylesheet: the inline opacity goes
   first, then the animation holding the end value, so there is never a frame
   showing the start value in between. */
async function fadeIn(element) {
    const animation = element.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: FADE_DURATION_MS, easing: FADE_EASING, fill: 'forwards' }
    );

    await settled([animation]);

    element.style.removeProperty('opacity');
    animation.cancel();
}

/* The project a navigation started from, when a link inside one was clicked.
   Null for history moves and for anything on a project page. */
function clickedProject(data) {
    return data.trigger instanceof HTMLElement ? data.trigger.closest('.project') : null;
}

/* Resolves once the incoming page's hero can be shown, or when the limit runs
   out. Anything without a hero resolves at once. */
function whenHeroReady(container) {
    const hero = container.querySelector('.hero');
    if (!hero) return Promise.resolve();

    const ready = new Promise((resolve) => {
        if (hero.tagName === 'IMG') {
            if (hero.complete) return resolve();

            hero.addEventListener('load', resolve, { once: true });
            hero.addEventListener('error', resolve, { once: true });
            return;
        }

        if (hero.readyState >= 3) return resolve();   // HAVE_FUTURE_DATA

        hero.addEventListener('canplay', resolve, { once: true });
        hero.addEventListener('error', resolve, { once: true });

        /* Nothing would ever fire otherwise. Barba parses the page with
           DOMParser, whose document has no browsing context, so a media
           element in it never begins loading and its autoplay is passed over.
           This starts it, and re-arms autoplay along the way. */
        if (hero.networkState === HTMLMediaElement.NETWORK_EMPTY) hero.load();
    });

    // A missing or stalled asset must not hold the navigation for ever.
    return Promise.race([ready, wait(HERO_WAIT_LIMIT_MS)]);
}

/* Stands in for the doppelganger when that file is not loaded, so the
   transition does not have to check before every call. */
const NO_DOPPELGANGER = {
    capture: function () {},
    fly: function () { return Promise.resolve(); },
    breathe: function () {},
    settle: function () { return Promise.resolve(); },
    release: function () {},
};

class PageTransition {

    /* page is the set of callbacks page.js hands over: collapseBanner, stop,
       start and startBanners. Nothing here reaches for a Page directly. */
    constructor(page) {
        this.page = page;
        this.leaveFinished = Promise.resolve();

        // URL -> scrollY, so back and forward can return to where they were.
        this.scrollPositions = new Map();
        this.scrollbarWidth = 0;

        this.doppelganger = typeof BulletDoppelganger === 'undefined'
            ? NO_DOPPELGANGER
            : new BulletDoppelganger();

        this.hideNextContainer = this.hideNextContainer.bind(this);
        this.leave = this.leave.bind(this);
        this.enter = this.enter.bind(this);
    }

    barbaConfig() {
        // Otherwise the browser restores scroll on popstate and fights us.
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

        // Hides the incoming container the moment it lands, before any paint.
        barba.hooks.nextAdded(this.hideNextContainer);

        return {
            /* False keeps leave and enter sequential and lets barba overlap the
               fetch with the leave animation. See the note at the top before
               changing it. */
            sync: false,
            preventRunning: true,
            transitions: [{ name: 'fade', leave: this.leave, enter: this.enter }],
        };
    }

    hideNextContainer(data) {
        if (TRANSITION_REDUCED_MOTION.matches) return;
        data.next.container.style.opacity = '0';
    }

    /* Leaving ---------------------------------------------------------------

       Assigned before returning rather than awaited by barba alone, so that
       enter can wait on it under sync:true, where the two run at once. */
    leave(data) {
        this.leaveFinished = this.runLeave(data);
        return this.leaveFinished;
    }

    async runLeave(data) {
        this.lock();
        this.scrollPositions.set(data.current.url.href, window.scrollY);

        /* Copied before anything moves, so the bullet is never seen to jump and
           the click has something to show for itself right away. */
        this.doppelganger.capture(data);

        /* The clicked project's banner is the one that gets to close properly.
           Null on any other kind of navigation, and then the whole container
           simply fades as one piece. */
        const project = clickedProject(data);
        const banner = project ? project.querySelector('.banner') : null;

        if (TRANSITION_REDUCED_MOTION.matches) {
            await this.page.collapseBanner(project);
        } else {
            await Promise.all([
                // Away at once, so the click is answered without waiting.
                fadeOut(everythingBut(data.current.container, banner)),

                // Fully retracted first, then gone.
                this.page.collapseBanner(project)
                    .then(() => fadeOut(banner ? [banner] : [])),
            ]);
        }

        /* Out of layout rather than removed. Barba only removes it after enter
           finishes, and until then it would sit above the new container and
           throw off every measurement taken there.

           The hidden attribute rather than a style, because activeContainer()
           in utils.js keys off it: every feature scopes its queries that way,
           so none of them start themselves on this page as it leaves. */
        data.current.container.hidden = true;

        this.page.stop();
    }

    /* Entering ------------------------------------------------------------ */

    enter(data) {
        return this.runEnter(data);
    }

    async runEnter(data) {
        await this.leaveFinished;

        try {
            const container = data.next.container;

            /* Started before anything is awaited, so the hero loads during the
               doppelganger's flight rather than after it. */
            const heroReady = whenHeroReady(container);

            this.restoreScroll(data);
            this.page.start();

            await this.doppelganger.fly();
            await this.breatheUntil(heroReady);

            /* The container as one piece, so everything arrives together and
               anything added to a page later comes with it. */
            if (TRANSITION_REDUCED_MOTION.matches) {
                container.style.removeProperty('opacity');
            } else {
                await fadeIn(container);
            }

            this.doppelganger.release();
            this.page.startBanners();
        } finally {
            // Even if something above threw, the page has to be usable again.
            this.unlock();
        }
    }

    // The pulse is the only sign of life while a slow hero loads.
    async breatheUntil(ready) {
        const startPulse = setTimeout(() => this.doppelganger.breathe(), HERO_BREATHE_AFTER_MS);

        await ready;

        clearTimeout(startPulse);
        await this.doppelganger.settle();
    }

    /* Back and forward return to where the page was left, everything else
       starts at the top. Barba works the direction out itself, so trigger is
       already 'back' or 'forward' rather than 'popstate'. */
    restoreScroll(data) {
        const isHistoryMove = data.trigger === 'back' || data.trigger === 'forward';
        const remembered = this.scrollPositions.get(data.next.url.href);

        window.scrollTo(0, isHistoryMove && remembered ? remembered : 0);
    }

    /* Locking -------------------------------------------------------------

       Scrolling and clicking are off for the whole transition: the page is
       mid-animation and half of it is about to be replaced. Switching pointer
       events off also stops the hover rule that opens a banner on a desktop,
       which is what lets collapseBanner close it. */
    lock() {
        const root = document.documentElement;

        // The scrollbar is about to vanish, which would shift the page sideways.
        this.scrollbarWidth = window.innerWidth - root.clientWidth;

        /* Hidden still scrolls programmatically, it only stops the user, so
           the scroll to the top below still works. */
        root.style.overflow = 'hidden';
        if (this.scrollbarWidth > 0) root.style.paddingRight = `${this.scrollbarWidth}px`;

        const wrapper = document.querySelector('[data-barba="wrapper"]');
        if (wrapper) wrapper.style.pointerEvents = 'none';
    }

    unlock() {
        const root = document.documentElement;
        root.style.removeProperty('overflow');
        root.style.removeProperty('padding-right');

        const wrapper = document.querySelector('[data-barba="wrapper"]');
        if (wrapper) wrapper.style.removeProperty('pointer-events');
    }
}

/* First load ----------------------------------------------------------------
   The container starts hidden from the stylesheet, under a class the document
   head adds before any of this file is parsed. Hiding it here instead would be
   too late: on a slow connection the page paints, blanks, and only then fades.

   Revealed once everything has loaded and the fonts are ready, so the page
   arrives already set rather than reflowing as the faces swap in. Images below
   the fold are lazy, so waiting on load does not mean waiting on all of them.

   Deleting this file leaves the class on, so the rule in the stylesheet goes
   with it.
-------------------------------------------------------------------------- */

function revealFirstPage() {
    const container = transitionContainer();
    const animate = container && !TRANSITION_REDUCED_MOTION.matches;

    /* Taken over inline before the class comes off, so dropping the class
       cannot reveal the page a frame early. fadeIn clears it again at the end. */
    if (animate) container.style.opacity = '0';

    document.documentElement.classList.remove(LOADING_CLASS);

    if (animate) fadeIn(container);
}

Promise.race([
    new Promise((resolve) => runAfterFontsLoad(resolve)),
    wait(FIRST_PAINT_LIMIT_MS),
]).then(revealFirstPage);
