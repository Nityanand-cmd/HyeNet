import re

with open('public/app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Match onclick="fn(...)" or onclick='fn(...)'
matches = re.findall(r'onclick=[\'"]([^\'"]+)[\'"]', js)
print(f"Total dynamic onclick attributes in JS: {len(matches)}")

missing = []
for oc in set(matches):
    clean = re.sub(r'\$\{[^}]+\}', "'test'", oc).strip()
    m = re.match(r'([a-zA-Z0-9_$]+)\s*\(', clean)
    if m:
        fn_name = m.group(1)
        pat = r'(function\s+' + fn_name + r'\b|' + fn_name + r'\s*=\s*(async\s*)?function|const\s+' + fn_name + r'\b|let\s+' + fn_name + r'\b|var\s+' + fn_name + r'\b)'
        if not re.search(pat, js):
            missing.append((fn_name, oc))

if missing:
    print("MISSING DYNAMIC ONCLICK FUNCTIONS:")
    for fn, oc in missing:
        print(f"  {fn} in: {oc}")
else:
    print("ALL dynamic onclick functions exist in app.js!")
