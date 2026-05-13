'use strict';

const EPS = 1e-15;
const $ = id => document.getElementById(id);
const grid = $('grid'), chart = $('chart');
const ctx = grid.getContext('2d'), cctx = chart.getContext('2d');
let S = null, selected = -1, hover = -1, running = false;

function checkedRadio(name){ return document.querySelector(`input[name="${name}"]:checked`)?.value || ''; }
function val(id){ const el=$(id); if(el.type==='checkbox') return el.checked; const v=el.value; return isNaN(+v) ? v : +v; }
function opts(){ return {
  n:val('n'), p0:val('p0'), gridW:val('gridW'), shortcutW:val('shortcutW'), seed:val('seed'), prior:val('prior'), edgeMode:checkedRadio('edgeMode'),
  shortcutCount:val('shortcutCount'), targetMode:val('targetMode'), readout:val('readout'), refreshR:val('refreshR'), dynamicRandom:val('dynamicRandom'),
  anneal:val('anneal'), annealK:val('annealK'), steps:val('steps'), metricEvery:val('metricEvery'), damping:val('damping')
};}
function fmt(x){ if(x===undefined||x===null||!isFinite(x)) return '—'; if(Math.abs(x)>=1e3||Math.abs(x)<1e-3) return x.toExponential(2); return x.toPrecision(4); }
function setStatus(t){ $('status').textContent=t; }
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
function zeros(n){ return new Array(n).fill(0); }
function dot(a,b){ let s=0; for(let i=0;i<a.length;i++) s += a[i]*b[i]; return s; }
function norm(a){ return Math.sqrt(dot(a,a)); }
function mean(a){ let s=0; for(const x of a) s+=x; return s/a.length; }
function std(a){ if(!a.length) return 0; const m=mean(a); let s=0; for(const x of a){ const d=x-m; s+=d*d; } return Math.sqrt(s/Math.max(1,a.length)); }

class RNG{
  constructor(seed){ this.s = (Number(seed)>>>0) || 0x12345678; this.hasSpare=false; this.spare=0; }
  uniform(){
    let t = (this.s += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n){ return Math.floor(this.uniform() * n); }
  normal(mean=0, sd=1){
    if(this.hasSpare){ this.hasSpare=false; return mean + sd*this.spare; }
    let u=0, v=0;
    while(u<=1e-12) u=this.uniform();
    while(v<=1e-12) v=this.uniform();
    const mag = Math.sqrt(-2*Math.log(u));
    const z0 = mag*Math.cos(2*Math.PI*v);
    const z1 = mag*Math.sin(2*Math.PI*v);
    this.spare=z1; this.hasSpare=true;
    return mean + sd*z0;
  }
}

function makePrior(n, mode, rng){
  const N=n*n;
  if(mode==='sinusoid'){
    const y=zeros(N);
    for(let r=0;r<n;r++) for(let c=0;c<n;c++) y[r*n+c] = Math.sin(2*Math.PI*r/Math.max(n,1)) + 0.6*Math.cos(2*Math.PI*c/Math.max(n,1));
    return y;
  }
  if(mode==='blocks'){
    const y=zeros(N);
    for(let r=0;r<n;r++) for(let c=0;c<n;c++) y[r*n+c] = (r<n/2 ? 1.0 : -1.0) + (c>n/2 ? 0.4 : -0.4) + 0.08*rng.normal();
    return y;
  }
  if(mode==='smooth-random'){
    let a=zeros(N).map(()=>rng.normal());
    for(let it=0;it<8;it++){
      const b=zeros(N), cnt=zeros(N);
      for(let r=0;r<n;r++) for(let c=0;c<n;c++){
        const u=r*n+c;
        const add=(v)=>{b[u]+=a[v]; cnt[u]++;};
        add(u); if(r>0) add(u-n); if(r+1<n) add(u+n); if(c>0) add(u-1); if(c+1<n) add(u+1);
      }
      a=b.map((x,i)=>x/cnt[i]);
    }
    const m=mean(a), s=Math.max(std(a), EPS);
    return a.map(x=>(x-m)/s);
  }
  return zeros(N).map(()=>rng.normal());
}

function makeLatentTruth(n, mode, rng){
  if(mode==='sinusoid' || mode==='blocks' || mode==='smooth-random') return makePrior(n, mode, rng);
  const N=n*n, f=zeros(N);
  for(let r=0;r<n;r++) for(let c=0;c<n;c++){
    const X = n>1 ? c/(n-1) : 0, Y = n>1 ? r/(n-1) : 0;
    f[r*n+c] = 0.8*Math.sin(2*Math.PI*X) + 0.5*Math.cos(2*Math.PI*Y) + 0.35*Math.sin(2*Math.PI*(X+Y)) + 0.15*rng.normal();
  }
  let a=f;
  for(let it=0;it<3;it++){
    const g=zeros(N);
    for(let r=0;r<n;r++) for(let c=0;c<n;c++){
      const vals=[]; const u=r*n+c;
      vals.push(a[u]); if(r>0) vals.push(a[u-n]); if(r+1<n) vals.push(a[u+n]); if(c>0) vals.push(a[u-1]); if(c+1<n) vals.push(a[u+1]);
      g[u]=vals.reduce((p,q)=>p+q,0)/vals.length;
    }
    a=g;
  }
  return a;
}

class GBPStateJS{
  constructor(){ this.initGrid({n:10,p0:1,gridW:100,shortcutW:3000,seed:0,prior:'random',edgeMode:'smoothing'}); }

