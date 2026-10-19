// Sandbox X5 sound, synthesised per sample: BMW 4.4 twin-turbo V8 (X5 M50i) plus tyres and brakes. No samples, no network.
// Output 0: engine (two banks, panned like twin tailpipes). Output 1: chassis (tyre squeal, brake rumble, thuds).
// The engine is driven by driving-audio.js through AudioParams; one-shot moments (lift-off, shifts, impacts) arrive on the port.
//
// Cross-plane V8, firing order 1-5-4-8-6-3-7-2 (cylinders 1-4 one bank, 5-8 the other): each bank fires unevenly
// (A B A B B A B A), which is where the V8 burble comes from. Each firing is an exhaust blowdown pulse whose width follows the
// crank (≈200° of the 720° cycle), so pulses are long, soft thumps at idle and short barks near the redline.
const ORDER=[1,5,4,8,6,3,7,2],BANK=c=>c<=4?0:1,TAU=Math.PI*2;
const noise=()=>Math.random()*2-1;
// Topology-preserving state-variable filter (Cytomic). set() per block, tick() per sample.
class SVF{
 constructor(){this.a=0;this.b=0;this.k=1;this.a1=1;this.a2=0;this.a3=0;this.low=0;this.band=0;this.high=0;}
 set(fc,q){const g=Math.tan(Math.PI*Math.min(fc,sampleRate*.45)/sampleRate);this.k=1/q;this.a1=1/(1+g*(g+this.k));this.a2=g*this.a1;this.a3=g*this.a2;}
 tick(x){const v3=x-this.b,v1=this.a1*this.a+this.a2*v3,v2=this.b+this.a2*this.a+this.a3*v3;this.a=2*v1-this.a;this.b=2*v2-this.b;
  this.low=v2;this.band=v1;this.high=x-this.k*v1-v2;return v2;}
}
// Feedback comb with a damping low-pass in the loop: one pipe section (header or tailpipe).
class Pipe{
 constructor(ms,fb,damp){this.n=Math.round(ms/1000*sampleRate);this.buf=new Float32Array(this.n);this.i=0;this.fb=fb;this.damp=damp;this.lp=0;}
 tick(x){const old=this.buf[this.i];this.lp+=(old-this.lp)*this.damp;const y=x+this.fb*this.lp;this.buf[this.i]=y;this.i=(this.i+1)%this.n;return y;}
}
const P=(name,max,min=0)=>({name,defaultValue:0,minValue:min,maxValue:max,automationRate:'k-rate'});
class X5Engine extends AudioWorkletProcessor{
 static get parameterDescriptors(){return [P('rpm',8000),P('load',1,-1),P('boost',1),P('flap',1),P('crackle',1),P('starter',1),P('whine',1),P('slip',1),P('brake',1),P('speed',60)];}
 constructor(){
  super();
  this.cycle=0;this.fired=0;this.nextFire=1/8;this.pulses=[];this.pops=[];this.events=[];
  // Unequal header and tailpipe lengths per bank, slightly different cylinders: no two firings sound alike.
  this.banks=[0,1].map(b=>({header:new Pipe(b?3.1:2.6,.32,.55),tail:new Pipe(b?9.7:8.9,.38,.35),m1:0,m2:0,dc:0,dcx:0}));
  this.cyl=Array.from({length:9},()=>.88+Math.random()*.24);
  this.s={rpm:0,load:0,boost:0,flap:0,crackle:0,starter:0,whine:0,slip:0,brake:0,speed:0};
  this.intake=new SVF();this.flutterF=new SVF();this.squealA=new SVF();this.squealB=new SVF();this.rumble=new SVF();this.hiss=new SVF();this.popF=new SVF();
  this.turbo=0;this.whinePh=0;this.starterPh=0;this.flutterPh=0;this.wobble=0;this.wobbleV=0;this.flutterAmp=0;this.thud=[];this.squealAm=1;
  this.port.onmessage=e=>this.events.push(e.data);
 }
 fire(){
  const c=ORDER[this.fired%8],s=this.s,rpm=Math.max(s.rpm,60),on=Math.max(0,s.load),over=Math.max(0,-s.load);
  // Idle lopes (cam overlap), cruise is smooth, overrun is ragged with the odd near-misfire.
  const rough=rpm<1100?.3:on>.2?.08:.18+over*.35;
  // Louder with revs and load: idle is a soft lope, a pull near the redline fills the street.
  let a=(.22+.95*on)*(.42+.58*Math.min(1,rpm/4200))*this.cyl[c]*(1+noise()*rough);
  if(over>.05){a*=.5;if(Math.random()<over*.14)a*=.12;}
  if(s.starter>.5)a*=.35;   // cranking: compression thumps, no real combustion yet
  const width=Math.min(.04,Math.max(.003,.28/(rpm/120)))*sampleRate;
  this.pulses.push({bank:BANK(c),t:0,w:width,a,grit:.25+over*.5});
  // Fresh jitter for the next event: wider at idle, tight under load.
  this.fired++;this.nextFire=(this.fired+1)/8+noise()*(rpm<1100?.006:.0018);
 }
 pop(a,bank=Math.random()<.5?0:1,len=.0015+Math.random()*.005){this.pops.push({t:0,a,bank,len:len*sampleRate,f:70+Math.random()*80,ph:0});}
 process(_in,[engine,chassis],par){
  const sr=sampleRate,s=this.s,N=engine[0].length,eL=engine[0],eR=engine[1],cL=chassis[0],cR=chassis[1];
  const target={};for(const k in s)target[k]=par[k][0];
  for(const e of this.events.splice(0)){
   if(e.type==='lift'){this.flutterAmp=Math.max(this.flutterAmp,e.a);this.flutterPh=0;if(e.a>.5)this.pop(1.3+e.a,undefined,.006);}
   else if(e.type==='bark'){this.pop(1.1,0,.004);this.pop(.9,1,.004);}
   else if(e.type==='bang')this.pop(e.a||2,undefined,.009);
   else if(e.type==='thud')this.thud.push({t:0,a:e.a||.5,f:e.f||48});
  }
  // Block-rate filter settings from the smoothed state of the previous block.
  const rpmN=Math.min(1,s.rpm/6500),fire=s.rpm/30;
  this.intake.set(260+s.rpm*.11,1.3);this.flutterF.set(1500+this.flutterAmp*900,2.2);this.popF.set(3200,.7);
  this.wobble+=this.wobbleV;this.wobbleV+=(noise()*.02-this.wobble*.01-this.wobbleV*.05);
  this.squealA.set(1050+s.slip*180+this.wobble*220,9);this.squealB.set(2250+s.slip*260-this.wobble*300,11);
  this.rumble.set(110,.8);this.hiss.set(5200,.9);
  // Muffler: closed flap ≈ 380 Hz corner, open (sport / hard pull) lets the bark through.
  const fc=470+s.flap*(1100+1900*rpmN),mk=1-Math.exp(-TAU*fc/sr);
  for(let i=0;i<N;i++){
   for(const k in s)s[k]+=(target[k]-s[k])*.0025;
   const rpm=s.rpm,on=Math.max(0,s.load),over=Math.max(0,-s.load);
   // Crank: one cycle = 720°; fire at every 90° plus jitter.
   this.cycle+=rpm/120/sr;
   if(rpm>40)while(this.cycle>=this.nextFire)this.fire();else{this.nextFire=Math.floor(this.cycle*8+1)/8;this.fired=Math.floor(this.cycle*8);}
   let x0=0,x1=0,env=0;
   for(let p=this.pulses.length-1;p>=0;p--){const q=this.pulses[p],x=q.t/q.w;
    if(x>=1){this.pulses.splice(p,1);continue;}
    // Steep blowdown front, then the pressure bleeds away.
    const shape=x<.07?x/.07:Math.pow((1-x)/.93,2.2),v=q.a*shape*(1+q.grit*noise()*shape);
    if(q.bank)x1+=v;else x0+=v;env+=shape*q.a;q.t++;}
   // Phase-locked orders give the body weight: 4th (firing), 2nd, 1st and the ½-order bank rumble.
   const ph=this.cycle*TAU,weight=(.08+.32*on+.06*over)*Math.min(1,rpm/500)*(.45+.55*Math.min(1,rpm/4200));
   const tone=weight*(.5*Math.sin(ph*8)+.3*Math.sin(ph*4+.7)+.18*Math.sin(ph*2+1.9)+.12*Math.sin(ph+.4));
   x0+=tone;x1+=tone*.92;
   // Overrun crackle: random pops in the tailpipes while the throttle is shut.
   if(s.crackle>.01&&Math.random()<s.crackle*24/sr)this.pop(.25+Math.random()*(.5+s.crackle));
   let popOut0=0,popOut1=0;
   for(let p=this.pops.length-1;p>=0;p--){const q=this.pops[p];
    const e=Math.exp(-q.t/q.len),body=Math.sin(q.ph)*Math.exp(-q.t/(.018*sr));q.ph+=TAU*q.f/sr;
    const v=q.a*(noise()*e*1.4+body*.9);if(q.bank)popOut1+=v;else popOut0+=v;
    if(++q.t>.08*sr)this.pops.splice(p,1);}
   // Each bank: header → tailpipe → two-pole muffler → DC blocker.
   const out=[x0,x1].map((x,b)=>{const B=this.banks[b];let y=B.tail.tick(B.header.tick(x));
    B.m1+=(y-B.m1)*mk;B.m2+=(B.m1-B.m2)*mk;y=B.m2;
    const d=y-B.dcx+.9985*B.dc;B.dcx=y;B.dc=d;return d;});
   const pf=this.popF.tick(popOut0+popOut1)*.6;out[0]+=pf+popOut0*.25;out[1]+=pf+popOut1*.25;
   // Intake roar and turbo: the air side, not muffled. Spool whistle rides on boost.
   const inNoise=noise();
   let air=this.intake.tick(inNoise)*(.03+.5*on*(.15+rpmN))*(.35+env*.9);
   this.turbo+=TAU*(1800+8200*s.boost)/sr;
   air+=Math.sin(this.turbo)*s.boost*s.boost*.012+this.hiss.tick(inNoise)*s.boost*on*.025;
   // Blow-off on lift-off: compressor surge flutter ("chu-tu-tu") falling in rate.
   if(this.flutterAmp>.001){const rate=13+this.flutterAmp*14;this.flutterPh+=rate/sr;
    const chop=Math.pow(.5+.5*Math.cos(this.flutterPh*TAU),3);
    air+=this.flutterF.tick(noise())*this.flutterAmp*(.25+.75*chop)*.35;this.flutterAmp*=Math.exp(-1/(.38*sr));}
   // Starter motor and gear whine (reverse).
   this.starterPh+=TAU*(165+18*Math.sin(this.cycle*TAU*2))/sr;
   air+=s.starter*(.05*Math.sin(this.starterPh)+.025*Math.sin(this.starterPh*2.03)+.01*noise());
   this.whinePh+=TAU*(Math.max(rpm,300)/60*7.3)/sr;air+=s.whine*.018*Math.sin(this.whinePh);
   // Valvetrain tick: faint, only audible at idle up close.
   air+=noise()*env*.004*(1-rpmN);
   // Gentle saturation keeps peaks musical when everything lands at once.
   const g=1.15;eL[i]=Math.tanh((out[0]*.68+out[1]*.32+air)*g)/g;eR[i]=Math.tanh((out[1]*.68+out[0]*.32+air)*g)/g;
   // Chassis: tyre squeal with a wandering pitch and flutter, brake pad rumble, thuds (stop rebound, impacts, engine rock).
   const sn=noise();this.squealAm+=(Math.random()-this.squealAm)*.002;
   const sq=(this.squealA.tick(sn)*1+this.squealB.tick(sn)*.55)*Math.pow(s.slip,1.4)*(.55+.45*this.squealAm)*.55;
   let ch=sq+this.rumble.tick(noise())*s.brake*Math.min(1,s.speed/12)*.35;
   for(let p=this.thud.length-1;p>=0;p--){const q=this.thud[p],t=q.t/sr;ch+=q.a*(Math.sin(TAU*q.f*t*(1-t))*Math.exp(-t/.11)+noise()*Math.exp(-t/.012)*.4);if(++q.t>.6*sr)this.thud.splice(p,1);}
   cL[i]=cR[i]=Math.tanh(ch);
  }
  return true;
 }
}
registerProcessor('x5-engine',X5Engine);
