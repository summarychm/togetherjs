/* Cursor viewing support
   */
define(["jquery", "ui", "util", "session", "element-finder", "tinycolor"], function ($, ui, util, session, elementFinder, tinycolor) {
  var assert = util.assert;
  var AssertionError = util.AssertionError;

  var FOREGROUND_COLORS = ["#111", "#eee"];
  var CURSOR_HEIGHT = 25;

  session.hub.on("cursor-update", function (msg) {
    Cursor.getClient(msg.clientId).updatePosition(msg);
  });

  // FIXME: should check for a peer leaving and remove the cursor object

  var Cursor = util.Class({

    constructor: function (clientId) {
      this.clientId = clientId;
      this.element = ui.cloneTemplate("cursor");
      this.elementClass = "towtruck-scrolled-normal";
      this.element.addClass(this.elementClass);
      this.updatePeer(session.peers.get(clientId));
      this.lastTop = this.lastLeft = null;
      $(document.body).append(this.element);
    },

    updatePeer: function (peer) {
      this.element.css({color: peer.color});
      var name = this.element.find(".towtruck-cursor-name");
      assert(name.length);
      name.text(peer.nickname);
      name.css({
        backgroundColor: peer.color,
        color: tinycolor.mostReadable(peer.color, FOREGROUND_COLORS)
      });
    },

    setClass: function (name) {
      if (name != this.elementClass) {
        this.element.removeClass(this.elementClass).addClass(name);
        this.elementClass = name;
      }
    },

    updatePosition: function (pos) {
      var top, left;
      if (pos.element) {
        var target = $(elementFinder.findElement(pos.element));
        var offset = target.offset();
        top = offset.top + pos.offsetY;
        left = offset.left + pos.offsetX;
      } else {
        // No anchor, just an absolute position
        top = pos.top;
        left = pos.left;
      }
      // These are saved for use by .refresh():
      this.lastTop = top;
      this.lastLeft = left;
      this.setPosition(top, left);
    },

    setPosition: function (top, left) {
      var wTop = $(window).scrollTop();
      var height = $(window).height();
      if (top < wTop) {
        top = wTop + 5;
        this.setClass("towtruck-scrolled-above");
      } else if (top > wTop + height - CURSOR_HEIGHT) {
        top = wTop + height - CURSOR_HEIGHT - 5;
        this.setClass("towtruck-scrolled-below");
      } else {
        this.setClass("towtruck-scrolled-normal");
      }
      this.element.css({
        top: top,
        left: left
      });
    },

    refresh: function () {
      if (this.lastTop !== null) {
        this.setPosition(this.lastTop, this.lastLeft);
      }
    },

    _destroy: function () {
      this.element.remove();
      this.element = null;
    }
  });

  Cursor._cursors = {};

  Cursor.getClient = function (clientId) {
    var c = Cursor._cursors[clientId];
    if (! c) {
      c = Cursor._cursors[clientId] = Cursor(clientId);
    }
    return c;
  };

  Cursor.forEach = function (callback, context) {
    context = context || null;
    for (var a in Cursor._cursors) {
      if (Cursor._cursors.hasOwnProperty(a)) {
        callback.call(context, Cursor._cursors[a], a);
      }
    }
  };

  Cursor.destroy = function (clientId) {
    Cursor._cursors[clientId]._destroy();
    delete Cursor._cursors[clientId];
  };

  session.peers.on("add update", function (peer) {
    var c = Cursor.getClient(peer.clientId);
    c.updatePeer(peer);
  });

  var lastTime = 0;
  var MIN_TIME = 100;
  var lastPosX = -1;
  var lastPosY = -1;
  var lastMessage = null;
  function mousemove(event) {
    var now = Date.now();
    if (now - lastTime < MIN_TIME) {
      return;
    }
    lastTime = now;
    var pageX = event.pageX;
    var pageY = event.pageY;
    if (Math.abs(lastPosX - pageX) < 3 && Math.abs(lastPosY - pageY) < 3) {
      // Not a substantial enough change
      return;
    }
    lastPosX = pageX;
    lastPosY = pageY;
    var target = event.target;
    if (target == document.documentElement || target == document.body) {
      lastMessage = {
        type: "cursor-update",
        top: pageY,
        left: pageX
      };
      session.send(lastMessage);
      return;
    }
    target = $(target);
    var offset = target.offset();
    var offsetX = pageX - offset.left;
    var offsetY = pageY - offset.top;
    lastMessage = {
      type: "cursor-update",
      element: elementFinder.elementLocation(target),
      offsetX: Math.floor(offsetX),
      offsetY: Math.floor(offsetY)
    };
    session.send(lastMessage);
  }

  var scrollTimeout = null;
  var scrollTimeoutSet = 0;
  var SCROLL_DELAY_TIMEOUT = 75;
  var SCROLL_DELAY_LIMIT = 300;

  function scroll() {
    var now = Date.now();
    if (scrollTimeout) {
      if (now - scrollTimeoutSet < SCROLL_DELAY_LIMIT) {
        clearTimeout(scrollTimeout);
      } else {
        // Just let it progress anyway
        return;
      }
    }
    scrollTimeout = setTimeout(_scrollRefresh, SCROLL_DELAY_TIMEOUT);
    if (! scrollTimeoutSet) {
      scrollTimeoutSet = now;
    }
  }

  function _scrollRefresh() {
    scrollTimeout = null;
    scrollTimeoutSet = 0;
    Cursor.forEach(function (c) {
      c.refresh();
    });
  }

  session.on("ui-ready", function () {
    $(document).mousemove(mousemove);
    document.addEventListener("click", documentClick, true);
    $(window).scroll(scroll);
  });

  session.on("close", function () {
    Cursor.forEach(function (c, clientId) {
      Cursor.destroy(clientId);
    });
    $(document).unbind("mousemove", mousemove);
    document.removeEventListener("click", documentClick, true);
    $(window).unbind("scroll", scroll);
  });

  session.hub.on("hello", function (msg) {
    // Immediately get our cursor onto this new person's screen:
    if (lastMessage) {
      session.send(lastMessage);
    }
  });


  function documentClick(event) {
    // FIXME: this might just be my imagination, but somehow I just
    // really don't want to do anything at this stage of the event
    // handling (since I'm catching every click), and I'll just do
    // something real soon:
    setTimeout(function () {
      var location = elementFinder.elementLocation(event.target);
      var offset = $(event.target).offset();
      var offsetX = event.pageX - offset.left;
      var offsetY = event.pageY - offset.top;
      session.send({
        type: "cursor-click",
        element: location,
        offsetX: offsetX,
        offsetY: offsetY
      });
    });
  }

  var CLICK_TRANSITION_TIME = 3000;

  session.hub.on("cursor-click", function (pos) {
    // When the click is calculated isn't always the same as how the
    // last cursor update was calculated, so we force the cursor to
    // the last location during a click:
    Cursor.getClient(pos.clientId).updatePosition(pos);
    var element = ui.cloneTemplate("click");
    var target = $(elementFinder.findElement(pos.element));
    var offset = target.offset();
    var top = offset.top + pos.offsetY;
    var left = offset.left + pos.offsetX;
    $(document.body).append(element);
    element.css({
      top: top,
      left: left
    });
    setTimeout(function () {
      element.addClass("towtruck-clicking");
    });
    setTimeout(function () {
      element.remove();
    }, CLICK_TRANSITION_TIME);
  });

});