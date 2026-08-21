// zgui-core/modal-drag.js — makes every `.modal-content` draggable (via its `.modal-header`)
// and resizable (via edge handles), persisting size/position per modal id. Auto-applies to any
// modal inserted into the DOM via a MutationObserver. Distilled from Audio-Haxor's modal-drag.js
// with the app-specific player/terminal dock logic removed. window.ZGui.modalDrag.
//
// Pairs with ZGui.modal (which emits the canonical `.modal-*` structure). Host may define
// window.prefs ({getItem,setItem}); otherwise a localStorage shim is installed.
(function () {
    "use strict";

    const prefs = window.prefs || (window.prefs = {
        getItem(k) { try { return localStorage.getItem(k); } catch { return null; } },
        setItem(k, v) { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* quota */ } },
    });

    let _dragState = null;
    let _resizeState = null;

    const EDGE_CURSOR = {
        n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
        ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
    };

    function getModalKey(modal) {
        const overlay = modal.closest(".modal-overlay");
        return (overlay && overlay.id) || modal.id || (modal.closest("[id]") && modal.closest("[id]").id) || "";
    }

    function saveGeometry(modal) {
        const key = getModalKey(modal);
        if (!key) return;
        const rect = modal.getBoundingClientRect();
        prefs.setItem("modal_" + key, JSON.stringify({
            left: Math.round(rect.left), top: Math.round(rect.top),
            width: Math.round(rect.width), height: Math.round(rect.height),
        }));
    }

    function restoreGeometry(modal) {
        const key = getModalKey(modal);
        if (!key) return;
        const saved = prefs.getItem("modal_" + key);
        if (!saved) return;
        try {
            const geo = JSON.parse(saved);
            if (geo.left < 0 || geo.top < 0 || geo.left > window.innerWidth - 100 || geo.top > window.innerHeight - 50) return;
            if (geo.width < 200 || geo.height < 100) return;
            const overlay = modal.closest(".modal-overlay");
            if (overlay) { overlay.style.alignItems = "flex-start"; overlay.style.justifyContent = "flex-start"; }
            modal.style.position = "fixed";
            modal.style.left = geo.left + "px";
            modal.style.top = geo.top + "px";
            modal.style.width = geo.width + "px";
            modal.style.height = geo.height + "px";
            modal.style.margin = "0";
            modal.style.maxWidth = "none";
            modal.style.maxHeight = "none";
            const body = modal.querySelector(".modal-body");
            if (body) {
                const headerH = (modal.querySelector(".modal-header") || {}).offsetHeight || 50;
                body.style.maxHeight = (geo.height - headerH - 10) + "px";
            }
        } catch { /* corrupt geometry */ }
    }

    function init(modal) {
        if (!modal || modal._dragInit) return;
        modal._dragInit = true;
        if (getComputedStyle(modal).position !== "fixed") modal.style.position = "relative";

        ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach(function (edge) {
            const handle = document.createElement("div");
            handle.className = "modal-resize modal-resize-" + edge;
            handle.dataset.modalResize = edge;
            modal.appendChild(handle);
        });

        restoreGeometry(modal);

        const header = modal.querySelector(".modal-header");
        if (header) {
            header.style.cursor = "move";
            header.addEventListener("mousedown", function (e) {
                if (e.target.closest(".modal-close, button, input, select")) return;
                if (e.button !== 0) return;
                e.preventDefault();
                const rect = modal.getBoundingClientRect();
                const overlay = modal.closest(".modal-overlay");
                if (overlay) { overlay.style.alignItems = "flex-start"; overlay.style.justifyContent = "flex-start"; }
                modal.style.position = "fixed";
                modal.style.left = rect.left + "px";
                modal.style.top = rect.top + "px";
                modal.style.margin = "0";
                modal.style.width = rect.width + "px";
                document.body.style.userSelect = "none";
                document.body.style.cursor = "move";
                _dragState = { modal, startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
            });
        }

        modal.addEventListener("mousedown", function (e) {
            const handle = e.target.closest("[data-modal-resize]");
            if (!handle) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = modal.getBoundingClientRect();
            const overlay = modal.closest(".modal-overlay");
            if (overlay) { overlay.style.alignItems = "flex-start"; overlay.style.justifyContent = "flex-start"; }
            modal.style.position = "fixed";
            modal.style.left = rect.left + "px";
            modal.style.top = rect.top + "px";
            modal.style.margin = "0";
            modal.style.width = rect.width + "px";
            modal.style.height = rect.height + "px";
            modal.style.maxWidth = "none";
            modal.style.maxHeight = "none";
            document.body.style.userSelect = "none";
            document.body.style.cursor = EDGE_CURSOR[handle.dataset.modalResize] || "";
            _resizeState = {
                modal, edge: handle.dataset.modalResize,
                startX: e.clientX, startY: e.clientY,
                origLeft: rect.left, origTop: rect.top, origWidth: rect.width, origHeight: rect.height,
            };
        });
    }

    document.addEventListener("mousemove", function (e) {
        if (_dragState) {
            const s = _dragState;
            s.modal.style.left = (s.origLeft + e.clientX - s.startX) + "px";
            s.modal.style.top = (s.origTop + e.clientY - s.startY) + "px";
        }
        if (_resizeState) {
            const s = _resizeState;
            const dx = e.clientX - s.startX, dy = e.clientY - s.startY;
            const minW = 300, minH = 200;
            let left = s.origLeft, top = s.origTop, w = s.origWidth, h = s.origHeight;
            if (s.edge.includes("e")) w = Math.max(minW, s.origWidth + dx);
            if (s.edge.includes("w")) { w = Math.max(minW, s.origWidth - dx); left = s.origLeft + s.origWidth - w; }
            if (s.edge.includes("s")) h = Math.max(minH, s.origHeight + dy);
            if (s.edge.includes("n")) { h = Math.max(minH, s.origHeight - dy); top = s.origTop + s.origHeight - h; }
            s.modal.style.left = left + "px";
            s.modal.style.top = top + "px";
            s.modal.style.width = w + "px";
            s.modal.style.height = h + "px";
            const body = s.modal.querySelector(".modal-body");
            if (body) {
                const headerH = (s.modal.querySelector(".modal-header") || {}).offsetHeight || 50;
                body.style.maxHeight = (h - headerH - 10) + "px";
            }
        }
    });

    document.addEventListener("mouseup", function () {
        if (_dragState) saveGeometry(_dragState.modal);
        if (_resizeState) saveGeometry(_resizeState.modal);
        if (_dragState || _resizeState) { document.body.style.userSelect = ""; document.body.style.cursor = ""; }
        _dragState = null;
        _resizeState = null;
    });

    // Auto-enhance modals as they enter the DOM.
    function enable() {
        const observer = new MutationObserver(function (mutations) {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const modal = node.classList && node.classList.contains("modal-content")
                        ? node : (node.querySelector && node.querySelector(".modal-content"));
                    if (modal && !modal._dragInit) init(modal);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.querySelectorAll(".modal-content").forEach(init);
    }
    if (document.body) enable();
    else document.addEventListener("DOMContentLoaded", enable);

    window.ZGui = window.ZGui || {};
    window.ZGui.modalDrag = { init: init };
    if (!window.initModalDragResize) window.initModalDragResize = init;
})();