  initGrid(payload){
    this.n = clamp(parseInt(payload.n ?? 10),2,80); this.N=this.n*this.n;
    this.p0 = Math.max(EPS, Number(payload.p0 ?? 1));
    this.gridW = Math.max(0, Number(payload.gridW ?? 100));
    this.shortcutW = Math.max(0, Number(payload.shortcutW ?? 100));
    const mode = String(payload.edgeMode ?? payload.edgeObsMode ?? 'smoothing').toLowerCase();
    this.edgeObsMode = ['noisy','measurement','relative','relative-noisy'].includes(mode) ? 'noisy' : 'smoothing';
    this.rng = new RNG(parseInt(payload.seed ?? 0));
    const priorMode = String(payload.prior ?? 'random');
    if(this.edgeObsMode==='noisy'){
      this.xTrue = makeLatentTruth(this.n, priorMode, this.rng);
      const sd = 1/Math.sqrt(Math.max(this.p0, EPS));
      this.y = this.xTrue.map(x => x + this.rng.normal(0, sd));
    } else {
      this.y = makePrior(this.n, priorMode, this.rng);
      this.xTrue = this.y.slice();
    }
    this.iter=0; this.history=[]; this.mapref=null;
    const ii=[], jj=[], ww=[], zz=[], kk=[], ss=[];
    for(let r=0;r<this.n;r++) for(let c=0;c<this.n;c++){
      const u=r*this.n+c;
      if(c+1<this.n){ const v=u+1; ii.push(u); jj.push(v); ww.push(this.gridW); zz.push(this.gridObservation(u,v)); kk.push(0); ss.push(0); }
      if(r+1<this.n){ const v=u+this.n; ii.push(u); jj.push(v); ww.push(this.gridW); zz.push(this.gridObservation(u,v)); kk.push(0); ss.push(0); }
    }
    this.setEdges(ii,jj,ww,zz,kk,ss);
    this.solveMapOnce('base');
    this.recordMetrics('base');
  }

  gridObservation(u,v){
    if(this.edgeObsMode!=='noisy' || this.gridW<=EPS) return 0;
    const sigma = 1/Math.sqrt(Math.max(this.gridW, EPS));
    return this.xTrue[u] - this.xTrue[v] + this.rng.normal(0, sigma);
  }

  setEdges(ii,jj,ww,zz,kk,ss){
    this.i=ii.slice(); this.j=jj.slice(); this.baseW=ww.slice(); this.z=zz.slice(); this.kind=kk.slice(); this.source=ss.slice();
    const m=this.i.length;
    this.msgLamI=zeros(m); this.msgEtaI=zeros(m); this.msgLamJ=zeros(m); this.msgEtaJ=zeros(m);
  }
  appendEdges(newI,newJ,newW,newZ,newKind,newSource){
    if(!newI.length) return;
    this.i.push(...newI); this.j.push(...newJ); this.baseW.push(...newW); this.z.push(...newZ); this.kind.push(...newKind); this.source.push(...newSource);
    for(let k=0;k<newI.length;k++){ this.msgLamI.push(0); this.msgEtaI.push(0); this.msgLamJ.push(0); this.msgEtaJ.push(0); }
  }
  edgeKey(a,b){ return a<b ? `${a}_${b}` : `${b}_${a}`; }
  edgeSet(){ const s=new Set(); for(let e=0;e<this.i.length;e++) s.add(this.edgeKey(this.i[e],this.j[e])); return s; }

