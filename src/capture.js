"use strict";
// Runs only in the trusted browser shell. The source image stays in this modal.
window.wingCapture = {
  async open() {
    closeModal();
    const generation = modalGeneration;
    const source = await act("capture-preview");
    if (!source?.png || generation !== modalGeneration) return;
    const image = new Image();
    image.src = "data:image/png;base64," + source.png;
    await image.decode();
    if (generation !== modalGeneration) return;
    showModal(
      "capture",
      `<div class="dialog-content capture-editor">${dialogHead("Capture a region")}
      <p>Drag across the image, or enter pixel coordinates. Escape cancels.</p>
      <div class="capture-stage"><img alt="Page capture preview" draggable="false"><div class="capture-selection" aria-hidden="true"></div></div>
      <div class="capture-fields">${["X", "Y", "Width", "Height"].map((name) => `<label>${name}<input type="number" data-crop="${name.toLowerCase()}" step="1" min="${name === "Width" || name === "Height" ? 1 : 0}" required></label>`).join("")}</div>
      <label class="setting-row"><span>Portrait frame (9:16)</span><input id="capture-portrait" type="checkbox"></label>
      <p class="capture-error" role="status"></p><div class="dialog-actions"><button class="secondary" data-dismiss>Cancel</button><button class="secondary" data-export="clipboard">Copy image</button><button class="primary" data-export="file">Save PNG</button></div></div>`,
    );
    const root = document.querySelector(".capture-editor");
    const stage = root.querySelector(".capture-stage"),
      preview = stage.querySelector("img"),
      selection = stage.querySelector(".capture-selection");
    const fields = Object.fromEntries(
      [...root.querySelectorAll("[data-crop]")].map((input) => [
        input.dataset.crop,
        input,
      ]),
    );
    preview.src = image.src;
    const ink = document.createElement("canvas");
    ink.className = "capture-ink";
    ink.width = image.naturalWidth;
    ink.height = image.naturalHeight;
    stage.append(ink);
    root.querySelector(".capture-stage").insertAdjacentHTML(
      "beforebegin",
      `<div class="capture-tools"><select id="capture-tool" aria-label="Tool"><option value="crop">Select region</option><option value="pen">Pen</option><option value="box">Box</option><option value="arrow">Arrow</option><option value="text">Text</option></select><input id="capture-color" type="color" value="#e5484d" aria-label="Color"><input id="capture-label" placeholder="Text, then click the image"><button class="secondary" id="capture-undo">Undo</button></div>`,
    );
    const tool = root.querySelector("#capture-tool"),
      strokes = [],
      weight = Math.max(3, image.naturalWidth / 400);
    const paint = (context, mark) => {
      context.strokeStyle = context.fillStyle = mark.color;
      context.lineWidth = weight;
      context.lineCap = context.lineJoin = "round";
      const [a, b] = [mark.points[0], mark.points[mark.points.length - 1]];
      if (mark.tool === "text") {
        context.font = `600 ${weight * 6}px -apple-system, sans-serif`;
        context.fillText(mark.text, a.x, a.y);
      } else if (mark.tool === "box") {
        context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else {
        context.beginPath();
        mark.points.forEach((p) => context.lineTo(p.x, p.y));
        if (mark.tool === "arrow") {
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          for (const side of [-0.5, 0.5])
            context.lineTo(
              b.x - weight * 5 * Math.cos(angle + side),
              b.y - weight * 5 * Math.sin(angle + side),
            ),
              context.moveTo(b.x, b.y);
        }
        context.stroke();
      }
    };
    const repaint = () => {
      const context = ink.getContext("2d");
      context.clearRect(0, 0, ink.width, ink.height);
      strokes.forEach((mark) => paint(context, mark));
    };
    root.querySelector("#capture-undo").onclick = () => {
      strokes.pop();
      repaint();
    };
    let marking = null;
    let rect = {
        x: 0,
        y: 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
      },
      drag;
    const valid = () =>
      Object.values(rect).every(Number.isInteger) &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x + rect.width <= image.naturalWidth &&
      rect.y + rect.height <= image.naturalHeight;
    const draw = () => {
      const ok = valid();
      selection.hidden = !ok;
      for (const [name, input] of Object.entries(fields))
        input.value = rect[name];
      Object.assign(selection.style, {
        left: (100 * rect.x) / image.naturalWidth + "%",
        top: (100 * rect.y) / image.naturalHeight + "%",
        width: (100 * rect.width) / image.naturalWidth + "%",
        height: (100 * rect.height) / image.naturalHeight + "%",
      });
      root.querySelector(".capture-error").textContent = ok
        ? `${rect.width} × ${rect.height} pixels`
        : "Choose a rectangle inside the image.";
      root
        .querySelectorAll("[data-export]")
        .forEach((button) => (button.disabled = !ok));
    };
    for (const [name, input] of Object.entries(fields))
      input.oninput = () => {
        rect[name] = Number(input.value);
        draw();
      };
    const point = (event) => {
      const bounds = stage.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(
            image.naturalWidth,
            Math.round(
              ((event.clientX - bounds.left) * image.naturalWidth) /
                bounds.width,
            ),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            image.naturalHeight,
            Math.round(
              ((event.clientY - bounds.top) * image.naturalHeight) /
                bounds.height,
            ),
          ),
        ),
      };
    };
    stage.onpointerdown = (event) => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      if (tool.value !== "crop") {
        const color = root.querySelector("#capture-color").value;
        if (tool.value === "text") {
          const text = root.querySelector("#capture-label").value.trim();
          if (text) strokes.push({ tool: "text", color, text, points: [point(event)] });
          repaint();
          return;
        }
        marking = { tool: tool.value, color, points: [point(event)] };
        strokes.push(marking);
        stage.setPointerCapture(event.pointerId);
        return;
      }
      drag = {
        start: point(event),
        previous: { ...rect },
        id: event.pointerId,
      };
      stage.setPointerCapture(event.pointerId);
    };
    stage.onpointermove = (event) => {
      if (marking) {
        const next = point(event);
        if (marking.tool === "pen") marking.points.push(next);
        else marking.points[1] = next;
        repaint();
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const end = point(event);
      rect = {
        x: Math.min(drag.start.x, end.x),
        y: Math.min(drag.start.y, end.y),
        width: Math.abs(drag.start.x - end.x),
        height: Math.abs(drag.start.y - end.y),
      };
      draw();
    };
    stage.onpointerup = (event) => {
      if (marking) {
        marking = null;
        stage.releasePointerCapture(event.pointerId);
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      if (!valid()) rect = drag.previous;
      drag = null;
      stage.releasePointerCapture(event.pointerId);
      draw();
    };
    stage.onpointercancel = stage.onlostpointercapture = () => {
      if (drag) {
        rect = drag.previous;
        drag = null;
        draw();
      }
    };
    root.querySelectorAll("[data-export]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (!valid()) return;
          const canvas = document.createElement("canvas"),
            portrait = root.querySelector("#capture-portrait").checked;
          canvas.width = portrait ? rect.width + 64 : rect.width;
          canvas.height = portrait
            ? Math.ceil((canvas.width * 16) / 9)
            : rect.height;
          if (portrait && canvas.height < rect.height + 64) {
            canvas.height = rect.height + 64;
            canvas.width = Math.ceil((canvas.height * 9) / 16);
          }
          if (canvas.width * canvas.height > 64000000) {
            root.querySelector(".capture-error").textContent =
              "This capture is too large. Choose a smaller region.";
            return;
          }
          const context = canvas.getContext("2d");
          context.fillStyle = "#f3efe7";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(
            image,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            (canvas.width - rect.width) / 2,
            (canvas.height - rect.height) / 2,
            rect.width,
            rect.height,
          );
          context.save();
          context.beginPath();
          context.rect(
            (canvas.width - rect.width) / 2,
            (canvas.height - rect.height) / 2,
            rect.width,
            rect.height,
          );
          context.clip();
          context.translate(
            (canvas.width - rect.width) / 2 - rect.x,
            (canvas.height - rect.height) / 2 - rect.y,
          );
          strokes.forEach((mark) => paint(context, mark));
          context.restore();
          root
            .querySelectorAll("[data-export]")
            .forEach((b) => (b.disabled = true));
          const png = canvas.toDataURL("image/png").split(",")[1];
          if (png.length > 7000000) {
            draw();
            root.querySelector(".capture-error").textContent =
              "This capture is too large to export. Choose a smaller region.";
            return;
          }
          const result = await act("image-export", {
            png,
            destination: button.dataset.export,
          });
          if (!root.isConnected) return;
          if (result?.ok) {
            closeModal();
            toast(
              button.dataset.export === "clipboard"
                ? "Image copied."
                : "Image saved.",
            );
          } else draw();
        }),
    );
    draw();
  },
};
