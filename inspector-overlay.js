/**
 * Inspector Overlay for Fastshot Preview
 *
 * Standalone vanilla JS module that runs inside the preview iframe.
 * Activated via postMessage from parent — highlights elements on hover,
 * sends back source location (from data-source attributes set by babel plugin)
 * when user clicks. A selected element can be dragged or nudged with the arrow
 * keys (reported as `element-moved`), and the parent can preview a style change
 * on it before the source edit is saved (`preview-style`).
 */
(function () {
  'use strict';

  // Prevent double-init
  if (window.__fastshotInspector) return;

  var active = false;
  var currentTarget = null;
  var selectedTarget = null; // locked element after click — overlay stays until cleared
  var selection = null; // { source, index } of selectedTarget, to find it again when the app re-renders it
  var pendingSelect = null; // retry of the parent's `select` while the app has not rendered the element yet
  var restoring = false; // the app is getting back the screens a save's reload closed; `select` waits for them
  var restored = false; // the page got a save's screens back
  var known = null; // the screens last reported: a navigator the app does not have mounted now still has its last ones
  var cursorInside = false;
  var drag = null; // { x, y, dx, dy, moved } while the selected element is dragged
  var justDragged = false;
  var nudge = { target: null, dx: 0, dy: 0, timer: null }; // arrow-key moves not yet reported
  var patched = []; // [node, cssProperty, previous inline value] for reset-preview
  // The editor saves a move on what this page reports it moved (`picked` names the element selected); an editor from
  // before that saves the move on its selected element and takes no other field, so this page moves that one.
  var editorTakesMovers = false;
  // The build this page was loaded from: the editor selects its element again only in a page its own save published.
  var buildScript = document.querySelector('script[data-fastshot-build-id]');
  var buildId = buildScript ? buildScript.getAttribute('data-fastshot-build-id') : null;

  // --- Overlay elements ---
  // The overlay uses box-shadow to dim everything OUTSIDE its bounds,
  // creating a spotlight cutout over the hovered element.

  var overlay = document.createElement('div');
  overlay.id = '__fastshot-inspector-overlay';
  overlay.style.cssText =
    'position:fixed;z-index:99999;pointer-events:none;' +
    'background:rgba(89,58,255,0.5);border-radius:4px;' +
    'transition:top 0.05s ease-out,left 0.05s ease-out,width 0.05s ease-out,height 0.05s ease-out;' +
    'display:none;';

  var label = document.createElement('div');
  label.id = '__fastshot-inspector-label';
  label.style.cssText =
    'position:fixed;z-index:100000;pointer-events:none;' +
    'background:#593AFF;color:#fff;font:600 11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'padding:3px 7px;border-radius:4px;white-space:nowrap;display:none;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.25);max-width:320px;overflow:hidden;text-overflow:ellipsis;';

  // Margin overlay boxes (top, right, bottom, left)
  var marginColor = 'rgba(33, 214, 255, 0.5)';
  var marginOverlays = ['top', 'right', 'bottom', 'left'].map(function (side) {
    var el = document.createElement('div');
    el.id = '__fastshot-inspector-margin-' + side;
    el.style.cssText =
      'position:fixed;z-index:99998;pointer-events:none;display:none;' +
      'background:' + marginColor + ';';
    document.documentElement.appendChild(el);
    return el;
  });

  // Padding overlay boxes (top, right, bottom, left)
  var paddingColor = 'rgba(55, 200, 100, 0.5)';
  var paddingOverlays = ['top', 'right', 'bottom', 'left'].map(function (side) {
    var el = document.createElement('div');
    el.id = '__fastshot-inspector-padding-' + side;
    el.style.cssText =
      'position:fixed;z-index:99998;pointer-events:none;display:none;' +
      'background:' + paddingColor + ';';
    document.documentElement.appendChild(el);
    return el;
  });

  // Gap overlay boxes — dynamically created per gap slot
  var gapColor = 'rgba(255, 100, 180, 0.5)';
  var gapOverlays = [];

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(label);

  // --- Helpers ---

  /** Walk up from el to find the nearest ancestor (or self) with data-source.
   *  If none found, walk back down from the clicked element to find the nearest
   *  descendant with data-source (handles library components like TabBar that
   *  don't forward dataSet). Returns the clicked element with source borrowed
   *  from the descendant so the highlight covers the actual clicked area. */
  function findSourceElement(el) {
    // 1. Walk up — standard path
    var node = el;
    while (node && node !== document.documentElement) {
      if (node.dataset && node.dataset.source) return node;
      node = node.parentElement;
    }

    // 2. Walk down — the nearest descendant with data-source, which is what an edit or a move changes
    var child = el.querySelector('[data-source]');
    if (child) return child;

    return null;
  }

  function sourceOf(el) {
    return el.dataset.source || '';
  }

  /** The content of the file its key was written in (SHA-1): the pod edits by the key only in that content. */
  function hashOf(el) {
    return el.dataset.sourceHash || null;
  }

  function nodesWithSource(source) {
    return Array.prototype.filter.call(document.querySelectorAll('[data-source]'), function (node) {
      return node.dataset.source === source;
    });
  }

  /** Every rendered instance of the element's JSX (list rows share one source). */
  function instancesOf(el) {
    return el.dataset.source ? nodesWithSource(el.dataset.source) : [el];
  }

  /** The selected element; once the app re-renders it, the node that renders it now (none while it is gone). */
  function selected() {
    if (selection && !(selectedTarget && selectedTarget.isConnected)) {
      var matches = nodesWithSource(selection.source);
      selectedTarget = matches[Math.min(selection.index, matches.length - 1)] || null;
    }
    return selectedTarget;
  }

  /** The app screen an address shows: its path, query and hash, less the reload counter `t` the editor adds. */
  function screenOf(href) {
    var url = new URL(href, location.href);
    url.searchParams.delete('t');
    return url.pathname + url.search + url.hash;
  }

  /** Scroll what a person can scroll (the page, its lists) to show el; a box that clips without scrolling (a card with
   * overflow hidden) keeps its place, or everything in it would shift. */
  function scrollIntoSight(el) {
    var kept = [];
    for (var a = el.parentElement; a; a = a.parentElement) {
      var cs = window.getComputedStyle(a);
      kept.push([a, /hidden|clip/.test(cs.overflowX) && a.scrollLeft, /hidden|clip/.test(cs.overflowY) && a.scrollTop]);
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    kept.forEach(function (k) {
      if (k[1] !== false) k[0].scrollLeft = k[1];
      if (k[2] !== false) k[0].scrollTop = k[2];
    });
  }

  /** What the element is, in words a person uses (the label and the editor's menu title). */
  function kindOf(el) {
    // The source-tag plugin marks an image component (it draws its picture in elements of its own, none once the picture
    // failed to load; a box may hold a library's picture that no tag names).
    if (el.tagName === 'IMG' || el.dataset.sourceImage) return 'Image';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return 'Input';
    // A Text inside a Text renders as css-textHasAncestor-; a pressable Text is still text to style.
    if (/(^|\s)css-text(HasAncestor)?-/.test(el.className)) return 'Text';
    var role = el.getAttribute('role');
    if (role === 'button' || role === 'link' || window.getComputedStyle(el).cursor === 'pointer') return 'Button';
    if (el.tagName === 'svg' || el.querySelector(':scope > svg')) return 'Icon';
    return 'Box';
  }

  /** Hide highlight when cursor is not over a selectable element. */
  function showFullDim() {
    overlay.style.display = 'none';
    label.style.display = 'none';
    hideMarginOverlays();
    hidePaddingOverlays();
    hideGapOverlays();
  }

  /** Position overlay + label over a DOM element. */
  function hideMarginOverlays() {
    marginOverlays.forEach(function (el) { el.style.display = 'none'; });
  }

  function hidePaddingOverlays() {
    paddingOverlays.forEach(function (el) { el.style.display = 'none'; });
  }

  function showPaddingOverlays(el, rect) {
    var computed = window.getComputedStyle(el);
    var pt = parseFloat(computed.paddingTop) || 0;
    var pr = parseFloat(computed.paddingRight) || 0;
    var pb = parseFloat(computed.paddingBottom) || 0;
    var pl = parseFloat(computed.paddingLeft) || 0;

    if (pt === 0 && pr === 0 && pb === 0 && pl === 0) {
      hidePaddingOverlays();
      return;
    }

    // Padding is INSIDE the element rect
    // Top padding bar
    if (pt > 0) {
      paddingOverlays[0].style.cssText =
        'position:fixed;z-index:100001;pointer-events:none;display:block;background:' + paddingColor + ';' +
        'top:' + rect.top + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + pt + 'px;';
    } else { paddingOverlays[0].style.display = 'none'; }

    // Right padding bar
    if (pr > 0) {
      paddingOverlays[1].style.cssText =
        'position:fixed;z-index:100001;pointer-events:none;display:block;background:' + paddingColor + ';' +
        'top:' + (rect.top + pt) + 'px;left:' + (rect.right - pr) + 'px;width:' + pr + 'px;height:' + (rect.height - pt - pb) + 'px;';
    } else { paddingOverlays[1].style.display = 'none'; }

    // Bottom padding bar
    if (pb > 0) {
      paddingOverlays[2].style.cssText =
        'position:fixed;z-index:100001;pointer-events:none;display:block;background:' + paddingColor + ';' +
        'top:' + (rect.bottom - pb) + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + pb + 'px;';
    } else { paddingOverlays[2].style.display = 'none'; }

    // Left padding bar
    if (pl > 0) {
      paddingOverlays[3].style.cssText =
        'position:fixed;z-index:100001;pointer-events:none;display:block;background:' + paddingColor + ';' +
        'top:' + (rect.top + pt) + 'px;left:' + rect.left + 'px;width:' + pl + 'px;height:' + (rect.height - pt - pb) + 'px;';
    } else { paddingOverlays[3].style.display = 'none'; }
  }

  function hideGapOverlays() {
    gapOverlays.forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    gapOverlays = [];
  }

  function showGapOverlays(el) {
    hideGapOverlays();
    var computed = window.getComputedStyle(el);
    var display = computed.display;
    if (display !== 'flex' && display !== 'inline-flex') return;

    var gap = parseFloat(computed.gap || computed.rowGap) || 0;
    var columnGap = parseFloat(computed.columnGap) || gap;
    var rowGap = parseFloat(computed.rowGap) || gap;
    if (columnGap === 0 && rowGap === 0) return;

    var direction = computed.flexDirection || 'row';
    var children = [];
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      var childComputed = window.getComputedStyle(child);
      if (childComputed.display === 'none' || childComputed.position === 'absolute' || childComputed.position === 'fixed') continue;
      children.push(child);
    }

    for (var j = 0; j < children.length - 1; j++) {
      var r1 = children[j].getBoundingClientRect();
      var r2 = children[j + 1].getBoundingClientRect();
      var gapEl = document.createElement('div');
      gapEl.className = '__fastshot-inspector-gap';

      if (direction === 'row' || direction === 'row-reverse') {
        // Horizontal gap between children
        var gLeft = Math.min(r1.right, r2.right);
        var gRight = Math.max(r1.left, r2.left);
        if (gRight <= gLeft) continue;
        var gTop = Math.min(r1.top, r2.top);
        var gBottom = Math.max(r1.bottom, r2.bottom);
        gapEl.style.cssText =
          'position:fixed;z-index:100001;pointer-events:none;display:block;background:' + gapColor + ';' +
          'top:' + gTop + 'px;left:' + gLeft + 'px;width:' + (gRight - gLeft) + 'px;height:' + (gBottom - gTop) + 'px;';
      } else {
        // Vertical gap between children
        var gTopV = Math.min(r1.bottom, r2.bottom);
        var gBottomV = Math.max(r1.top, r2.top);
        if (gBottomV <= gTopV) continue;
        var gLeftV = Math.min(r1.left, r2.left);
        var gRightV = Math.max(r1.right, r2.right);
        gapEl.style.cssText =
          'position:fixed;z-index:100001;pointer-events:none;display:block;background:' + gapColor + ';' +
          'top:' + gTopV + 'px;left:' + gLeftV + 'px;width:' + (gRightV - gLeftV) + 'px;height:' + (gBottomV - gTopV) + 'px;';
      }

      document.documentElement.appendChild(gapEl);
      gapOverlays.push(gapEl);
    }
  }

  function showMarginOverlays(el, rect) {
    var computed = window.getComputedStyle(el);
    var mt = parseFloat(computed.marginTop) || 0;
    var mr = parseFloat(computed.marginRight) || 0;
    var mb = parseFloat(computed.marginBottom) || 0;
    var ml = parseFloat(computed.marginLeft) || 0;

    if (mt === 0 && mr === 0 && mb === 0 && ml === 0) {
      hideMarginOverlays();
      return;
    }

    // Top margin bar
    if (mt > 0) {
      marginOverlays[0].style.cssText =
        'position:fixed;z-index:99998;pointer-events:none;display:block;background:' + marginColor + ';' +
        'top:' + (rect.top - mt) + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + mt + 'px;';
    } else { marginOverlays[0].style.display = 'none'; }

    // Right margin bar
    if (mr > 0) {
      marginOverlays[1].style.cssText =
        'position:fixed;z-index:99998;pointer-events:none;display:block;background:' + marginColor + ';' +
        'top:' + (rect.top - mt) + 'px;left:' + rect.right + 'px;width:' + mr + 'px;height:' + (rect.height + mt + mb) + 'px;';
    } else { marginOverlays[1].style.display = 'none'; }

    // Bottom margin bar
    if (mb > 0) {
      marginOverlays[2].style.cssText =
        'position:fixed;z-index:99998;pointer-events:none;display:block;background:' + marginColor + ';' +
        'top:' + rect.bottom + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + mb + 'px;';
    } else { marginOverlays[2].style.display = 'none'; }

    // Left margin bar
    if (ml > 0) {
      marginOverlays[3].style.cssText =
        'position:fixed;z-index:99998;pointer-events:none;display:block;background:' + marginColor + ';' +
        'top:' + (rect.top - mt) + 'px;left:' + (rect.left - ml) + 'px;width:' + ml + 'px;height:' + (rect.height + mt + mb) + 'px;';
    } else { marginOverlays[3].style.display = 'none'; }
  }

  function positionOverlay(el) {
    var rect = el.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';

    showMarginOverlays(el, rect);
    showPaddingOverlays(el, rect);
    showGapOverlays(el);

    label.textContent = drag && drag.moved
      ? '↔ ' + Math.round(drag.dx) + '   ↕ ' + Math.round(drag.dy)
      : kindOf(el) + '  ' + Math.round(rect.width) + '×' + Math.round(rect.height);

    // Label above element, fall below if no room
    var labelTop = rect.top - 24;
    if (labelTop < 4) labelTop = rect.bottom + 4;
    label.style.top = labelTop + 'px';

    // Position label: align to left edge, but flip to right if it overflows viewport
    var vw = document.documentElement.clientWidth;
    label.style.left = '';
    label.style.right = '';
    var labelLeft = Math.max(4, rect.left);
    // Temporarily show to measure width
    label.style.display = 'block';
    label.style.left = labelLeft + 'px';
    var labelRect = label.getBoundingClientRect();
    if (labelRect.right > vw - 4) {
      // Flip: anchor to right edge of element instead
      label.style.left = '';
      label.style.right = Math.max(4, vw - rect.right) + 'px';
    }
  }

  function hideOverlay() {
    overlay.style.display = 'none';
    label.style.display = 'none';
    hideMarginOverlays();
    hidePaddingOverlays();
    hideGapOverlays();
    currentTarget = null;
    selectedTarget = null;
    selection = null;
  }

  // Computed styles the editor shows and edits, by React Native name.
  var STYLE_PROPS = [
    'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign', 'lineHeight',
    'borderRadius', 'borderWidth', 'borderColor', 'opacity', 'gap', 'display', 'flexDirection',
    'justifyContent', 'alignItems', 'alignSelf', 'position', 'top', 'left',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'width', 'height',
  ];

  /** Font families the app renders somewhere, so a font picker offers only loaded fonts. */
  function fontsInUse() {
    var fonts = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-source]'), function (node) {
      fonts[window.getComputedStyle(node).fontFamily.split(',')[0].replace(/['"]/g, '').trim()] = true;
    });
    return Object.keys(fonts).filter(Boolean).sort();
  }

  function buildPayload(el) {
    var source = sourceOf(el);
    var text = (el.textContent || '').trim().substring(0, 120);
    var rect = el.getBoundingClientRect();
    var computed = window.getComputedStyle(el);
    // Check for img: either the element itself or a descendant <img>
    var imgEl = el.tagName === 'IMG' ? el : el.querySelector('img');
    var tagName = imgEl ? 'img' : el.tagName.toLowerCase();
    var instances = instancesOf(el);
    var computedStyles = { margin: computed.margin, padding: computed.padding };
    STYLE_PROPS.forEach(function (name) { computedStyles[name] = computed[name]; });
    computedStyles.fontFamily = computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    computedStyles.borderRadius = computed.borderTopLeftRadius;
    computedStyles.borderWidth = computed.borderTopWidth;
    computedStyles.borderColor = computed.borderTopColor;

    return {
      source: source,
      sourceHash: hashOf(el),
      path: window.location.pathname + window.location.search + window.location.hash,
      text: text,
      tagName: tagName,
      kind: kindOf(el),
      parentDirection: el.parentElement ? window.getComputedStyle(el.parentElement).flexDirection : 'column',
      index: Math.max(0, instances.indexOf(el)),
      count: instances.length,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      computedSize: { width: computed.width, height: computed.height },
      imageSrc: imgEl ? (imgEl.src || null) : null,
      computedStyles: computedStyles,
    };
  }

  function sendToParent(action, payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          { type: 'fastshot-inspector', action: action, payload: payload || null, buildId: buildId },
          '*'
        );
      }
    } catch (e) {
      // silently ignore
    }
  }

  // --- Live preview of edits (the saved source edit reloads the page) ---

  var UNITLESS = { opacity: 1, fontWeight: 1, zIndex: 1, flex: 1, flexGrow: 1, flexShrink: 1 };
  var AXES = { Horizontal: ['Left', 'Right'], Vertical: ['Top', 'Bottom'] };

  /** The CSS properties a style property sets (an axis sets two sides). */
  function cssNamesOf(property) {
    var axis = /^(margin|padding)(Horizontal|Vertical)$/.exec(property);
    var names = axis ? AXES[axis[2]].map(function (side) { return axis[1] + side; }) : [property];
    return names.map(function (name) { return name.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); });
  }

  function patchStyle(nodes, property, value) {
    var css = /^-?[0-9.]+$/.test(String(value)) && !UNITLESS[property] ? value + 'px' : String(value);
    nodes.forEach(function (node) {
      cssNamesOf(property).forEach(function (cssName) {
        patched.push([node, cssName, node.style.getPropertyValue(cssName)]);
        node.style.setProperty(cssName, css, 'important');
      });
    });
  }

  /** Whether el shows at all: a size of 0 either way hides it. */
  function hasArea(el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** A size the element's own minimum or maximum would clamp moves that bound too, as the save does: only a bound its
   * own style writes as a number and nothing after it may override (the source-tag plugin lists it), in pixels. One from
   * elsewhere, a percentage or a constant stays. */
  function patchBounds(nodes, property, value) {
    var bounds = { width: ['minWidth', 'maxWidth'], height: ['minHeight', 'maxHeight'] }[property];
    if (!bounds || !/^-?[0-9.]+$/.test(String(value))) return;
    var computed = window.getComputedStyle(nodes[0]), own = {};
    (nodes[0].dataset.sourceBounds || '').split(' ').forEach(function (bound) {
      var parts = bound.split(':');
      if (parts[1]) own[parts[0]] = parseFloat(parts[1]);
    });
    var movable = function (name) {
      return /px$/.test(computed[name]) && Math.abs(parseFloat(computed[name]) - own[name]) < 0.01;
    };
    if (movable(bounds[0]) && parseFloat(computed[bounds[0]]) > parseFloat(value)) patchStyle(nodes, bounds[0], value);
    if (movable(bounds[1]) && parseFloat(computed[bounds[1]]) < parseFloat(value)) patchStyle(nodes, bounds[1], value);
  }

  /** Whether a value hides a copy of an element that shows in the app as saved with the element's other values the
   * editor is saving (`others`): measured with those and the value alone, the previews of other fields and moves set
   * aside for the moment (a draft may hide the copies already). */
  function hides(nodes, property, value, others) {
    var drafts = patched.map(function (entry) {
      return [entry[0], entry[1], entry[0].style.getPropertyValue(entry[1]), entry[0].style.getPropertyPriority(entry[1])];
    });
    resetPreview();
    Object.keys(others || {}).forEach(function (name) {
      patchStyle(nodes, name, others[name]);
      patchBounds(nodes, name, others[name]);
    });
    var showing = nodes.filter(hasArea);
    if (value !== '') patchStyle(nodes, property, value);
    patchBounds(nodes, property, value);
    var hidden = showing.some(function (node) { return !hasArea(node); });
    resetPreview();
    drafts.forEach(function (draft) {
      patched.push([draft[0], draft[1], draft[0].style.getPropertyValue(draft[1])]);
      draft[0].style.setProperty(draft[1], draft[2], draft[3]);
    });
    return hidden;
  }

  function resetPreview() {
    for (var i = patched.length - 1; i >= 0; i--) {
      patched[i][0].style.setProperty(patched[i][1], patched[i][2]);
    }
    patched = [];
  }

  /** The translate el has, as [x, y]: the moves not yet saved, on top of any the app gives it; null if not in pixels. */
  function offsetOf(el) {
    var value = window.getComputedStyle(el).translate;
    if (value !== 'none' && !/^-?[\d.]+px( -?[\d.]+px)?$/.test(value)) return null;
    var parts = value.split(' ');
    return [parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0];
  }

  /**
   * Where a pixel of el's offsets (its parent's space) goes on screen, along x and along y: an ancestor
   * the app scales or rotates changes both. Measured by translating el for a moment.
   */
  function basisOf(el) {
    var base = offsetOf(el);
    var value = el.style.getPropertyValue('translate');
    var priority = el.style.getPropertyPriority('translate');
    var at = function (x, y) {
      el.style.setProperty('translate', (base[0] + x) + 'px ' + (base[1] + y) + 'px', 'important');
      var rect = el.getBoundingClientRect();
      return [rect.left, rect.top];
    };
    var origin = at(0, 0), x = at(100, 0), y = at(0, 100);
    el.style.setProperty('translate', value, priority);
    return [[(x[0] - origin[0]) / 100, (x[1] - origin[1]) / 100], [(y[0] - origin[0]) / 100, (y[1] - origin[1]) / 100]];
  }

  /** What a move of el moves: el, or what a person presses (a button) that shows el alone, through boxes that show
   * only it (its icon, its label): moved alone, the visible button would leave its touch area behind on a phone. */
  function moverOf(el) {
    if (!editorTakesMovers || el.dataset.sourcePress) return el;
    for (var node = el; node.parentElement && alone(node); ) {
      node = node.parentElement;
      if (node.dataset.sourcePress && node.dataset.source) return node;
    }
    return el;
  }

  /** Whether node is all its parent shows: no other text, no other element but one not displayed. */
  function alone(node) {
    return Array.prototype.every.call(node.parentElement.childNodes, function (other) {
      if (other === node) return true;
      if (other.nodeType === Node.TEXT_NODE) return !other.textContent.trim();
      return other.nodeType !== Node.ELEMENT_NODE || window.getComputedStyle(other).display === 'none';
    });
  }

  var EDGES = ['top', 'right', 'bottom', 'left', 'start', 'end', 'inset', 'insetBlock', 'insetBlockStart', 'insetBlockEnd',
    'insetInline', 'insetInlineStart', 'insetInlineEnd'];

  /** The offsets el's own styles set in this page, zero ones too, by React Native name: the style the app passes it
   * (React's props of the nearest component above its node: a token's `start` stays `start`, which the page draws as
   * `left`) and the page's CSS rules for it and its inline style. The pod moves past a style it cannot see into only
   * where these are all ones it sees. Null when the app's style or a sheet of the page cannot be read. */
  function edgesOf(el) {
    var key = Object.keys(el).filter(function (name) { return name.indexOf('__reactFiber$') === 0; })[0];
    var root = key && el[key];
    while (root && root.return) root = root.return;
    // React keeps two copies of each fiber, and the node, and each copy above it, may name the one of a render before:
    // the last render's are the tree under the root's current one. There, the nearest component above el with a style.
    var fiber = (function find(node, above) {
      for (; node; node = node.sibling) {
        if (node.stateNode === el) return above;
        // A text's props are its string.
        var props = node.memoizedProps;
        var styled = find(node.child, typeof node.type !== 'string' && props && typeof props === 'object' && 'style' in props ? node : above);
        if (styled) return styled;
      }
      return null;
    })(root && root.stateNode && root.stateNode.current, null);
    if (!fiber) return null;
    var found = {};
    var unread = false;
    (function flatten(style) {
      if (Array.isArray(style)) style.forEach(flatten);
      else if (style && typeof style === 'object') {
        EDGES.forEach(function (name) { if (style[name] != null) found[name] = true; });
      }
    })(fiber.memoizedProps.style);
    var note = function (declarations) {
      EDGES.forEach(function (name) {
        if (declarations.getPropertyValue(name.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }))) {
          found[name] = true;
        }
      });
    };
    var visit = function (rules) {
      Array.prototype.forEach.call(rules, function (rule) {
        var imported = null;
        try {
          imported = rule.styleSheet && rule.styleSheet.cssRules;
        } catch (e) {
          unread = true; // Another origin's sheet, which may place el all the same.
        }
        if (imported) visit(imported);
        if (rule.cssRules) visit(rule.cssRules);
        var matches = false;
        try {
          matches = !!(rule.style && rule.selectorText && el.matches(rule.selectorText));
        } catch (e) {
          // A selector this element cannot be tested against (a pseudo-element) is not its own.
        }
        if (matches) note(rule.style);
      });
    };
    note(el.style);
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      var rules = null;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        unread = true;
      }
      if (rules) visit(rules);
    });
    return unread ? null : EDGES.filter(function (name) { return found[name]; });
  }

  /** The position a move's save reads: web renders some elements (an input) static, where top/left do nothing; fixed
   * and sticky move like absolute. */
  function positionOf(el) {
    var position = window.getComputedStyle(el).position;
    return position === 'static' || position === 'relative' ? position : 'absolute';
  }

  /** Show el moved by (x, y) from where the app puts it: what a move of it moves, and that one's copies. */
  function moveBy(el, x, y) {
    var nodes = instancesOf(moverOf(el));
    unpatch('translate', nodes);
    patchStyle(nodes, 'translate', Math.round(x) + 'px ' + Math.round(y) + 'px');
    positionOverlay(el);
  }

  /** Undo one preview property, on the given nodes or everywhere. */
  function unpatch(cssName, nodes) {
    patched = patched.filter(function (entry) {
      if (entry[1] !== cssName || (nodes && nodes.indexOf(entry[0]) < 0)) return true;
      entry[0].style.setProperty(cssName, entry[2]);
      return false;
    });
  }

  /** A move of the element picked (`picked`), saved on what it moves. */
  function reportMove(el, dx, dy, dragged) {
    var mover = moverOf(el);
    var computed = window.getComputedStyle(mover);
    sendToParent('element-moved', Object.assign({
      source: sourceOf(mover),
      sourceHash: hashOf(mover),
      path: window.location.pathname + window.location.search + window.location.hash,
      index: Math.max(0, instancesOf(mover).indexOf(mover)),
      dx: Math.round(dx),
      dy: Math.round(dy),
      position: positionOf(mover),
      top: parseFloat(computed.top) || 0,
      left: parseFloat(computed.left) || 0,
      // A drag reports as the press ends, the person still at the preview; arrow keys only after their pause.
      dragged: !!dragged,
    }, editorTakesMovers ? { picked: sourceOf(el), edges: edgesOf(mover) } : {}));
  }

  /** Report the arrow-key moves made so far, against the element they moved. */
  function flushNudge() {
    clearTimeout(nudge.timer);
    var target = nudge.target && (nudge.target.isConnected ? nudge.target : selected());
    if (target && (nudge.dx || nudge.dy)) reportMove(target, nudge.dx, nudge.dy);
    nudge = { target: null, dx: 0, dy: 0, timer: null };
  }

  function select(el, reselected) {
    if (nudge.target && nudge.target !== el) flushNudge();
    clearTimeout(pendingSelect);
    unpatch('touch-action');
    selectedTarget = el;
    currentTarget = el;
    selection = { source: sourceOf(el), index: Math.max(0, instancesOf(el).indexOf(el)) };
    var payload = buildPayload(el);
    // A selection only: the fonts the app renders, for the popover's font picker.
    payload.fonts = fontsInUse();
    // This page answers `check-style`: whether a value would hide the element (`preview-shown`).
    payload.checksStyle = true;
    // Picked again at the parent's request after a reload, not by the person: the editing goes on.
    if (reselected) payload.reselected = true;
    // What a drag or an arrow key moves, for the editor to ask the pod whether it can move it, and to name it.
    var mover = moverOf(el), moverStyle = window.getComputedStyle(mover);
    payload.mover = {
      source: sourceOf(mover),
      sourceHash: hashOf(mover),
      index: Math.max(0, instancesOf(mover).indexOf(mover)),
      position: positionOf(mover),
      top: parseFloat(moverStyle.top) || 0,
      left: parseFloat(moverStyle.left) || 0,
      kind: kindOf(mover),
      text: (mover.textContent || '').trim().substring(0, 120),
      edges: edgesOf(mover),
    };
    // Switch overlay to selected state: solid border, transparent background
    overlay.style.background = 'transparent';
    overlay.style.border = '2px solid #593AFF';
    // The selected element takes touch drags instead of scrolling the page under it.
    instancesOf(el).forEach(function (node) { patchStyle([node], 'touchAction', 'none'); });
    positionOverlay(el);
    sendToParent('element-selected', payload);
  }

  // --- Event handlers (capture phase to intercept before app) ---

  function onMouseMove(e) {
    if (!active) return;
    cursorInside = true;
    // If an element is selected (clicked), keep overlay locked on it
    if (selectedTarget) {
      document.body.style.cursor = selectedTarget.contains(e.target) ? 'move' : 'crosshair';
      return;
    }
    var el = findSourceElement(e.target);
    if (el && el !== currentTarget) {
      currentTarget = el;
      resetOverlayToHoverStyle();
      positionOverlay(el);
      sendToParent('element-hover', buildPayload(el));
    } else if (!el) {
      currentTarget = null;
      showFullDim();
    }
  }

  function onMouseLeave() {
    if (!active) return;
    cursorInside = false;
    // Don't hide overlay if an element is selected (even while the app has it unmounted for a moment)
    if (selection) return;
    hideOverlay();
  }

  function onPointerDown(e) {
    var target = active && selected();
    // An element the app translates by a percentage or calc() cannot be moved in pixels here.
    if (!target || !target.contains(e.target) || !offsetOf(moverOf(target))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var mover = moverOf(target);
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false, base: offsetOf(mover), basis: basisOf(mover) };
  }

  /** Back to where the drag started, saving nothing. */
  function cancelDrag() {
    var cancelled = drag;
    drag = null;
    if (cancelled && selected()) moveBy(selectedTarget, cancelled.base[0], cancelled.base[1]);
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Released outside the preview, where this page never heard it: the drag is dropped, not saved.
    if (e.buttons === 0) {
      cancelDrag();
      return;
    }
    // The pointer's screen move in the parent's own pixels, which offsets are in.
    var sx = e.clientX - drag.x, sy = e.clientY - drag.y;
    var bx = drag.basis[0], by = drag.basis[1];
    var det = bx[0] * by[1] - by[0] * bx[1];
    var dx = det ? (sx * by[1] - by[0] * sy) / det : sx;
    var dy = det ? (bx[0] * sy - sx * bx[1]) / det : sy;
    // Shift keeps the move on one axis.
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    drag.dx = dx;
    drag.dy = dy;
    if (selected()) moveBy(selectedTarget, drag.base[0] + dx, drag.base[1] + dy);
  }

  function onPointerUp(e) {
    if (!drag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Let go off the phone screen: the element would be out of sight, so the drag is dropped, not saved.
    if (e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight) {
      cancelDrag();
      return;
    }
    var finished = drag;
    drag = null;
    if (!finished.moved || !selected()) return;
    justDragged = true;
    // Let go where it started: nothing moved, nothing to save.
    if (!Math.round(finished.dx) && !Math.round(finished.dy)) {
      moveBy(selectedTarget, finished.base[0], finished.base[1]);
      return;
    }
    positionOverlay(selectedTarget);
    reportMove(selectedTarget, finished.dx, finished.dy, true);
  }

  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (justDragged) {
      justDragged = false;
      return;
    }

    var el = findSourceElement(e.target);
    if (el) select(el);
  }

  /** Reset overlay to hover style (called when hovering a new element). */
  function resetOverlayToHoverStyle() {
    overlay.style.background = 'rgba(89,58,255,0.5)';
    overlay.style.border = 'none';
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      deactivate();
      sendToParent('deactivated');
      return;
    }
    var step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    var size = e.shiftKey ? 10 : 1;
    if (!step || !nudgeBy(step[0] * size, step[1] * size)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  /** Moves the selected element by an arrow key's step (pressed here or in the editor); false if it cannot move. */
  function nudgeBy(dx, dy) {
    var target = selected();
    if (!target || !offsetOf(moverOf(target))) return false;
    // Moves still saving stay shown: this burst adds to them.
    if (!nudge.target) nudge.base = offsetOf(moverOf(target));
    nudge.target = target;
    nudge.dx += dx;
    nudge.dy += dy;
    moveBy(target, nudge.base[0] + nudge.dx, nudge.base[1] + nudge.dy);
    // One save for a burst of key presses.
    clearTimeout(nudge.timer);
    nudge.timer = setTimeout(flushNudge, 500);
    return true;
  }

  function onViewportChange(e) {
    if (!active || !selected()) return;
    positionOverlay(selectedTarget);
    // The page reflowed at another size (another device): the editor places its popover by the element again.
    if (e.type === 'resize') {
      var r = selectedTarget.getBoundingClientRect();
      sendToParent('selection-moved', { source: selection.source, index: selection.index, rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
    }
  }

  // --- Activate / Deactivate ---

  function activate() {
    if (active) return;
    active = true;
    cursorInside = false;
    // Don't dim until cursor enters the preview
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', cancelDrag, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    document.documentElement.addEventListener('mouseleave', onMouseLeave);
    document.body.style.cursor = 'crosshair';
  }

  function deactivate() {
    if (!active) return;
    active = false;
    cursorInside = false;
    drag = null;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', cancelDrag, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
    document.documentElement.removeEventListener('mouseleave', onMouseLeave);
    document.body.style.cursor = '';
    clearTimeout(nudge.timer);
    nudge = { target: null, dx: 0, dy: 0, timer: null };
    clearTimeout(pendingSelect);
    resetPreview();
    hideOverlay();
  }

  // --- The app's navigation (expo-router's root navigation, which the source-tag plugin gives the root layout) ---

  /** Calls back with the app's navigation once it is ready, or with null after 30 s (an app without it). */
  function withNavigation(callback) {
    var tries = 0;
    (function find() {
      var navigation = window.__fastshotNavigation && window.__fastshotNavigation();
      if (navigation && navigation.isReady()) callback(navigation);
      else if (++tries < 300) setTimeout(find, 100);
      else callback(null);
    })();
  }

  // The params that told a navigator which screen to open (React Navigation's nested navigation).
  var NESTING = ['state', 'screen', 'params', 'initial', 'path', 'merge', 'pop'];

  /** The screens open in a navigation state, as a reload gives them back for the app's navigators to rebuild: each
   * route by its key, name and params, and a navigator's history (a tab bar's Back), not the navigators' own keys,
   * which mean nothing to the next page's. A navigator's route keeps no params that opened a screen in it: the next
   * page would open that screen again rather than the screens it has. */
  function openScreens(state) {
    var nested = {};
    state.routes.forEach(function (route) { if (route.state) nested[route.key] = true; });
    var spent = function (entry) {
      if (!nested[entry.key] || !entry.params) return entry.params;
      var params = Object.assign({}, entry.params);
      NESTING.forEach(function (name) { delete params[name]; });
      return params;
    };
    return {
      index: state.index,
      // A tab bar's history keeps the params each visit had (`fullHistory`), which Back gives the tab again.
      history: state.history && state.history.map(function (entry) {
        return entry.params ? Object.assign({}, entry, { params: spent(entry) }) : entry;
      }),
      routes: state.routes.map(function (route) {
        return { key: route.key, name: route.name, params: spent(route), state: route.state && openScreens(route.state) };
      }),
    };
  }

  /** A navigator the app does not have mounted (a tab not opened since the page got its screens back) reports no
   * screens: it still has the ones it had last, by its route's key. */
  function withKnown(state, last) {
    if (!last) return state;
    return Object.assign({}, state, {
      routes: state.routes.map(function (route) {
        var was = last.routes.filter(function (entry) { return entry.key === route.key; })[0];
        if (!was || !was.state) return route;
        return Object.assign({}, route, { state: route.state ? withKnown(route.state, was.state) : was.state });
      }),
    });
  }

  // The editor keeps the screens open in this page, for the reload of a save to give them back; not those of a page
  // still getting its screens back (the edited screen alone).
  window.addEventListener('load', function () {
    withNavigation(function (navigation) {
      if (!navigation) return;
      var report = function () {
        if (restoring) return;
        known = withKnown(openScreens(navigation.getRootState()), known);
        // `restored`: these are the screens given back, or the app's moves since (not the edited screen alone).
        sendToParent('navigation', { state: known, restored: restored });
      };
      navigation.addListener('state', report);
      report();
    });
  });

  // --- Listen for commands from parent ---

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'fastshot-inspector') return;
    if (data.movers) editorTakesMovers = true;

    switch (data.action) {
      case 'activate':
        activate();
        break;
      case 'deactivate':
        deactivate();
        sendToParent('deactivated');
        break;
      case 'clear-selection':
        clearTimeout(pendingSelect);
        resetPreview();
        selectedTarget = null;
        selection = null;
        resetOverlayToHoverStyle();
        break;
      case 'nudge':
        if (active) nudgeBy(data.dx, data.dy);
        break;
      case 'preview-style':
        if (selected()) {
          var nodes = instancesOf(selectedTarget);
          // Each value previews from the app's own style; an empty one (a cleared field) shows just that.
          cssNamesOf(data.property).forEach(function (cssName) { unpatch(cssName, nodes); });
          // Bounds an earlier value moved go back too: the next value (auto after 150) may need neither.
          var boundNames = { width: ['min-width', 'max-width'], height: ['min-height', 'max-height'] }[data.property] || [];
          boundNames.forEach(function (cssName) { unpatch(cssName, nodes); });
          if (data.value !== '') patchStyle(nodes, data.property, data.value);
          patchBounds(nodes, data.property, data.value);
          positionOverlay(selectedTarget);
        }
        break;
      case 'check-style': {
        // Whether the value hides the element or a copy of it (a height of auto on a picture, a size of 0), for the
        // element the editor names, not the one picked now: the editor saves no value that does. A reloading page answers
        // once the app has rendered the element, or says it could not (null).
        var tries = 0;
        (function check() {
          var copies = nodesWithSource(data.source);
          if (!copies.length && ++tries < 100) {
            setTimeout(check, 100);
            return;
          }
          sendToParent('preview-shown', {
            request: data.request,
            hidden: copies.length ? hides(copies, data.property, data.value, data.with) : null,
          });
        })();
        break;
      }
      case 'restore-navigation':
        // A save's reload opened the edited screen alone, where the app's Back has nothing to go back to: the app gets
        // back the screens the person had open. Without its navigation (no expo-router root layout) it stays as it is.
        restoring = true;
        withNavigation(function (navigation) {
          if (navigation) {
            restored = true;
            known = data.state;
            navigation.resetRoot(data.state);
          }
          restoring = false;
        });
        break;
      case 'reset-preview':
        resetPreview();
        if (selected()) positionOverlay(selectedTarget);
        break;
      case 'select': {
        // Re-select the element being edited in a reloaded page, once the app has rendered it (its data may take a
        // while). One on another screen (a fullscreen preview's) or that never renders is reported missing, for the
        // editor to let it go.
        activate();
        var tries = 0;
        clearTimeout(pendingSelect);
        var elsewhere = data.path && screenOf(data.path) !== screenOf(location.href);
        (function find() {
          // The element is picked on the screen the person will see, once the app has its screens back.
          if (restoring) {
            pendingSelect = setTimeout(find, 100);
            return;
          }
          var matches = elsewhere ? [] : nodesWithSource(data.source);
          var target = matches[Math.min(data.index || 0, matches.length - 1)];
          if (target) {
            // A reloaded page and its lists start at their top: the element being edited comes back into sight.
            scrollIntoSight(target);
            select(target, true);
          } else if (!elsewhere && ++tries < 100) pendingSelect = setTimeout(find, 100);
          else sendToParent('select-missed', { source: data.source });
        })();
        break;
      }
    }
  });

  // --- Public API ---

  window.__fastshotInspector = {
    activate: activate,
    deactivate: deactivate,
    get isActive() {
      return active;
    },
  };

  // A nudge still waiting for its pause is reported when the page goes (the reload of an earlier save).
  window.addEventListener('pagehide', flushNudge);

  // The parent re-selects an element only once this listens: errorTracker.js reports the page loaded before this runs.
  sendToParent('ready');
})();
