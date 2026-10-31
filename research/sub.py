import numpy as np, scipy.io.wavfile as w
bd=60/92; SR=48000
PRE=int(0.005*SR); L=int(0.26*SR)

def frac_shift(x, d):
    n=len(x); N=1<<int(np.ceil(np.log2(n*2)))
    X=np.fft.rfft(x,N); f=np.fft.rfftfreq(N)
    return np.fft.irfft(X*np.exp(-2j*np.pi*f*d),N)[:n]

def best_lag(seg, tpl, maxlag):
    # seg longer by 2*maxlag; returns fractional lag
    c=np.correlate(seg, tpl, 'valid')  # len 2*maxlag+1
    i=int(np.argmax(c))
    if 0<i<len(c)-1:
        a,b,cc=c[i-1],c[i],c[i+1]; den=a-2*b+cc
        off=0.5*(a-cc)/den if den!=0 else 0
    else: off=0
    return i-maxlag+off

def grid(x, t_first, n):
    return [t_first + k*bd for k in range(n)]

def learn(x, times, levels, which):
    M=int(0.001*SR)
    tpls={}
    for lv in set(levels):
        segs=[]
        ref=None
        for t,l in zip(times,levels):
            if l!=lv: continue
            s=int(round(t*SR))-PRE
            seg=x[s:s+L].copy()
            if ref is None: ref=seg; segs.append(seg); continue
            big=x[s-M:s+L+M]
            lag=best_lag(big, ref, M)
            segs.append(frac_shift(x[s-M:s+L+M], -lag)[M:M+L] if True else seg)
        tpls[lv]=np.mean(segs,axis=0)
    return tpls

def subtract(x, times, levels, tpls, adapt=0.0):
    y=x.copy(); M=int(0.0015*SR); info=[]
    for t,l in zip(times,levels):
        tpl=tpls[l]; s=int(round(t*SR))-PRE
        if s-M<0 or s+L+M>len(x): continue
        big=x[s-M:s+L+M]
        lag=best_lag(big,tpl,M)
        sh=frac_shift(np.concatenate([np.zeros(M),tpl,np.zeros(M)]), lag+M)[M:M+L] if False else None
        # place template shifted by lag into window s..s+L
        tz=np.zeros(L+2*M); tz[M:M+L]=tpl
        tsh=frac_shift(tz, lag)
        seg=y[s-M:s+L+M]
        # gain fit on first 40ms (click-dominated)
        n=int(0.04*SR)+M
        g=np.dot(seg[:n],tsh[:n])/max(1e-12,np.dot(tsh[:n],tsh[:n])); g=float(np.clip(g,0.7,1.3))
        y[s-M:s+L+M]=seg-g*tsh
        if adapt>0:  # slowly update template from residual-free case not used here
            pass
        info.append((round(lag,2),round(g,3)))
    return y, info

def win_energy(x, times):
    return np.array([np.sum(x[int(t*SR)-PRE:int(t*SR)-PRE+L]**2) for t in times])

for name,t_first,npre in [('click_only.wav',0.501,4),('guitar.wav',0.48,4)]:
    sr,x=w.read(name); x=x.astype(np.float64)
    n=int((len(x)/SR - t_first - 0.27)/bd)+1
    times=grid(x,t_first,n); levels=['top' if k%4==0 else 'base' for k in range(n)]
    tpls=learn(x, times[:npre], levels[:npre], None)
    y,info=subtract(x, times, levels, tpls)
    e0=win_energy(x,times); e1=win_energy(y,times)
    red=10*np.log10(e1/e0)
    print('==',name,'beats',n)
    print(' reduction dB per click:',np.round(red,1))
    print(' lags/gains:',info[:12])
    w.write(name.replace('.wav','_sub.wav'),SR,y.astype(np.float32))
