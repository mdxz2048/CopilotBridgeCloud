import pathlib,hashlib,json,zipfile,xml.etree.ElementTree as ET,os,subprocess
root=pathlib.Path(os.environ.get('BRIDGE_OFFICIAL_RELEASE_DIR','/var/lib/docker/volumes/src_bridge_releases/_data/official-client'));root.mkdir(mode=0o755,exist_ok=True)
for name in ['ChatGPT-x64.msix','ChatGPT-License.xml']:
 target=root/name
 url='https://persistent.oaistatic.com/codex-app-prod/'+name
 if not target.exists():
  print(json.dumps({'downloadingOfficial':name}),flush=True)
  subprocess.run(['curl','--fail','--location','--silent','--show-error','--max-time','1200','--output',str(target)+'.part',url],check=True)
  os.rename(str(target)+'.part',target)
with zipfile.ZipFile(root/'ChatGPT-x64.msix') as archive:
 manifest=ET.fromstring(archive.read('AppxManifest.xml'));identity=next(e for e in manifest.iter() if e.tag.endswith('}Identity'))
 assert identity.attrib['Name']=='OpenAI.Codex'
 assert identity.attrib['ProcessorArchitecture']=='x64'
 assert 'AppxSignature.p7x' in archive.namelist()
 metadata={'version':identity.attrib['Version'],'publisher':identity.attrib['Publisher'],'officialSource':'https://learn.chatgpt.com/docs/enterprise/windows-deployment'}
(root/'Install-ChatGPT.ps1').write_bytes(pathlib.Path(__file__).with_name('Install-ChatGPT.ps1').read_bytes())
(root/'Install-ChatGPT.cmd').write_bytes(b'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-ChatGPT.ps1"\r\npause\r\n')
(root/'README.txt').write_text('Official ChatGPT Windows x64 offline package. Extract all files, then run Install-ChatGPT.cmd. Windows may ask for administrator approval. Original MSIX and license were downloaded from OpenAI and are unchanged. Installation checks package signing through Windows. Source: '+metadata['officialSource'],encoding='utf-8')
filename='ChatGPT-Windows-x64.zip';temporary=root/(filename+'.part')
with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
 for name in ['ChatGPT-x64.msix','ChatGPT-License.xml','Install-ChatGPT.ps1','Install-ChatGPT.cmd','README.txt']:archive.write(root/name,name)
os.replace(temporary,root/filename)
digest=hashlib.file_digest(open(root/filename,'rb'),'sha256').hexdigest()
metadata.update({'filename':filename,'arch':'x64','sha256':digest,'size':(root/filename).stat().st_size,'downloadUrl':'https://ai.mddxz.top/api/v1/official-client/files/'+filename})
(root/'manifest.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
print(json.dumps(metadata),flush=True)
# Only the current kit is served. The original MSIX lives unmodified inside it.
for name in ['ChatGPT-x64.msix','ChatGPT-License.xml','Install-ChatGPT.ps1','Install-ChatGPT.cmd','README.txt']:(root/name).unlink()
