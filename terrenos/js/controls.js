/*------------------------------------ VARIABLES ----------------------------------*/

/*----------- CONTROLS -------------*/
let terrainControls = document.getElementById('visualization-controls');

let resolutionInput = document.getElementById('resolution-range');
let resolutionDisplay = document.getElementById('rez-val');

let strokeInput = document.getElementById('stroke-range');
let strokeDisplay = document.getElementById('stroke-val');

let pencilToggleInput = document.getElementById('use-pencil-stroke');
let gridToggleInput = document.getElementById('use-grid');

let seedInput = document.getElementById('random-seed');

let bgColorInput = document.getElementById('color-bg');
let strokeColorInput = document.getElementById('color-stroke');
let gridColorInput = document.getElementById('color-grid');

let runButton = document.getElementById('run-button');
let resetButton = document.getElementById('refresh-button');
let saveButton = document.getElementById('save-button');

let zoomInput = document.getElementById('zoom-range');

/*----------- TERRAIN IMAGE -------------*/
let terrainElement = document.getElementById('pattern');

/*----------- STATES -------------*/
let hasInitialValues = true;
let hasUpdatedValues = true;
let pencilFlag = false;
let gridFlag = true;



/*----------- VALUES FOR P5JS -------------*/
let userSeedValue = -1;
let userBGColor = "#ffffff";
let userStrokeColor = "#000000";
let userGridColor = "#00ffff"
let userRez = 12;
let userStrokeWeight = 1.5;


/*---------------------------- RANGES ---------------------------------*/

jQuery('input[type=range]').on('mousedown', function(e){
    e.target.classList.add('grabbing');
})

jQuery('input[type=range]').on('mouseup', function(e){
    e.target.classList.remove('grabbing');
})


/*---------------------------- RESOLUTION RANGE -----------------------------*/

resolutionInput.addEventListener('input', function(){
    updateResolution();
    modifiedForm();
});

function updateResolution(){
    userRez = parseInt(resolutionInput.value);
    resolutionDisplay.innerHTML = resolutionInput.value;
}

/*------------------------------- STROKE RANGE -------------------------------*/
strokeInput.addEventListener('input', function(){
    updateStroke();
    modifiedForm();
});

function updateStroke(){
    userStrokeWeight = parseFloat(strokeInput.value);
    strokeDisplay.innerHTML = strokeInput.value;
}

/*------------------------------- PENCIL TOGGLE -------------------------------*/
pencilToggleInput.addEventListener('input', function(){
    updatePencilFlag();
    modifiedForm();
});

function updatePencilFlag(){
    pencilFlag = pencilToggleInput.checked;
}

function setPencilFilter(){
    if(pencilFlag && !terrainElement.classList.contains('pencil-lines')){
        terrainElement.classList.add('pencil-lines')
    }else if(!pencilFlag && terrainElement.classList.contains('pencil-lines')){
        terrainElement.classList.remove('pencil-lines')
    }
}

/*------------------------------- GRID TOGGLE -------------------------------*/
gridToggleInput.addEventListener('input', function(){
    updateGridFlag();
    modifiedForm();
});

function updateGridFlag(){
    gridFlag = gridToggleInput.checked;
    if(!gridFlag && !gridColorInput.disabled){
        gridColorInput.disabled = true;
        document.querySelector('label[for=color-grid]').classList.add('disabled-input');
    }else if(gridFlag && gridColorInput.disabled){
        gridColorInput.disabled = false;
        document.querySelector('label[for=color-grid]').classList.remove('disabled-input');
    }
}

/*------------------------------- SEED INPUT -------------------------------*/
seedInput.addEventListener('input', function(){
    updateSeedValue();
    modifiedForm();
});

function updateSeedValue(){
    if(!isNaN(parseFloat(seedInput.value))){
        userSeedValue = parseFloat(seedInput.value);
    }else{
        userSeedValue = -1;
    } 
}

/*------------------------------- COLOR STROKE -------------------------------*/
strokeColorInput.addEventListener('input', function(){
    updateStrokeColor();
    modifiedForm();
});

function updateStrokeColor(){
    userStrokeColor = strokeColorInput.value;
}

/*------------------------------- COLOR BACKGROUND -------------------------------*/
bgColorInput.addEventListener('input', function(){
    updateBGColor();
    modifiedForm();
});

function updateBGColor(){
    userBGColor = bgColorInput.value;
}

/*------------------------------- COLOR GRID -------------------------------*/
gridColorInput.addEventListener('input', function(){
    updateGridColor();
    modifiedForm();
});

function updateGridColor(){
    userGridColor = gridColorInput.value;
}

/*------------------------------- RESET BUTTON -------------------------------*/
resetButton.addEventListener('click', function(){
    terrainControls.reset();
    updateResolution();
    updateStroke();
    updatePencilFlag();
    updateGridFlag();
    updateSeedValue();
    updateStrokeColor();
    updateBGColor();
    updateGridColor();
    hasInitialValues = true;
    hasUpdatedValues = false;
    updateVisualization();
})

/*------------------------------- RUN BUTTON -------------------------------*/
runButton.addEventListener('click', function(){
    updateVisualization();
})

function updateVisualization(){
    if(!hasUpdatedValues){
        document.getElementById('pattern-container').classList.add('loading');
        hasUpdatedValues = true;
        setTimeout(function(){
            update = true;
            setPencilFilter();
            document.getElementById('pattern-container').classList.remove('loading');
        }, 1000);
    }
    toggleButtons();
}

/*------------------------------- BUTTON STATES -------------------------------*/
function toggleButtons(){
    
    if(hasUpdatedValues && runButton.disabled == false){
        runButton.disabled = true;
    }else if(!hasUpdatedValues && runButton.disabled == true){
        runButton.disabled = false;
    }

    if(hasInitialValues && resetButton.disabled == false){
        resetButton.disabled = true;
    }else if(!hasInitialValues && resetButton.disabled == true){
        resetButton.disabled = false;
    }
}



/*------------------------------- ZOOM RANGE -------------------------------*/
zoomInput.addEventListener('input', function(){
    updateZoom();
});

function updateZoom(){
    terrainElement.style.backgroundSize = zoomInput.value*15 + 'px';
}






function modifiedForm(){
    hasUpdatedValues = false;
    hasInitialValues = false;
    toggleButtons();
}