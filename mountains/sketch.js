/* --------------------------------------------------------------
 * Variables 
 * -------------------------------------------------------------*/

//Basic structure of horizontal points distibuted evenly across the canvas width
let basePoints = [];

//How many basepoints to generate;
const maxPoints = 300;

//How many generative horizontal points to generate in each layer
const points = 300;

//Array that holds all the horizontal points of the current layer,
//including both the basePoints and randomly generated ones
let pointList = [];

//Incremental parameter for the noise() function
let noiseTime = 0;

//Array that contains object literals with the x and y coordinate for each
//vertex of the current mountain
let currentMountain = [];

//History array containing arrays of x and y coordinates for each
//vertex of every mountain. Most recent to oldest.
let mountains = [];

//How many mountains to save in history
let historySize = 35;

//Whether the last mountain added to the history came from a user or from idle movement
let lastMountainWasIdle = true;

//How wide is the peak of each mountain
const mountainPeakWidth = 20;

//How wide is the base of each mountain
const mountainBaseWidth = 200;

//Define the maximum height of the mountain
let peakHeightPercent = 0.6
let maxMountainHeight = window.innerHeight*peakHeightPercent;

//Used in the dynamic multiplier algorithm. How much taller is the peak vs the rest
const defaultPeakMultiplier = 1;

//Used in the dynamic multiplier algorithm. How much shorter to make the plains.
const plainsMultiplier = -0.2;

//This value gets updated instantly when new users are detected.
let targetPeakMultiplier = defaultPeakMultiplier;

//This value is a smoothed version of the targetPeakMultiplier.
let peakMultiplier = defaultPeakMultiplier;

//Used to cap the erotion of the peak multiplier. If we allow the
//peak multiplier to be divided by an indefinite number of users,
//when many users are present, the peak multiplier will become too small.
//This value protects us from that scenario.
const maxUsers = 5;

//How vertically distant to draw each mountain in the history
let mountainGap = 30; //30

//Sets the speed. How many frames before the history advances one mountainGap.
let framesToRecord = 100; //100

//At the beginning of every cycle of animation, a new mountain rises from the bottom
//In a timeline from 0 to 1, these two values define when the mountain starts to rise and
//when it has risen completely
const terraformStart = 0; //0.2
const terraformComplete = 0.2; //0.4

//Color variables, initialized in setup
let historyColorStart;
let historyColorEnd;
let currentColor;
let snapshotColor;

//Camera input
let video;

//Minimum confidence level for the ml5 readings to be used
const globalConfidence = 0.2;

//Array that holds the center x position of each person detected
let centers = [];

//How much to smooth the mountain height values. 
const smoothingRate = 0.9; //A float between 0 and 1 (excluding 1). 0 is no smoothing. 0.99999 is a lot of smoothing.

//ml5 readings get inconsistent when a person is too close to the edge
//of the camera. This value defines safe margins left and right, to ignore
//values that are captured in these areas.
const safetyMargin = 0;


//Make true to see debugging view
let debugging = true;

//Make mountains with the mouse or with ml5
const mode = 'body'; //Either 'mouse' or 'body'

//Connect with debugger ui
const fpsDisplay = window.fpsdisplay;
const historySizeDisplay = window.historysize;
historySizeDisplay.addEventListener('change', updateConstants);
const cycledisplay = window.cyclelength;
cycledisplay.addEventListener('change', updateConstants);
const gapsize = window.gap;
gapsize.addEventListener('change', updateConstants);
const peaksize = window.peaks;
peaksize.addEventListener('change', updateConstants);

const closeButton = window.debugclose;
closeButton.addEventListener('click', function() {
  debugging = false
  localStorage.setItem('debugging', debugging);
  window.debugger.classList.remove('debug-on');
});
const resetButton = window.sketchreset;
resetButton.addEventListener('click', function(){window.location.reload();});
const saveButton = window.saveconstants;
saveButton.addEventListener('click', saveConstants);
const defaultsButton = window.defaultconstants;
defaultsButton.addEventListener('click', defaultConstants);

function preload() {
  if(mode == 'body'){
    // Load the bodyPose model
    bodyPose = ml5.bodyPose({ flipped: true });
  }
}

