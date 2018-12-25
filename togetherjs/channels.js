/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Channel abstraction.  Supported channels:
- WebSocket to an address 不同客户端
- postMessage between windows 父子窗口
The interface:
  channel = new ChannelName(parameters)
The instantiation is specific to the kind of channel
Methods:
  onmessage: set to function (jsonData)
  rawdata: set to true if you want onmessage to receive raw string data
  onclose: set to function ()
  send: function (string or jsonData)
  close: function ()
  In the future:
  -XMLHttpRequest to a server(with some form of queuing)
*/
define(["util"], function (util) {
  var channels = util.Module("channels"); // Channel类实例(挂载WebSocket)
  /* 
  Subclasses must define:
  - ._send(string)
  - ._setupConnection()
  - ._ready()
  - .close() (and must set this.closed to true)
  And must call:
  - ._flush() on open 实例open时调用该方法
  - ._incoming(string) on incoming message 子类实例接收到message时
  - onclose() (not onmessage - instead _incoming) 
  - emit("close")
  */
  var AbstractChannel = util.mixinEvents({ // WebSocket和postMessage的公共抽象基类(注入eventListener)
    onmessage: null,
    rawdata: false, //true,string数据,false JSON数据
    onclose: null,
    closed: false,
    baseConstructor: function () { //该方法会在子类实例的construcor时调用
      this._buffer = []; // 缓存待send的队列信息
      this._setupConnection(); // 调用子类的_setConnection方法,来设置channel
    },
    send: function (data) { // 发送socket
      if (this.closed)
        throw 'Cannot send to a closed connection';
      if (typeof data != "string")
        data = JSON.stringify(data);
      if (!this._ready()) //没有ready,则缓存数据
        return this._buffer.push(data);
      this._send(data); // 调用子类自己实现的_send方法
    },
    _flush: function () { // 在子类实例open时,优先处理this._buffer中缓存的消息
      for (var i = 0; i < this._buffer.length; i++) {
        this._send(this._buffer[i]); // 处理队列中的socket请求
      }
      this._buffer = []; // 清空缓存队列
    },
    _incoming: function (data) { // 接收到message时的处理方法
      if (!this.rawdata) { //消息类型处理
        try {
          data = JSON.parse(data);
        } catch (e) {
          console.error("Got invalid JSON data:", data.substr(0, 40));
          throw e;
        }
      }
      this.onmessage && this.onmessage(data); // 调用子类自身的onmessageFn(调用者定义)
      this.emit("message", data); // 调用绑定到message上的回调事件
    }
  });
  channels.WebSocketChannel = util.Class(AbstractChannel, { //根据AbstractChannel,创建WebSocketChannel
    constructor: function (address) {
      if (address.search(/^https?:/i) === 0) // 将baseHub转为ws协议
        address = address.replace(/^http/i, 'ws');
      this.address = address;
      this.socket = null;
      this._lastConnectTime = 0;
      this._backoff = 0;
      this.baseConstructor(); // 调用基类AbstractChannel的初始化方法
    },
    /******** 错误重连 begin ********/
    _reopening = false, // 是否处于错误重连的状态
    backoffTime: 50, // 错误重试的基数 Milliseconds to add to each reconnect time
    maxBackoffTime: 1500,
    backoffDetection: 2000, //错误重试的时间最大值 Amount of time since last connection attempt that shows we need to back off
    // this._setupConnection 方法中,通过this.socket.onclose方法中递归调用来实现错误重连
    /******** 错误重连 end ********/

    toString: function () {
      var s = '[WebSocketChannel to ' + this.address;
      if (!this.socket)
        s += ' (socket unopened)';
      else
        s += ' readyState: ' + this.socket.readyState;
      if (this.closed)
        s += ' CLOSED';
      return s + ']';
    },
    _setupConnection: function () { // 父类初始化时,配置并创建Connection
      if (this.closed) return;
      this._lastConnectTime = Date.now();
      this.socket = new WebSocket(this.address); //创建webSocket对象
      this.socket.onopen = (function () {
        this._flush(); //处理积压的队列请求
        this._reopening = false; // 撤销重连状态
      }).bind(this);
      this.socket.onmessage = (function (event) {
        this._incoming(event.data); // 调用基类的处理方法
      }).bind(this);
      this.socket.onerror = (function (event) {
        console.error('WebSocket error:', event.data);
      }).bind(this);
      this.socket.onclose = (function (event) {
        this.socket = null;
        var method = "error";
        if (event.wasClean)
          method = "log"; // FIXME: should I even log clean closes?
        console[method]('WebSocket close', event.wasClean ? 'clean' : 'unclean',
          'code:', event.code, 'reason:', event.reason || 'none');
        if (!this.closed) {
          this._reopening = true; //设置当前socketConnection处于错误重连的状态
          if (Date.now() - this._lastConnectTime > this.backoffDetection)
            this._backoff = 0;
          else
            this._backoff++;
          var time = Math.min(this._backoff * this.backoffTime, this.maxBackoffTime);
          setTimeout((function () { // 定期进行错误重连
            this._setupConnection();
          }).bind(this), time);
        }
      }).bind(this);
    },
    close: function () {
      this.closed = true;
      if (this.socket)
        this.socket.close(); // socket.onclose will call this.onclose:
      else {
        this.onclose && this.onclose();
        this.emit("close");
      }
    },
    _send: function (data) {
      this.socket.send(data);
    },
    _ready: function () { //是否就绪
      return this.socket && this.socket.readyState == this.socket.OPEN;
    },
  });
  /* Sends TO a window or iframe */
  channels.PostMessageChannel = util.Class(AbstractChannel, {
    _pingPollPeriod: 100, // milliseconds
    _pingPollIncrease: 100, // +100 milliseconds for each failure
    _pingMax: 2000, // up to a max of 2000 milliseconds
    constructor: function (win, expectedOrigin) {
      this.expectedOrigin = expectedOrigin;
      this._pingReceived = false;
      this._receiveMessage = this._receiveMessage.bind(this);
      if (win) {
        this.bindWindow(win, true);
      }
      this._pingFailures = 0;
      this.baseConstructor();
    },
    toString: function () {
      var s = '[PostMessageChannel';
      if (this.window) {
        s += ' to window ' + this.window;
      } else {
        s += ' not bound to a window';
      }
      if (this.window && !this._pingReceived) {
        s += ' still establishing';
      }
      return s + ']';
    },
    bindWindow: function (win, noSetup) {
      if (this.window) {
        this.close();
        // Though we deinitialized everything, we aren't exactly closed:
        this.closed = false;
      }
      if (win && win.contentWindow) {
        win = win.contentWindow;
      }
      this.window = win;
      // FIXME: The distinction between this.window and window seems unimportant
      // in the case of postMessage
      var w = this.window;
      // In a Content context we add the listener to the local window
      // object, but in the addon context we add the listener to some
      // other window, like the one we were given:
      if (typeof window != "undefined") {
        w = window;
      }
      w.addEventListener("message", this._receiveMessage, false);
      if (!noSetup) {
        this._setupConnection();
      }
    },
    _send: function (data) {
      this.window.postMessage(data, this.expectedOrigin || "*");
    },
    _ready: function () {
      return this.window && this._pingReceived;
    },
    _setupConnection: function () {
      if (this.closed || this._pingReceived || (!this.window)) {
        return;
      }
      this._pingFailures++;
      this._send("hello");
      // We'll keep sending ping messages until we get a reply
      var time = this._pingPollPeriod + (this._pingPollIncrease * this._pingFailures);
      time = time > this._pingPollMax ? this._pingPollMax : time;
      this._pingTimeout = setTimeout(this._setupConnection.bind(this), time);
    },
    _receiveMessage: function (event) {
      if (event.source !== this.window) {
        return;
      }
      if (this.expectedOrigin && event.origin != this.expectedOrigin) {
        console.info("Expected message from", this.expectedOrigin,
          "but got message from", event.origin);
        return;
      }
      if (!this.expectedOrigin) {
        this.expectedOrigin = event.origin;
      }
      if (event.data == "hello") {
        this._pingReceived = true;
        if (this._pingTimeout) {
          clearTimeout(this._pingTimeout);
          this._pingTimeout = null;
        }
        this._flush();
        return;
      }
      this._incoming(event.data);
    },
    close: function () {
      this.closed = true;
      this._pingReceived = false;
      if (this._pingTimeout) {
        clearTimeout(this._pingTimeout);
      }
      window.removeEventListener("message", this._receiveMessage, false);
      if (this.onclose) {
        this.onclose();
      }
      this.emit("close");
    }
  });
  /* Handles message FROM an exterior window/parent */
  channels.PostMessageIncomingChannel = util.Class(AbstractChannel, {
    constructor: function (expectedOrigin) {
      this.source = null;
      this.expectedOrigin = expectedOrigin;
      this._receiveMessage = this._receiveMessage.bind(this);
      window.addEventListener("message", this._receiveMessage, false);
      this.baseConstructor();
    },
    toString: function () {
      var s = '[PostMessageIncomingChannel';
      if (this.source) {
        s += ' bound to source ' + s;
      } else {
        s += ' awaiting source';
      }
      return s + ']';
    },
    _send: function (data) {
      this.source.postMessage(data, this.expectedOrigin);
    },
    _ready: function () {
      return !!this.source;
    },
    _setupConnection: function () {},
    _receiveMessage: function (event) {
      if (this.expectedOrigin && this.expectedOrigin != "*" &&
        event.origin != this.expectedOrigin) {
        // FIXME: Maybe not worth mentioning?
        console.info("Expected message from", this.expectedOrigin,
          "but got message from", event.origin);
        return;
      }
      if (!this.expectedOrigin) {
        this.expectedOrigin = event.origin;
      }
      if (!this.source) {
        this.source = event.source;
      }
      if (event.data == "hello") {
        // Just a ping
        this.source.postMessage("hello", this.expectedOrigin);
        return;
      }
      this._incoming(event.data);
    },
    close: function () {
      this.closed = true;
      window.removeEventListener("message", this._receiveMessage, false);
      if (this._pingTimeout) {
        clearTimeout(this._pingTimeout);
      }
      if (this.onclose) {
        this.onclose();
      }
      this.emit("close");
    }
  });
  channels.Router = util.Class(util.mixinEvents({ //创建
    constructor: function (channel) {
      this._channelMessage = this._channelMessage.bind(this);
      this._channelClosed = this._channelClosed.bind(this);
      this._routes = Object.create(null); // 存储routes集合 {id:route}
      channel && this.bindChannel(channel); // 给当前channel绑定新的监听,只监听type=route的message
    },
    bindChannel: function (channel) { // 给当前channel绑定新的监听,只监听type=route的message
      if (this.channel) { //移除原有监听,并重新添加
        this.channel.removeListener("message", this._channelMessage);
        this.channel.removeListener("close", this._channelClosed);
      }
      this.channel = channel;
      this.channel.on("message", this._channelMessage.bind(this)); //添加新的message监听
      this.channel.on("close", this._channelClosed.bind(this)); //添加新的close监听
    },
    _channelMessage: function (msg) { // 处理type为route的message监听函数
      if (msg.type == "route") {
        var id = msg.routeId;
        var route = this._routes[id]; // channel实例
        if (!route)
          return console.warn("No route with the id", id);
        if (msg.close) //关闭路由
          this._closeRoute(route.id);
        else {
          // 这种
          route.onmessage && route.onmessage(msg.message); // 触发channel原有的onmessage方法
          route.emit("message", msg.message); // 触发channel绑定的route路由回调
        }
      }
    },
    _channelClosed: function () { // type为route的close监听函数
      for (var id in this._routes) {
        this._closeRoute(id);
      }
    },
    _closeRoute: function (id) {
      var route = this._routes[id];
      if (route.onclose) {
        route.onclose();
      }
      route.emit("close");
      delete this._routes[id];
    },
    // makeRoute: function (id) { // 创建一个Route暂时无用
    //   id = id || util.generateId();
    //   var route = Route(this, id);
    //   this._routes[id] = route;
    //   return route;
    // }
  }));

  // // 用于和makeRoute搭配,暂时无用
  // var Route = util.Class(util.mixinEvents({
  //   constructor: function (router, id) {
  //     this.router = router;
  //     this.id = id;
  //   },
  //   send: function (msg) { // 调用其channel上的send方法,发送type="route"类型的事件
  //     this.router.channel.send({
  //       type: "route",
  //       routeId: this.id,
  //       message: msg
  //     });
  //   },
  //   close: function () {
  //     // This route instance has been overwritten, so ignore
  //     if (this.router._routes[this.id] !== this)
  //       return;
  //     delete this.router._routes[this.id];
  //   }
  // }));
  return channels;
});
