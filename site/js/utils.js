/* Utils ---------------------------------------------------------------------
   Small helpers shared by everything else. No state of its own.
-------------------------------------------------------------------------- */

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

function runAfterFontsLoad( callbackFunc, timeAfterLoad = 0 ) {

	const everythingLoaded = new Promise( function( resolve ) {
		if ( document.readyState === "complete" ) { //Si ya todo ha cargado
			resolve();
		} else { //Sino
			window.addEventListener( 'load', resolve ); //Esperar a que el browser avise que todo cargó
		}
	} );

	/* The load event does not cover fonts, and the stylesheet asks for
	   display=swap, so without this the fallback face shows first. */
	const fontsLoaded = document.fonts ? document.fonts.ready : Promise.resolve();

	Promise.all( [ everythingLoaded, fontsLoaded ] ).then( function() {
		if(timeAfterLoad == 0){
			callbackFunc();
		}else{
			setTimeout(callbackFunc, timeAfterLoad);
		}
	} );
}

/* The container barba is currently showing.

   Both are in the document during a transition: the outgoing one is hidden but
   stays until the new page has finished arriving, so a plain document query
   finds its elements too and a feature would start itself on a page that is on
   its way out. Falls back to the document, which is correct before barba has
   done anything.

   Hidden rather than styled out, so that there is a selector for it. */
function activeContainer() {
    return document.querySelector('[data-barba="container"]:not([hidden])') || document;
}

/* The same query the CSS uses to split hover styles from touch styles. Kept as
   a list so anything can listen for it changing, like a mouse being plugged
   into a touch device. */
const FINE_POINTER_QUERY = window.matchMedia('(pointer: fine)');

/* True for anything without a fine primary pointer. "Not fine" rather than
   "coarse", because pointer can also be "none" on devices with no pointing
   device at all, and those need the touch behaviour too. */
function isMobile() {
    return !FINE_POINTER_QUERY.matches;
}
