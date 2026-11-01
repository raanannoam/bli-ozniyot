const fs=require('fs'); const dir=__dirname+'/';
function readWav(f){const b=fs.readFileSync(f); let o=12; while(b.toString('ascii',o,o+4)!=='data'){o+=8+b.readUInt32LE(o+4);} const n=b.readUInt32LE(o+4)/4; return new Float32Array(b.buffer.slice(b.byteOffset+o+8,b.byteOffset+o+8+n*4));}
const D=require('/home/user/bli-ozniyot/dsp.js'); const sr=48000;
const g=readWav(dir+'g_strong_h0.wav'), p=readWav(dir+'p_strong_h1.wav');
const n=60*sr, backing=new Float32Array(n), inst=new Float32Array(n);
for(let i=0;i<n;i++){ backing[i]=g[i%g.length]; inst[i]=p[i%p.length]*0.7; }
const L=Math.round(0.2*sr), ir=new Float32Array(L); let seed=7; const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647-0.5;};
const d0=480; ir[d0]=0.6; ir[d0+1]=0.3; ir[d0+2]=-0.2; ir[d0+40]=0.15; for(let i=d0+200;i<L;i++) ir[i]+=rnd()*0.06*Math.exp(-(i-d0)/(0.04*sr));
function conv(x,h){const y=new Float32Array(x.length); const nz=[]; for(let j=0;j<h.length;j++) if(Math.abs(h[j])>1e-5) nz.push(j); for(const j of nz){const hj=h[j]; for(let i=j;i<x.length;i++) y[i]+=x[i-j]*hj;} return y;}
for (const ppm of [0,30]) {
  const f=1+ppm*1e-6, bs=new Float32Array(n); for(let i=0;i<n;i++){const t=i*f,j=Math.floor(t),a=t-j; bs[i]=(backing[j]||0)*(1-a)+(backing[j+1]||0)*a;}
  const echo=conv(bs,ir), mic=new Float32Array(n); for(let i=0;i<n;i++) mic[i]=echo[i]+inst[i];
  for (const seg of [10]) {
    const r=D.removeBackground(mic,backing,sr,{segSec:seg});
    let e0=0,e1=0; for(let i=40*sr;i<59*sr;i++){e0+=echo[i]**2; e1+=(r.clean[i]-inst[i])**2;}
    console.log(`drift ${ppm}ppm, with drift correction: mix reduction in the last 20s ${(10*Math.log10(e1/e0)).toFixed(1)} dB`);
  }
}
