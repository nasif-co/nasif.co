/* Bullet doppelganger -------------------------------------------------------
   Carries the project bullet across a home to project transition.

   On the way out, a copy of the clicked project's bullet is dropped on top of
   the real one and left there. The real one fades out underneath it, so the
   copy looks like the same bullet staying put while the rest of the page
   leaves. On the way in it slides to where .project-bullet sits on the new
   page, the page fades in around it, and then it is taken away: the real
   bullet has faded in underneath by then, so nothing is seen to change.

   While it waits for the new page's hero to load it pulses gently, which is
   the only sign of life on an otherwise blank screen.

   Home to project only. Going the other way there is nothing to hand over.

   Entirely optional. transitions.js substitutes a set of empty methods when
   this file is not loaded, so deleting it is all that removing it takes.
-------------------------------------------------------------------------- */

const DOPPELGANGER_DURATION_MS = 520;
const DOPPELGANGER_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

// Above everything, including the banner at z-index 2.
const DOPPELGANGER_Z_INDEX = 9999;

// One breath in, or out: the pulse alternates, so a full cycle is twice this.
const DOPPELGANGER_BREATH_MS = 800;
const DOPPELGANGER_BREATH_SCALE = 1.22;

// How long easing back to rest takes when the wait is over.
const DOPPELGANGER_SETTLE_MS = 220;

class BulletDoppelganger {

    constructor() {
        this.clone = null;
        this.from = null;
        this.breathing = null;
    }

    /* Called during leave, after the banners have finished collapsing so the
       bullet is copied where it has actually come to rest rather than
       mid-animation. */
    capture(data) {
        this.release();
        if (!this.appliesTo(data)) return;

        const project = data.trigger.closest('.project');
        const bullet = project ? project.querySelector('.bullet') : null;
        if (!bullet) return;

        const rect = bullet.getBoundingClientRect();
        if (!rect.width) return;   // not rendered, nothing to copy

        this.from = rect;
        this.clone = bullet.cloneNode(true);
        this.clone.setAttribute('aria-hidden', 'true');

        /* Fixed, and appended outside the barba wrapper, so that swapping the
           container underneath does not disturb it. */
        this.clone.style.cssText = [
            'position:fixed',
            `top:${rect.top}px`,
            `left:${rect.left}px`,
            `width:${rect.width}px`,
            `height:${rect.height}px`,
            'margin:0',
            `z-index:${DOPPELGANGER_Z_INDEX}`,
            'pointer-events:none',
        ].join(';');

        document.body.appendChild(this.clone);
    }

    /* One direction only, and only when a link inside a project started it.

       Deliberately says nothing about the incoming page. Barba fetches it
       alongside the leave animation, so data.next.namespace is still empty
       while this runs. Whether the new page has a bullet to fly to is settled
       in fly() instead, which releases the copy if it finds none. */
    appliesTo(data) {
        return (
            data.current.namespace === 'index' &&
            data.trigger instanceof HTMLElement &&
            data.trigger.closest('.project') !== null
        );
    }

    /* Called during enter, once the new page is in place and scrolled but
       before it fades in, so this is the only bullet visible while it moves.

       getBoundingClientRect includes the target's own transform, so this lands
       where the bullet actually appears rather than where it is laid out. */
    async fly() {
        if (!this.clone) return;

        const target = activeContainer().querySelector('.project-bullet');
        if (!target) return this.release();

        const to = target.getBoundingClientRect();

        /* The translate property rather than a transform, so that the pulse
           below can animate scale without the two overwriting each other.
           Individual transform properties apply before transform, and scale
           before translate, so the pulse happens in place wherever this has
           got to. */
        const animation = this.clone.animate(
            [
                { translate: '0px 0px' },
                { translate: `${to.left - this.from.left}px ${to.top - this.from.top}px` },
            ],
            {
                duration: DOPPELGANGER_DURATION_MS,
                easing: DOPPELGANGER_EASING,
                fill: 'forwards',
            }
        );

        await animation.finished.catch(() => {});
    }

    // Runs until settle() is called, or until the copy is taken away.
    breathe() {
        if (!this.clone || this.breathing) return;

        this.breathing = this.clone.animate(
            [{ scale: 1 }, { scale: DOPPELGANGER_BREATH_SCALE }],
            {
                duration: DOPPELGANGER_BREATH_MS,
                iterations: Infinity,
                direction: 'alternate',
                easing: 'ease-in-out',
            }
        );
    }

    /* Eased back to rest from wherever the pulse had got to. Cancelling on its
       own would snap it, so the size is read before the loop is stopped. */
    async settle() {
        if (!this.breathing) return;

        const reached = getComputedStyle(this.clone).scale;

        this.breathing.cancel();
        this.breathing = null;

        if (reached === 'none') return;

        const back = this.clone.animate(
            [{ scale: reached }, { scale: 1 }],
            { duration: DOPPELGANGER_SETTLE_MS, easing: 'ease-out', fill: 'forwards' }
        );

        await back.finished.catch(() => {});
    }

    // The real bullet has faded in underneath, so this goes unnoticed.
    release() {
        if (!this.clone) return;

        if (this.breathing) this.breathing.cancel();
        this.breathing = null;

        this.clone.remove();
        this.clone = null;
        this.from = null;
    }
}
