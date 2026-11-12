// One sidebar connection. Prefer the public event bus; older daemons can retain their activity-only stream.
const PATHS=["/api/events?replay=0","/api/activity/events"];
async function headers(socket){
  let bytes=new Uint8Array(0);
  for(;;){
    const chunk=await socket.read(65536);if(chunk===null)throw new Error("OpenRig closed the event stream before its HTTP response.");
    const next=new Uint8Array(bytes.length+chunk.length);next.set(bytes);next.set(chunk,bytes.length);bytes=next;
    let end=-1;for(let i=3;i<bytes.length;i++)if(bytes[i-3]===13&&bytes[i-2]===10&&bytes[i-1]===13&&bytes[i]===10){end=i+1;break;}
    if(end<0){if(bytes.length>65536)throw new Error("OpenRig event response headers are too large.");continue;}
    if(end>65536)throw new Error("OpenRig event response headers are too large.");
    const head=Array.from(bytes.slice(0,end),b=>String.fromCharCode(b)).join("");
    const status=Number(/^HTTP\/1\.[01] (\d{3})\b/.exec(head)?.[1]);
    if(!status)throw new Error("OpenRig returned an invalid event HTTP response.");
    // sseParser consumes raw HTTP, including the head; retain every byte already read.
    return{status,head,initial:bytes};
  }
}
export async function openRigEventStream(connect,url,onSocket=()=>{}){
  for(const path of PATHS){
    const socket=await connect(url.hostname,Number(url.port||80));onSocket(socket);
    try{
      await socket.write(`GET ${path} HTTP/1.1\r\nHost: ${url.host}\r\nAccept: text/event-stream\r\n\r\n`);
      const response=await headers(socket);
      if(response.status===404&&path===PATHS[0]){socket.close();continue;}
      if(response.status!==200)throw new Error(`OpenRig event stream returned HTTP ${response.status}.`);
      if(!/^content-type:\s*text\/event-stream(?:[;\s]|$)/im.test(response.head))throw new Error("OpenRig event response is not an event stream.");
      return{socket,path,initial:response.initial};
    }catch(error){try{socket.close();}catch{}throw error;}
  }
  throw new Error("OpenRig has no supported event stream.");
}
