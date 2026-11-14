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

/** Herdr's mod runtime fails a socket read after 30 s without bytes ("Resource temporarily unavailable", os error 11), and OpenRig's event
 *  stream sends nothing while quiet. That is an idle stream, not a closed one (a closed one reads as `null`). A TCP timeout is a dead peer. */
export const isIdleTimeout = (error) => /Resource temporarily unavailable|os error 11\b/i.test(String(error?.message ?? error));

/** After this many idle timeouts in a row (30 s each: about two minutes of silence) the stream is replaced even though the daemon still answers
 *  on a new connection. A tunnel or middlebox can drop an idle flow without a reset: the daemon is fine, this socket is not, and it would
 *  otherwise stay open and silent forever. The sidebar's 5 s polling keeps its data fresh meanwhile; the replacement costs one reconnect and
 *  one refresh per two quiet minutes (the unfixed code did four reconnects in that time). */
export const MAX_IDLE_TIMEOUTS = 4;

/** Reads a stream until it ends. An idle timeout is not a disconnect: `alive()` (one small health request) decides, and while the daemon
 *  answers the same socket is read again, so a quiet system makes no reconnect and no refresh. Returns "closed" (the daemon closed it),
 *  "unhealthy" (the check failed or threw: reconnect with backoff), "stale" (MAX_IDLE_TIMEOUTS timeouts in a row with no data: replace it)
 *  or "stopped"; any other read error is thrown to the caller. Any chunk resets the idle count. */
export async function pumpEvents(socket, { onChunk, alive, stop }) {
  let idle = 0;
  for (;;) {
    let chunk;
    try { chunk = await socket.read(65536); }
    catch (error) {
      if (!isIdleTimeout(error)) throw error;
      if (stop()) return "stopped";
      let ok = false;
      try { ok = await alive(); } catch { ok = false; }
      if (stop()) return "stopped";
      if (!ok) return "unhealthy";
      if (++idle >= MAX_IDLE_TIMEOUTS) return "stale";
      continue;
    }
    if (chunk === null) return "closed";
    if (stop()) return "stopped";
    idle = 0;
    onChunk(chunk);
  }
}
