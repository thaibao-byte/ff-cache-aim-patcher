(function () {
  "use strict";

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileNameEl = document.getElementById("fileName");
  const modesEl = document.getElementById("modes");
  const statusEl = document.getElementById("status");

  let originalBuffer = null;
  let originalName = "";

  // Bone name maps (UTF-8). Adjust if OB changes strings.
  const PATCHES = {
    lock: {
      from: "bone_Head",
      to:   "bone_Head"
    },
    neck: {
      from: "bone_Head",
      to:   "bone_Neck"
    },
    drag: {
      from: "bone_Head",
      to:   "bone_Spine"
    },
    body: {
      from: "bone_Head",
      to:   "bone_Hips"
    }
  };

  // Secondary common aliases found in some caches
  const ALIASES = [
    { from: "Head", toMap: { neck: "Neck", drag: "Spine", body: "Hips", lock: "Head" } },
    { from: "Bip001 Head", toMap: { neck: "Bip001 Neck", drag: "Bip001 Spine", body: "Bip001 Pelvis", lock: "Bip001 Head" } }
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

  function applyPatch(buffer, mode) {
    const view = new Uint8Array(buffer.slice(0)); // copy
    const patch = PATCHES[mode];
    if (!patch) throw new Error("Mode không hợp lệ");

    let totalReplaced = 0;

    const fromBytes = encode(patch.from);
    const toBytes = encode(patch.to);

    if (fromBytes.length !== toBytes.length) {
      const max = Math.max(fromBytes.length, toBytes.length);
      const f = new Uint8Array(max);
      const t = new Uint8Array(max);
      f.set(fromBytes);
      t.set(toBytes);
      const positions = findAll(view, fromBytes);
      for (const pos of positions) {
        view.set(t, pos);
        totalReplaced++;
      }
    } else {
      const positions = findAll(view, fromBytes);
      for (const pos of positions) {
        view.set(toBytes, pos);
        totalReplaced++;
      }
    }

    for (const alias of ALIASES) {
      const fromA = encode(alias.from);
      const toStr = alias.toMap[mode];
      if (!toStr) continue;
      const toA = encode(toStr);
      if (fromA.length !== toA.length) continue;
      const positions = findAll(view, fromA);
      for (const pos of positions) {
        view.set(toA, pos);
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
    a.download = name.replace(/(\.[\w]+)?$/, `_${mode}$1`) || `cache_${mode}.bin`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file) {
    try {
      setStatus("Đang đọc file…");
      originalBuffer = await readFile(file);
      originalName = file.name;
      fileNameEl.textContent = file.name + " (" + (file.size / 1024).toFixed(1) + " KB)";
      modesEl.classList.add("show");
      setStatus("Chọn mode bên dưới", "ok");
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
        setStatus("Không tìm thấy bone string trong file. Có thể version khác hoặc đã patch.", "err");
        return;
      }
      download(buffer, originalName, mode);
      setStatus(`Đã patch ${count} vị trí → tải về xong`, "ok");
    } catch (err) {
      setStatus(err.message || "Lỗi patch", "err");
    }
  });
})();
