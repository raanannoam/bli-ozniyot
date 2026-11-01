const fs=require('fs'); const dir=__dirname+'/';
function readWav(f){const b=fs.readFileSync(f); let o=12; while(b.toString('ascii',o,o+4)!=='data'){o+=8+b.readUInt32LE(o+4);} const n=b.readUInt32LE(o+4)/4; return new Float32Array(b.buffer.slice(b.byteOffset+o+8,b.byteOffset+o+8+n*4));}
const sr=48000,bd=60/92, X=readWav(dir+'click_only.wav');
// make a long recording (~90s): copy real beats (each with its click) from the take onto a long grid
const B=Math.round(bd*sr), t0=Math.round(0.501*sr), nB=138, long=new Float32Array(t0+nB*B+sr);
for(let k=0;k<nB;k++){ const srcK=(k<4)?k:4+((k-4)%17); const pos=k%4; const src=srcK - (srcK%4) + pos; const so=t0+src*B-2000, d=t0+k*B-2000; for(let i=0;i<B;i++) long[d+i]=X[so+i]||0; }
const nClicks=nB;
for (const ppm of [0,30,80]) {
  const f=1+ppm*1e-6, y=new Float32Array(long.length);
  for(let i=0;i<y.length;i++){const t=i*f, j=Math.floor(t), a=t-j; y[i]=(long[j]||0)*(1-a)+(long[j+1]||0)*a;}
  const cs=[]; for(let k=0;k<nClicks;k++) cs.push({idx:Math.round((0.501+k*bd)*sr),pos:k%4,pre:k<4});
  for (const [tag,path] of [['before',dir+'../dsp_before_drift.js'],['after','/home/user/bli-ozniyot/dsp.js']]) {
    delete require.cache[require.resolve(path)]; const D=require(path);
    const r=D.removeClicks(y,sr,cs,{level:'strong'});
    const e=(a,c)=>{let s=0; for(let i=c.idx-240;i<c.idx-240+12480;i++) s+=a[i]**2; return s;};
    const last=cs.slice(-20); let worst=0, med=[];
    for(const c of last){ const d=10*Math.log10(e(r.clean,c)/e(y,c)); med.push(d); worst=Math.max(worst,d); }
    med.sort((a,b)=>a-b);
    console.log(`drift ${ppm}ppm ${tag.padEnd(6)} last 20 clicks (after ~75s): median ${med[10].toFixed(1)} dB, worst ${worst.toFixed(1)} dB`);
  }
}
