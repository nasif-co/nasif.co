var joblist = [
	'interfaces.',
	'dispositivos.',
	'páginas web.',
	'objetos.',
	'programas.',
	'textos.',
	'circuitos.',
	'luces.',
	'código.'
];

var currentJob = 0;

setInterval(switchJob, 5000);

function switchJob(){
	var jobElmnt = document.querySelector('#lo-que-hago');
	if(jobElmnt != null){
		currentJob ++;
		if(currentJob >= joblist.length) currentJob = 0;

		jobElmnt.innerHTML = joblist[currentJob];

		jobElmnt.classList.remove('animateUnderline');
		void jobElmnt.offsetWidth;
		jobElmnt.classList.add('animateUnderline');
	}
}