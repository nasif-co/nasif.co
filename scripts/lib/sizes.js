// Default sizes attributes for images, so they do not have to be written out
// per image. An author only writes data-sizes to override one of these.
//
// Four places an image can sit on this site, so four strings. They were worked
// out once from the layout and written down, which is the whole of the file
// apart from choosing between them at the bottom.
//
// IMPORTANT: these mirror site/css/style.css and nothing checks that they still
// agree. The symptom of a mismatch is a quietly slightly wrong variant, not an
// error, so if you change any of the numbers in the table below, recalculate.

/* Everything the widths are derived from, as the stylesheet has it.
   The content box is 100vw less the body padding and .main-content's padding,
   capped by .main-content at 1600px — so it stops growing at a 1860px viewport.
   The grid is two equal columns with a gap between them.

     viewport     --horizontal-pad   --banner-extents   inset   --gap
     1 - 450      5.5                24.5               60      10
     451 - 575    5.5                33                 77      10
     576 - 768    5.5                45                 101     15
     769 - 830    10                 65                 150     20
     831 - 1099   10                 65                 150     30
     1100 +       30                 100                260     35

   inset is 2 * pad + 2 * extents: what comes off the viewport either side.
   A full width image is the content box. A single column is half of it less
   half the gap, so (100vw - inset - gap) / 2. At 1860px and up the content box
   is a flat 1600px, making those 1600px and 783px.

   Note that the 769-830 and 831-1099 bands differ only by gap, which is why the
   full width string has one fewer clause than the others. */

/** A grid item spanning both columns: the whole content box. */
const FULL = [
  "(min-width: 1860px) 1600px",
  "(min-width: 1100px) calc(100vw - 260px)",
  "(min-width: 769px) calc(100vw - 150px)",
  "(min-width: 576px) calc(100vw - 101px)",
  "(min-width: 451px) calc(100vw - 77px)",
  "calc(100vw - 60px)",
].join(", ");

/** One of the two columns. */
const HALF = [
  "(min-width: 1860px) 783px",
  "(min-width: 1100px) calc((100vw - 295px) / 2)",
  "(min-width: 831px) calc((100vw - 180px) / 2)",
  "(min-width: 769px) calc((100vw - 170px) / 2)",
  "(min-width: 576px) calc((100vw - 116px) / 2)",
  "(min-width: 451px) calc((100vw - 87px) / 2)",
  "calc((100vw - 70px) / 2)",
].join(", ");

/** Half, until .mobile-double-wide starts spanning both columns at 575px. */
const MOBILE_FULL = [
  "(min-width: 1860px) 783px",
  "(min-width: 1100px) calc((100vw - 295px) / 2)",
  "(min-width: 831px) calc((100vw - 180px) / 2)",
  "(min-width: 769px) calc((100vw - 170px) / 2)",
  "(min-width: 576px) calc((100vw - 116px) / 2)",
  "(min-width: 451px) calc(100vw - 77px)",
  "calc(100vw - 60px)",
].join(", ");

/* The hero, which is not in a grid and is cropped by object-fit: cover, so its
   height can be what decides rather than its width.

   The 4 / 3 is that crop: a 16:9 master in a 12:9 box is scaled to fill the
   height, so the source has to be (16/9) / (12/9) wider than the box. Cut the
   masters to 12:9 to match the box and the factor becomes 1, and the 16 / 9 in
   the portrait clause below becomes 12 / 9.

   Overestimates on purpose where the layout reverts to a short hero: too large
   only costs bytes, too small is visibly blurry. The phone clause has to come
   first, or a phone would match the portrait clause and pull the largest file
   there is for an image 330px wide. */
const HERO = [
  "(max-width: 450px) calc((100vw - 60px) * 4 / 3)",
  "(max-aspect-ratio: 1/1) calc(90vh * 16 / 9)",
  "(min-width: 1860px) 2133px",
  "(min-width: 1100px) calc((100vw - 260px) * 4 / 3)",
  "(min-width: 769px) calc((100vw - 150px) * 4 / 3)",
  "(min-width: 576px) calc((100vw - 101px) * 4 / 3)",
  "(min-width: 451px) calc((100vw - 77px) * 4 / 3)",
  "calc((100vw - 60px) * 4 / 3)",
].join(", ");

export const IMAGE_SIZES = { hero: HERO, full: FULL, mobileFull: MOBILE_FULL, half: HALF };

/** A class attribute's value split into names. */
function tokens(classAttr) {
  return classAttr.trim().split(/\s+/).filter(Boolean);
}

/** The class value out of a tag's raw attribute text. */
function classAttrOf(attrText) {
  return attrText.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
}

/**
 * Which of the four an image gets, from its own class and its wrapper's.
 *
 * precedingHtml is everything before the tag, and the match is anchored to its
 * end, so this reads the wrapper's opening tag and nothing else — every image
 * on the site is the only child of an <a> or a <figure>. An image with no
 * wrapper is an unknown, and gets the full width rather than risk being blurry.
 */
export function defaultSizes(classAttr, precedingHtml) {
  if (tokens(classAttr).includes("hero")) return IMAGE_SIZES.hero;

  const wrapper = precedingHtml.match(/<(?:a|figure)\b([^>]*)>\s*$/i);
  if (!wrapper) return IMAGE_SIZES.full;

  /* Exact class names, not a pattern: \bdouble-wide\b also matches inside
     mobile-double-wide, since a hyphen counts as a word boundary. */
  const wrapperClasses = tokens(classAttrOf(wrapper[1]));

  if (wrapperClasses.includes("mobile-double-wide")) return IMAGE_SIZES.mobileFull;
  if (wrapperClasses.includes("double-wide")) return IMAGE_SIZES.full;

  return IMAGE_SIZES.half;
}
