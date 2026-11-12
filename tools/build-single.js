// index.html + css + js 를 파일 하나로 합친다. 사용: node tools/build-single.js [출력 경로]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) => '<script>\n' + read(src) + '\n</script>');
const font = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const out = '<title>증권왕</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + font +
  '\n<style>\n' + read('css/style.css') + '\n</style>\n' + body;
const dest = process.argv[2] || path.join(root, 'dist', 'jeunggwonwang.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(dest, (out.length / 1024).toFixed(0) + 'KB');