  activeWeightAt(e, opts={}){
    let w=this.baseW[e];
    if(opts.anneal && this.kind[e]===1){ const K=Math.max(1, parseInt(opts.annealK ?? 200)); w *= Math.max(0, 1 - this.iter/K); }
    return w;
  }
  belief(readout='full'){
    const lam=zeros(this.N), eta=zeros(this.N);
    for(let v=0; v<this.N; v++){ lam[v]=this.p0; eta[v]=this.p0*this.y[v]; }
    const useBase = readout==='base';
    for(let e=0;e<this.i.length;e++){
      if(useBase && this.kind[e]!==0) continue;
      const a=this.i[e], b=this.j[e];
      lam[a]+=this.msgLamI[e]; eta[a]+=this.msgEtaI[e];
      lam[b]+=this.msgLamJ[e]; eta[b]+=this.msgEtaJ[e];
    }
    const mu=zeros(this.N);
    for(let v=0;v<this.N;v++) mu[v]=eta[v]/Math.max(lam[v], EPS);
    return {lam,eta,mu};
  }
  targetForPairs(pi,pj,targetMode,readout,muOverride=null){
    const out=zeros(pi.length);
    if(targetMode==='zero') return out;
    if(targetMode==='prior'){
      for(let k=0;k<pi.length;k++) out[k]=this.y[pi[k]]-this.y[pj[k]];
      return out;
    }
    const mu = muOverride ?? this.belief(readout).mu;
    for(let k=0;k<pi.length;k++) out[k]=mu[pi[k]]-mu[pj[k]];
    return out;
  }
  addRandomShortcuts(count,targetMode,readout,source=1,muOverride=null){
    count=Math.max(0,parseInt(count));
    const existing=this.edgeSet(); const ni=[], nj=[]; let tries=0;
    while(ni.length<count && tries<count*2000+2000){
      tries++;
      const a=this.rng.int(this.N), b=this.rng.int(this.N);
      if(a===b) continue;
      const ra=Math.floor(a/this.n), ca=a%this.n, rb=Math.floor(b/this.n), cb=b%this.n;
      if(Math.abs(ra-rb)+Math.abs(ca-cb)<=1) continue;
      const key=this.edgeKey(a,b); if(existing.has(key)) continue;
      existing.add(key); ni.push(a); nj.push(b);
    }
    const nz=this.targetForPairs(ni,nj,targetMode,readout,muOverride);
    this.appendEdges(ni,nj,new Array(ni.length).fill(this.shortcutW),nz,new Array(ni.length).fill(1),new Array(ni.length).fill(source));
    return ni.length;
  }
  addManualShortcut(a,b,targetMode,readout){
    a=parseInt(a); b=parseInt(b);
    if(a<0||b<0||a>=this.N||b>=this.N||a===b) return false;
    if(this.edgeSet().has(this.edgeKey(a,b))) return false;
    const z=this.targetForPairs([a],[b],'current',readout)[0];
    this.appendEdges([a],[b],[this.shortcutW],[z],[1],[2]);
    return true;
  }
  filterEdges(keepFn){
    const ni=[],nj=[],nw=[],nz=[],nk=[],ns=[],mli=[],mei=[],mlj=[],mej=[];
    for(let e=0;e<this.i.length;e++) if(keepFn(e)){
      ni.push(this.i[e]); nj.push(this.j[e]); nw.push(this.baseW[e]); nz.push(this.z[e]); nk.push(this.kind[e]); ns.push(this.source[e]);
      mli.push(this.msgLamI[e]); mei.push(this.msgEtaI[e]); mlj.push(this.msgLamJ[e]); mej.push(this.msgEtaJ[e]);
    }
    this.i=ni; this.j=nj; this.baseW=nw; this.z=nz; this.kind=nk; this.source=ns;
    this.msgLamI=mli; this.msgEtaI=mei; this.msgLamJ=mlj; this.msgEtaJ=mej;
  }
  clearShortcuts(){ this.filterEdges(e => this.kind[e]===0); }
  refreshShortcutTargets(targetMode,readout,resetMessages=true,sourceFilter=null,muOverride=null){
    const idx=[]; for(let e=0;e<this.i.length;e++) if(this.kind[e]===1 && (sourceFilter===null || this.source[e]===sourceFilter)) idx.push(e);
    if(!idx.length) return;
    const pi=idx.map(e=>this.i[e]), pj=idx.map(e=>this.j[e]);
    const tz=this.targetForPairs(pi,pj,targetMode,readout,muOverride);
    for(let k=0;k<idx.length;k++){
      const e=idx[k]; this.z[e]=tz[k];
      if(resetMessages){ this.msgLamI[e]=0; this.msgEtaI[e]=0; this.msgLamJ[e]=0; this.msgEtaJ[e]=0; }
    }
  }
  refreshManualShortcuts(readout,resetMessages=true,muOverride=null){ this.refreshShortcutTargets('current',readout,resetMessages,2,muOverride); }
  resampleRandomShortcuts(count,targetMode,readout,muOverride=null){
    this.filterEdges(e => this.source[e]!==1);
    return this.addRandomShortcuts(count,targetMode,readout,1,muOverride);
  }
  resetMessages(){
    for(let e=0;e<this.i.length;e++){ this.msgLamI[e]=0; this.msgEtaI[e]=0; this.msgLamJ[e]=0; this.msgEtaJ[e]=0; }
    this.iter=0; this.history=[];
  }
  stepGBP(opts={}){
    const damp=clamp(Number(opts.damping ?? 0),0,0.99);
    const {lam,eta}=this.belief('full');
    const oldLI=this.msgLamI.slice(), oldEI=this.msgEtaI.slice(), oldLJ=this.msgLamJ.slice(), oldEJ=this.msgEtaJ.slice();
    for(let e=0;e<this.i.length;e++){
      const w=this.activeWeightAt(e,opts), a=this.i[e], b=this.j[e];
      const cavLamJ=Math.max(lam[b]-oldLJ[e], EPS), cavEtaJ=eta[b]-oldEJ[e];
      const denJ=Math.max(w+cavLamJ, EPS);
      const nLamI=w*cavLamJ/denJ;
      const nEtaI=(w/denJ)*cavEtaJ + nLamI*this.z[e];
      const cavLamI=Math.max(lam[a]-oldLI[e], EPS), cavEtaI=eta[a]-oldEI[e];
      const denI=Math.max(w+cavLamI, EPS);
      const nLamJ=w*cavLamI/denI;
      const nEtaJ=(w/denI)*cavEtaI - nLamJ*this.z[e];
      if(damp>0){ const q=1-damp; this.msgLamI[e]=damp*oldLI[e]+q*nLamI; this.msgEtaI[e]=damp*oldEI[e]+q*nEtaI; this.msgLamJ[e]=damp*oldLJ[e]+q*nLamJ; this.msgEtaJ[e]=damp*oldEJ[e]+q*nEtaJ; }
      else { this.msgLamI[e]=nLamI; this.msgEtaI[e]=nEtaI; this.msgLamJ[e]=nLamJ; this.msgEtaJ[e]=nEtaJ; }
    }
    this.iter++;
  }
  maybeRefreshBeforeStep(opts={}){
    const R=Math.max(1,parseInt(opts.refreshR ?? 10));
    if(this.iter<=0 || this.iter%R!==0) return;
    const targetMode=String(opts.targetMode ?? 'current'), readout=String(opts.readout ?? 'base');
    const muAt=this.belief(readout).mu;
    if(opts.dynamicRandom){
      this.refreshManualShortcuts(readout,true,muAt);
      const count=Math.max(0,parseInt(opts.shortcutCount ?? 10));
      this.resampleRandomShortcuts(count,targetMode,readout,muAt);
    } else if(targetMode==='current'){
      this.refreshShortcutTargets(targetMode,readout,true,null,muAt);
    } else {
      this.refreshManualShortcuts(readout,true,muAt);
    }
  }

