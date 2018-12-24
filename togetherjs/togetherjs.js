/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*jshint scripturl:true */
// 未压缩模式,采用require方式整合 
// min模式,将所有code 都压缩的一个js文件中
(function () {
  var styleSheet = "/togetherjs/togetherjs.css";
  // True if this file should use minimized sub-resources:
  var min = false;
  var version = "unknown";
  var cacheBust = Date.now() + "";
  var defaultConfiguration = {
    // The siteName is used in the walkthrough (defaults to document.title):
    siteName: null,
    // The name of this tool as provided to users.  The UI is updated to use this.
    // Because of how it is used in text it should be a proper noun, e.g.,
    // "MySite's Collaboration Tool"
    toolName: null,
    // When true, youTube videos will synchronize
    youtube: true,
    dontShowClicks: false, // 是否禁用波浪提示,可以选择器
    cloneClicks: false, // 是否同步用户点击
    hubBase: null, // server地址
    getUserName: null, // 获取用户名,函数/变量
    getUserColor: null, //用户使用的颜色
    getUserAvatar: null, // 用户头像
    useMinimizedCode: undefined, // 是否使用minimizedCode
    cacheBust: true, // 其否开发模式,开启hash
    on: {}, // Any events to bind to
    hub_on: {}, // Hub events to bind to
    findRoom: null, //room配置,字符串或对象(prefix,max)
    autoStart: false, // 是否自动启动
    suppressJoinConfirmation: false, // 显示是否加入room提示
    suppressInvite: false, //是否弹出邀请窗口
    inviteFromRoom: null, //邀请同房间的其他人
    storagePrefix: "togetherjs", // 本地存储时的前缀
    includeHashInUrl: false, // url强验证
    disableWebRTC: false, // 禁用音视频
    ignoreMessages: ["cursor-update", "keydown", "scroll-update"], //控制台要屏蔽的事件类型
    ignoreForms: [":password"], //要忽略的表单元素
    lang: "en-US", //默认语言
    fallbackLang: "en-US" // 备用语言
  };
  var configOverride = localStorage.getItem("togetherjs.configOverride");
  if (configOverride) {
    try {
      configOverride = JSON.parse(configOverride);
    } catch (e) {
      configOverride = null;
    }
    if (!configOverride || configOverride.expiresAt < Date.now()) {
      localStorage.removeItem("togetherjs.configOverride");
    } else {
      for (var attr in configOverride) {
        if (!configOverride.hasOwnProperty(attr)) continue;
        if (attr == "expiresAt" || !configOverride.hasOwnProperty(attr))
          continue;
        window["TogetherJSConfig_" + attr] = configOverride[attr];
        console.log("Config override:", attr, "=", configOverride[attr]);
      }
    }
  }
  /******** 尝试从配置/localStorage中 读取baseUrl begin ********/
  var baseUrl = "__baseUrl__";
  if (window.TogetherJSConfig && window.TogetherJSConfig.baseUrl)
    baseUrl = window.TogetherJSConfig.baseUrl;
  if (window.TogetherJSConfig_baseUrl)
    baseUrl = window.TogetherJSConfig_baseUrl;
  defaultConfiguration.baseUrl = baseUrl;
  var baseUrlOverride = localStorage.getItem("togetherjs.baseUrlOverride");
  if (baseUrlOverride) {
    try {
      baseUrlOverride = JSON.parse(baseUrlOverride);
    } catch (e) {
      baseUrlOverride = null;
    }
    if (!baseUrlOverride || baseUrlOverride.expiresAt < Date.now())
      localStorage.removeItem("togetherjs.baseUrlOverride");
    else baseUrl = baseUrlOverride.baseUrl;
  }
  if (!baseUrl) {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src && src.search(/togetherjs(-min)?.js(\?.*)?$/) !== -1) {
        baseUrl = src.replace(/\/*togetherjs(-min)?.js(\?.*)?$/, "");
        console.warn("Detected baseUrl as", baseUrl);
        break;
      } else if (src && src.search(/togetherjs-min.js(\?.*)?$/) !== -1) {
        baseUrl = src.replace(/\/*togetherjs-min.js(\?.*)?$/, "");
        console.warn("Detected baseUrl as", baseUrl);
        break;
      }
    }
  }
  if (!baseUrl) {
    console.warn(
      "Could not determine TogetherJS's baseUrl (looked for a <script> with togetherjs.js and togetherjs-min.js)"
    );
  }
  var defaultHubBase = "https://hub.togetherjs.mozillalabs.com";
  defaultConfiguration.hubBase = defaultHubBase;
  /******** baseUrl end ********/
  /******** TogetherJ主体类 begin ********/
  window.TogetherJS = function TogetherJS(event) {
    var session;
    if (TogetherJS.running) {
      session = TogetherJS.require("session");
      return session.close();
    }
    /******** 确定启动together的DOM begin ********/
    TogetherJS.startup.button = null;
    try {
      if (event && typeof event == "object") {
        if (event.target && typeof event)
          TogetherJS.startup.button = event.target;
        else if (event.nodeType == 1) TogetherJS.startup.button = event;
        else if (event[0] && event[0].nodeType == 1)
          TogetherJS.startup.button = event[0]; //jq
      }
    } catch (e) {
      console.warn("Error determining starting button:", e);
    }
    //******** 确定启动together的DOM end ********/
    if (window.TogetherJSConfig && !window.TogetherJSConfig.loaded) {
      TogetherJS.config(window.TogetherJSConfig); // 读取并应用配置文件
      window.TogetherJSConfig.loaded = true;
    }
    /******** on 和 hub_on事件绑定 begin ********/
    var attr;
    var attrName;
    var globalOns = {}; // 存放systemEvent集合
    for (attr in window) {
      if (attr.indexOf("TogetherJSConfig_on_") === 0) {
        //先检测事件
        attrName = attr.substr("TogetherJSConfig_on_".length);
        globalOns[attrName] = window[attr];
      } else if (attr.indexOf("TogetherJSConfig_") === 0) {
        // 再检测属性
        attrName = attr.substr("TogetherJSConfig_".length);
        TogetherJS.config(attrName, window[attr]);
      }
    }
    var ons = TogetherJS.config.get("on"); //更新config中的 onEvent
    for (attr in globalOns) ons[attr] = globalOns[attr];
    TogetherJS.config("on", ons); //更新配置
    for (attr in ons) TogetherJS.on(attr, ons[attr]); //绑定事件
    var hubOns = TogetherJS.config.get("hub_on"); //更新config中的 hubOn
    if (hubOns) {
      for (attr in hubOns) {
        if (hubOns.hasOwnProperty(attr)) TogetherJS.hub.on(attr, hubOns[attr]);
      }
    }
    /******** on 和 hub_on事件绑定 end ********/
    if (!TogetherJS.config.close("cacheBust")) {
      // 判断hash
      cacheBust = "";
      delete TogetherJS.requireConfig.urlArgs;
    }
    if (!TogetherJS.startup.reason)
      // 设置启动类型
      TogetherJS.startup.reason = "started";
    /*****************************************************************************************/
    if (TogetherJS._loaded) {
      //_loaded属性为真(延迟执行)就直接启动,并停止继续执行
      session = TogetherJS.require("session");
      addStyle();
      return session.start();
    }
    /*****************************************************************************************/
    // A sort of signal to session.js to tell it to actually start itself (i.e., put up a UI and try to activate)
    TogetherJS.startup._launch = true; // 标识TogetherJS已经启动
    addStyle();
    var minSetting = TogetherJS.config.get("useMinimizedCode");
    TogetherJS.config.close("useMinimizedCode");
    if (minSetting !== undefined) min = !!minSetting;
    var requireConfig = TogetherJS._extend(TogetherJS.requireConfig);
    var deps = ["session", "jquery"];
    var lang = TogetherJS.getConfig("lang");
    // [igoryen]: We should generate this value in Gruntfile.js, based on the available translations
    var availableTranslations = {
      "en-US": true,
      en: "en-US"
      // "es": "es-BO",
      // "es-BO": true,
      // "ru": true,
      // "ru-RU": "ru",
      // "pl": "pl-PL",
      // "pl-PL": true
    };
    if (lang === undefined) lang = navigator.language.replace(/_/g, "-");
    if (/-/.test(lang) && !availableTranslations[lang])
      lang = lang.replace(/-.*$/, "");
    if (!availableTranslations[lang]) lang = availableTranslations["en-US"];
    TogetherJS.config("lang", lang);
    var localeTemplates = "templates-" + lang;
    deps.splice(0, 0, localeTemplates); //加入模板文件
    if (!min) {
      if (typeof require == "function") {
        if (!require.config) {
          console.warn(
            "The global require (",
            require,
            ") is not requirejs; please use togetherjs-min.js"
          );
          throw new Error("Conflict with window.require");
        }
        TogetherJS.require = require.config(requireConfig);
      }
    }

    function callback(session, jquery) {
      TogetherJS._loaded = true;
      if (!min) {
        TogetherJS.require = require.config({
          //包装require
          context: "togetherjs"
        });
        TogetherJS._requireObject = require;
      }
    }
    if (typeof TogetherJS.require == "function")
      TogetherJS.require(deps, callback);
    //自定义的require
    else {
      requireConfig.deps = deps;
      requireConfig.callback = callback;
      if (!min) window.require = requireConfig;
    }
    if (min) addScript("/togetherjs/togetherjsPackage.js");
    else addScript("/togetherjs/libs/require.js");
  };
  /******** TogetherJ主体类 end ********/
  /******** tool begin ********/
  TogetherJS._extend = function (base, extensions) {
    // 给对象扩展属性/方法
    if (!extensions) {
      extensions = base;
      base = {};
    }
    for (var a in extensions) {
      if (extensions.hasOwnProperty(a)) {
        base[a] = extensions[a];
      }
    }
    return base;
  };
  TogetherJS._mixinEvents = function (proto) {
    //给对象添加EventListener
    proto.on = function on(name, callback) {
      if (typeof callback != "function") {
        console.warn(
          "Bad callback for",
          this,
          ".once(",
          name,
          ", ",
          callback,
          ")"
        );
        throw "Error: .once() called with non-callback";
      }
      if (name.search(" ") != -1) {
        var names = name.split(/ +/g);
        names.forEach(function (n) {
          this.on(n, callback);
        }, this);
        return;
      }
      if (this._knownEvents && this._knownEvents.indexOf(name) == -1) {
        var thisString = "" + this;
        if (thisString.length > 20) {
          thisString = thisString.substr(0, 20) + "...";
        }
        console.warn(thisString + ".on('" + name + "', ...): unknown event");
        if (console.trace) console.trace();
      }
      if (!this._listeners) {
        this._listeners = {};
      }
      if (!this._listeners[name]) {
        this._listeners[name] = [];
      }
      if (this._listeners[name].indexOf(callback) == -1) {
        this._listeners[name].push(callback);
      }
    };
    proto.once = function once(name, callback) {
      if (typeof callback != "function") {
        console.warn(
          "Bad callback for",
          this,
          ".once(",
          name,
          ", ",
          callback,
          ")"
        );
        throw "Error: .once() called with non-callback";
      }
      var attr = "onceCallback_" + name;
      // FIXME: maybe I should add the event name to the .once attribute:
      if (!callback[attr]) {
        callback[attr] = function onceCallback() {
          callback.apply(this, arguments);
          this.off(name, onceCallback);
          delete callback[attr];
        };
      }
      this.on(name, callback[attr]);
    };
    proto.off = proto.removeListener = function off(name, callback) {
      // 删除指定的socket监听,批量删除,name用" "分割.
      // Defer the .off() call until the .emit() is done.
      if (this._listenerOffs) return this._listenerOffs.push([name, callback]);
      if (name.search(" ") != -1) { //支持批量关闭"/"
        var names = name.split(/ +/g);
        return names.forEach(n => {
          this.off(n, callback); //递归自身进行off操作
        });
      }
      if (!this._listeners || !this._listeners[name])
        return; //_listeners为空或_listeners[name]为空,return
      this._listeners[name] = this._listeners[name].filter( //删除指定事件
        fn => fn != callback
      );
    };
    proto.emit = function emit(name) {
      //将待清除事件集合缓存到offs变量上(因为遍历listeners时有可能会操作_listenerOffs集合)
      var offs = this._listenerOffs = [];
      if (!this._listeners || !this._listeners[name])
        return;
      var args = Array.prototype.slice.call(arguments, 1);
      this._listeners[name].forEach(callback => {
        callback.apply(this, args); //依次触发绑定的回调函数
      });
      delete this._listenerOffs;
      if (offs.length) {
        offs.forEach(function (item) {
          this.off(item[0], item[1]);
        }, this);
      }
    };
    return proto;
  };
  TogetherJS._teardown = function () {
    // 卸载模块的方法
    var requireObject = TogetherJS._requireObject || window.require;
    // FIXME: this doesn't clear the context for min-case
    if (requireObject.s && requireObject.s.contexts) {
      delete requireObject.s.contexts.togetherjs;
    }
    // 初始化配置
    TogetherJS._loaded = false;
    TogetherJS.startup = TogetherJS._extend(TogetherJS._startupInit);
    TogetherJS.running = false;
  };
  /******** tool end ********/
  // This should contain the output of "git describe --always --dirty"
  // FIXME: substitute this on the server (and update make-static-client)
  TogetherJS.version = version;
  TogetherJS.baseUrl = baseUrl;
  TogetherJS.running = false; // 当前运行状态
  TogetherJS.pageLoaded = Date.now(); //记载page加载时间
  TogetherJS._knownEvents = ["ready", "close"]; //systemEvent所支持的事件
  TogetherJS.toString = function () {
    return "TogetherJS";
  };
  TogetherJS._configuration = {}; // 所有的配置项
  TogetherJS._configTrackers = {}; // 属性track集合 {key:ary}
  TogetherJS._configClosed = {}; // 冻结的配置项
  TogetherJS._defaultConfiguration = defaultConfiguration; // 内部配置项
  TogetherJS.requireConfig = {
    context: "togetherjs",
    baseUrl: baseUrl + "/togetherjs",
    urlArgs: "bust=" + cacheBust,
    paths: {
      jquery: "libs/jquery-1.11.1.min",
      walkabout: "libs/walkabout/walkabout",
      esprima: "libs/walkabout/lib/esprima",
      falafel: "libs/walkabout/lib/falafel",
      tinycolor: "libs/tinycolor",
      whrandom: "libs/whrandom/random"
    }
  };
  TogetherJS._startupInit = {
    //每部启动会话元素的初始化配置
    button: null, // 启动会话的元素
    reason: null, // 链接方式(started全新会话,joined继续会话)
    continued: false, //页面加载后,Together已经运行.
    _joinShareId: null, //要加入的房间
    _launch: false //true立即启动,false通过session.start()启动
  };
  TogetherJS.startup = TogetherJS._extend(TogetherJS._startupInit); //初始化配置元素
  TogetherJS._mixinEvents(TogetherJS); // 绑定eventListener
  TogetherJS.hub = TogetherJS._mixinEvents({}); // 给hub绑定eventListener
  // 修改配置的3种方式
  // *  TogetherJS.config(configurationObject)
  // *  TogetherJS.config(configName, value)
  // *  window.TogetherJSConfig在togetherJS启动前
  TogetherJS.config = function (name, val) {
    // 设置config,支持字符和对象2种形式
    var settings, i, tracker, attr;
    if (arguments.length == 1) {
      if (typeof name != "object")
        throw new Error(
          "TogetherJS.config(value) must have an object value (not: " +
          name +
          ")"
        );
      settings = name; //对象形式
    } else {
      settings = {};
      settings[name] = val;
    }
    for (attr in settings) {
      // 进行赋值
      if (TogetherJS._configClosed[attr] && TogetherJS.running)
        //被冻结的属性
        throw new Error(
          "The configuration " + attr + " is finalized and cannot be changed"
        );
      if (attr == "loaded" || attr == "callToStart")
        //不支持修改loaded/callToStart两属性
        continue;
      if (!TogetherJS._defaultConfiguration.hasOwnProperty(attr))
        //不认识的属性
        console.warn(
          "Unknown configuration value passed to TogetherJS.config():",
          attr
        );
      var previous = TogetherJS._configuration[attr];
      var value = settings[attr];
      TogetherJS._configuration[attr] = value; // 设置值
      /******** track 发布 begin ********/
      var trackers = TogetherJS._configTrackers[name] || [];
      var failed = false; //是否报错
      trackers.some(tracker => {
        try {
          tracker(value, previous);
        } catch (e) {
          console.warn(
            "Error setting configuration",
            name,
            "to",
            value,
            ":",
            e,
            "; reverting to",
            previous
          );
          failed = true;
          return failed;
        }
      });
      if (failed) {
        TogetherJS._configuration[attr] = previous;
        for (i = 0; i < trackers.length; i++) {
          try {
            tracker = trackers[i];
            tracker(value);
          } catch (e) {
            console.warn(
              "Error REsetting configuration",
              name,
              "to",
              previous,
              ":",
              e,
              "(ignoring)"
            );
          }
        }
      }
      /******** track previous end ********/
    }
  };
  TogetherJS.config.get = TogetherJS.getConfig = function (name) {
    //获取配置信息
    var value = TogetherJS._configuration[name];
    if (value === undefined) {
      if (!TogetherJS._defaultConfiguration.hasOwnProperty(name))
        console.error("Tried to load unknown configuration value:", name);
      value = TogetherJS._defaultConfiguration[name];
    }
    return value;
  };
  TogetherJS.config.track = function (name, callback) {
    // track,用于订阅config变化的函数
    if (!TogetherJS._defaultConfiguration.hasOwnProperty(name))
      throw new Error("Configuration is unknown: " + name);
    callback(TogetherJS.config.get(name));
    if (!TogetherJS._configTrackers[name])
      TogetherJS._configTrackers[name] = [];
    TogetherJS._configTrackers[name].push(callback);
    return callback;
  };
  TogetherJS.config.close = function (name) {
    //冻结并返回指定值
    if (!TogetherJS._defaultConfiguration.hasOwnProperty(name)) {
      throw new Error("Configuration is unknown: " + name);
    }
    TogetherJS._configClosed[name] = true;
    return this.get(name);
  };
  TogetherJS.reinitialize = function () {
    //重新启动
    // 如果未设置,说明TogetherJS has been not loaded,不需要重新加载
    if (TogetherJS.running && typeof TogetherJS.require == "function") {
      TogetherJS.require(["session"], function (session) {
        session.emit("reinitialize");
      });
    }
  };
  TogetherJS.refreshUserData = function () {
    // 刷新用户数据,emit
    if (TogetherJS.running && typeof TogetherJS.require == "function") {
      TogetherJS.require(["session"], function (session) {
        session.emit("refresh-user-data");
      });
    }
  };
  TogetherJS._onmessage = function (msg) {
    // 处理接收到的socket信息
    var type = msg.type;
    if (type.search(/^app\./) === 0)
      //hub 事件
      type = type.substr("app.".length);
    // system事件
    else type = "togetherjs." + type;
    msg.type = type;
    TogetherJS.hub.emit(msg.type, msg); //通过hub.emit触发事件
  };
  TogetherJS.send = function (msg) {
    // 发送socket事件(开发者使用)
    if (!TogetherJS.require)
      throw "You cannot use TogetherJS.send() when TogetherJS is not running";
    TogetherJS.require(["session"], function (session) {
      session.appSend(msg);
    });
  };
  TogetherJS.shareUrl = function () {
    if (!TogetherJS.require) return null;
    var session = TogetherJS.require("session");
    return session.shareUrl();
  };
  // 没有用到的方法
  TogetherJS.checkForUsersOnChannel = function (address, callback) {
    if (address.search(/^https?:/i) === 0) {
      address = address.replace(/^http/i, "ws");
    }
    var socket = new WebSocket(address);
    var gotAnswer = false;
    socket.onmessage = function (event) {
      var msg = JSON.parse(event.data);
      if (msg.type != "init-connection") {
        console.warn(
          "Got unexpected first message (should be init-connection):",
          msg
        );
        return;
      }
      if (gotAnswer) {
        console.warn(
          "Somehow received two responses from channel; ignoring second"
        );
        socket.close();
        return;
      }
      gotAnswer = true;
      socket.close();
      callback(msg.peerCount);
    };
    socket.onclose = socket.onerror = function () {
      if (!gotAnswer) {
        console.warn("Socket was closed without receiving answer");
        gotAnswer = true;
        callback(undefined);
      }
    };
  };
  var hash = location.hash.replace(/^#/, "");
  var room = /&?togetherjs=([^&]*)/.exec(hash); //room
  if (room) {
    // 加入到room
    TogetherJS.startup._joinShareId = room[1];
    TogetherJS.startup.reason = "joined";
    var newHash =
      hash.substr(0, room.index) + hash.substr(room.index + room[0].length);
    location.hash = newHash; // 更新为去除掉room后的hash
  }
  if (window._TogetherJSShareId) {
    TogetherJS.startup._joinShareId = window._TogetherJSShareId;
    delete window._TogetherJSShareId;
  }

  function conditionalActivate() {
    // 页面加载(支持自动/延时加载,TogetherJSConfig_callToStart)
    if (window.TogetherJSConfig_noAutoStart) return;
    var callToStart = window.TogetherJSConfig_callToStart;
    if (window.TogetherJSConfig && window.TogetherJSConfig.callToStart)
      callToStart = window.TogetherJSConfig.callToStart;
    if (callToStart)
      // 将初始化方法传入回调事件中
      callToStart(onload);
    else onload();
  }

  function onload() {
    if (TogetherJS.startup._joinShareId)
      // 方式1: joined room
      TogetherJS();
    else if (window._TogetherJSBookmarklet) {
      //方式2: 书签功能载入(基本不用)
      delete window._TogetherJSBookmarklet;
      TogetherJS();
    } else {
      var key = "togetherjs-session.status";
      var value = sessionStorage.getItem(key);
      if (value) {
        value = JSON.parse(value);
        if (value && value.running) {
          //方式3: sessionStorage 如果running,则continue
          TogetherJS.startup.continued = true;
          TogetherJS.startup.reason = value.startupReason;
          TogetherJS();
        }
      } else if (
        window.TogetherJSConfig_autoStart ||
        (window.TogetherJSConfig && window.TogetherJSConfig.autoStart)
      ) {
        TogetherJS.startup.reason = "joined"; //方式4: 自动启动
        TogetherJS();
      }
    }
  }
  conditionalActivate(); // 页面加载
  function addStyle() {
    var existing = document.getElementById("togetherjs-stylesheet");
    if (!existing) {
      var link = document.createElement("link");
      link.id = "togetherjs-stylesheet";
      link.setAttribute("rel", "stylesheet");
      link.href =
        baseUrl + styleSheet + (cacheBust ? "?bust=" + cacheBust : "");
      document.head.appendChild(link);
    }
  }

  function addScript(url) {
    var script = document.createElement("script");
    script.src = baseUrl + url + (cacheBust ? "?bust=" + cacheBust : "");
    document.head.appendChild(script);
  }
})();
