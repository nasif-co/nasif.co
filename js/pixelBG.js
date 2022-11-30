var blobs = []
var colorPalette = [];
var pixColor
var pixelSize = null;
var maxDiameter = null;
var colorStrings = ['#03a230', '#ff5b1f', '#3e51f7', '#ffd21f', '#ffbfda'];

var themeMeta = document.querySelector('meta[name=theme-color]');

function setup() {
  var cnv = createCanvas(window.innerWidth, window.innerHeight);
  cnv.id('p5bg');
  colorMode(RGB);

  pixelSize = round(width / 40);
  maxDiameter = pixelSize * 5;


  colorPalette = [color(3,162,49), color(255, 91, 31), color(62, 82, 247), color(255, 211, 31), color(255, 191, 218)];
  for (i = 0; i < 5; i++) blobs.push(new Blob(random(maxDiameter, width - maxDiameter), random(maxDiameter, height - maxDiameter), colorPalette[i], i));
  frameRate(20);
  if(typeof startGsap === "function"){
    startGsap();
  }
}

function draw() {
  background(255);
  for (i = 0; i < blobs.length; i++) {
    let xStart = round(blobs[i].x / pixelSize) - blobs[i].r / pixelSize - 1;
    let xEnd = round(blobs[i].x / pixelSize) + blobs[i].r / pixelSize + 1;
    let yStart = round(blobs[i].y / pixelSize) - blobs[i].r / pixelSize - 1;
    let yEnd = round(blobs[i].y / pixelSize) + blobs[i].r / pixelSize + 1;

    for (x = xStart; x < xEnd; x++) {
      for (y = yStart; y < yEnd; y++) {
        let sum = 0;
        let xdif = (x * pixelSize + pixelSize / 2) - blobs[i].x;
        let ydif = (y * pixelSize + pixelSize / 2) - blobs[i].y;
        let d = sqrt((xdif * xdif) + (ydif * ydif));
        pixColor = blobs[i].color;
        sum = 10 * blobs[i].r / d;
        pixColor.setAlpha(map(sum, 7, 15, 0, 255)); //change the first two values to tweak pixel antialiasing cutoff (lower values on the first = blocky-er blobs)
        if (alpha(pixColor) > 20) {
          fill(pixColor);
          noStroke();
          square(x * pixelSize, y * pixelSize, pixelSize);
        }
      }

    }
  }

  for (i = 0; i < blobs.length; i++) {
    blobs[i].update();
    //blobs[i].show();
  }
}

class Blob {

  constructor(x, y, color_, colornumber) {
    this.x = x;
    this.y = y;
    this.color = color_;
    this.cnum = colornumber;
    let angle = random(0, 2 * PI);
    while (angle % PI == 0) {
      angle = random(0, 2 * PI);
    }
    this.xspeed = random(2, 4) * Math.cos(angle);
    this.yspeed = random(2, 4) * Math.sin(angle);
    this.rMultiplier = int(random(2, 5));
    this.r = pixelSize * this.rMultiplier;
  }

  update() {
    this.x += this.xspeed;
    this.y += this.yspeed;
    //if (this.x + this.r > width || this.x - this.r < 0) this.xspeed *= -1;
    if(this.x - this.r < 0 && this.xspeed < 0) this.xspeed *= -1;
    if(this.x + this.r > width && this.xspeed > 0) this.xspeed *= -1;
    if(this.y - this.r < 0 && this.yspeed < 0){
      this.yspeed *= -1;
      if( document.querySelector( "body.project-page" ) === null ){
        //themeMeta.setAttribute('content', colorStrings[this.cnum]);
      }
    } 
    if(this.y + this.r > height && this.yspeed > 0) this.yspeed *= -1;
    //if (this.y + this.r > height || this.y - this.r < 0) this.yspeed *= -1;
  }

  show() {
    noFill();
    stroke(0);
    strokeWeight(4);
    ellipse(this.x, this.y, this.r * 2, this.r * 2);
  }

  resize() {
    this.r = pixelSize * this.rMultiplier;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pixelSize = round(width / 40);
  maxDiameter = pixelSize * 5;
  for (i = 0; i < 3; i++) blobs[i].resize();
}
