import subprocess
from bs4 import BeautifulSoup

with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Inject error tracking right after <head>
injected = html.replace('<head>', '''<head>
<script>
window.__caught_errors = [];
window.onerror = function(msg, url, line, col, err) {
  var errObj = {msg: msg, url: url, line: line, col: col, stack: err ? err.stack : ''};
  window.__caught_errors.push(errObj);
  var el = document.getElementById('error-debug-dump');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'error-debug-dump';
    el.style = 'background:red;color:white;padding:20px;z-index:999999;position:fixed;top:0;left:0;width:100%;';
    document.body ? document.body.appendChild(el) : document.documentElement.appendChild(el);
  }
  el.innerText += JSON.stringify(errObj, null, 2) + '\\n';
};
</script>''')

# Also at the end of body, add a success indicator if no error
injected = injected.replace('</body>', '''
<div id="runtime-check-marker" style="display:none">RUNTIME_CHECK_DONE</div>
</body>''')

with open('scratch/test_page.html', 'w', encoding='utf-8') as f:
    f.write(injected)

cmd = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '--headless=new',
    '--dump-dom',
    'file:///c:/Users/ASUS/Downloads/HygieNet_Project - Copy/HygieNet_Project/scratch/test_page.html'
]

p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
soup = BeautifulSoup(p.stdout, 'html.parser')
err_dump = soup.find(id='error-debug-dump')
marker = soup.find(id='runtime-check-marker')

if err_dump:
    print("RUNTIME ERRORS FOUND:")
    print(err_dump.text)
else:
    print("NO RUNTIME ERRORS FOUND! App loaded cleanly.")

if marker:
    print("Page executed completely to end of body.")
