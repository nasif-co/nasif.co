/* Image loading -------------------------------------------------------------
   Makes images and videos appear rather than pop in, and takes over from
   native lazy loading once the page itself has arrived.

   Two jobs, with very different timing.

   Catching. Anything that has not arrived yet is hidden and its wrapper
   marked, so the stylesheet can pulse a grey placeholder in the space the
   build has already reserved; when it lands it fades in and the placeholder
   goes. This has to happen before the browser has had a chance to paint
   anything, which is well before Page exists — so it runs from the bottom of
   this file on the way past, and again for each page barba brings in.

   Releasing. The images the browser is still holding back are walked in
   document order and let go two at a time, so the page fills from the top down
   instead of waiting for someone to scroll. That has to happen after the load
   event, or it would delay it.

   Nothing is hidden until it is known to still be loading, so anything already
   in the cache is left alone and a failure in here leaves the page visible
   rather than blank.

   Videos take part only when they have a poster, which is the frame the build
   extracts for them. The wait is on the poster image, never on playback, so a
   video that is never scrolled to cannot leave a placeholder pulsing for ever.
   Without a build there are no posters, and videos simply appear as before.
-------------------------------------------------------------------------- */

const IMAGE_FADE_MS = 500;
const IMAGE_FADE_EASING = 'cubic-bezier(0.33, 0, 0.2, 1)';

// Goes on the wrapper, not the media: see .media-loading in the stylesheet.
const IMAGE_LOADING_CLASS = 'media-loading';

/* Two at a time. One would leave the connection idle through every round trip,
   and many would arrive in no particular order. */
const IMAGE_QUEUE_CONCURRENCY = 2;

const IMAGE_SLOW_CONNECTIONS = ['slow-2g', '2g'];

/* What has been caught already, so the pass at the bottom of this file and the
   one in start() never both take the same element. Weak, so an element removed
   with its container takes its entry with it. */
const caughtMedia = new WeakMap();

/* Resolves when an image has arrived, or failed. A failure resolves too: a
   broken image should stop pulsing and show whatever the browser shows. */
function whenImageLoaded(image) {
    if (image.complete) return Promise.resolve();

    return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
    });
}

/* A video is ready to be seen once its poster is, so this waits on a separate
   request for the same URL — the browser serves both from one response.
   Deliberately not loadeddata: nothing loads a video here, and a video off
   screen is never played, so that would wait for ever. */
function whenPosterLoaded(video) {
    const poster = video.getAttribute('poster');
    if (!poster) return null;

    const probe = new Image();
    probe.src = poster;
    return whenImageLoaded(probe);
}

// The viewer's preference about their own data wins over smooth scrolling.
function shouldForceImageLoad() {
    const connection = navigator.connection;
    if (!connection) return true;
    if (connection.saveData) return false;

    return !IMAGE_SLOW_CONNECTIONS.includes(connection.effectiveType);
}

/* The placeholder fills its wrapper, so the wrapper's box has to be this
   element's box and nothing else. A parent holding other things as well is not
   a wrapper, and marking it would be wrong twice over: the placeholder would
   cover its siblings, and .media-loading's position:relative would make it the
   containing block for any absolutely positioned descendant.

   That second one is not hypothetical. The hero video's parent is the whole
   <section class="project-hero">, which also contains .hero-meta and therefore
   .bullet-track — so marking it moved the project bullet sideways by the width
   of .main-content's padding until the poster finished loading. */
function markWrapper(element, loading) {
    const wrapper = element.parentElement;
    if (!wrapper || wrapper.children.length !== 1) return;

    wrapper.classList.toggle(IMAGE_LOADING_CLASS, loading);
}

/* Hides one element that has not arrived and arranges its fade. Idempotent, so
   the two passes can both call it, and standalone rather than a method so the
   first page can be caught long before there is a Page to own it.

   Returns a promise for the arrival, which is what the queue waits on — never
   the fade, or one image's animation would hold up the next one's download. */
function catchMedia(element) {
    const already = caughtMedia.get(element);
    if (already) return already;

    const arrival = element.tagName === 'VIDEO'
        ? whenPosterLoaded(element)
        : (element.complete ? null : whenImageLoaded(element));

    // Already here, or nothing to wait for. Either way, leave it alone.
    if (arrival === null) return null;

    caughtMedia.set(element, arrival);

    element.style.opacity = '0';
    markWrapper(element, true);

    arrival.then(() => revealMedia(element));
    return arrival;
}

async function revealMedia(element) {
    /* decode() after load and never before. On an image the browser is still
       holding back it would start the download itself and undo the queue's
       ordering; here it only means the fade cannot begin on a frame the image
       is not ready to paint on. */
    if (element.decode) await element.decode().catch(() => {});

    // Gone with its container mid-flight, so there is nothing left to show.
    if (!element.isConnected) return;

    // The placeholder goes first, so the two are never both visible.
    markWrapper(element, false);

    const fade = element.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: IMAGE_FADE_MS, easing: IMAGE_FADE_EASING, fill: 'forwards' }
    );

    await fade.finished.catch(() => {});

    /* Handed back to the stylesheet: the inline value first, then the animation
       holding the end value, so no frame shows opacity 0. */
    element.style.removeProperty('opacity');
    fade.cancel();
}

class ImageLoading {

    constructor() {
        this.queue = [];
        this.arrivals = new Map();   // image -> promise of its arrival
        this.stopped = false;
    }

    start() {
        this.stopped = false;

        const root = activeContainer();
        const media = Array.from(root.querySelectorAll('img, video[poster]'));

        // Page one is caught at the bottom of this file; this is for barba's.
        media.forEach((element) => {
            const arrival = catchMedia(element);
            if (arrival) this.arrivals.set(element, arrival);
        });

        /* Only what the browser is holding back. Anything eager is already on
           its way, and anything complete came out of the cache. */
        this.queue = Array.from(root.querySelectorAll('img')).filter(
            (image) => !image.complete && image.loading === 'lazy'
        );

        if (!shouldForceImageLoad()) return;

        for (let worker = 0; worker < IMAGE_QUEUE_CONCURRENCY; worker += 1) this.pump();
    }

    /* Only the queue is abandoned. Anything mid-fade is left to finish or to be
       thrown away with its container, which revealMedia checks for. */
    stop() {
        this.stopped = true;
        this.queue = [];
        this.arrivals = new Map();
    }

    /* One worker. Each takes the next image in document order and waits for it
       before taking another, so the page fills downwards. */
    async pump() {
        while (!this.stopped && this.queue.length > 0) {
            const image = this.queue.shift();

            // Low, so this never competes with a hero that is still arriving.
            image.setAttribute('fetchpriority', 'low');

            // Changing lazy to eager is what starts the download.
            image.loading = 'eager';

            await this.arrivals.get(image);
        }
    }
}

/* First page ----------------------------------------------------------------
   On the way past, before the browser has painted and long before the load
   event. Doing this from start() instead was too late: the load event waits
   for every image the browser decided to fetch, and under throttling it
   decides to fetch most of them, so they had already arrived and rendered in
   bands by the time anything here ran.
-------------------------------------------------------------------------- */

document.querySelectorAll('img, video[poster]').forEach(catchMedia);
