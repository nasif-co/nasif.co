#ifdef GL_ES
precision mediump float; //highp, mediump or lowp
#endif

uniform vec2 u_resolution;  // Canvas size (width, height)
uniform float u_time;       // Time in seconds since load

#define PI 3.1415926535897932384626433832795

vec3 mustard = vec3(255.0, 210.0, 31.0);
vec3 bubblegum = vec3(255.0, 191.0, 218.0);
vec3 cilantro = vec3(3.0, 162.0, 48.0);
vec3 carrot = vec3(255.0, 91.0, 31.0);
vec3 cobalt = vec3(62.0, 81.0, 247.0);

vec4 circle(vec2 uv, float rad, vec2 pos) {
	float d = smoothstep( 0.0, 1.0, length(pos - uv) - rad); //modificar el primer valor de smoothstep hacia los negativos para blur (-100, 200)
	float t = clamp(d, 0.0, 1.0);
    vec4 layer1 = vec4(vec3(0.0), 1.0);
    vec4 circ = vec4(vec3(1.0), 1.0 - t);
	return mix(layer1, circ, circ.a*1.0); //multiplicador de opacidad
}

vec4 ball( in vec2 xycoord, in float xperiod, in float yperiod, in float rad, in vec3 color){
    //Normalize rgb and invert it
    color.r = 1.0 - color.r/255.0;
    color.g = 1.0 - color.g/255.0;
    color.b = 1.0 - color.b/255.0;

    //Draw circle
    vec4 ballRender = circle( xycoord.xy, 
                              rad, 
                              vec2( abs((2.0*(u_resolution.x - rad*2.0)/PI)*asin( sin( 2.0*PI*(u_time + 930.0)/xperiod ) )) + rad, 
                                    abs((2.0*(u_resolution.y - rad*2.0)/PI)*asin( sin( 2.0*PI*(u_time + 500.0)/yperiod ) )) + rad )  
                            );
    //Set circle colors;
    ballRender.r *= color.r;
    ballRender.g *= color.g;
    ballRender.b *= color.b;

    return ballRender;
}

void main() {
    float minSideLength = min( u_resolution.x, u_resolution.y );
    
    //Mustard
    vec4 circleOne = ball(gl_FragCoord.xy, minSideLength*0.04, minSideLength*0.06, minSideLength*0.075, mustard);

    //Bubblegum
    vec4 circleTwo = ball(gl_FragCoord.xy, minSideLength*0.07, minSideLength*0.04, minSideLength*0.09, bubblegum);

    //Cilantro
    vec4 circleThree = ball(gl_FragCoord.xy, minSideLength*0.02, minSideLength*0.08, minSideLength*0.12, cilantro);

    //Carrot
    vec4 circleFour = ball(gl_FragCoord.xy, minSideLength*0.03, minSideLength*0.05, minSideLength*0.1, carrot);

    //Cobalt
    vec4 circleFive = ball(gl_FragCoord.xy, minSideLength*0.04, minSideLength*0.03, minSideLength*0.14, cobalt);

    vec4 finalColor = circleOne;
    finalColor -= smoothstep(0.0, 0.55, circleTwo)*circleOne;
    finalColor += circleTwo;
    finalColor -= smoothstep(0.0, 0.55, circleThree)*circleTwo;
    finalColor += circleThree;
    finalColor -= smoothstep(0.0, 0.55, circleFour)*circleThree;
    finalColor += circleFour;
    finalColor -= smoothstep(0.0, 0.55, circleFive)*circleFour;
    finalColor += circleFive;

    finalColor = vec4( 1.0 - finalColor.r, 1.0 - finalColor.g, 1.0 - finalColor.b, 1.0);
    
    gl_FragColor = finalColor;
}

