/**
 * Shared Your College duck mark for PDF headers.
 * Uses assets/delta-duck-mascot.png (white sticker outline on green/navy bars).
 */
(function (global) {
  "use strict";

  var MASCOT_ASPECT = 1667 / 2020;
  var logoPromise = null;

  function mascotCandidates() {
    var path = (global.location && global.location.pathname) || "";
    var inSubdir =
      path.indexOf("/reports/") !== -1 ||
      path.indexOf("/faculty-onboarding/") !== -1 ||
      /\/reports\/[^/]+\.html$/i.test(path);
    var bases = inSubdir ? ["../assets/", "assets/"] : ["assets/", "../assets/"];
    var files = [
      "delta-duck-mascot.png",
      "Duck_Delta_Flag_Outline_DIGITAL.png",
      "Delta_College_Duck_Outline_DIGITAL.png"
    ];
    var urls = [];
    bases.forEach(function (base) {
      files.forEach(function (file) {
        urls.push(base + file);
      });
    });
    return urls;
  }

  function isBackgroundPixel(data, idx) {
    var i = idx * 4;
    return data[i + 3] < 24 || (data[i] < 24 && data[i + 1] < 24 && data[i + 2] < 24);
  }

  function knockoutCornerBackground(imageData) {
    var w = imageData.width;
    var h = imageData.height;
    var data = imageData.data;
    var seen = new Uint8Array(w * h);
    var stack = [0, w - 1, (h - 1) * w, h * w - 1];
    var s;
    for (s = 0; s < stack.length; s++) seen[stack[s]] = 1;
    while (stack.length) {
      var p = stack.pop();
      if (!isBackgroundPixel(data, p)) continue;
      data[p * 4 + 3] = 0;
      var x = p % w;
      var y = (p / w) | 0;
      var next = [];
      if (x > 0) next.push(p - 1);
      if (x + 1 < w) next.push(p + 1);
      if (y > 0) next.push(p - w);
      if (y + 1 < h) next.push(p + w);
      for (s = 0; s < next.length; s++) {
        if (!seen[next[s]]) {
          seen[next[s]] = 1;
          stack.push(next[s]);
        }
      }
    }
  }

  function processImage(img) {
    var h = 280;
    var w = Math.round(h * (img.naturalWidth / img.naturalHeight));
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    try {
      var imageData = ctx.getImageData(0, 0, w, h);
      knockoutCornerBackground(imageData);
      ctx.putImageData(imageData, 0, 0);
    } catch (err) {
      /* keep the drawn image if the canvas is tainted */
    }
    return canvas.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Failed to load " + src));
      };
      img.src = src;
    });
  }

  function loadDuckLogo() {
    if (logoPromise) return logoPromise;
    logoPromise = (async function () {
      var urls = mascotCandidates();
      for (var i = 0; i < urls.length; i++) {
        try {
          var img = await loadImage(urls[i]);
          if (img && img.naturalWidth) return processImage(img);
        } catch (e) {
          /* try next path */
        }
      }
      return null;
    })();
    return logoPromise;
  }

  function duckWidth(height) {
    return height * MASCOT_ASPECT;
  }

  function drawDuck(doc, dataUrl, x, y, height) {
    if (!dataUrl || !doc || typeof doc.addImage !== "function") return 0;
    var width = duckWidth(height);
    try {
      doc.addImage(dataUrl, "PNG", x, y, width, height);
      return width;
    } catch (err) {
      return 0;
    }
  }

  global.FacultyDashboardPdfBrand = {
    loadDuckLogo: loadDuckLogo,
    drawDuck: drawDuck,
    duckWidth: duckWidth
  };
})(window);
