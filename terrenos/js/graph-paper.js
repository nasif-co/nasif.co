// var originalSVG = document.getElementById('graph-paper').outerHTML;
// var targetSVG64 = window.btoa(originalSVG);
// document.getElementById('pattern-container').style.backgroundImage = "url('data:image/svg+xml;base64," + targetSVG64 + "')";

function setBackgroundColor(){
    document.getElementById('pattern-container').style.backgroundColor = userBGColor;
}

// function setGridColor(){
//     document.getElementById('graph-paper').style.setProperty('--svg-grid-color', userGridColor);
//     originalSVG = document.getElementById('graph-paper').outerHTML;
//     targetSVG64 = window.btoa(originalSVG);
//     document.getElementById('pattern-container').style.backgroundImage = "url('data:image/svg+xml;base64," + targetSVG64 + "')";
// }