/* Email protection ----------------------------------------------------------
   Undoes Cloudflare's email obfuscation on a page barba has brought in.

   With the setting on, Cloudflare rewrites any address in the HTML it serves
   into a placeholder carrying the real one in hex:

       <span class="__cf_email__" data-cfemail="…">[email protected]</span>

   and injects a script that turns it back. That script runs once, on the first
   load. Barba fetches later pages and inserts their markup without executing
   anything in it, so every page after the first keeps the placeholder — and
   the copy button would put "[email protected]" on the clipboard.

   The obfuscation is a single-byte XOR: the first pair of hex digits is the
   key, the rest is the address. So this does the same job as their script,
   per page, and the HTML served to a scraper is still obfuscated.

   Delete this file if email obfuscation is ever turned off; nothing else
   refers to it.
-------------------------------------------------------------------------- */

const CF_EMAIL_CLASS = '__cf_email__';
const CF_EMAIL_HREF = '/cdn-cgi/l/email-protection';

/** Returns the address, or null if the hex is not what we expect. */
function decodeCloudflareEmail(hex) {
    if (!hex || hex.length < 4 || hex.length % 2 !== 0) return null;

    const key = parseInt(hex.slice(0, 2), 16);
    if (Number.isNaN(key)) return null;

    let address = '';
    for (let i = 2; i < hex.length; i += 2) {
        const byte = parseInt(hex.slice(i, i + 2), 16);
        if (Number.isNaN(byte)) return null;

        address += String.fromCharCode(byte ^ key);
    }

    // A sanity check rather than validation: anything else is not an address,
    // and putting it on the page would be worse than leaving the placeholder.
    return address.includes('@') ? address : null;
}

class EmailProtection {

    start() {
        const root = activeContainer();

        /* Replaced by a plain text node rather than filled in, so the markup
           ends up as it was written and button.textContent is the address. */
        root.querySelectorAll(`.${CF_EMAIL_CLASS}`).forEach((placeholder) => {
            const address = decodeCloudflareEmail(placeholder.dataset.cfemail);
            if (address) placeholder.replaceWith(document.createTextNode(address));
        });

        /* A mailto link has its address moved into the fragment instead. None
           on the site yet, but one added later would break the same way. */
        root.querySelectorAll(`a[href*="${CF_EMAIL_HREF}"]`).forEach((link) => {
            const address = decodeCloudflareEmail(link.getAttribute('href').split('#')[1]);
            if (address) link.setAttribute('href', `mailto:${address}`);
        });
    }

    // Nothing to undo: these elements leave with their container.
    stop() {}
}
