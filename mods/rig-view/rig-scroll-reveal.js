/** Native key handling can overwrite a same-frame ScrollHandle reveal. Request it
 * after that key frame, using the timer's live context. Cancel before releasing
 * the handle or replacing this request; getIndex reads the latest selection. */
export function revealAfterKey(cx,scroll,getIndex,owner){
 let canceled=false;
 const task=cx.timer.after(16,nextCx=>{
  if(canceled)return;
  const index=getIndex();
  if(Number.isInteger(index)&&index>=0){scroll.scroll_to_item(index);nextCx.notify();}
 },{owner});
 return ()=>{canceled=true;task?.cancel?.();};
}
