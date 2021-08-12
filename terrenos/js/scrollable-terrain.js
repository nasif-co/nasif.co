/*----------------------------------- VARIABLES GLOBALES ---------------------------------------*/

var targetElmnt = document.getElementById("pattern");
var lastX = 0; //Background position X actual del contenedor con el patrón de fondo
var newX = 0;
var targetX = 0; //Background position X objetivo definida por el drag
var lastY = 0; //Background position Y actual del contenedor con el patrón de fondo
var newY = 0;
var targetY = 0; //Background position Y objetivo definida por el drag

var velX = 0; //Velocidad actual en x
var velY = 0; //Velocidad actual en y

drag = 0.75; //Drag del spring
strength = 0.04; //Strength del spring





/*---------------------------------------- DRAG --------------------------------------------*/
//Activamos el drag en el elemento
dragElement(targetElmnt);

//Esta función se tomó y modificó de: https://www.w3schools.com/howto/howto_js_draggable.asp
function dragElement(elmnt) {
  var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  elmnt.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    // Posición del curso al inicio del drag
    pos3 = e.clientX;
    pos4 = e.clientY;
    // Cerramos el drag cuando suelten el click
    document.onmouseup = closeDragElement;
    // Llamamos una función cada vez que el mouse se mueve
    document.onmousemove = elementDrag;

    //Agregar clase para cambiar el cursor al drag
    if(!targetElmnt.classList.contains('dragging')){
      targetElmnt.classList.add('dragging')
    }
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    // Ahora que el mouse se movió, calculamos cuánto se movio (relativo a la posición inicial al iniciar el drag)
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    //Reseteamos la posición inicial del drag para la próxima vez que corra la función
    pos3 = e.clientX;
    pos4 = e.clientY;
    // Y le sumamos ese deltaX y deltaY a la posición objetivo en x y y
    targetY -= pos2;
    targetX -= pos1;
  }

  function closeDragElement() {
    // Soltamos todo cuando el mouse suelta el click
    document.onmouseup = null;
    document.onmousemove = null;

    //Quitar clase para cambiar el cursor al no drag
    if(targetElmnt.classList.contains('dragging')){
      targetElmnt.classList.remove('dragging')
    }
  }
}

/*------------------------------------- ANIMACIÓN -----------------------------------------*/
//Esta función hace la pseudo física para animar el movimiento del fondo como un spring. No se llama
// aquí sino en el archivo de p5.js para aprovechar el loop de p5 y llamarla cada frame
//El código partió de: https://www.youtube.com/watch?v=VWfXiSUDquw
function animateBGPattern(){
  var forceX = targetX - lastX;
  var forceY = targetY - lastY;

  forceX *= strength;
  forceY *= strength;

  velX *= drag;
  velY *= drag;

  velX += forceX;
  velY += forceY;

  newX += velX;
  newY += velY;

  if(newX != lastX || newY != lastY){
    lastX = newX;
    lastY = newY;
    targetElmnt.style.backgroundPosition = lastX + "px " + lastY + "px";
    document.getElementById('pattern-container').style.backgroundPosition = lastX + "px " + lastY + "px";
  }
}
