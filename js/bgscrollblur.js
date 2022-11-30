function startGsap(){
    gsap.registerPlugin(CustomEase);
    gsap.registerPlugin(ScrollTrigger);

    gsap.to('#p5bg', {
        scrollTrigger: {
            trigger: "body",
            start: () => '+=' + window.innerHeight/8,
            end: () => 3*window.innerHeight/5,
            scrub: 0.6,
        },
        filter: "blur( 2.5vw )",
        //filter: () => "blur(" + Math.min(Math.max( window.innerWidth/15, 30), 100) + "px)",
        ease: CustomEase.create("custom", "M0,0,C0.116,0,0.526,0.135,0.656,0.256,0.764,0.356,1,0.924,1,1"),
    });

    gsap.to('#p5bg', {
        scrollTrigger: {
            trigger: "body",
            start: () => '+=' + window.innerHeight/4,
            end: () => 3*window.innerHeight/5,
            scrub: 1,
        },
        opacity: (0.6),
    });
}

