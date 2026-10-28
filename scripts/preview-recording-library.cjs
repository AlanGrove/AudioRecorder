/* Local-only UI fixture. Synthetic oscillator instead of microphone; Drive requests are mocked. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const setup = `<script>
localStorage.setItem('audioRecorderDriveSettings', JSON.stringify({clientId:'fixture.apps.googleusercontent.com', autoUpload:false}));
localStorage.setItem('audioRecorderAutoDownload','false');
window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>queueMicrotask(()=>c.callback({access_token:'fixture-only',expires_in:3600}))}),hasGrantedAllScopes:()=>true}}};
navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'fixture-tone',label:'合成测试音（不采集麦克风）'}];
navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext(),o=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();o.frequency.value=440;g.gain.value=.05;o.connect(g);g.connect(d);o.start();await c.resume();const track=d.stream.getAudioTracks()[0],stop=track.stop.bind(track);track.stop=()=>{stop();try{o.stop();}catch{}void c.close();};return d.stream;};
const originalFetch=window.fetch.bind(window), files=new Map(JSON.parse(localStorage.getItem('fixtureCloudFiles')||'[]')); let loseFinal=false;
window.fetch=async (url,options={})=>{
 if(!String(url).startsWith('https://www.googleapis.com/')) return originalFetch(url,options);
 const u=new URL(url), json=(data,headers={})=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json',...headers}});
 if(u.pathname.endsWith('/about'))return json({user:{permissionId:'fixture-user',displayName:'本地测试账号'}});
 if(u.pathname.endsWith('/generateIds'))return json({ids:['fixture-'+crypto.randomUUID()]});
 if(options.method==='POST' && u.searchParams.has('uploadType')) {const m=JSON.parse(options.body);files.set(m.id,{...m});return json({}, {Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id='+m.id});}
 if(options.method==='PUT'){const id=u.searchParams.get('upload_id'),f=files.get(id);f.size=String(options.body.size);localStorage.setItem('fixtureCloudFiles',JSON.stringify([...files]));if(loseFinal){loseFinal=false;throw new TypeError('模拟上传完成响应丢失');}return json(f);}
 if(options.method==='POST')return json({id:'fixture-folder'});
 if(u.searchParams.has('q'))return json({files:[]});
 const f=files.get(u.pathname.split('/').pop());return f?.size?json(f):new Response('{}',{status:404});
};
</script>`;
const controls = `<aside style="position:fixed;left:12px;bottom:12px;padding:12px;border:1px solid #ddd;border-radius:12px;background:white;font:12px Arial;z-index:500">
本地测试：合成音频，模拟云盘。<button id="fixtureAdd" style="width:auto;height:auto;border:0;border-radius:8px;background:#007aff;padding:8px">生成测试录音</button><button id="fixtureCrash" style="width:auto;height:auto;border:0;border-radius:8px;background:#ab6020;padding:8px">模拟突然中断</button><button id="fixtureLostFinal" style="width:auto;height:auto;border:0;border-radius:8px;background:#ab6020;padding:8px">模拟上传响应丢失</button><button id="fixtureCsp" style="width:auto;height:auto;padding:8px">检查 CSP</button><span id="fixtureState"></span>
</aside><script>
document.getElementById('fixtureCsp').onclick=()=>{
 window.addEventListener('securitypolicyviolation',e=>{if(e.blockedURI==='inline')document.getElementById('fixtureState').textContent='CSP 已拦截无许可的内联脚本';},{once:true});
 const probe=document.createElement('script');probe.textContent="document.getElementById('fixtureState').textContent='CSP 检查失败：脚本被执行'";document.body.appendChild(probe);probe.remove();
};
document.getElementById('fixtureCrash').onclick=()=>{window.removeEventListener('beforeunload',beforeUnloadListener);location.reload();};
document.getElementById('fixtureLostFinal').onclick=()=>{loseFinal=true;document.getElementById('fixtureState').textContent='下一次上传将模拟响应丢失';};
document.getElementById('fixtureAdd').onclick=async()=>{
 const data=new ArrayBuffer(8044),v=new DataView(data),str=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,8036,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,8000,true);
 const blob=new Blob([data],{type:'audio/wav'}),id=crypto.randomUUID(),name='测试录音 '+new Date().toLocaleTimeString();
 window.AudioRecorderDrive.setRecording({id,mp3:{name:name+'.mp3',blob},webm:{name:name+'.webm',blob}});
 document.getElementById('fixtureState').textContent='已生成（合成静音）';
};
</script>`;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
// A preview must never serve backend configuration, credential files or arbitrary source.
const assets = new Set(['/', '/index.html', '/AudioRecorder.html', '/drive-backend-config.js',
 '/AudioRecorder.js', '/AudioRecorderWorklet.js', '/recorder-controls.js', '/mp3-encoder.js', '/mp3-encoder-worker.js', '/recording-recovery.js', '/recording-library.js',
 '/google-drive.js', '/input-devices.js', '/lamejs.iife.js', '/recorder.css', '/recording-library.css',
 '/google-drive.css', '/icons/icon16.png', '/icons/icon48.png', '/icons/icon128.png', '/icons/google-drive.svg']);
function createPreviewServer() { return http.createServer((req,res)=>{
 if(!['127.0.0.1:4174','localhost:4174'].includes(req.headers.host) ||
    (req.headers.origin && !['http://127.0.0.1:4174','http://localhost:4174'].includes(req.headers.origin))) {res.writeHead(403).end();return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
 let url, pathname;
 try {url=new URL(req.url,'http://127.0.0.1:4174');pathname=decodeURIComponent(url.pathname);}
 catch {res.writeHead(400).end();return;}
 if(!assets.has(pathname)){res.writeHead(404).end();return;}
 if(url.pathname==='/drive-backend-config.js'){res.setHeader('Content-Type',types['.js']);res.end("window.AudioRecorderDriveBackendUrl='';");return;}
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{
  let body=fs.readFileSync(file);
  if(file.endsWith('index.html')){
   const nonce=crypto.randomBytes(18).toString('base64');
   const trusted=text=>text.replaceAll('<script>',`<script nonce="${nonce}">`);
   body=body.toString('utf8').replace("script-src 'self'",`script-src 'self' 'nonce-${nonce}'`)
    .replace('<script src="drive-backend-config.js">',trusted(setup)+'<script src="drive-backend-config.js">')
    .replace('</body>',trusted(controls)+'</body>');
  }
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(body);
 }catch{res.writeHead(404).end();}
}); }
module.exports = { createPreviewServer };
if(require.main===module) createPreviewServer().listen(4174,'127.0.0.1',()=>console.log('录音列表测试：http://127.0.0.1:4174/ （仅模拟数据）'));
