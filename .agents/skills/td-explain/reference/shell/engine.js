function drawMap(st){
  const N=mapLabels(),E=edgeLabels();let b="";
  for(const k in MAPE){const [d,[lx,ly,a]]=MAPE[k];const on=st.edges.includes(k);const w=(st.warn||[]).includes(k);b+=ar(d,on?(w?"warn":"on"):"")+tx(lx,ly,E[k],on?(w?"el w":"el hl"):"el",a);}
  for(const k in MAPN){const [x,y,w,h]=MAPN[k];b+=box(x,y,w,h,N[k][0],N[k][1],st.nodes.includes(k)?"on":"");}
  $("#map").innerHTML=svg(MAPW,MAPH,L("Mapa del sistema","System map"),b);
}
function render(){
  document.documentElement.lang=lang;
  document.querySelectorAll("[data-i]").forEach(el=>el.innerHTML=T[lang][el.dataset.i]);
  document.querySelectorAll(".lang button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.l===lang));
  $("#prev").textContent=L("← Anterior","← Back");$("#next").textContent=L("Siguiente →","Next →");
  $("#people").innerHTML=PEOPLE().map(p=>`<span class="person ${p.c||""}"><span class="av">${p.a}</span>${p.n} <small>${p.r}</small></span>`).join("");
  $("#picker").innerHTML=STEPS.map((s,i)=>`<button data-s="${i}"><span class="n">${i+1}</span>${s[lang].t}</button>`).join("");
  document.querySelectorAll("#picker button").forEach(b=>b.onclick=()=>go(+b.dataset.s));
  $("#sections").innerHTML=SECTIONS().map(s=>`<section><h2>${s.t}</h2>${s.s?`<p class="sub">${s.s}</p>`:""}${s.html}</section>`).join("");
  go(cur);
}
function go(i){
  cur=i;const s=STEPS[i],c=s[lang];
  drawMap(s);$("#flow").innerHTML=c.flow;
  document.querySelectorAll("#picker button").forEach(b=>b.setAttribute("aria-current",+b.dataset.s===i));
  $("#card").innerHTML=`<span class="num">${L("Paso","Step")} ${i+1} / ${STEPS.length}${(s.tags||[]).map(t=>`<span class="tag">${t}</span>`).join("")}</span><h2>${c.t}</h2><p class="what">${c.what}</p>${FIGS[i]()}`+
   (c.facts&&c.facts.length?`<ul class="facts">${c.facts.map(f=>f.startsWith("flag:")?`<li class="flag">${f.slice(5)}</li>`:`<li>${f}</li>`).join("")}</ul>`:"")+
   `<details class="where"><summary>${s.codeL?s.codeL[lang]:L("Dónde está en el código","Where it is in the code")}</summary><ul>${s.code.map(p=>`<li>${esc(p)}</li>`).join("")}</ul></details>`;
  $("#prev").disabled=i===0;$("#next").disabled=i===STEPS.length-1;
}
$("#prev").onclick=()=>cur>0&&go(cur-1);
$("#next").onclick=()=>cur<STEPS.length-1&&go(cur+1);
document.querySelectorAll(".lang button").forEach(b=>b.onclick=()=>{lang=b.dataset.l;try{localStorage.setItem("td-explain-lang",lang)}catch(e){}render();});
document.addEventListener("keydown",e=>{if(e.target.closest&&e.target.closest("input,textarea"))return;if(e.key==="ArrowRight"&&cur<STEPS.length-1)go(cur+1);if(e.key==="ArrowLeft"&&cur>0)go(cur-1);});
{const m=/s=(\d+)/.exec(location.hash);if(m)cur=Math.min(+m[1],STEPS.length-1);}
render();
</script>
</body>
</html>
