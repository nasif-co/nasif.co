function runEachResize( callbackFunc, runOnLoad = true, fireOnOrientChange = true ) {

	var resizeTimer; //variable que va a guardar el contador del setTimeout;

	if ( document.readyState === "complete" ) { //Si ya todo ha cargado
		if ( runOnLoad ) callbackFunc();
		initRunEachResize();
	} else { //Sino
		window.addEventListener( 'load', function() { //Esperar a que el browser avise que todo cargÃ³
			if ( runOnLoad ) callbackFunc();
			initRunEachResize();
		} );
	}

	function initRunEachResize() {
		window.addEventListener( 'resize', function() {
			clearTimeout( resizeTimer );
			resizeTimer = setTimeout( callbackFunc, 200 );
		} );

		if ( fireOnOrientChange ) {
			window.addEventListener( 'orientationchange', function() {
				clearTimeout( resizeTimer );
				resizeTimer = setTimeout( callbackFunc, 200 );
			} );
		}
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
		window.addEventListener( 'load', function() { //Esperar a que el browser avise que todo cargÃ³
			if(timeAfterLoad == 0){
				callbackFunc();
			}else{
				setTimeout(callbackFunc, timeAfterLoad);
			}
		} );
	}
}

runOnceOnLoad( initScrollObserver );

let scrollObserver = null;
let noHoverQuery = window.matchMedia("(hover: none)");

function initScrollObserver() {

    //Initialize the observer
    if( document.querySelector('.project-thumbnail').getBoundingClientRect().bottom < window.innerHeight ){
        if( document.querySelector('#p5bg') !== null ){
            document.querySelector('#p5bg').classList.add('blurry');
        }
    }
    scrollObserver = new IntersectionObserver(handleIntersection, {
        threshold: 1,
    });
    scrollObserver.observe(document.querySelector('.project-thumbnail'));
    scrollObserver.observe(document.querySelector('h1'));

    //Items to observe if there is no hover
    if( noHoverQuery.matches ){
        Array.from( document.querySelectorAll( '.project-thumbnail' ) ).forEach( thumbnail => {
            scrollObserver.observe( thumbnail );
        });
    }

}


function handleIntersection(entries) {
    entries.map((entry) => {
        
        if (entry.isIntersecting) {
            //blur bg
            if( entry.target.matches('.project-thumbnail:first-child') ){
                if( document.querySelector('#p5bg') !== null ){
                    document.querySelector('#p5bg').classList.add('blurry');
                }
            }

            //unblur bg
            if( entry.target.matches('h1') ){
                if( document.querySelector('#p5bg') !== null ){
                    document.querySelector('#p5bg').classList.remove('blurry');
                }
            }

            //expand tag
            if( noHoverQuery.matches ){
                entry.target.classList.add('expanded-tag');
            }
        }else{
            //unblur bg
            if( entry.target.matches('.project-thumbnail:first-child') ){
                if( document.querySelector('.main-subtitle').getBoundingClientRect().top > 0 ){
                    if( document.querySelector('#p5bg') !== null ){
                        document.querySelector('#p5bg').classList.remove('blurry');
                    }
                }
            }

            //contract tag
            if( noHoverQuery.matches ){
                entry.target.classList.remove('expanded-tag');
            }
        }
        
    });
}