function setup() {
  //Set colors
  historyColorStart = color("rgb(82, 93, 247)");
  historyColorEnd = color('white');
  snapshotColor = color('white');
  currentColor = color('blue');


  //Get saved constants from localStorage
  if(localStorage.getItem("historySize") !== null) {
    historySize = parseInt(localStorage.getItem("historySize"));
  }
  historySizeDisplay.value = historySize;

  if(localStorage.getItem("cycleLength") !== null) {
    framesToRecord = parseInt(localStorage.getItem("cycleLength"));
  }
  cycledisplay.value = framesToRecord;

  if(localStorage.getItem("gapSize") !== null) {
    mountainGap = parseInt(localStorage.getItem("gapSize"));
  }
  gapsize.value = mountainGap;

  if(localStorage.getItem("peakSize") !== null) {
    peakHeightPercent = parseFloat(localStorage.getItem("peakSize"));
    maxMountainHeight = window.innerHeight*peakHeightPercent;
  }
  peaksize.value = peakHeightPercent;


  const p5canvas = createCanvas(windowWidth, windowHeight);
  p5canvas.id('p5canvas');

  for (let i = 1; i <= maxPoints; i++) {
    basePoints[i - 1] = ((i - 1) * width) / maxPoints;
  }
  setHorizontalPoints();

  if(mode == 'body'){
    requestCameraPermission().then(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      cameras = devices.filter(device => device.kind === 'videoinput');
      createDropdown();
      // Use the first camera by default
      if (cameras.length > 0) {
        initializeCamera(cameras[0].deviceId);
      }
    });
    //video = createCapture({ flipped: true, video: true, audio: false });
    //video.size(windowWidth, windowHeight);
    //video.hide();
    //bodyPose.detectStart(video, gotPoses);
  }).catch((err) => {
    console.error('Permission denied or error:', err);
    alert('Camera permission is required to access cameras.');
  });
  }

  

  strokeJoin(ROUND);

  //Check if debugging is on from last refresh
  if(localStorage.getItem('debugging') != null) {
    debugging = (localStorage.getItem('debugging') === 'true');
  }

  if(debugging) {
    window.debugger.classList.add('debug-on');
  }else {
    window.debugger.classList.remove('debug-on');
  }
}

function requestCameraPermission() {
  return navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
      // Stop the temporary stream
      stream.getTracks().forEach(track => track.stop());
      console.log('Permission granted');
    });
}

function createDropdown() {
  dropdown = window.camerapicker;
  cameras.forEach((camera, index) => {
    const option = document.createElement('option');
    option.textContent =  camera.label || `Camera ${index + 1}`;
    option.setAttribute('value', camera.deviceId);
    dropdown.appendChild(option);
  });

  dropdown.addEventListener('change', function() {
    const selectedDeviceId = dropdown.value();
    initializeCamera(selectedDeviceId);
  });

  // dropdown.changed(() => {
  //   const selectedDeviceId = dropdown.value();
  //   initializeCamera(selectedDeviceId);
  // });
}

function initializeCamera(deviceId) {
  if (video) {
    video.remove();
    bodypose.detectStop();
  }
  video = createCapture({
    flipped: true,
    audio: false,
    video: {
      deviceId: { exact: deviceId }
    }
  });
  video.size(width, height);
  video.hide();
  bodyPose.detectStart(video, gotPoses);
}

