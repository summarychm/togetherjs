/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* 
首次启动TogetherJS时界面UI显示逻辑处理
This module handles all the different UI that happens (sometimes in order) when
   TogetherJS is started: (TogetherJS启动)
   - Introduce the session when you've been invited (介绍当前会议)
   - Show any browser compatibility indicators (浏览器兼容相关)
   - Show the walkthrough the first time ()
   - Show the share link window (显示共享房间链接窗口)
   When everything is done it fires session.emit("startup-ready") 全部准备完成后广播 "startup-ready"
*/
define(["util", "require", "jquery", "windowing", "storage"], function (util, require, $, windowing, storage) {
  var assert = util.assert;
  var startup = util.Module("startup");
  // Avoid circular import:
  var session = null;
  var STEPS = [
    "browserBroken",
    "browserUnsupported",
    "sessionIntro",
    "walkthrough",
    "share"
  ];
  var currentStep = null;
  startup.start = function () { // 采用next()中间件的方式,实现页面UI展示
    if (!session) { //保证session必须存在
      require(["session"], function (sessionModule) {
        session = sessionModule; // 加载session模块
        startup.start(); // 重新进入startup.start方法
      });
      return;
    }
    var index = -1;
    if (currentStep) //根据name查找index
      index = STEPS.indexOf(currentStep);
    index++;
    if (index >= STEPS.length) //全部加载完毕,则触发"startup-ready"事件
      return session.emit("startup-ready");
    currentStep = STEPS[index];
    handlers[currentStep](startup.start); //next()中间件递归调用
  };
  var handlers = {
    browserBroken: function (next) { //浏览器是否支持webSocket监测
      if (window.WebSocket)
        return next();
      windowing.show("#togetherjs-browser-broken", { //浏览器不支持websocket
        onClose: function () {
          session.close();
        }
      });
      $.browser.msie && $("#togetherjs-browser-broken-is-ie").show();
    },
    browserUnsupported: function (next) { // 空方法
      next();
    },
    sessionIntro: function (next) { // 控制是否显示joinRoom对话框(firstRun)
      if ((!session.isClient) || !session.firstRun)
        return next();
      TogetherJS.config.close("suppressJoinConfirmation");
      if (TogetherJS.config.get("suppressJoinConfirmation"))
        return next();
      var cancelled = false;
      windowing.show("#togetherjs-intro", {
        onClose: function () {
          if (!cancelled) {
            next();
          }
        }
      });
      $("#togetherjs-intro .togetherjs-modal-dont-join").click(function () {
        cancelled = true;
        windowing.hide();
        session.close("declined-join");
      });
    },
    walkthrough: function (next) { // 是否显示help(新手入门)
      storage.settings.get("seenIntroDialog").then(function (seenIntroDialog) {
        if (seenIntroDialog)
          return next();
        require(["walkthrough"], function (walkthrough) {
          walkthrough.start(true, function () {
            storage.settings.set("seenIntroDialog", true);
            next();
          });
        });
      });
    },
    share: function (next) { // 控制是否显示邀请链接窗口
      TogetherJS.config.close("suppressInvite");
      if (session.isClient || (!session.firstRun) || TogetherJS.config.get("suppressInvite"))
        return next();
      require(["windowing"], function (windowing) {
        windowing.show("#togetherjs-share");
        // FIXME: no way to detect when the window is closed If there was a next() step then it would not work
      });
    }
  };
  return startup;
});
