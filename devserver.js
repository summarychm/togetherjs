var
  http = require("http"),
  url = require("url"),
  path = require("path"),
  fs = require("fs"),
  port = process.argv[2] || process.env['PORT'] || 8080;

http.createServer(function (request, response) {
  var uri = url.parse(request.url).pathname //域名后的路径名
  var filename = path.join(process.cwd(), 'build', uri); //对应的真实路径
  fs.exists(filename, function (exists) {
    if (!exists) errorWriteToEnd(400, '404 Not Found');
    //目录路径补全
    if (fs.statSync(filename).isDirectory()) filename += '/index.html';
    fs.readFile(filename, "binary", function (err, file) {
      if (err) errorWriteToEnd(500, null, err);
      response.writeHead(200);
      response.write(file, "binary"); // 二进制下载?
      response.end();
    });
  });
}).listen(parseInt(port, 10));

function errorWriteToEnd(errNum, msg, err) {
  response.writeHead(errNum, {
    "Content-Type": "text/plain"
  });
  msg && response.write(err + "\n");
  err && response.write(err + "\n");
  return response.end();
}

console.log("Static file server running at\n  => http://localhost:" + port + "/\nCTRL + C to shutdown");