function draw() {
  if(mode == 'mouse') {
    centers = [];
    //Only if the mouse is over the sketch
    if( window.p5canvas.matches(':hover') ){
      centers = [mouseX];
    }
  }

  //Guides the animation cycles
  const animationPlayhead = (frameCount%framesToRecord/framesToRecord);
  
  background("white");
  strokeWeight(8);
  
  /* --------------------------------------------------------------
  * History
  * -------------------------------------------------------------*/
  
  for (let i = mountains.length - 1; i >= 0; i--) {
    //In this cycle of animation, what color does this mountain start with
    let colorStart = lerpColor(historyColorStart, historyColorEnd, i/(historySize - 1));
    //In this cycle of animation, what color does this mountain end with
    const colorEnd = lerpColor(historyColorStart, historyColorEnd, (i+1)/(historySize - 1));

    if( i == 0 && !lastMountainWasIdle){
      colorStart = snapshotColor;
    }

    //When hitting end of animation, set the mountain as its end color,
    //which will now be its start color at the end of this draw when a 
    //new mountain is added and this one moves back in history
    if (frameCount % framesToRecord == 0) {
      fill( colorEnd );
      stroke( colorEnd );
    } else {
      //Else, smoothly color it depending on its animation frame
      const currentColor = lerpColor(
        colorStart,
        colorEnd,
        animationPlayhead,
      );
      fill( currentColor );
      stroke( currentColor );
    }
    
    beginShape();
    let mountain = mountains[i];
    for (let rock of mountain) {
      // When frameCount hits end of animation, draw each mountain position one gap
      // above (meaning i+2 instead of i+1), which will be the starting point as soon as the
      // new mountain is added to the history at the end of this draw
      if (frameCount % framesToRecord == 0) {
        vertex(rock.x, rock.y - mountainGap*(i+2));
      } else {
        //ex: frameCount % 50 / 50: creates smooth 0-1 transition over 50 frames
        vertex(rock.x, rock.y - mountainGap*(i+1) - mountainGap*animationPlayhead);
        //i+1 because we want the history to start one mountainGap above the bottom edge.
        //if we did just i, it would start at the bottom edge, where new mountains start
      }
    }
    vertex(width * 2, height*2);
    vertex(0, height*2);
    endShape(CLOSE);
  }

  /* --------------------------------------------------------------
  * Current Mountain
  * -------------------------------------------------------------*/

  //Dynamic sizing attributes for the mountains
  //Depending on how many people are present, the max and min sizes
  //of the mountains are set, to avoid overflowing the canvas.
  //When people leave, the dynamic size updates smoothly
  targetPeakMultiplier = defaultPeakMultiplier/constrain(centers.length*0.6,1, maxUsers);
  
  let peakAdjustmentSpeed = map(targetPeakMultiplier - peakMultiplier, 0, defaultPeakMultiplier, 0, 0.08);

  peakMultiplier += peakAdjustmentSpeed;

  let targetColor = color('blue');
  if(centers.length == 0) {
    targetColor = color("rgb(82, 93, 247)");
  }

  currentColor = lerpColor(currentColor, targetColor, 0.2);
  
  fill(currentColor);
  stroke(currentColor);
  beginShape();

  //Go through each horizontal point
  for (let i = 0; i < pointList.length; i++) {
    
    //Set the base, the texture of the terrain with no mountains
    let base = plainsMultiplier;

    //Go through each person
    centers.forEach(center => {
      //Calculate how much to raise the current point vertically,
      //depending on how close the person is to it.
      base += map(
        abs(dist(pointList[i], 0, center, 0)),
        mountainPeakWidth,
        mountainBaseWidth,
        peakMultiplier,
        0,
        true
      );
    });

    //The y for the current point starts at height (bottom of canvas)
    //a noise value is subtracted to create a terrain. This terrain is 
    //multiplied by the base value, which raises it depending on the position
    //of each person 
    let y = height - noise(i * 0.005 + noiseTime) * base;
    //Finally, this calculated y is amplified to be more visible
    y = map(y, height, height - defaultPeakMultiplier, height - 1, height - maxMountainHeight);

    //Smoothing of the mountain height:

    //If the current mountain is being drawn for the first time
    if(currentMountain.length <= i) {
      //Set the values of x and y as calculated
      currentMountain[i] = {
        x: pointList[i],
        y: y, //height - plainsMultiplier,
      };
    } else {
      //If this mountain was already drawn once,
      //smooth (running average) the y of the mountain using the
      //previous values and the new value.
      //The amount of smoothing is controlled by the smoothingRate constant
      currentMountain[i] = {
        x: pointList[i],
        y: currentMountain[i].y*smoothingRate + y*(1 - smoothingRate),
      };
    }

    //Animates the upward motion of the current mountains
    let displayOffset = -mountainGap*animationPlayhead;

    if (animationPlayhead <= terraformComplete) {
      displayOffset = map(animationPlayhead, 0, terraformComplete, mountainGap, -mountainGap*terraformComplete);
    }

    let scaler = easeInOutCubic(map(constrain(animationPlayhead, terraformStart, terraformComplete), terraformStart, terraformComplete, 0, 1));
    
    //Draw the current mountain's vertex that was just calculated
    vertex(pointList[i], (currentMountain[i].y - height)*scaler + height + displayOffset);
  }
  vertex(width * 2, height*2);
  vertex(0, height*2);
  endShape(CLOSE);

  if (frameCount % framesToRecord == 0) {
    mountains.unshift(currentMountain);
    mountains = mountains.splice(0, historySize);
    setHorizontalPoints();
    currentMountain = [];

    lastMountainWasIdle = centers.length == 0;
  }

  if(debugging) {
    showDebugger();
  }
}

