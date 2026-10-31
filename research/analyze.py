import numpy as np, scipy.io.wavfile as w, sys
bd=60/92
for name in ['click_only.wav','guitar.wav']:
    sr,x=w.read(name); x=x.astype(np.float64)
    print('==',name,'len %.2fs'%(len(x)/sr),'peak %.3f'%np.abs(x).max(),'rms %.4f'%np.sqrt((x**2).mean()))
    # energy envelope 1ms
    hop=48; e=np.sqrt(np.convolve(x**2,np.ones(hop)/hop,'same'))[::hop]
    # onset: rises
    d=np.diff(e,prepend=0); 
    # find clicks: local maxima of d above thresh, min distance 0.4*bd
    th=d.max()*0.15; idx=[]
    for i in range(1,len(d)-1):
        if d[i]>th and d[i]>=d[i-1] and d[i]>=d[i+1]:
            if not idx or i-idx[-1]>0.4*bd*1000: idx.append(i)
            elif d[i]>d[idx[-1]]: idx[-1]=i
    t=np.array(idx)/1000.
    print('onsets(s):',np.round(t[:30],3))
    if len(t)>2: print('intervals:',np.round(np.diff(t)[:28],3),'expected %.3f'%bd)
