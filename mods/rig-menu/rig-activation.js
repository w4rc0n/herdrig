// Herdr delivers the key callback and a native click for keyboard activation.
// State belongs to the view/control, not a render closure: a redraw between the
// two callbacks must not turn one Enter into two actions. No time-based debounce.
const owners=new WeakMap();
const activationKey=event=>['enter','return','space',' '].includes(String(event?.key??'').toLowerCase());
export function activationPair(owner,id){
  let controls=owners.get(owner);if(!controls)owners.set(owner,controls=new Map());
  let state=controls.get(id);if(!state)controls.set(id,state={keyPending:false});
  return{
    key:handler=>(event,cx)=>{
      if(activationKey(event))state.keyPending=true;
      return handler(event,cx); // keep existing disabled, repeat and review-release fences
    },
    click:handler=>(event,cx)=>{
      if(state.keyPending){state.keyPending=false;cx.stop_propagation();return;}
      return handler(event,cx);
    },
    pointer:(handler=()=>{})=>(event,cx)=>{
      state.keyPending=false; // an independent pointer action is never swallowed
      return handler(event,cx);
    },
  };
}
