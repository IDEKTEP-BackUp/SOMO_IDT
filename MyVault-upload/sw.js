// เก็บไฟล์แอป ฟอนต์ และไอคอนเว็บไว้ในเครื่อง เพื่อให้เปิดได้แม้ไม่มีเน็ต
const CACHE = 'myvault-v8';      // ไฟล์ของแอปเอง
const RUNTIME = 'myvault-rt-v1'; // ฟอนต์ + ไอคอนเว็บ
const MAX_RUNTIME = 300;
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-rounded.png'
];

// download the font stylesheet and every font file it points to
async function warmFonts(){
  try{
    const rt = await caches.open(RUNTIME);
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    await rt.put(FONT_CSS, res.clone());
    const css = await res.text();
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]))];
    await Promise.all(urls.map(async u => {
      if (await rt.match(u)) return;
      const r = await fetch(u);
      if (r.ok) await rt.put(u, r);
    }));
  }catch(e){ /* offline during install: fonts get cached on a later visit */ }
}

// cache site icons the page asks for (opaque responses are fine for <img>)
async function warmIcons(urls){
  const rt = await caches.open(RUNTIME);
  for (const u of urls){
    try{
      if (await rt.match(u)) continue;
      const r = await fetch(new Request(u, { mode: 'no-cors' }));
      await rt.put(u, r);
    }catch(e){}
  }
  await trim();
}

async function trim(){
  const rt = await caches.open(RUNTIME);
  const keys = (await rt.keys()).filter(k => !k.url.startsWith('https://fonts.')); // never drop fonts
  for (let i = 0; i < keys.length - MAX_RUNTIME; i++) await rt.delete(keys[i]);
}

const isRuntime = url =>
  url.hostname === 'fonts.googleapis.com' ||
  url.hostname === 'fonts.gstatic.com' ||
  url.pathname === '/favicon.ico';

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(ASSETS)),
    warmFonts()
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'warm' && Array.isArray(e.data.urls)){
    const urls = e.data.urls.filter(u => { try{ return isRuntime(new URL(u)) }catch(_){ return false } });
    e.waitUntil(warmIcons(urls));
  }
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // fonts & site icons: serve from cache straight away, refresh in the background
  if (url.origin !== location.origin){
    if (!isRuntime(url)) return;
    e.respondWith(caches.open(RUNTIME).then(async rt => {
      const hit = await rt.match(e.request.url);
      const net = fetch(e.request).then(res => { rt.put(e.request.url, res.clone()); return res }).catch(() => null);
      if (hit){ e.waitUntil(net); return hit; }
      const res = await net;
      return res || Response.error();
    }));
    return;
  }

  // app files: network first (so updates show up), fall back to cache offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
