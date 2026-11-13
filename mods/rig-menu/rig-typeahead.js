const fold=text=>String(text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** Menu/select-list typeahead only; callers keep tree letter commands untouched. */
export function typeahead(state,event,labels,current,now=Date.now()){
 if(Object.entries(event.modifiers??{}).some(([key,value])=>key!=='shift'&&value))return null;
 const char=event.key_char??(event.key==='space'?' ':event.key);
 if(typeof char!=='string'||[...char].length!==1||/[\u0000-\u001f\u007f]/.test(char))return null;
 const active=!!state?.query&&now-state.at<=500;
 if(char===' '&&!active)return null;
 const key=fold(char),repeat=active&&[...state.query].every(c=>c===key);
 const query=active&&!repeat?state.query+key:key;
 const start=active&&!repeat?current:current+1;
 let index=current;
 for(let n=0;n<labels.length;n++){
  const candidate=(Math.max(0,start)+n)%labels.length;
  if(fold(labels[candidate]).startsWith(query)){index=candidate;break;}
 }
 return {query,at:now,index};
}
