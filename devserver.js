var
  http = require("http"),
  url = require("url"),
  path = require("path"),
  fs = require("fs"),
  port = process.argv[2] || process.env['PORT'] || 3000;
http.createServer(function (request, response) {
  var uri = url.parse(request.url).pathname //域名后的路径名
  var filename = path.join(process.cwd(), 'build', uri); //对应的真实路径
  fs.exists(filename, function (exists) {
    if (!exists) {
      response.writeHead(400, {
        "Content-Type": "text/plain"
      });
      response.write("404 Not Found" + "\n");
      return response.end();
      errorWriteToEnd(400, '404 Not Found', response);
    }
    //目录路径补全
    if (fs.statSync(filename).isDirectory()) filename += '/index.html';
    fs.readFile(filename, "binary", function (err, file) {
      if (err) {
        response.writeHead(500, {
          "Content-Type": "text/plain"
        });
        response.write(err + "\n");
        return response.end();
        // errorWriteToEnd(500, null, err,response);
      }
      response.writeHead(200);
      response.write(file, "binary"); // 二进制下载?
      response.end();
    });
  });
}).listen(parseInt(port, 10));

function errorWriteToEnd(errNum, msg, err, response) {
  response.writeHead(errNum, {
    "Content-Type": "text/plain"
  });
  msg && response.write(err + "\n");
  err && response.write(err + "\n");
  return response.end();
}

console.log("Static file server running at\n  => http://localhost:" + port + "/\nCTRL + C to shutdown");