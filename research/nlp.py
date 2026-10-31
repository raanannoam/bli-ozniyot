import numpy as np, scipy.io.wavfile as w
from scipy.signal import stft, istft
from sub import *
def run2(x,times,npre,nbeat,mu=0.25,cth=0.97):
    pos=[k%nbeat for k in range(len(times))]
    tp=learn(x,times[:npre],pos[:npre],None)
    y=x.copy(); est=np.zeros_like(x); M=int(0.0015*SR)
    for k,(t,p) in enumerate(zip(times,pos)):
        tpl=tp[p]; s=int(round(t*SR))-PRE
        if s-M<0 or s+L+M>len(x): continue
        big=x[s-M:s+L+M]; lag=best_lag(big,tpl,M)
        tz=np.zeros(L+2*M); tz[M:M+L]=tpl; tsh=frac_shift(tz,lag)
        n=int(0.04*SR)+M
        g=float(np.clip(np.dot(big[:n],tsh[:n])/np.dot(tsh[:n],tsh[:n]),0.7,1.3))
        y[s-M:s+L+M]=big-g*tsh; est[s-M:s+L+M]+=g*tsh
        if k>=npre:
            obs=frac_shift(big,-lag)[M:M+L]/g
            c=np.dot(obs,tp[p])/np.sqrt(np.dot(obs,obs)*np.dot(tp[p],tp[p]))
            if c>cth: tp[p]=(1-mu)*tp[p]+mu*obs
    return y,est
def suppress(y, est, c=0.02, beta=3.0, floor=0.1):
    f,t,Y=stft(y,SR,nperseg=1024,noverlap=768); _,_,E=stft(est,SR,nperseg=1024,noverlap=768)
    R=c*np.abs(E)**2
    # spread residual estimate a little in time (reverb tail) and frequency
    from scipy.ndimage import maximum_filter
    R=maximum_filter(R,size=(3,3))
    G=1-beta*R/np.maximum(np.abs(Y)**2,1e-12)
    G=np.clip(G,floor,1)
    # smooth gains: avoid musical noise
    from scipy.ndimage import uniform_filter
    G=uniform_filter(G,size=(3,3))
    _,out=istft(Y*G,SR,nperseg=1024,noverlap=768)
    return out[:len(y)]
if __name__=='__main__':
    for name,t0 in [('click_only.wav',0.501),('guitar.wav',0.48)]:
        sr,x=w.read(name); x=x.astype(np.float64); times=grid(x,t0,23)
        y,est=run2(x,times,4,4)
        e0=win_energy(x,times)
        for tag,(cc,bb,fl) in {'gentle':(0.02,2,0.25),'strong':(0.02,4,0.1)}.items():
            z=suppress(y,est,cc,bb,fl)
            r=10*np.log10(win_energy(z,times)/e0)
            # guitar damage proxy: energy change outside click windows should be ~0
            mask=np.ones(len(x),bool)
            for tt in times: mask[max(0,int(tt*SR)-PRE):int(tt*SR)-PRE+L]=False
            dmg=10*np.log10(np.sum(z[mask]**2)/np.sum(y[mask]**2))
            print(name,tag,'click windows median %.1f dB'%np.median(r[4:]),'outside windows change %.2f dB'%dmg)
            w.write(name.replace('.wav','_%s.wav'%tag),SR,z.astype(np.float32))
