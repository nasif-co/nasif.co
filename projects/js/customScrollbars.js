function runOnceOnLoad( callbackFunc, timeAfterLoad = 0 ){
	if ( document.readyState === "complete" ) {
		if(timeAfterLoad == 0){
			callbackFunc();
		}else{
			setTimeout(callbackFunc, timeAfterLoad);
		}
	} else { //Sino
		window.addEventListener( 'load', function() {
			if(timeAfterLoad == 0){
				callbackFunc();
			}else{
				setTimeout(callbackFunc, timeAfterLoad);
			}
		} );
	}
}

runOnceOnLoad( initScrollbars );

function initScrollbars() {
    OverlayScrollbars(document.querySelector('.project-gallery-wrapper'), { }); 

    document.querySelector( '.os-viewport' ).classList.add('dragscroll');
    dragscroll.reset();
}

runOnceOnLoad( setupTippy );

let scrollReminder = null;

function setupTippy() {
	let noHoverQuery = window.matchMedia("(hover: none)");

	if( !noHoverQuery.matches ){
		let lastDateAccessed = localStorage.getItem('lastDateScrolled');
		if( lastDateAccessed !== null) {
			lastDateAccessed = new Date( lastDateAccessed );
		}
		const today = new Date();

		//Scroll reminder for the project gallery
		if( lastDateAccessed == null || Math.abs( today - lastDateAccessed ) > 86400000 ) { //Only if sessionStorage says it hasn't been shown this session
			scrollReminder = tippy('.project-gallery-wrapper', {
				content: 'Scroll horizontally or drag with your pointer to see more media!',
				followCursor: true,
				hideOnClick: false,
				arrow: false,
				theme: 'rightarrow'
			});
		}

		document.querySelector('.os-viewport').addEventListener("scroll", function() {
			if( scrollReminder !== null ){
				scrollReminder[0].disable();
				console.log('Cleared scroll reminder.');
			}
			localStorage.setItem( 'lastDateScrolled', today.toString() );
		}, {once : true});
		
		//Other informational tippies
		tippy('[data-tippy-content]', {
			followCursor: true,
			arrow: false,
		});
	}
}

