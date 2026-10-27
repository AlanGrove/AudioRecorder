/* Local-only UI fixture. No microphone, Google sign-in or real Drive upload. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const setup = `<script>
localStorage.setItem('audioRecorderDriveSettings', JSON.stringify({clientId:'fixture.apps.googleusercontent.com', autoUpload:false}));
window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>queueMicrotask(()=>c.callback({access_token:'fixture-only',expires_in:3600}))}),hasGrantedAllScopes:()=>true}}};
const originalFetch=window.fetch.bind(window), files=new Map(); let next=0;
window.fetch=async (url,options={})=>{
 if(!String(url).startsWith('https://www.googleapis.com/')) return originalFetch(url,options);
 const u=new URL(url), json=(data,headers={})=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json',...headers}});
 if(u.pathname.endsWith('/about'))return json({user:{permissionId:'fixture-user',displayName:'本地测试账号'}});
 if(u.pathname.endsWith('/generateIds'))return json({ids:['fixture-'+(++next)]});
 if(options.method==='POST' && u.searchParams.has('uploadType')) {const m=JSON.parse(options.body);files.set(m.id,{...m});return json({}, {Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id='+m.id});}
 if(options.method==='PUT'){const id=u.searchParams.get('upload_id'),f=files.get(id);f.size=String(options.body.size);return json(f);}
 if(options.method==='POST')return json({id:'fixture-folder'});
 if(u.searchParams.has('q'))return json({files:[]});
 const f=files.get(u.pathname.split('/').pop());return f?.size?json(f):new Response('{}',{status:404});
};
</script>`;
const controls = `<aside style="position:fixed;left:12px;bottom:12px;padding:12px;border:1px solid #ddd;border-radius:12px;background:white;font:12px Arial;z-index:500">
本地测试，云端请求均为模拟。<button id="fixtureAdd" style="width:auto;height:auto;border:0;border-radius:8px;background:#007aff;padding:8px">生成测试录音</button><span id="fixtureState"></span>
</aside><script>
document.getElementById('fixtureAdd').onclick=async()=>{
 const data=new ArrayBuffer(8044),v=new DataView(data),str=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,8036,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,8000,true);
 const blob=new Blob([data],{type:'audio/wav'}),id=crypto.randomUUID(),name='测试录音 '+new Date().toLocaleTimeString();
 window.AudioRecorderDrive.setRecording({id,mp3:{name:name+'.mp3',blob},webm:{name:name+'.webm',blob}});
 document.getElementById('fixtureState').textContent='已生成（合成静音）';
};
</script>`;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/drive-backend-config.js'){res.setHeader('Content-Type',types['.js']);res.end("window.AudioRecorderDriveBackendUrl='';");return;}
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{
  let body=fs.readFileSync(file);
  if(file.endsWith('index.html'))body=body.toString('utf8').replace('<script src="drive-backend-config.js">',setup+'<script src="drive-backend-config.js">').replace('</body>',controls+'</body>');
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(body);
 }catch{res.writeHead(404).end();}
}).listen(4174,'127.0.0.1',()=>console.log('录音列表测试：http://127.0.0.1:4174/ （仅模拟数据）'));
