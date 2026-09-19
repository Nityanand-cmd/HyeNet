with open('public/app.js', 'r', encoding='utf-8') as f:
    js_code = f.read()

# Escape </script> inside JS just in case
safe_js = js_code.replace("</script>", "<\\/script>")

html = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>JS Syntax Test Inline</title>
</head>
<body>
  <div id="result">Pending</div>
  <script>
    window.onerror = function(msg, url, line, col, error) {
      document.getElementById('result').innerText = 'ERROR: ' + msg + ' at line ' + line + ':' + col + '\\n' + (error ? error.stack : '');
      return true;
    };
  </script>
  <script>
""" + safe_js + """
  </script>
  <script>
    if (document.getElementById('result').innerText === 'Pending') {
      document.getElementById('result').innerText = 'SUCCESS';
    }
  </script>
</body>
</html>"""

with open('scratch/test_inline.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Wrote test_inline.html')
