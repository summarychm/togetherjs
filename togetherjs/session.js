/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
// socket通信主类
define(["require", "util", "channels", "jquery", "storage"], function (require, util, channels, $, storage) {
  var DEBUG = true; // 是否开发模式
  var assert = util.assert;
  // This is the amount of time in which a hello-back must be received after a hello for us to respect a URL change:
  var HELLO_BACK_CUTOFF = 1500; // 收到hello事件的最大响应间隔
  var peers; // 缓存peer用户类类
  var channel = null; // This is the channel to the hub:
  var localStoragePrefix = "togetherjs."; // This is the key we use for localStorage:
  var MAX_SESSION_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

  var session = util.mixinEvents(util.Module("session")); // 创建一个session类,并注入eventListener
  session.shareId = null; // roomId
  session.clientId = null; // 标识客户端的ID
  session.router = channels.Router(); //
  session.firstRun = false; // 是否是首次运行
  session.timeHelloSent = null;
  session.AVATAR_SIZE = 90; //头像宽高尺寸

  /******** url相关 begin ********/
  var includeHashInUrl = TogetherJS.config.get("includeHashInUrl"); // 是否开启强验证
  TogetherJS.config.close("includeHashInUrl"); // 冻结该属性
  var currentUrl = location.href.replace(/\#.*$/, ""); //去除掉room后的url
  if (includeHashInUrl)
    currentUrl = location.href;
  session.hubUrl = function (id) { // hub地址
    id = id || session.shareId;
    assert(id, "URL cannot be resolved before TogetherJS.shareId has been initialized");
    TogetherJS.config.close("hubBase");
    var hubBase = TogetherJS.config.get("hubBase");
    return hubBase.replace(/\/*$/, "") + "/hub/" + id;
  };
  session.shareUrl = function () { //shareUrl
    assert(session.shareId, "Attempted to access shareUrl() before shareId is set");
    var hash = location.hash;
    var m = /\?[^#]*/.exec(location.href);
    var query = "";
    if (m)
      query = m[0];
    hash = hash.replace(/&?togetherjs-[a-zA-Z0-9]+/, "");
    hash = hash || "#";
    return location.protocol + "//" + location.host + location.pathname + query +
      hash + "&togetherjs=" + session.shareId;
  };
  session.currentUrl = function () { // 强匹配location.href(含hash部分),弱匹配(不含#的地址)
    if (includeHashInUrl)
      return location.href;
    else
      return location.href.replace(/#.*/, "");
  };
  /******** url相关 end ********/
  /****************************************
   * Message handling/dispatching
   */
  /******** send Socket begin ********/
  session.hub = util.mixinEvents({}); // 给hub属性绑定EventListener
  var IGNORE_MESSAGES = TogetherJS.config.get("ignoreMessages");
  if (IGNORE_MESSAGES === true) { // 屏蔽所有的事件打印,关闭调试模式
    DEBUG = false;
    IGNORE_MESSAGES = [];
  }
  var MESSAGES_WITHOUT_CLIENTID = ["who", "invite", "init-connection"]; // togetherJS内部通信的事件
  var readyForMessages = false; //UI是否加载完毕,false时会屏蔽收到的channel信息
  session.send = function (msg) { //channel.send方法的二次包装
    if (DEBUG && IGNORE_MESSAGES.indexOf(msg.type) == -1)
      console.info("Send:", msg);
    msg.clientId = session.clientId;
    channel.send(msg);
  };
  session.appSend = function (msg) { //TogetherJS.send方法的二次包装方法
    var type = msg.type;
    if (type.search(/^togetherjs\./) === 0) // togetherjs.开头的情况
      type = type.substr("togetherjs.".length);
    else if (type.search(/^app\./) === -1) // app.开头的情况
      type = "app." + type;
    msg.type = type;
    session.send(msg);
  };
  /******** send Socket end ********/
  /****************************************
   * Standard message responses
   */
  /* Always say hello back, and keep track of peers: */
  /******** hello hello-back begin ********/
  session.hub.on("hello hello-back", function (msg) {
    if (msg.type == "hello")
      sendHello(true);
    if (session.isClient && (!msg.isClient) && session.firstRun &&
      session.timeHelloSent && Date.now() - session.timeHelloSent < HELLO_BACK_CUTOFF)
      processFirstHello(msg); // 首次收到hello信息
  });
  session.hub.on("who", function (msg) {
    sendHello(true);
  });

  function sendHello(helloBack) { // hello事件,true:hello,false:hello-back
    var msg = session.makeHelloMessage(helloBack); //获取包装后的hello信息
    if (!helloBack) {
      session.timeHelloSent = Date.now();
      peers.Self.url = msg.url;
    }
    session.send(msg);
  }

  function processFirstHello(msg) { // 首次收到hello信息
    if (!msg.sameUrl) {
      var url = msg.url;
      if (msg.urlHash)
        url += msg.urlHash;
      require("ui").showUrlChangeMessage(msg.peer, url); // 提示用户UrlChange
      location.href = url; // 跳转到对应的url上
    }
  }
  session.makeHelloMessage = function (helloBack) { //包装要发送的hello消息内容
    var msg = {
      name: peers.Self.name || peers.Self.defaultName,
      avatar: peers.Self.avatar,
      color: peers.Self.color,
      url: session.currentUrl(),
      urlHash: location.hash,
      // FIXME: titles update, we should track those changes:
      title: document.title,
      rtcSupported: session.RTCSupported,
      isClient: session.isClient
    };
    if (helloBack)
      msg.type = "hello-back";
    else {
      msg.type = "hello";
      msg.clientVersion = TogetherJS.version;
    }
    if (!TogetherJS.startup.continued)
      msg.starting = true;
    session.emit("prepare-hello", msg); //通知其他模块调用它们注册的hello事件
    return msg;
  };
  /******** hello hello-back begin ********/
  /****************************************
   * Lifecycle (start and end)
   */
  function initIdentityId() { // 获取并设置userId,并返回一个(promise)
    return util.Deferred(function (def) { // 生成一个promise对象
      if (session.identityId) // userID
        return def.resolve();
      storage.get("identityId").then(function (id) { //从localStorage中读取ID
        if (!id) {
          id = util.generateId();
          storage.set("identityId", id);
        }
        session.identityId = id;
        def.resolve();
      });
    });
  }
  initIdentityId.done = initIdentityId();
  session.close = function (reason) {
    TogetherJS.running = false;
    var msg = {
      type: "bye"
    };
    if (reason) {
      msg.reason = reason;
    }
    session.send(msg);
    session.emit("close");
    var name = window.name;
    storage.tab.get("status").then(function (saved) {
      if (!saved) {
        console.warn("No session information saved in", "status." + name);
      } else {
        saved.running = false;
        saved.date = Date.now();
        storage.tab.set("status", saved);
      }
      channel.close();
      channel = null;
      session.shareId = null;
      session.emit("shareId");
      TogetherJS.emit("close");
      TogetherJS._teardown();
    });
  };
  session.on("start", function () {
    $(window).on("resize", resizeEvent);
    if (includeHashInUrl)
      $(window).on("hashchange", hashchangeEvent);
  });
  session.on("close", function () {
    $(window).off("resize", resizeEvent);
    if (includeHashInUrl)
      $(window).off("hashchange", hashchangeEvent);
  });

  function hashchangeEvent() { // 发送hello-back事件,一般都是因为用户设置了url强检测
    sendHello(false);
  }

  function resizeEvent() {
    session.emit("resize");
  }
  if (TogetherJS.startup._launch)
    setTimeout(session.start); // 启动TogetherJS 
  function initStartTarget() { //设置启动TogetherJS的startup元素
    var id;
    if (TogetherJS.startup.button) {
      id = TogetherJS.startup.button.id;
      if (id)
        storage.set("startTarget", id);
      return;
    }
    storage.get("startTarget").then(function (id) {
      var el = document.getElementById(id);
      if (el)
        TogetherJS.startup.button = el;
    });
  }

  function initShareId() { //设置并获取ShareId
    return util.Deferred(function (def) {
      var hash = location.hash;
      var shareId = session.shareId;
      var isClient = true;
      var set = true;
      var sessionId;
      session.firstRun = !TogetherJS.startup.continued;
      if (!shareId) {
        if (TogetherJS.startup._joinShareId) // 从startup中joinShareId
          shareId = TogetherJS.startup._joinShareId;
        if (!shareId) {
          var m = /&?togetherjs=([^&]*)/.exec(hash);
          if (m) {
            isClient = !m[1];
            shareId = m[2];
            var newHash = hash.substr(0, m.index) + hash.substr(m.index + m[0].length);
            location.hash = newHash;
          }
        }
      }
      return storage.tab.get("status").then(function (saved) {
        var findRoom = TogetherJS.config.get("findRoom");
        TogetherJS.config.close("findRoom");
        if (findRoom && saved && findRoom != saved.shareId)
          console.info("Ignoring findRoom in lieu of continued session");
        else if (findRoom && TogetherJS.startup._joinShareId)
          console.info("Ignoring findRoom in lieu of explicit invite to session");
        // findRoom为字符串,且session中没有status节点且url中也没有roomId,findRoom为String的情况
        if (findRoom && typeof findRoom == "string" && (!saved) && (!TogetherJS.startup._joinShareId)) {
          isClient = true;
          shareId = findRoom; //更新shareId
          sessionId = util.generateId(); //生成userId
        } else if (findRoom && (!saved) && (!TogetherJS.startup._joinShareId)) { // finRoom为Object的情况
          assert(findRoom.prefix && typeof findRoom.prefix == "string", "Bad findRoom.prefix", findRoom);
          assert(findRoom.max && typeof findRoom.max == "number" && findRoom.max > 0, "Bad findRoom.max", findRoom);
          sessionId = util.generateId(); //生成userId
          if (findRoom.prefix.search(/[^a-zA-Z0-9]/) != -1) // prefix不符合规定
            console.warn("Bad value for findRoom.prefix:", JSON.stringify(findRoom.prefix));
          getRoomName(findRoom.prefix, findRoom.max) // 根据prefix和max生成roomId
            .then(function (sId) {
              isClient = true;
              shareId = sId;
              // session.clientId = session.identityId + "." + sessionId; // 根据userId和sessionId生成clientId
              // storage.tab.set("status", { //更新sessionStorage
              //   reason: "joined",
              //   shareId: shareId,
              //   running: true,
              //   date: Date.now(),
              //   sessionId: sessionId
              // });
              // session.isClient = true;
              // session.shareId = shareId;
              // session.emit("shareId"); // 
              // def.resolve(session.shareId); //继续传递roomId
            });
          // return;
        } else if (TogetherJS.startup._launch) { //Together 已经运行
          if (saved) { // 加入原有room
            isClient = (saved.reason == "joined");
            if (!shareId)
              shareId = saved.shareId;
            sessionId = saved.sessionId;
          } else {
            isClient = TogetherJS.startup.reason == "joined";
            assert(!sessionId);
            sessionId = util.generateId();
          }
          if (!shareId) //最终还是没有,则随机生成shareId
            shareId = util.generateId();
        } else if (saved) { //没有启动,没有配置findRoom参数,但是有sessionStorage配置的情况
          isClient = (saved.reason == "joined");
          TogetherJS.startup.reason = saved.reason;
          TogetherJS.startup.continued = true;
          shareId = saved.shareId;
          sessionId = saved.sessionId;
          // The only case when we don't need to set the storage status again is when we're already set to be running
          set = !saved.running;
        } else {
          throw new util.AssertionError("No saved status, and no startup._launch request; why did TogetherJS start?");
        }
        assert(session.identityId);
        session.clientId = session.identityId + "." + sessionId;
        if (set) {
          storage.tab.set("status", {
            reason: TogetherJS.startup.reason,
            shareId: shareId,
            running: true,
            date: Date.now(),
            sessionId: sessionId
          });
        }
        session.isClient = isClient;
        session.shareId = shareId;
        session.emit("shareId");
        def.resolve(session.shareId);
      });
    });
  }

  function getRoomName(prefix, maxSize) { //生成roomId
    var findRoom = TogetherJS.config.get("hubBase").replace(/\/*$/, "") + "/findroom";
    return $.ajax({
      url: findRoom,
      dataType: "json",
      data: {
        prefix: prefix,
        max: maxSize
      }
    }).then(function (resp) {
      return resp.name;
    });
  }

  function openChannel() { // 开启SocketChannel
    assert(!channel, "Attempt to re-open channel");
    var hubUrl = session.hubUrl();
    console.info("Connecting to", hubUrl, " page.url", location.href);
    var c = channels.WebSocketChannel(hubUrl);
    c.onmessage = function (msg) {
      if (!readyForMessages && DEBUG) // ui还未加载完毕就收到消息,进行警告⚠️
        return console.info("In (but ignored for being early):", msg);
      if (DEBUG && IGNORE_MESSAGES.indexOf(msg.type) == -1) // 打印收到的message
        console.info("In:", msg);
      if (!peers) // peers信息还未加载完毕就收到信息,进行报错
        return console.warn("Message received before all modules loaded (ignoring):", msg);
      // 如果不是内部事件,则必须提供clientId
      if ((!msg.clientId) && MESSAGES_WITHOUT_CLIENTID.indexOf(msg.type) == -1)
        return console.warn("Got message without clientId, where clientId is required", msg);
      if (msg.clientId)
        msg.peer = peers.getPeer(msg.clientId, msg); //获取当前clientId对应的peer,不存在就创建
      // We do this here to make sure this is run before any other hello handlers:
      if (["hello", "hello-back", "peer-update"].includes(msg.type)) //根据msg更新用户信息
        msg.peer.updateFromHello(msg);
      if (msg.peer) { //存在用户列表
        msg.sameUrl = msg.peer.url == currentUrl; //更新url
        if (!msg.peer.isSelf) //更新peer的最后操作时间
          msg.peer.updateMessageDate(msg);
      }
      session.hub.emit(msg.type, msg); // 调用其他模块添加的type回调
      TogetherJS._onmessage(msg); // 处理用户绑定的type回调.
    };
    channel = c;
    session.router.bindChannel(channel);
  }
  session.start = function () {
    initStartTarget(); //设置启动TogetherJS的startup元素
    initIdentityId() //设置userId,并返回promise
      .then(initShareId) // 设置并获取ShareId
      .then(function (shareId) {
        readyForMessages = false;
        openChannel(); // 开启SocketChannel
        require(["ui"], function (ui) {
          TogetherJS.running = true; //将运行状态设为true
          ui.prepareUI(); // 页面加载toolbar的函数
          var features = ["peers", "ui", "chat", "webrtc", "cursor", "startup", "forms", "visibilityApi"]; //依赖包 "videos", 
          require(features, function () {
            $(function () {
              peers = require("peers"); // 加载peers代码
              var startup = require("startup"); //加载startup代码
              session.emit("start"); // 调用其他模块添加的start回调
              session.once("ui-ready", function () { //监听ui加载完毕事件
                readyForMessages = true;
                startup.start(); // 进行初始化检测等流程
              });
              ui.activateUI();
              peers._SelfLoaded.then(function () {
                sendHello(false);
              });
              TogetherJS.emit("ready");
            });
          });
        });
      });
  };
  util.testExpose({
    getChannel: function () {
      return channel;
    }
  });
  return session;
});
/*
// 废弃的方法
session.recordUrl = function () {
  assert(session.shareId);
  var url = TogetherJS.baseUrl.replace(/\/*$/, "") + "/togetherjs/recorder.html";
  url += "#&togetherjs=" + session.shareId + "&hubBase=" + TogetherJS.config.get("hubBase");
  return url;
};
*/