  buildSystemForReference(mode='base'){
    const useCurrent = mode==='current';
    const ri=[], rj=[], rw=[], rz=[];
    const b=this.y.map(x=>this.p0*x);
    const diag=new Array(this.N).fill(this.p0);
    for(let e=0;e<this.i.length;e++){
      if(!useCurrent && this.kind[e]!==0) continue;
      const w = useCurrent ? this.activeWeightAt(e,{anneal:false}) : this.baseW[e];
      if(w<=EPS) continue;
      const a=this.i[e], c=this.j[e], z=this.z[e];
      ri.push(a); rj.push(c); rw.push(w); rz.push(z);
      diag[a]+=w; diag[c]+=w; b[a]+=w*z; b[c]-=w*z;
    }
    return {b,ri,rj,rw,rz,diag};
  }
  applyA(x, ref){
    const out=x.map(v=>this.p0*v);
    for(let k=0;k<ref.ri.length;k++){
      const a=ref.ri[k], b=ref.rj[k], w=ref.rw[k];
      const d=x[a]-x[b]; out[a]+=w*d; out[b]-=w*d;
    }
    return out;
  }
  solveMapOnce(mode='base'){
    const ref=this.buildSystemForReference(mode);
    const t0=performance.now();
    let x, solver, rel, iters=0;
    if(mode==='base'){
      const res=this.solveBandedCholesky(ref);
      x=res.x; solver='Frontend banded sparse Cholesky'; rel=res.rel; iters=0;
    } else {
      const res=this.solvePCG(ref,this.y.slice());
      x=res.x; solver=`Frontend PCG fallback (${res.iters} iters)`; rel=res.rel; iters=res.iters;
    }
    const solveMs=performance.now()-t0;
    const bNorm=norm(ref.b);
    const r0=norm(ref.b.map((v,i)=>v-this.applyA(this.y,ref)[i]));
    const mr={
      mode,xstar:x,b:ref.b,refI:ref.ri,refJ:ref.rj,refW:ref.rw,refZ:ref.rz,diag:ref.diag,
      estar:this.energy(x,ref.ri,ref.rj,ref.rw,ref.rz), ey:this.energy(this.y,ref.ri,ref.rj,ref.rw,ref.rz),
      solver, solveMs, relResidual:rel, r0Norm:r0, bNorm, nnzA:this.N+4*ref.ri.length, nnzFactor:null, iters
    };
    this.mapref=mr; return mr;
  }
  lowerBandIndex(i,j,bw){ return i*(bw+1)+(i-j); }
  solveBandedCholesky(ref){
    const N=this.N, bw=this.n;
    const band=new Float64Array(N*(bw+1));
    const idx=(i,j)=>i*(bw+1)+(i-j);
    for(let i=0;i<N;i++) band[idx(i,i)]=this.p0;
    for(let k=0;k<ref.ri.length;k++){
      const a=ref.ri[k], b=ref.rj[k], w=ref.rw[k];
      band[idx(a,a)] += w; band[idx(b,b)] += w;
      const hi=Math.max(a,b), lo=Math.min(a,b);
      if(hi-lo<=bw) band[idx(hi,lo)] += -w;
    }
    const L=new Float64Array(N*(bw+1));
    for(let i=0;i<N;i++){
      const j0=Math.max(0,i-bw);
      for(let j=j0;j<=i;j++){
        let s=band[idx(i,j)];
        const k0=Math.max(0,i-bw,j-bw);
        for(let k=k0;k<j;k++) s -= L[idx(i,k)]*L[idx(j,k)];
        if(i===j) L[idx(i,i)] = Math.sqrt(Math.max(s, EPS));
        else L[idx(i,j)] = s / Math.max(L[idx(j,j)], EPS);
      }
    }
    const y=zeros(N), x=zeros(N);
    for(let i=0;i<N;i++){
      let s=ref.b[i]; const j0=Math.max(0,i-bw);
      for(let j=j0;j<i;j++) s -= L[idx(i,j)]*y[j];
      y[i]=s/Math.max(L[idx(i,i)],EPS);
    }
    for(let i=N-1;i>=0;i--){
      let s=y[i]; const r1=Math.min(N-1,i+bw);
      for(let r=i+1;r<=r1;r++) s -= L[idx(r,i)]*x[r];
      x[i]=s/Math.max(L[idx(i,i)],EPS);
    }
    const Ax=this.applyA(x,ref);
    const rel=norm(ref.b.map((v,i)=>v-Ax[i]))/Math.max(norm(ref.b),EPS);
    return {x,rel};
  }
  solvePCG(ref,x0){
    const N=this.N, x=x0.slice();
    let Ax=this.applyA(x,ref), r=zeros(N);
    for(let i=0;i<N;i++) r[i]=ref.b[i]-Ax[i];
    let z=r.map((v,i)=>v/Math.max(ref.diag[i],EPS));
    let p=z.slice(), rz=dot(r,z), bNorm=Math.max(norm(ref.b),EPS), rel=norm(r)/bNorm;
    const tol=1e-10, maxIt=Math.min(20000,Math.max(500,4*N));
    let it=0;
    for(; it<maxIt && rel>tol; it++){
      const Ap=this.applyA(p,ref);
      const alpha=rz/Math.max(dot(p,Ap),EPS);
      for(let i=0;i<N;i++){ x[i]+=alpha*p[i]; r[i]-=alpha*Ap[i]; }
      rel=norm(r)/bNorm; if(rel<=tol) break;
      z=r.map((v,i)=>v/Math.max(ref.diag[i],EPS));
      const rzNew=dot(r,z), beta=rzNew/Math.max(rz,EPS);
      for(let i=0;i<N;i++) p[i]=z[i]+beta*p[i];
      rz=rzNew;
    }
    return {x,rel,iters:it+1};
  }
  energy(x,ri,rj,rw,rz){
    let E=0; for(let v=0;v<this.N;v++){ const d=x[v]-this.y[v]; E += 0.5*this.p0*d*d; }
    for(let k=0;k<ri.length;k++){ const d=x[ri[k]]-x[rj[k]]-rz[k]; E += 0.5*rw[k]*d*d; }
    return E;
  }
  applyRefA(x,ref){
    const out=x.map(v=>this.p0*v);
    for(let k=0;k<ref.refI.length;k++){
      const a=ref.refI[k], b=ref.refJ[k], w=ref.refW[k]; const d=x[a]-x[b];
      out[a]+=w*d; out[b]-=w*d;
    }
    return out;
  }
  recordMetrics(readout='base'){
    if(!this.mapref) return null;
    const mu=this.belief(readout).mu, ref=this.mapref;
    const Amu=this.applyRefA(mu,ref);
    const r=ref.b.map((v,i)=>v-Amu[i]);
    const rNorm=norm(r), residualB=rNorm/Math.max(ref.bNorm,EPS), residual=rNorm/Math.max(ref.r0Norm,EPS);
    const Emu=this.energy(mu,ref.refI,ref.refJ,ref.refW,ref.refZ);
    const gap=Math.max(0,Emu-ref.estar);
    const mapError=norm(mu.map((v,i)=>v-ref.xstar[i]))/Math.max(norm(ref.xstar),EPS);
    const rec={iter:this.iter,residual,residualB,energyGap:gap,relEnergyGap:gap/Math.max(Math.abs(ref.ey-ref.estar),EPS),mapError,energy:Emu};
    if(this.history.length && this.history[this.history.length-1].iter===this.iter) this.history[this.history.length-1]=rec;
    else { this.history.push(rec); if(this.history.length>2000) this.history=this.history.slice(-2000); }
    return rec;
  }
  snapshot(readout='base'){
    const mu=this.belief(readout).mu, shortcuts=[];
    for(let e=0;e<this.i.length;e++) if(this.kind[e]===1) shortcuts.push({i:this.i[e],j:this.j[e],z:this.z[e],w:this.baseW[e],source:this.source[e]});
    const gridZ=[]; for(let e=0;e<this.i.length;e++) if(this.kind[e]===0) gridZ.push(this.z[e]);
    const ref=this.mapref;
    const stats={
      iter:this.iter,n:this.n,N:this.N,edgeCount:this.i.length,gridEdgeCount:this.kind.filter(x=>x===0).length,shortcutCount:this.kind.filter(x=>x===1).length,
      randomShortcutCount:this.kind.map((k,e)=>k===1 && this.source[e]===1 ? 1 : 0).reduce((a,b)=>a+b,0),
      manualShortcutCount:this.kind.map((k,e)=>k===1 && this.source[e]===2 ? 1 : 0).reduce((a,b)=>a+b,0),
      p0:this.p0,gridW:this.gridW,shortcutW:this.shortcutW,edgeObsMode:this.edgeObsMode,gridZStd:std(gridZ)
    };
    if(ref){ Object.assign(stats,{mapMode:ref.mode,solver:ref.solver,solveMs:ref.solveMs,solveRelResidual:ref.relResidual,initialResidualNorm:ref.r0Norm,bNorm:ref.bNorm,nnzA:ref.nnzA,nnzFactor:ref.nnzFactor,Estar:ref.estar,Ey:ref.ey}); }
    return {stats,y:this.y.slice(),mu,shortcuts,history:this.history.slice(-600)};
  }
}

let STATE = new GBPStateJS();

function resize(){ const d=window.devicePixelRatio||1; for(const cv of [grid,chart]){ const r=cv.getBoundingClientRect(); cv.width=Math.max(1,Math.floor(r.width*d)); cv.height=Math.max(1,Math.floor(r.height*d)); cv.getContext('2d').setTransform(d,0,0,d,0,0); } }
function rc(i){ return [Math.floor(i/S.stats.n), i%S.stats.n]; }
function pos(i){ const r=grid.getBoundingClientRect(), pad=42, n=S.stats.n; const cell=Math.min((r.width-2*pad)/(n-1||1),(r.height-2*pad)/(n-1||1)); const [rr,c]=rc(i); return [(r.width-cell*(n-1))/2+c*cell,(r.height-cell*(n-1))/2+rr*cell,cell]; }
function color(v,mi,ma){ let t=(v-mi)/(ma-mi+1e-12); t=Math.max(0,Math.min(1,t)); let a=t<.5?t*2:(t-.5)*2; let c=t<.5?[[103,232,249],[13,19,38]]:[[13,19,38],[251,191,36]]; return `rgb(${(c[0][0]*(1-a)+c[1][0]*a)|0},${(c[0][1]*(1-a)+c[1][1]*a)|0},${(c[0][2]*(1-a)+c[1][2]*a)|0})`; }
function drawGrid(){
  if(!S) return; const r=grid.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); const n=S.stats.n, mu=S.mu; let mi=Math.min(...mu), ma=Math.max(...mu); ctx.lineCap='round';
  const noisy = S.stats.edgeObsMode === 'noisy';
  for(let rr=0; rr<n; rr++) for(let c=0; c<n; c++){
    const u=rr*n+c;
    ctx.strokeStyle = noisy ? 'rgba(180,210,240,.20)' : 'rgba(180,210,240,.13)';
    if(c+1<n){ let [x1,y1,cell]=pos(u), [x2,y2]=pos(u+1); ctx.lineWidth=Math.max(1,cell*.035); ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
    if(rr+1<n){ let [x1,y1,cell]=pos(u), [x2,y2]=pos(u+n); ctx.lineWidth=Math.max(1,cell*.035); ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
  }
  for(const e of S.shortcuts){ const [x1,y1,cell]=pos(e.i), [x2,y2]=pos(e.j); const dx=x2-x1, dy=y2-y1, L=Math.hypot(dx,dy)||1, nx=-dy/L, ny=dx/L; ctx.strokeStyle=e.source===2?'rgba(251,191,36,.82)':'rgba(103,232,249,.66)'; ctx.lineWidth=Math.max(1.35,cell*.06); ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo((x1+x2)/2+nx*Math.min(38,L*.08),(y1+y2)/2+ny*Math.min(38,L*.08),x2,y2); ctx.stroke(); }
  for(let i=0;i<S.stats.N;i++){ const [x,y,cell]=pos(i), rad=Math.max(2.4,Math.min(9.5,cell*.18)); ctx.beginPath(); ctx.arc(x,y,rad,0,Math.PI*2); ctx.fillStyle=color(mu[i],mi,ma); ctx.fill(); ctx.strokeStyle=i===selected?'#fbbf24':i===hover?'#fff':'rgba(255,255,255,.38)'; ctx.lineWidth=i===selected?2.8:1; ctx.stroke(); }
}
function drawChart(){
  if(!S) return; const d=S.history||[], r=chart.getBoundingClientRect(); cctx.clearRect(0,0,r.width,r.height);
  if(d.length<2){ cctx.fillStyle='rgba(255,255,255,.45)'; cctx.font='12px system-ui'; cctx.fillText('Run GBP to show metric curves.',14,24); return; }
  const p={l:42,t:8,r:10,b:20}, W=r.width-p.l-p.r, H=r.height-p.t-p.b, x0=d[0].iter, x1=d[d.length-1].iter;
  const vals=d.flatMap(o=>[o.residual,o.relEnergyGap,o.mapError]).filter(x=>x>0&&isFinite(x)); let ymin=Math.min(-12,...vals.map(x=>Math.log10(x))), ymax=Math.max(0,...vals.map(x=>Math.log10(x)));
  const X=x=>p.l+(x-x0)/(x1-x0+1e-12)*W, Y=v=>p.t+(ymax-Math.log10(Math.max(v,1e-14)))/(ymax-ymin+1e-12)*H;
  cctx.strokeStyle='rgba(255,255,255,.12)'; cctx.lineWidth=1; cctx.font='10px ui-monospace,monospace';
  for(let k=Math.ceil(ymin);k<=Math.floor(ymax);k++){ let y=Y(10**k); cctx.beginPath(); cctx.moveTo(p.l,y); cctx.lineTo(p.l+W,y); cctx.stroke(); cctx.fillStyle='rgba(255,255,255,.38)'; cctx.fillText('1e'+k,4,y+4); }
  for(const [col,fn] of [['#67e8f9',o=>o.residual],['#34d399',o=>o.relEnergyGap],['#fb7185',o=>o.mapError]]){ cctx.strokeStyle=col; cctx.lineWidth=2.35; cctx.beginPath(); d.forEach((o,i)=>{ let x=X(o.iter), y=Y(fn(o)); if(i)cctx.lineTo(x,y); else cctx.moveTo(x,y); }); cctx.stroke(); }
}
function updateStats(){
  if(!S) return; const st=S.stats, last=(S.history||[]).at(-1)||{};
  $('iterBig').textContent=st.iter; $('vars').textContent=st.N; $('edges').textContent=st.edgeCount; $('shorts').textContent=st.shortcutCount; $('selected').textContent=selected>=0?selected:'none';
  $('resid').textContent=fmt(last.residual); $('merr').textContent=fmt(last.mapError); $('egap').textContent=fmt(last.energyGap); $('rgap').textContent=fmt(last.relEnergyGap);
  $('solver').textContent=st.solver||'—'; $('solveMs').textContent=fmt(st.solveMs)+' ms'; $('solveRel').textContent=fmt(st.solveRelResidual); $('mapMode').textContent=st.mapMode||'base';
  $('edgeModeStat').textContent=st.edgeObsMode||'—'; $('gridZStd').textContent=fmt(st.gridZStd); $('shortcutSplit').textContent=`${st.randomShortcutCount||0} / ${st.manualShortcutCount||0}`;
  $('badge').textContent=`iter ${st.iter} · ${st.N} vars · ${st.edgeObsMode||'base'} · frontend GBP`;
}
function update(){ resize(); updateStats(); drawGrid(); drawChart(); }
function nearest(ev){ if(!S) return -1; const r=grid.getBoundingClientRect(), x=ev.clientX-r.left, y=ev.clientY-r.top; let best=-1, bd=1e18, cell=20; for(let i=0;i<S.stats.N;i++){ const [nx,ny,c]=pos(i); cell=c; const d=(x-nx)**2+(y-ny)**2; if(d<bd){bd=d;best=i;} } return bd<Math.max(12,cell*.42)**2?best:-1; }
function commit(readout=null){ S=STATE.snapshot(readout || String(val('readout')||'base')); update(); }
async function runFrontend(o){
  const steps=Math.max(1,Math.min(20000,parseInt(o.steps??100))), metricEvery=Math.max(1,parseInt(o.metricEvery??10));
  const readout=String(o.readout??'base'); const t0=performance.now();
  for(let k=0;k<steps && running;k++){
    STATE.maybeRefreshBeforeStep(o);
    STATE.stepGBP(o);
    if(STATE.iter%metricEvery===0) STATE.recordMetrics(readout);
    if(k%50===49){ commit(readout); await new Promise(requestAnimationFrame); }
  }
  STATE.recordMetrics(readout);
  commit(readout);
  return {runMs:performance.now()-t0};
}

grid.onmousemove=e=>{hover=nearest(e); drawGrid();};
grid.onclick=e=>{ const nd=nearest(e); if(nd<0) return; if(selected<0){selected=nd; updateStats(); drawGrid(); return;} if(selected===nd){selected=-1; updateStats(); drawGrid(); return;} const ok=STATE.addManualShortcut(selected,nd,String(val('targetMode')||'current'),String(val('readout')||'base')); STATE.recordMetrics(String(val('readout')||'base')); selected=-1; commit(); setStatus(ok?'Manual persistent shortcut added.':'Could not add manual shortcut.'); };
$('buildBtn').onclick=()=>{ try{ selected=-1; STATE.initGrid(opts()); const count=parseInt(val('shortcutCount')||0); if(count>0){ STATE.addRandomShortcuts(count,String(val('targetMode')||'current'),String(val('readout')||'base')); STATE.recordMetrics(String(val('readout')||'base')); } commit(); setStatus('Built grid, generated base observations, and solved MAP once.'); }catch(e){setStatus(e.message);} };
$('randBtn').onclick=()=>{ try{ const added=STATE.addRandomShortcuts(parseInt(val('shortcutCount')||10),String(val('targetMode')||'current'),String(val('readout')||'base')); STATE.recordMetrics(String(val('readout')||'base')); commit(); setStatus(`Added ${added||0} random shortcuts.`); }catch(e){setStatus(e.message);} };
$('clearBtn').onclick=()=>{ try{ STATE.clearShortcuts(); STATE.recordMetrics(String(val('readout')||'base')); commit(); setStatus('Cleared shortcuts.'); }catch(e){setStatus(e.message);} };
$('refreshBtn').onclick=()=>{ try{ const readout=String(val('readout')||'base'), targetMode=String(val('targetMode')||'current'); const mu=STATE.belief(readout).mu; if(targetMode==='current') STATE.refreshShortcutTargets('current',readout,true,null,mu); else { STATE.refreshShortcutTargets(targetMode,readout,true,1,mu); STATE.refreshManualShortcuts(readout,true,mu); } STATE.recordMetrics(readout); commit(readout); setStatus('Refreshed shortcut targets and reset shortcut messages.'); }catch(e){setStatus(e.message);} };
$('resetBtn').onclick=()=>{ try{ STATE.resetMessages(); STATE.recordMetrics(String(val('readout')||'base')); commit(); setStatus('Messages reset. MAP reference unchanged.'); }catch(e){setStatus(e.message);} };
$('mapBtn').onclick=()=>{ try{ STATE.solveMapOnce('base'); STATE.recordMetrics(String(val('readout')||'base')); commit(); setStatus('Recomputed base MAP once.'); }catch(e){setStatus(e.message);} };
$('runBtn').onclick=async()=>{ if(running) return; running=true; setStatus('Running frontend GBP…'); try{ const d=await runFrontend(opts()); setStatus(`Ran frontend GBP in ${fmt(d.runMs)} ms.`); }catch(e){setStatus(e.message);} running=false; };
$('stopBtn').onclick=()=>{ running=false; setStatus('Stop requested.'); };
window.onresize=update;
function loadDefaultDemo(){
  try{
    STATE.initGrid(opts());
    const count=parseInt(val('shortcutCount')||0);
    if(count>0){
      STATE.addRandomShortcuts(count,String(val('targetMode')||'current'),String(val('readout')||'base'));
      STATE.recordMetrics(String(val('readout')||'base'));
    }
    commit(String(val('readout')||'base'));
    setStatus('Default shortcut demo loaded. Click Run GBP.');
  }catch(e){ setStatus(e.message); commit('base'); }
}
loadDefaultDemo();
