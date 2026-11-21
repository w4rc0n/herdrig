// SHA-256 over UTF-8 text, without host APIs (also runs in QuickJS).
// Encode unpaired UTF-16 surrogates as U+FFFD, like Node's Buffer.from(text).
const ROUND = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];
const rotate = (value,bits) => (value >>> bits) | (value << (32-bits));

/** Return the lowercase SHA-256 hex digest of a string's UTF-8 bytes. */
export function sha256Text(text) {
  if(typeof text !== 'string')throw new TypeError('sha256Text expects a string');
  const state=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const block=new Uint8Array(64),words=new Int32Array(64);
  let used=0,bytes=0;
  const compress=()=>{
    for(let i=0;i<16;i++)words[i]=(block[i*4]<<24)|(block[i*4+1]<<16)|(block[i*4+2]<<8)|block[i*4+3];
    for(let i=16;i<64;i++){
      const x=words[i-15],y=words[i-2];
      words[i]=(words[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))|0;
    }
    let [a,b,c,d,e,f,g,h]=state;
    for(let i=0;i<64;i++){
      const first=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+ROUND[i]+words[i])|0;
      const second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
      h=g;g=f;f=e;e=(d+first)|0;d=c;c=b;b=a;a=(first+second)|0;
    }
    const next=[a,b,c,d,e,f,g,h];
    for(let i=0;i<8;i++)state[i]=(state[i]+next[i])|0;
    used=0;
  };
  const put=byte=>{block[used++]=byte;if(used===64)compress();};
  const emit=byte=>{bytes++;put(byte);};
  for(let i=0;i<text.length;i++){
    let point=text.charCodeAt(i);
    if(point>=0xd800&&point<=0xdbff){
      const low=text.charCodeAt(i+1);
      if(low>=0xdc00&&low<=0xdfff){point=0x10000+((point-0xd800)<<10)+(low-0xdc00);i++;}
      else point=0xfffd;
    }else if(point>=0xdc00&&point<=0xdfff)point=0xfffd;
    if(point<0x80)emit(point);
    else if(point<0x800){emit(0xc0|(point>>>6));emit(0x80|(point&63));}
    else if(point<0x10000){emit(0xe0|(point>>>12));emit(0x80|((point>>>6)&63));emit(0x80|(point&63));}
    else{emit(0xf0|(point>>>18));emit(0x80|((point>>>12)&63));emit(0x80|((point>>>6)&63));emit(0x80|(point&63));}
  }
  // Append the 64-bit big-endian bit length; padding itself is not counted.
  const high=Math.floor(bytes/0x20000000),low=(bytes*8)>>>0;
  put(0x80);
  while(used!==56)put(0);
  for(let shift=24;shift>=0;shift-=8)put(high>>>shift);
  for(let shift=24;shift>=0;shift-=8)put(low>>>shift);
  return state.map(word=>(word>>>0).toString(16).padStart(8,'0')).join('');
}
