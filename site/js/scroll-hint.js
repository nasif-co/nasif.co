/* Scroll hint ---------------------------------------------------------------
   A project page opens on a full height hero, which can read as the whole
   page. If someone sits at the top long enough, .static-at-top goes on <html>
   and the CSS fades in the .hint. Clicking it scrolls down half a viewport.

   Once per page load. The first scroll down cancels the timer and drops the
   class for good: someone who has scrolled has understood there is more, and
   a hint reappearing later would only nag.

   Narrow layouts do not need it, so below the breakpoint the timer does not
   exist at all. Switched live, since a window can be resized across it.

   Lives for one page, and only where there is a .hint to point at.
-------------------------------------------------------------------------- */

// How long at the top before the hint appears.
const HINT_DELAY_MS = 3000;

const HINT_CLASS = 'static-at-top';

// How far a click scrolls, as a fraction of the viewport height.
const HINT_SCROLL_FRACTION = 0.8;

/* Anything past this counts as having scrolled down. Not 0: scroll positions
   are subpixel, and iOS goes negative while rubber-banding. */
const HINT_TOP_TOLERANCE_PX = 1;

// Where the layout stops needing the hint. Keep in step with the stylesheet.
const HINT_ENABLED_QUERY = window.matchMedia('(min-width: 768px)');

class ScrollHint {

    constructor() {
        this.hint = null;
        this.timeoutId = null;
        this.running = false;

        // True once the hint has had its one chance, taken or not.
        this.spent = false;

        this.reveal = this.reveal.bind(this);
        this.handleClick = this.handleClick.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleQueryChange = this.handleQueryChange.bind(this);
    }

    start() {
        this.hint = activeContainer().querySelector('.hint');
        if (!this.hint) return;   // not a project page

        /* Attached even while the hint is hidden. The CSS gives it
           pointer-events:none until the class lands, so it cannot be clicked
           before it is visible. */
        this.hint.addEventListener('click', this.handleClick);

        // Arriving part way down the page is its own answer.
        if (window.scrollY > HINT_TOP_TOLERANCE_PX) {
            this.spent = true;
            return;
        }

        this.handleQueryChange();
        HINT_ENABLED_QUERY.addEventListener('change', this.handleQueryChange);
    }

    stop() {
        if (!this.hint) return;

        HINT_ENABLED_QUERY.removeEventListener('change', this.handleQueryChange);
        this.hint.removeEventListener('click', this.handleClick);

        // The class is on <html>, which barba does not swap, so clear it here.
        this.cancel();

        this.hint = null;
        this.spent = false;
    }

    handleQueryChange() {
        if (HINT_ENABLED_QUERY.matches && !this.spent) {
            this.begin();
        } else {
            this.cancel();
        }
    }

    // Counting down, and watching for the scroll that makes it unnecessary.
    begin() {
        if (this.running) return;
        this.running = true;

        this.timeoutId = setTimeout(this.reveal, HINT_DELAY_MS);
        window.addEventListener('scroll', this.handleScroll, { passive: true });
    }

    // Leaves the page exactly as if this had never run.
    cancel() {
        if (!this.running) return;
        this.running = false;

        clearTimeout(this.timeoutId);
        this.timeoutId = null;
        window.removeEventListener('scroll', this.handleScroll);
        document.documentElement.classList.remove(HINT_CLASS);
    }

    /* Keeps running afterwards: the scroll listener is still what takes the
       hint back down again. */
    reveal() {
        this.timeoutId = null;
        document.documentElement.classList.add(HINT_CLASS);
    }

    handleScroll() {
        /* Position, not the event itself. Barba scrolls to the top after a
           transition, which fires a scroll at 0 that means nothing here. */
        if (window.scrollY <= HINT_TOP_TOLERANCE_PX) return;

        this.cancel();

        // For the rest of this page load, whatever the window does next.
        this.spent = true;
        HINT_ENABLED_QUERY.removeEventListener('change', this.handleQueryChange);
    }

    handleClick() {
        // The published height, so this matches what the layout was built on.
        const svh = getComputedStyle(document.documentElement).getPropertyValue('--svh');
        const viewportHeight = parseFloat(svh) || window.innerHeight;

        /* Browsers apply prefers-reduced-motion to CSS scroll-behavior but not
           to this, so it has to be asked here. */
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        window.scrollTo({
            top: viewportHeight * HINT_SCROLL_FRACTION,
            behavior: reduceMotion ? 'auto' : 'smooth',
        });
    }
}
