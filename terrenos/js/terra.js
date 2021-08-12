let field = [];
let rez = 12;
let cols, rows;
let increment = 0.1;
let zoff = 0;
let noise;
let outlineWeight = 1.5

let update = true;
let percentUnaffected = 0.95;
let tileRepetitions = 3;

let seed = Date.now()

let canvas;

function setup() {
if(typeof(isSVG) != 'undefined' && isSVG){
  canvas = createCanvas(1500, 1500, SVG);
}else{
  canvas = createCanvas(1500, 1500);
  canvas.parent('canvas-container');
}
  
  noise = new OpenSimplexNoise(seed);

  setNoiseGrid();
}

function setNoiseGrid(){
  field = [];

  cols = 1 + width / rez;
  rows = 1 + height / rez;

  for (let i = 0; i < cols; i++) {
      let k = [];
      for (let j = 0; j < rows; j++) {
          k.push(0);
      }
      field.push(k);
  }
}

function drawLine(v1, v2) {
  line(v1.x, v1.y, v2.x, v2.y);
}

function draw() {
  if(update){

      if(typeof(userSeedValue) != 'undefined' && userSeedValue != -1){ 
        zoff = userSeedValue;
      }else{
        zoff = random(0,100);
      }

      if(typeof(userStrokeWeight) != 'undefined'){ 
        outlineWeight = userStrokeWeight;
      }else{
        outlineWeight = 1.5;
      }

      let strokeColor = hexToRgb("#000000"); 
      if(typeof(userStrokeColor) != 'undefined'){ 
        strokeColor = hexToRgb(userStrokeColor);
      }

      if(typeof(userRez) != 'undefined' && rez != userRez){ 
        rez = userRez
        setNoiseGrid();
      }


      calculatePoints();
      update = false;
      clear();

      //Dibujar la visualización
      strokeWeight(outlineWeight);

      stroke(strokeColor.r, strokeColor.g, strokeColor.b, 50);
      drawTerrain(8,3);

      stroke(strokeColor.r, strokeColor.g, strokeColor.b, 120);
      drawTerrain(8,4);

      stroke(strokeColor.r, strokeColor.g, strokeColor.b, 180);
      drawTerrain(8,5);

      stroke(strokeColor.r, strokeColor.g, strokeColor.b, 220);
      drawTerrain(8,6);

      strokeWeight(1);

      
    //targetElmnt está definido en scrollable-terrain.js
    if(typeof(targetElmnt) !== 'undefined'){
      var cnvs = document.querySelector('#canvas-container canvas');
      var data = cnvs.toDataURL();
      targetElmnt.style.backgroundImage = 'url(' + data + ')';
    }

    if(typeof(gridFlag) == "boolean" && gridFlag){
      clear();
      drawGrid();
      var cnvs = document.querySelector('#canvas-container canvas');
      var data = cnvs.toDataURL();
      document.getElementById('pattern-container').style.backgroundImage = 'url(' + data + ')';
    }else{
      document.getElementById('pattern-container').style.backgroundImage = 'none';
    }

    if(typeof(setBackgroundColor) == 'function'){
      setBackgroundColor(); //Definido en graph-paper.js
    }
      
    //zoff += 0.1;

  }
  
  if(typeof(animateBGPattern) == 'function'){
    animateBGPattern(); //Definido en scrollable-terrain.js
  }
  
}

function calculatePoints(){
  let xoff = 0;
  for (let i = 0; i < cols; i++) {
    xoff += increment;
    let yoff = 0;
    for (let j = 0; j < rows; j++) {
      field[i][j] = float(noise.noise3D(xoff, yoff, zoff)); //Asignamos un valor entre -1 y 1 a cada punto de la grilla
      
      //Calculamos que tan cerca está el punto actual de la esquina derecha
      let percentRight = i/(cols-1);
      percentRight = constrain(map(percentRight, percentUnaffected, 1, 0, 1),0,1); //Limitamos el porcentaje de cercanía a esa esquina para que no afecte
                                                                                    //el área definida por percentUnaffected
      //Hacemos lo mismo con que tan cerca está de la esquina inferior
      let percentBottom = j/(rows-1);
      percentBottom = constrain(map(percentBottom, percentUnaffected, 1, 0, 1),0,1);
      
      let totalAvailable; //Variable que guarda el porcentaje más grande entre percentBottom y percentRight.
                            //Esta define cuánto de ese punto particular se afecta por su cercanía a las esquinas y cuánto por su valor inicial.
      if(percentRight >= percentBottom){
          totalAvailable = percentRight;
      }else{
          totalAvailable = percentBottom;
      }
      
      //Ahora calculamos cuánto de totalAvailable corresponde a la esquina derecha y cuánto a la inferior.
      let rightBottomSum = percentRight + percentBottom;
      if(rightBottomSum != 0){
        //Sacamos un porcentaje relativo entre percentRight y percentBottom (el porcentaje de cada uno con respecto a la suma de los dos)
        //Y luego usamos ese porcentaje de cada uno y lo multiplicamos al totalAvailable para saber que porcentaje del valor final del punto
        //de la grilla le corresponde.
        //
        //Ej. Si estamos en la mitad de la grilla (asumiendo que percentUnaffected es 0) entonces percentRight es 0.5 y percentBottom es 0.5
        //    totalAvailable también sería 0.5. Haciendo este cálculo nos da que el porcentaje relativo de percentRight sería también 0.5 al
        //    igual que el de percentBottom. Este numero es el porcentaje de totalAvailable que le corresponde a cada uno, por eso lo multiplicamos
        //    con totalAvailable y nos da que percentRight = 0.25 y percentBottom = 0.25, los cuales ya son los porcentajes del valor final,
        //    estableciendo que el valor del punto de la grilla es 50% su valor inicial, 25% el valor de la esquina derecha y 25% el de la esquina inf.
        percentRight = (percentRight/rightBottomSum)*totalAvailable;
        percentBottom = (percentBottom/rightBottomSum)*totalAvailable;
      }
      
      //Habiendo hecho los cálculos, los aplicamos al valor final
                      //Valor inicial                      //Valor de la esq.Hor. (der = izq)    //Valor de la esq.Vert. (arriba = abajo)
        field[i][j] = field[i][j]*(1.0 - totalAvailable) + field[0][j]*percentRight       +      field[i][0]*percentBottom;
        
        //Finalmente, nos aseguramos de que cada valor de la grilla en la esquina derecha sea igual a su correspondiente en la esquina izq.
        //Y lo mismo con la esquina de arriba y de abajo.
        if(i == cols - 1){
          field[i][j] = field[0][j];
        }else if(j == rows - 1){
          field[i][j] = field[i][0];
        }
      
      yoff += increment;
    }
  }
}

