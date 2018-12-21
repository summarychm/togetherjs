/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* This module handles all the different UI that happens (sometimes in order) when
   TogetherJS is started:
   - Introduce the session when you've been invited
   - Show any browser compatibility indicators
   - Show the walkthrough the first time
   - Show the share link window
   When everything is done it fires session.emit("startup-ready")
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
  startup.start = function () {
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
    handlers[currentStep](startup.start);
  };
  var handlers = {
    browserBroken: function (next) { //初始检测
      if (window.WebSocket) //浏览器基础环境监测
        return next();
      windowing.show("#togetherjs-browser-broken", {
        onClose: function () {
          session.close();
        }
      });
      if ($.browser.msie)
        $("#togetherjs-browser-broken-is-ie").show();
    },
    browserUnsupported: function (next) { // 空
      next();
    },
    sessionIntro: function (next) { // 显示joinRoom提示
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
    walkthrough: function (next) {// 是否显示help
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
    share: function (next) {
      TogetherJS.config.close("suppressInvite");
      if (session.isClient || (!session.firstRun) ||
        TogetherJS.config.get("suppressInvite")) {
        next();
        return;
      }
      require(["windowing"], function (windowing) {
        windowing.show("#togetherjs-share");
        // FIXME: no way to detect when the window is closed
        // If there was a next() step then it would not work
      });
    }
  };
  return startup;
});