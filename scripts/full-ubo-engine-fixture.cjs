const {app, BrowserWindow, WebContentsView, session, webContents} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const {ExtensionManager} = require('../src/extensions.cjs');
const enabled = process.env.WING_UBO_ENABLED === 'true';
app.setPath('userData',process.env.WING_UBO_PROFILE);
app.commandLine.appendSwitch('host-resolver-rules','MAP * 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('disable-background-networking');
const report = {enabled,engine:process.versions,loadError:null,logs:[],seen:[],results:null};
// Qualification failures belong in CI output, never Electron's GUI error dialog.
function fatal(error) {
  report.error = error?.stack || String(error);
  try { fs.writeFileSync(process.env.WING_UBO_REPORT, JSON.stringify(report,null,2)); } catch {}
  process.stderr.write(report.error + '\n');
  app.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
app.on('web-contents-created',(_event,wc) => wc.on('console-message',event => {
  if(report.logs.length<30) report.logs.push({level:event.level,message:event.message.slice(0,1500),source:event.sourceId});
}));

app.whenReady().then(async () => {
  let win, server;
  try {
    server = http.createServer((req,res) => {
      const host=req.headers.host;
      report.seen.push({host,path:req.url});
      if(req.url==='/image.svg'){
        res.setHeader('Content-Type','image/svg+xml');
        return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      }
      const port=server.address().port;
      res.setHeader('Content-Type','text/html');
      res.end(`<!doctype html><title>Full uBlock Origin fixture</title><h1>Qualification</h1><script>
        window.results={};
        for(const [key,host] of [['ad','doubleclick.net'],['control','wing-safe.invalid']]){
          const image=new Image(); image.onload=()=>window.results[key]='loaded';image.onerror=()=>window.results[key]='blocked';
          image.src='http://'+host+':${port}/image.svg'; document.body.append(image);
        }
      </script>`);
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const ses=session.fromPartition('persist:qualification');
    const manager=new ExtensionManager({registryPath:path.join(process.env.WING_UBO_PROFILE,'extensions.json'),getSession:()=>ses,
      createTab:async (_profile,details)=>{const view=new WebContentsView({webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});manager.addTab('qualification',view.webContents,win);if(details.url)await view.webContents.loadURL(details.url);return[view.webContents,win];},
      removeTab:(_profile,wc)=>{if(!wc.isDestroyed())wc.close();},selectTab(){},requestPermissions:async()=>true});
    win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    manager.configure('qualification');
    if(enabled){
      try {report.extension=(await manager.install('qualification',process.env.WING_UBO_EXTENSION)).extensions[0];}
      catch(error){report.loadError=error.message;}
      // Give the unmodified bundled lists/background page time to initialize.
      await new Promise(resolve=>setTimeout(resolve,5000));
      report.extensionContexts=webContents.getAllWebContents().filter(wc=>wc.getURL().startsWith('chrome-extension:')).map(wc=>({url:wc.getURL(),type:wc.getType()}));
      for(const wc of webContents.getAllWebContents().filter(wc=>wc.getType()==='backgroundPage')){
        try {report.backgroundAPIs=await wc.executeJavaScript(`({webRequest:typeof chrome.webRequest,blockingListener:typeof chrome.webRequest?.onBeforeRequest?.addListener,webNavigation:typeof chrome.webNavigation,storage:typeof chrome.storage,ready:typeof vAPI!=='undefined'})`);}
        catch(error){report.backgroundError=error.message;}
      }
    }
    const view=new WebContentsView({webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    manager.addTab('qualification',view.webContents,win);
    win.contentView.addChildView(view);view.setBounds({x:0,y:0,width:800,height:600});
    await view.webContents.loadURL(`http://127.0.0.1:${server.address().port}/fixture`);
    const deadline=Date.now()+5000;
    do {
      report.results=await view.webContents.executeJavaScript('window.results');
      if(report.results?.ad && report.results?.control)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
  }catch(error){report.error=error.stack;}
  finally{
    fs.writeFileSync(process.env.WING_UBO_REPORT,JSON.stringify(report,null,2));
    for(const wc of webContents.getAllWebContents())if(!wc.isDestroyed())wc.close();
    server?.close();if(win && !win.isDestroyed())win.destroy();app.exit(report.error ? 1 : 0);
  }
});