function keyReleased() {
  if (key === ' ') {
    saveCanvas();
  }else if (key === 'd') {
    debugging = !debugging;
    localStorage.setItem('debugging', debugging);
    if(debugging) {
      window.debugger.classList.add('debug-on');
    }else {
      window.debugger.classList.remove('debug-on');
    }
  }
}

function setHorizontalPoints() {
  noiseTime += 1;
  pointList = [];
  for (let i = 0; i < points; i++) {
    pointList[i] = noise(i * 2 + noiseTime) * width;
  }
  pointList = pointList.concat(basePoints);
  pointList.sort(function (a, b) {
    return a - b;
  });
}

function gotPoses(results) {
  // Save the output to the poses variable
  poses = results;

  centers = [];
  //Run through poses and get the centers
  for (let i = 0; i < poses.length; i++) {
    let person = poses[i];
    let center = false;
    if (person.nose.confidence > globalConfidence && 
      person.right_eye.confidence > globalConfidence &&
      person.left_eye.confidence > globalConfidence) {
      center = person.nose.x;
    } 
    // else if (
    //   person.right_eye.confidence > globalConfidence &&
    //   person.left_eye.confidence > globalConfidence
    // ) {
    //   const person_span = person.right_eye.x - person.left_eye.x;
    //   center = person.left_eye.x + person_span / 2;
    // } 
    // else if (
    //   person.right_shoulder.confidence > globalConfidence &&
    //   person.left_shoulder.confidence > globalConfidence
    // ) {
    //   const person_span = person.right_shoulder.x - person.left_shoulder.x;
    //   center = person.left_shoulder.x + person_span / 2;
    // }

    if (center !== false && center > safetyMargin && center < width - safetyMargin) {
      centers.push(center);
    }
  }
}

function showDebugger() {
  //Draw the middle line of each person
  stroke('lime');
  strokeWeight(1);
  for (let j = 0; j < centers.length; j++) {
    line(centers[j],0, centers[j], height);
  }

  //Draw the safety margins
  fill(252, 223, 3, 100);
  noStroke();
  rect(0,0, safetyMargin, height);
  rect(width - safetyMargin,0, safetyMargin, height);

  //Show fps for debugging
  fpsDisplay.textContent = round(frameRate());
}

//From https://easings.net/#easeInOutCubic
function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function updateConstants(e) {
  const elmnt = e.currentTarget;

  switch (elmnt.id) {
    case 'historysize':
      var val = parseInt(elmnt.value);
      //validate
      if( !isNaN(val) && val >= 5 && val <= 600){
        historySize = val;
        saveButton.disabled = false;
        resetButton.disabled = false;
      }
      break;
    case 'cyclelength':
      var val = parseInt(elmnt.value);
      //validate
      if( !isNaN(val) && val >= 1 && val <= 600){
        framesToRecord = val;
        saveButton.disabled = false;
        resetButton.disabled = false;
      }
      break;
    case 'gap':
      var val = parseInt(elmnt.value);
      //validate
      if( !isNaN(val) ){
        mountainGap = val;
        saveButton.disabled = false;
        resetButton.disabled = false;
      }
      break;
    case 'peaks':
      var val = parseFloat(elmnt.value);
      //validate
      if( !isNaN(val) && val >= 0.1 && val <= 0.95){
        peakHeightPercent = val;
        maxMountainHeight = window.innerHeight*peakHeightPercent;
        saveButton.disabled = false;
        resetButton.disabled = false;
      }
      break;
  }
}

function saveConstants() {
  localStorage.setItem("historySize", historySize);
  localStorage.setItem("cycleLength", framesToRecord);
  localStorage.setItem("gapSize", mountainGap);
  localStorage.setItem("peakSize", peakHeightPercent); 

  saveButton.disabled = true;
  resetButton.disabled = true;
}

function defaultConstants() {
  localStorage.removeItem('historySize');
  localStorage.removeItem('cycleLength');
  localStorage.removeItem('gapSize');
  localStorage.removeItem('peakSize');

  window.location.reload();
}