/* Video visibility ----------------------------------------------------------
   Plays videos while they are on screen and pauses them once they leave, so
   nothing is decoding out of sight.

   It also does the work the autoplay attribute cannot. Barba parses a new page
   with DOMParser, whose document has no browsing context, so a media element
   in it never begins loading and its autoplay is passed over. Calling play()
   here starts the resource selection the attribute never got to, which is why
   videos autoplay after a page transition at all.

   What the viewer does wins. A video paused by hand stays paused however often
   it scrolls past, until it is played by hand again. That is decided by
   listening for play and pause rather than by wrapping the calls, so a play or
   pause button added later needs to know nothing about this file: it calls
   play() or pause() on the video and this follows along.

   Only videos that ought to be playing are started: one carrying the autoplay
   attribute, or one this paused when it went off screen and therefore owes a
   resume. A video the viewer never started is left alone, which is what makes
   this safe for a video with sound.

   Lives for one page.
-------------------------------------------------------------------------- */

/* Any part on screen counts. A margin or a higher threshold would only move
   where the edge falls, and starting a muted video costs little. */
const VIDEO_THRESHOLD = 0;

class VideoVisibility {

    constructor() {
        this.videos = [];
        this.observer = null;

        // Paused by hand. Not to be started again until played by hand.
        this.pausedByViewer = new Set();

        // Paused because it left the screen, so it is owed a resume.
        this.pausedWhileAway = new Set();

        /* Pauses asked for here whose event has not arrived yet. Kept apart
           from the set above, which resume() clears the moment a video comes
           back, possibly before the earlier pause event has been seen. */
        this.pausing = new Set();

        this.handleEntries = this.handleEntries.bind(this);
        this.handlePlay = this.handlePlay.bind(this);
        this.handlePause = this.handlePause.bind(this);
    }

    start() {
        this.videos = Array.from(activeContainer().querySelectorAll('video'));
        if (this.videos.length === 0) return;

        this.videos.forEach((video) => {
            video.addEventListener('play', this.handlePlay);
            video.addEventListener('pause', this.handlePause);
        });

        this.observer = new IntersectionObserver(this.handleEntries, {
            threshold: VIDEO_THRESHOLD,
        });

        this.videos.forEach((video) => this.observer.observe(video));
    }

    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Listeners first, so the pauses below are not mistaken for the viewer's.
        this.videos.forEach((video) => {
            video.removeEventListener('play', this.handlePlay);
            video.removeEventListener('pause', this.handlePause);

            /* Stopped on the way out. Barba keeps the outgoing container in the
               document until the new page has finished arriving, so a video left
               running would go on being heard for the whole transition. */
            if (!video.paused) video.pause();
        });

        this.videos = [];
        this.pausedByViewer.clear();
        this.pausedWhileAway.clear();
        this.pausing.clear();
    }

    handleEntries(entries) {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                this.resume(entry.target);
            } else {
                this.suspend(entry.target);
            }
        });
    }

    resume(video) {
        if (this.pausedByViewer.has(video)) return;

        // Nothing to resume: this one was never playing to begin with.
        if (!video.autoplay && !this.pausedWhileAway.has(video)) return;

        this.pausedWhileAway.delete(video);

        /* A play cut short by a pause rejects, which fast scrolling makes
           routine, and a blocked autoplay rejects as well. Neither matters. */
        const started = video.play();
        if (started) started.catch(() => {});
    }

    suspend(video) {
        // Already paused, so pause() would fire nothing and settle nothing.
        if (video.paused) return;

        this.pausing.add(video);
        this.pausedWhileAway.add(video);

        video.pause();
    }

    // However it started, it is no longer being held back.
    handlePlay(event) {
        this.pausedByViewer.delete(event.target);
    }

    handlePause(event) {
        // Ours, from the video going off screen.
        if (this.pausing.delete(event.target)) return;

        /* Nothing else here pauses a video, so this came from outside: the
           viewer, through whatever control they were given. */
        this.pausedByViewer.add(event.target);
    }
}
