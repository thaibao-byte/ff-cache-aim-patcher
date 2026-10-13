(function () {
  "use strict";

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileNameEl = document.getElementById("fileName");
  const modesEl = document.getElementById("modes");
  const statusEl = document.getElementById("status");

  let originalBuffer = null;
  let originalName = "";

  // Primary + common variants (UTF-8)
  const PATCHES = {
    lock: [
      { from: "bone_Head", to: "bone_Head" },
      { from: "Bone_Head", to: "Bone_Head" },
      { from: "Bip001 Head", to: "Bip001 Head" },
      { from: "Head", to: "Head" }
    ],
    neck: [
      { from: "bone_Head", to: "bone_Neck" },
      { from: "Bone_Head", to: "Bone_Neck" },
      { from: "Bip001 Head", to: "Bip001 Neck" },
      { from: "Head", to: "Neck" }
    ],
    drag: [
      { from: "bone_Head", to: "bone_Spine" },
      { from: "Bone_Head", to: "Bone_Spine" },
      { from: "Bip001 Head", to: "Bip001 Spine" },
      { from: "Head", to: "Spine" },
      { from: "bone_Neck", to: "bone_Spine" }
    ],
    body: [
      { from: "bone_Head", to: "bone_Hips" },
      { from: "Bone_Head", to: "Bone_Hips" },
      { from: "Bip001 Head", to: "Bip001 Pelvis" },
      { from: "Head", to: "Hips" },
      { from: "bone_Neck", to: "bone_Hips" }
    ]
  };

  // Extra search targets for diagnostics
  const SCAN_STRINGS = [
    "bone_Head", "bone_Neck", "bone_Spine", "bone_Hips",
    "Bone_Head", "Bone_Neck", "Bone_Spine", "Bone_Hips",
    "Bip001 Head", "Bip001 Neck", "Bip001 Spine", "Bip001 Pelvis",
    "Head", "Neck", "Spine", "Hips", "Pelvis",
    "Root", "Hip", "Chest", "UpperChest"
  ];

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = "status" + (type ? " " + type : "");
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Không đọc được file"));
      reader.readAsArrayBuffer(file);
    });
  }

  function findAll(haystack, needle) {
    const positions = [];
    const nLen = needle.length;
    if (nLen === 0 || haystack.length < nLen) return positions;
    outer: for (let i = 0; i <= haystack.length - nLen; i++) {
      for (let j = 0; j < nLen; j++) {
        if (haystack[i + j] !== needle[j]) continue outer;
      }
      positions.push(i);
    }
    return positions;
  }

  function encode(str) {
    return new TextEncoder().encode(str);
  }

  function scanBones(buffer) {
    const view = new Uint8Array(buffer);
    const found = [];
    for (const s of SCAN_STRINGS) {
      const bytes = encode(s);
      const count = findAll(view, bytes).length;
      if (count > 0) found.push(s + "×" + count);
    }
    return found;
  }

  function applyPatch(buffer, mode) {
    const view = new Uint8Array(buffer.slice(0));
    const list = PATCHES[mode];
    if (!list) throw new Error("Mode không hợp lệ");

    let totalReplaced = 0;

    for (const patch of list) {
      const fromBytes = encode(patch.from);
      const toBytes = encode(patch.to);

      // same-length only to keep binary layout safe
      if (fromBytes.length !== toBytes.length) continue;

      const positions = findAll(view, fromBytes);
      for (const pos of positions) {
        view.set(toBytes, pos);
        totalReplaced++;
      }
    }

    return { buffer: view.buffer, count: totalReplaced };
  }

  function download(buffer, name, mode) {
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = name.replace(/\.zip$/i, "");
    a.download = base.replace(/(\.[\w]+)?$/, `_${mode}$1`) || `cache_${mode}.bin`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Minimal ZIP local-file extractor (stored / deflate via DecompressionStream if available)
  async function extractFromZip(arrayBuffer) {
    const view = new Uint8Array(arrayBuffer);
    // look for local file headers PK\x03\x04
    const candidates = [];
    for (let i = 0; i < view.length - 30; i++) {
      if (view[i] === 0x50 && view[i+1] === 0x4b && view[i+2] === 0x03 && view[i+3] === 0x04) {
        const compMethod = view[i+8] | (view[i+9] << 8);
        const compSize = view[i+18] | (view[i+19]<<8) | (view[i+20]<<16) | (view[i+21]<<24);
        const nameLen = view[i+26] | (view[i+27] << 8);
        const extraLen = view[i+28] | (view[i+29] << 8);
        const nameStart = i + 30;
        const nameBytes = view.slice(nameStart, nameStart + nameLen);
        const name = new TextDecoder().decode(nameBytes);
        const dataStart = nameStart + nameLen + extraLen;
        const data = view.slice(dataStart, dataStart + compSize);

        // skip directories
        if (name.endsWith("/")) continue;

        if (compMethod === 0) {
          // stored
          candidates.push({ name, buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
        } else if (compMethod === 8 && typeof DecompressionStream !== "undefined") {
          try {
            const ds = new DecompressionStream("deflate-raw");
            const stream = new Blob([data]).stream().pipeThrough(ds);
            const ab = await new Response(stream).arrayBuffer();
            candidates.push({ name, buffer: ab });
          } catch (_) {}
        }
      }
    }
    return candidates;
  }

  async function handleFile(file) {
    try {
      setStatus("Đang đọc file…");
      let buffer = await readFile(file);
      originalName = file.name;

      // if zip → extract inner binary
      const isZip = file.name.toLowerCase().endsWith(".zip") ||
        (new Uint8Array(buffer)[0] === 0x50 && new Uint8Array(buffer)[1] === 0x4b);

      if (isZip) {
        setStatus("Đang giải nén zip…");
        const files = await extractFromZip(buffer);
        if (!files.length) {
          setStatus("Zip rỗng hoặc không giải nén được (cần file stored/deflate).", "err");
          originalBuffer = null;
          modesEl.classList.remove("show");
          return;
        }
        // prefer largest file or name containing cache/bone/res
        files.sort((a, b) => b.buffer.byteLength - a.buffer.byteLength);
        let chosen = files.find(f => /cache|bone|res|asset|bundle/i.test(f.name)) || files[0];
        buffer = chosen.buffer;
        originalName = chosen.name || file.name;
        setStatus("Lấy từ zip: " + (chosen.name || "?") + " (" + (buffer.byteLength/1024).toFixed(1) + " KB)", "ok");
      }

      originalBuffer = buffer;
      fileNameEl.textContent = originalName + " (" + (buffer.byteLength / 1024).toFixed(1) + " KB)";

      const found = scanBones(buffer);
      if (found.length) {
        setStatus("Tìm thấy: " + found.slice(0, 8).join(", ") + (found.length > 8 ? "…" : ""), "ok");
      } else {
        setStatus("Cảnh báo: không thấy bone string phổ biến. File có thể encrypt / sai loại.", "err");
      }

      modesEl.classList.add("show");
    } catch (e) {
      setStatus(e.message || "Lỗi đọc file", "err");
      originalBuffer = null;
      modesEl.classList.remove("show");
    }
  }

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  modesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn || !originalBuffer) return;
    const mode = btn.dataset.mode;
    try {
      setStatus("Đang patch…");
      const { buffer, count } = applyPatch(originalBuffer, mode);
      if (count === 0) {
        const found = scanBones(originalBuffer);
        if (found.length) {
          setStatus("Không match mode này. File có: " + found.slice(0, 6).join(", "), "err");
        } else {
          setStatus("Không tìm thấy bone string. File zip/encrypt/sai loại.", "err");
        }
        return;
      }
      download(buffer, originalName, mode);
      setStatus(`Đã patch ${count} vị trí → tải về xong`, "ok");
    } catch (err) {
      setStatus(err.message || "Lỗi patch", "err");
    }
  });
})();