function limitValue(value, partitions, pass){
  if(value > ((2/partitions)*pass - 1) && value < ((2/partitions)*(pass+1) - 1 )){
      return 1;
  }else{
    return 0;
  }
}

function getState(a, b, c, d) {
  return a * 8 + b * 4  + c * 2 + d * 1;
}

function drawGrid(){
  let numLines = 20;
  let gridColor = hexToRgb("#00ffff"); 
  if(typeof(userGridColor) != 'undefined'){ 
    gridColor = hexToRgb(userGridColor);
  }
  stroke(gridColor.r, gridColor.g, gridColor.b);
  strokeWeight(1);
  for (let i = 0; i < numLines; i++) {
    if(i == 0 || i == (numLines)){
      strokeWeight(3); //Hace que la última línea esté fuera del canvas y la primera mida 1px adentro del canvas
    }else{
      strokeWeight(1);
    }
    line(i*width/numLines, 0, i*width/numLines, height); // Línea vertical
    line(0, i*height/numLines, width, i*height/numLines); // Línea horizontal
  }
  stroke(0);
  strokeWeight(1);
}

function drawTerrain(partitions, pass){
  /*------------------ DIBUJAR LOS PUNTOS -------------------------*/
  //for (int i = 0; i < cols; i++) {
  //  for (int j = 0; j < rows; j++) {
  //    //fill(field[i][j]*255);
  //    noStroke();
  //    if(field[i][j]>0){
  //      fill(255,0,255);
  //    }else{
  //      fill(0,255,255);
  //    }
  //    circle(i*rez, j*rez, 2);
      
  //  }
  //}
  
  /*----------------------------------- ALGORITMO MARCHING SQUARES ---------------------------------------*/
  //Aquí entra en juego marching squares, pasando por cada punto y calculando su estado (16 posibilidades)
  //Dependiendo de si su valor es 0 o 1. (Se hace un ceil para pasar de los valor flotantes entre -1 y 1 a
  //enteros entre 0 y 1. Una vez calculado su estado, se dibujan las líneas con base en el algoritmo, que busca
  //separar los 0 de los 1.
  
  for (let i = 0; i < cols-1; i++) {
    for (let j = 0; j < rows-1; j++) {
      let x = i * rez;
      let y = j * rez;
      let a = createVector(x + rez * 0.5, y );
      let b = createVector(x + rez, y + rez * 0.5);
      let c = createVector(x + rez * 0.5, y + rez);
      let d = createVector(x, y + rez * 0.5);
      //Aquí modificamos los valores de cada punto según el paso, creando varias capas de terreno.
      let state = getState(limitValue(field[i][j], partitions, pass), 
                            limitValue(field[i+1][j], partitions, pass), 
                            limitValue(field[i+1][j+1], partitions, pass), 
                            limitValue(field[i][j+1], partitions, pass));
      
      switch (state) {
      case 1:  
        drawLine(c, d);
        break;
      case 2:  
        drawLine(b, c);
        break;
      case 3:  
        drawLine(b, d);
        break;
      case 4:  
        drawLine(a, b);
        break;
      case 5:  
        drawLine(a, d);
        drawLine(b, c);
        break;
      case 6:  
        drawLine(a, c);
        break;
      case 7:  
        drawLine(a, d);
        break;
      case 8:  
        drawLine(a, d);
        break;
      case 9:  
        drawLine(a, c);
        break;
      case 10: 
        drawLine(a, b);
        drawLine(c, d);
        break;
      case 11: 
        drawLine(a, b);
        break;
      case 12: 
        drawLine(b, d);
        break;
      case 13: 
        drawLine(b, c);
        break;
      case 14: 
        drawLine(c, d);
        break;
      }
    }
  }
}

//Taken from https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}