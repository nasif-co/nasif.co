/* Viewport height -----------------------------------------------------------
   Publishes the small viewport height as --svh on :root, in pixels, so the CSS
   can use calc(var(--svh) ...) in place of the svh unit.

   The unit is only as trustworthy as the browser. Safari keeps the layout
   viewport still while its toolbar moves, so svh is stable. Some other iOS
   browsers resize the layout viewport instead, collapsing svh, lvh and dvh
   into one moving number, and anything sized with it then changes height
   mid-scroll and shifts the page.

   In CSS write it as calc(var(--svh, 100svh) ...), so there is a sensible
   value before this runs and if it never does.

   Lives for the whole session. Started once, never stopped.
-------------------------------------------------------------------------- */

class ViewportHeight {

    constructor() {
        this.lastWidth = 0;
        this.svh = 0;
        this.lvh = 0;
    }

    start() {
        this.measure();
        this.lastWidth = window.innerWidth;

        /* On a phone only a rotation or a width change is a real resize. A
           toolbar sliding away fires resize too, and remeasuring on that is
           the exact thing this exists to prevent. On desktop all of them are
           real. */
        runEachResize(() => {
            const widthChanged = window.innerWidth !== this.lastWidth;
            if (!widthChanged && isMobile()) return;

            this.lastWidth = window.innerWidth;
            this.measure();
        }, false);
    }

    measure() {
        const probe = document.createElement('div');

        // Fixed and empty, so it adds nothing to the page height or scroll area.
        probe.style.cssText =
            'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;';
        document.body.appendChild(probe);

        probe.style.height = '100svh';
        this.svh = probe.getBoundingClientRect().height;

        probe.style.height = '100lvh';
        this.lvh = probe.getBoundingClientRect().height;

        probe.remove();

        /* When both read the same the browser is not distinguishing them, and
           this is just the viewport as it stands. At load the toolbar is
           normally showing, so that is the small viewport in any case. */
        document.documentElement.style.setProperty('--svh', `${Math.round(this.svh)}px`);
    }

    // For the debug panel. Apart means svh is trustworthy here, equal means not.
    getStatus() {
        return {
            svh: Math.round(this.svh),
            lvh: Math.round(this.lvh),
            distinct: Math.abs(this.lvh - this.svh) > 1,
        };
    }
}
