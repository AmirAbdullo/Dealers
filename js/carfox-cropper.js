/**
 * CarFox image crop modal (Cropper.js from cdnjs, loaded on first use).
 *
 *   CarfoxCropper.open(file, { shape: 'circle' | 'square', title, output: 'image/jpeg' | 'image/png', size })
 *     -> Promise<Blob | null>   (null when the user cancels)
 *
 * Square 1:1 crop locked; the preview mask is round for avatars and square for logos.
 * Pinch / scroll to zoom, drag to reposition, plus a zoom slider. The cropped area is
 * exported from a canvas and the caller uploads that blob through the existing endpoint.
 */
(function (global) {
  'use strict';

  var CROPPER_JS = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js';
  var CROPPER_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css';
  var libPromise = null;
  var modal = null;
  var els = {};

  var CSS =
    '#cfCropOverlay{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.6);display:flex;align-items:flex-end;justify-content:center;}' +
    '#cfCropOverlay[hidden]{display:none !important;}' +
    '@media(min-width:640px){#cfCropOverlay{align-items:center;}}' +
    '#cfCropPanel{background:#fff;width:100%;max-width:480px;border-radius:20px 20px 0 0;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.3);}' +
    '@media(min-width:640px){#cfCropPanel{border-radius:20px;}}' +
    '#cfCropStage{position:relative;width:100%;height:320px;background:#0f172a;touch-action:none;}' +
    '#cfCropStage img{display:block;max-width:100%;}' +
    '#cfCropPanel.cf-circle .cropper-view-box,#cfCropPanel.cf-circle .cropper-face{border-radius:50%;}' +
    '#cfCropPanel .cropper-view-box{outline:2px solid rgba(255,255,255,.9);outline-offset:-1px;}' +
    '#cfCropPanel .cropper-modal{background:#0f172a;opacity:.7;}' +
    '#cfCropZoom{width:100%;accent-color:#1d4ed8;}';

  function loadLib() {
    if (global.Cropper) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[href="' + CROPPER_CSS + '"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CROPPER_CSS;
        document.head.appendChild(link);
      }
      var s = document.createElement('script');
      s.src = CROPPER_JS;
      s.onload = function () { global.Cropper ? resolve() : reject(new Error('Cropper failed to load')); };
      s.onerror = function () { reject(new Error('Could not load the image editor')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function mount() {
    if (modal) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.id = 'cfCropOverlay';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML =
      '<div id="cfCropPanel">' +
      '<div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">' +
      '<button type="button" id="cfCropCancel" class="text-sm font-semibold text-gray-600 hover:text-gray-900">Cancel</button>' +
      '<h2 id="cfCropTitle" class="text-sm font-bold text-gray-900">Adjust photo</h2>' +
      '<button type="button" id="cfCropSave" class="rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-1.5">Save</button>' +
      '</div>' +
      '<div id="cfCropStage"><img id="cfCropImg" alt="" /></div>' +
      '<div class="px-4 py-3">' +
      '<div class="flex items-center gap-3 text-gray-500">' +
      '<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path stroke-linecap="round" d="M21 21l-4.3-4.3M8 11h6"/></svg>' +
      '<input id="cfCropZoom" type="range" min="0" max="100" value="0" aria-label="Zoom" />' +
      '<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path stroke-linecap="round" d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>' +
      '</div>' +
      '<p class="mt-2 text-xs text-gray-500 text-center">Drag to reposition · pinch or scroll to zoom</p>' +
      '</div>' +
      '</div>';
    document.body.appendChild(modal);
    els = {
      panel: modal.querySelector('#cfCropPanel'),
      img: modal.querySelector('#cfCropImg'),
      title: modal.querySelector('#cfCropTitle'),
      zoom: modal.querySelector('#cfCropZoom'),
      cancel: modal.querySelector('#cfCropCancel'),
      save: modal.querySelector('#cfCropSave')
    };
  }

  function open(file, options) {
    options = options || {};
    var shape = options.shape === 'circle' ? 'circle' : 'square';
    var outputType = options.output || (shape === 'circle' ? 'image/jpeg' : 'image/png');
    var size = options.size || 512;

    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) {
        return reject(new Error('Please choose an image file'));
      }
      loadLib().then(function () {
        mount();
        var cropper = null;
        var minRatio = 1;
        var maxRatio = 1;
        var syncing = false;
        var objectUrl = URL.createObjectURL(file);

        els.title.textContent = options.title || (shape === 'circle' ? 'Adjust photo' : 'Adjust logo');
        els.panel.classList.toggle('cf-circle', shape === 'circle');
        els.zoom.value = '0';

        function cleanup(result) {
          if (cropper) { cropper.destroy(); cropper = null; }
          URL.revokeObjectURL(objectUrl);
          els.img.removeAttribute('src');
          modal.hidden = true;
          document.body.style.overflow = '';
          els.cancel.onclick = null;
          els.save.onclick = null;
          els.zoom.oninput = null;
          document.removeEventListener('keydown', onKey);
          resolve(result);
        }
        function onKey(e) { if (e.key === 'Escape') cleanup(null); }

        els.img.onload = function () {
          if (cropper) return;
          cropper = new global.Cropper(els.img, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 1,
            cropBoxMovable: false,
            cropBoxResizable: false,
            toggleDragModeOnDblclick: false,
            guides: false,
            center: false,
            highlight: false,
            background: false,
            responsive: true,
            zoomOnWheel: true,
            zoomOnTouch: true,
            wheelZoomRatio: 0.1,
            minCropBoxWidth: 120,
            ready: function () {
              var data = cropper.getImageData();
              minRatio = data.width / data.naturalWidth; // fit ratio at open
              maxRatio = minRatio * 4;
              els.zoom.value = '0';
            },
            zoom: function (e) {
              if (e.detail.ratio < minRatio) { e.preventDefault(); return; }
              if (e.detail.ratio > maxRatio) { e.preventDefault(); return; }
              if (!syncing) {
                els.zoom.value = String(Math.round(((e.detail.ratio - minRatio) / (maxRatio - minRatio)) * 100));
              }
            }
          });
        };
        els.img.src = objectUrl;

        els.zoom.oninput = function () {
          if (!cropper) return;
          var v = Number(els.zoom.value) / 100;
          syncing = true;
          cropper.zoomTo(minRatio + v * (maxRatio - minRatio));
          syncing = false;
        };
        els.cancel.onclick = function () { cleanup(null); };
        els.save.onclick = function () {
          if (!cropper) return;
          els.save.disabled = true;
          var canvas = cropper.getCroppedCanvas({
            width: size,
            height: size,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            fillColor: outputType === 'image/jpeg' ? '#ffffff' : 'transparent'
          });
          canvas.toBlob(function (blob) {
            els.save.disabled = false;
            if (!blob) return cleanup(null);
            cleanup(blob);
          }, outputType, 0.9);
        };
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        modal.hidden = false;
      }).catch(reject);
    });
  }

  global.CarfoxCropper = { open: open };
})(typeof window !== 'undefined' ? window : this);
