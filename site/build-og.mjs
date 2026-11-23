/**
 * Deterministic 1200x630 Open Graph card generated with Node built-ins.
 * No fonts, network requests, Python packages or third-party image dependencies.
 * Run: node site/build-og.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WIDTH = 1200, HEIGHT = 630;
const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
const color = (hex) => [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),255];
const BG=color('#0e1728'), PANEL=color('#19253e'), BORDER=color('#35466d'), BLUE=color('#4b6fe6'),
  WHITE=color('#eaf1ff'), SUB=color('#b3c9f9'), SOFT=color('#8396b5'), GOLD=color('#f6cb39');
function rect(x,y,w,h,c) {
  const x0=Math.max(0,x|0),x1=Math.min(WIDTH,(x+w)|0),y0=Math.max(0,y|0),y1=Math.min(HEIGHT,(y+h)|0);
  for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const at=4*(py*WIDTH+px);pixels.set(c,at);}
}
function disk(cx,cy,r,c) {const r2=r*r;for(let y=Math.max(0,cy-r);y<Math.min(HEIGHT,cy+r);y++)for(let x=Math.max(0,cx-r);x<Math.min(WIDTH,cx+r);x++)if((x-cx)**2+(y-cy)**2<=r2){pixels.set(c,4*(y*WIDTH+x));} }
const GLYPHS = {
 A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],
 C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],
 E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],
 G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],
 I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],
 K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],
 M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],
 O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],
 Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],
 S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],
 U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],
 W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],
 Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
 '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],
 ' ':['00000','00000','00000','00000','00000','00000','00000'],
 '/':['00001','00001','00010','00100','01000','10000','10000'],
 '-':['00000','00000','00000','11111','00000','00000','00000'],
 ':':['00000','00100','00100','00000','00100','00100','00000'],
 '.':['00000','00000','00000','00000','00000','00110','00110']
};
function write(text,x,y,scale,c) {
 for(const char of text.toUpperCase()){
  const glyph=GLYPHS[char]??GLYPHS[' '];
  for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(glyph[row][col]==='1')rect(x+col*scale,y+row*scale,scale,scale,c);
  x+=6*scale;
 }
}
rect(0,0,WIDTH,HEIGHT,BG);
rect(53,52,1094,526,BORDER);rect(57,56,1086,518,PANEL);
rect(90,86,14,75,BLUE);
write('SCAD AI IDE',133,106,12,WHITE);
write('OPENSCAD INSIDE VISUAL STUDIO CODE',110,251,5,SUB);
write('PREVIEW / TOOLCHAINS / LIBRARIES',110,339,5,SOFT);
write('CAD EVIDENCE / NATIVE AGENT TOOLS',110,393,5,SOFT);
rect(110,498,362,48,BLUE);write('SOURCE-FIRST PREVIEW',126,509,4,WHITE);
// Brand-inspired geometric cheese motif, not a screenshot of the installed extension.
rect(950,130,100,135,GOLD);disk(1006,175,14,PANEL);disk(970,230,10,PANEL);disk(1037,239,9,PANEL);
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
const u32=n=>Uint8Array.of((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);
function chunk(type,data){const kind=new TextEncoder().encode(type);const payload=new Uint8Array(8+data.length+4);payload.set(u32(data.length));payload.set(kind,4);payload.set(data,8);payload.set(u32(crc32(payload.subarray(4,8+data.length))),8+data.length);return payload;}
const ihdr=new Uint8Array(13);ihdr.set(u32(WIDTH));ihdr.set(u32(HEIGHT),4);ihdr[8]=8;ihdr[9]=6;
const scan=new Uint8Array((WIDTH*4+1)*HEIGHT);for(let y=0;y<HEIGHT;y++)scan.set(pixels.subarray(y*WIDTH*4,(y+1)*WIDTH*4),y*(WIDTH*4+1)+1);
const chunks=[Uint8Array.of(137,80,78,71,13,10,26,10),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan,{level:9})),chunk('IEND',new Uint8Array(0))];
const size=chunks.reduce((n,a)=>n+a.length,0);const output=new Uint8Array(size);let offset=0;for(const a of chunks){output.set(a,offset);offset+=a.length;}
const filename=join(dirname(fileURLToPath(import.meta.url)),'assets','og-card.png');
writeFileSync(filename,output);console.log('Generated',filename,'(1200x630,',output.length,'bytes)');
