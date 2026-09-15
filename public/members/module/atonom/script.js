(function () {
  "use strict";

  const chem = window.AtonomChem;
  if (!chem) {
    throw new Error("Moduł chemiczny nie został załadowany.");
  }

  const RANDOM_EXAMPLES = [
    "fenol",
    "etanol",
    "propan-2-ol",
    "2-chloroetan",
    "2,2-dichloroetan",
    "2,2-dichloropropanol",
    "1,2-dibromoetan",
    "but-2-en",
    "cis-but-2-en",
    "trans-but-2-en",
    "cis-1,2-dichloroeten",
    "pent-1-yn",
    "2-metylopropan",
    "2,3-dimetylobutan",
    "3-etylo-2-metylopentan",
    "cykloheksan",
    "1-chloro-2-fluorobenzen",
    "1,4-dichlorobenzen",
    "etylobenzen",
    "toluen",
    "anilina",
    "aceton",
    "etanal",
    "kwas propanowy",
    "kwas octowy",
    "etanian etylu",
    "etyloamina",
    "glicyna",
    "alanina",
    "dwutlenek węgla"
  ];

  const DARK_ATOM_COLORS = Object.freeze({
    H: "#f8fafc",
    C: "#9baabd",
    N: "#60a5fa",
    O: "#fb5c5c",
    F: "#b7ef4a",
    Cl: "#45d17a",
    Br: "#c47b5f",
    I: "#a78bfa"
  });

  const LIGHT_BOND_COLORS = Object.freeze({
    1: "#46574e",
    2: "#e96f24",
    3: "#9c4fd6"
  });

  const DARK_BOND_COLORS = Object.freeze({
    1: "#b7c8bf",
    2: "#ff9a52",
    3: "#df83ff"
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isHexColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  function hexToRgb(hex) {
    const raw = hex.replace("#", "");
    const full = raw.length === 3 ? raw.split("").map((character) => character + character).join("") : raw;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16)
    };
  }

  function mixColor(hex, target, amount) {
    const color = hexToRgb(hex);
    const mixed = {
      r: Math.round(color.r + (target.r - color.r) * amount),
      g: Math.round(color.g + (target.g - color.g) * amount),
      b: Math.round(color.b + (target.b - color.b) * amount)
    };
    return `rgb(${mixed.r}, ${mixed.g}, ${mixed.b})`;
  }

  function textColorForBackground(hex) {
    const color = hexToRgb(hex);
    const luminance = (color.r * 0.299 + color.g * 0.587 + color.b * 0.114) / 255;
    return luminance > 0.61 ? "#142019" : "#ffffff";
  }

  class MoleculeRenderer {
    constructor(canvas, stage) {
      this.canvas = canvas;
      this.stage = stage;
      this.context = canvas.getContext("2d", { alpha: true });
      this.model = null;
      this.width = 0;
      this.height = 0;
      this.pixelRatio = 1;
      this.yaw = -0.52;
      this.pitch = -0.18;
      this.energy = 0.28;
      this.atomScale = 1;
      this.cameraDistance = 1;
      this.theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      this.atomColors = {};
      this.bondColors = {};
      this.paused = false;
      this.dragging = false;
      this.pointer = null;
      this.lastFrameTime = performance.now();
      this.zoomListener = null;

      this.bindEvents();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(stage);
      this.resize();
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    bindEvents() {
      this.canvas.addEventListener("pointerdown", (event) => {
        this.dragging = true;
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        this.canvas.setPointerCapture(event.pointerId);
        this.stage.classList.add("is-dragging", "has-interacted");
      });

      this.canvas.addEventListener("pointermove", (event) => {
        if (!this.dragging || !this.pointer || this.pointer.id !== event.pointerId) return;
        const deltaX = event.clientX - this.pointer.x;
        const deltaY = event.clientY - this.pointer.y;
        this.yaw += deltaX * 0.009;
        this.pitch = clamp(this.pitch + deltaY * 0.009, -1.34, 1.34);
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
      });

      const finishPointer = (event) => {
        if (this.pointer && this.pointer.id !== event.pointerId) return;
        this.dragging = false;
        this.pointer = null;
        this.stage.classList.remove("is-dragging");
      };
      this.canvas.addEventListener("pointerup", finishPointer);
      this.canvas.addEventListener("pointercancel", finishPointer);

      this.canvas.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          this.stage.classList.add("has-interacted");
          this.cameraDistance = clamp(this.cameraDistance + event.deltaY * 0.0015, 0.35, 2.6);
          if (this.zoomListener) this.zoomListener(this.cameraDistance);
        },
        { passive: false }
      );

      this.canvas.tabIndex = 0;
      this.canvas.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 0.18 : 0.08;
        if (event.key === "ArrowLeft") this.yaw -= step;
        else if (event.key === "ArrowRight") this.yaw += step;
        else if (event.key === "ArrowUp") this.pitch = clamp(this.pitch - step, -1.34, 1.34);
        else if (event.key === "ArrowDown") this.pitch = clamp(this.pitch + step, -1.34, 1.34);
        else return;
        event.preventDefault();
        this.stage.classList.add("has-interacted");
      });
    }

    setModel(model) {
      this.model = model;
      this.resetView();
    }

    setEnergy(value) {
      this.energy = clamp(value, 0, 2.5);
    }

    setAtomScale(value) {
      this.atomScale = clamp(value, 0.4, 2.2);
    }

    setCameraDistance(value) {
      this.cameraDistance = clamp(value, 0.35, 2.6);
    }

    setTheme(theme) {
      this.theme = theme === "dark" ? "dark" : "light";
    }

    setAtomColor(element, color) {
      if (chem.ELEMENTS[element] && isHexColor(color)) this.atomColors[element] = color;
    }

    setAtomColors(colors) {
      this.atomColors = {};
      Object.entries(colors || {}).forEach(([element, color]) => this.setAtomColor(element, color));
    }

    resetAtomColors() {
      this.atomColors = {};
    }

    getAtomColor(element) {
      return this.atomColors[element] ||
        (this.theme === "dark" ? DARK_ATOM_COLORS[element] : chem.ELEMENTS[element].color);
    }

    setBondColor(order, color) {
      const normalizedOrder = Number(order);
      if ([1, 2, 3].includes(normalizedOrder) && isHexColor(color)) {
        this.bondColors[normalizedOrder] = color;
      }
    }

    setBondColors(colors) {
      this.bondColors = {};
      Object.entries(colors || {}).forEach(([order, color]) => this.setBondColor(order, color));
    }

    resetBondColors() {
      this.bondColors = {};
    }

    getBondColor(order) {
      return this.bondColors[order] ||
        (this.theme === "dark" ? DARK_BOND_COLORS[order] : LIGHT_BOND_COLORS[order]);
    }

    setPaused(value) {
      this.paused = Boolean(value);
    }

    resetView() {
      this.yaw = -0.52;
      this.pitch = -0.18;
      this.stage.classList.remove("has-interacted");
    }

    resize() {
      const bounds = this.stage.getBoundingClientRect();
      this.width = Math.max(1, bounds.width);
      this.height = Math.max(1, bounds.height);
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const targetWidth = Math.round(this.width * this.pixelRatio);
      const targetHeight = Math.round(this.height * this.pixelRatio);
      if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;
      }
    }

    centerOfModel() {
      if (!this.model || !this.model.atoms.length) return { x: 0, y: 0, z: 0 };
      const heavyAtoms = this.model.atoms.filter((atom) => atom.element !== "H");
      const atoms = heavyAtoms.length ? heavyAtoms : this.model.atoms;
      return atoms.reduce(
        (center, atom) => ({
          x: center.x + atom.position.x / atoms.length,
          y: center.y + atom.position.y / atoms.length,
          z: center.z + atom.position.z / atoms.length
        }),
        { x: 0, y: 0, z: 0 }
      );
    }

    rotatePoint(point, center, time, atomId) {
      const energyOffset = this.paused ? 0 : this.energy * 0.038;
      const vibration = {
        x: Math.sin(time * 2.1 + atomId * 1.71) * energyOffset,
        y: Math.sin(time * 2.7 + atomId * 0.93) * energyOffset,
        z: Math.cos(time * 2.35 + atomId * 1.37) * energyOffset
      };
      const x = point.x - center.x + vibration.x;
      const y = point.y - center.y + vibration.y;
      const z = point.z - center.z + vibration.z;

      const cosY = Math.cos(this.yaw);
      const sinY = Math.sin(this.yaw);
      const xY = x * cosY - z * sinY;
      const zY = x * sinY + z * cosY;

      const cosX = Math.cos(this.pitch);
      const sinX = Math.sin(this.pitch);
      return {
        x: xY,
        y: y * cosX - zY * sinX,
        z: y * sinX + zY * cosX
      };
    }

    projectedAtoms(time) {
      const center = this.centerOfModel();
      const rotated = this.model.atoms.map((atom) => ({
        atom,
        rotated: this.rotatePoint(atom.position, center, time, atom.id)
      }));

      const extent = Math.max(
        1.4,
        ...rotated
          .filter((item) => item.atom.element !== "H")
          .map((item) => Math.hypot(item.rotated.x, item.rotated.y) + 0.9)
      );
      const scale = Math.min(this.width, this.height) * 0.39 / extent / this.cameraDistance;

      return rotated.map((item) => {
        const perspective = clamp(5.8 / (5.8 + item.rotated.z * 0.16), 0.72, 1.35);
        return {
          ...item,
          x: this.width / 2 + item.rotated.x * scale * perspective,
          y: this.height / 2 + item.rotated.y * scale * perspective,
          perspective,
          scale
        };
      });
    }

    drawBond(context, start, end, bond) {
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const distance = Math.max(1, Math.hypot(deltaX, deltaY));
      const normalX = -deltaY / distance;
      const normalY = deltaX / distance;
      const depthFactor = clamp(1 - (start.rotated.z + end.rotated.z) * 0.015, 0.78, 1.18);
      const lineWidth = clamp(start.scale * 0.055, 2.5, 8) * depthFactor;
      const spacing = Math.max(3.2, lineWidth * 0.67);
      const bondColor = this.getBondColor(bond.order);
      const offsets =
        bond.order === 3 ? [-spacing, 0, spacing] : bond.order === 2 ? [-spacing * 0.55, spacing * 0.55] : [0];

      offsets.forEach((offset) => {
        context.beginPath();
        context.moveTo(start.x + normalX * offset, start.y + normalY * offset);
        context.lineTo(end.x + normalX * offset, end.y + normalY * offset);
        context.lineCap = "round";
        context.lineWidth = lineWidth + 2.4;
        context.strokeStyle = this.theme === "dark"
          ? "rgba(226, 240, 232, 0.13)"
          : "rgba(27, 42, 34, 0.22)";
        context.stroke();

        const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
        gradient.addColorStop(
          0,
          mixColor(bondColor, { r: 255, g: 255, b: 255 }, this.theme === "dark" ? 0.24 : 0.12)
        );
        gradient.addColorStop(0.5, bondColor);
        gradient.addColorStop(
          1,
          mixColor(bondColor, { r: 255, g: 255, b: 255 }, this.theme === "dark" ? 0.24 : 0.12)
        );
        context.lineWidth = lineWidth;
        context.strokeStyle = gradient;
        context.stroke();
      });
    }

    drawAtom(context, item) {
      const properties = chem.ELEMENTS[item.atom.element];
      const radiusBase = clamp(item.scale * 0.14, 8.5, 21);
      const radius = radiusBase * properties.radius * this.atomScale * item.perspective;
      const color = this.getAtomColor(item.atom.element);

      context.save();
      context.shadowColor = "rgba(28, 47, 37, 0.22)";
      context.shadowBlur = Math.max(4, radius * 0.55);
      context.shadowOffsetY = Math.max(2, radius * 0.2);

      const gradient = context.createRadialGradient(
        item.x - radius * 0.33,
        item.y - radius * 0.38,
        radius * 0.08,
        item.x,
        item.y,
        radius
      );
      gradient.addColorStop(0, mixColor(color, { r: 255, g: 255, b: 255 }, 0.48));
      gradient.addColorStop(0.3, mixColor(color, { r: 255, g: 255, b: 255 }, 0.08));
      gradient.addColorStop(0.78, color);
      gradient.addColorStop(1, mixColor(color, { r: 8, g: 20, b: 14 }, 0.4));

      context.beginPath();
      context.arc(item.x, item.y, radius, 0, Math.PI * 2);
      context.fillStyle = gradient;
      context.fill();
      context.shadowColor = "transparent";
      context.lineWidth = Math.max(1.2, radius * 0.075);
      context.strokeStyle = this.theme === "dark"
        ? "rgba(242, 249, 245, 0.34)"
        : "rgba(18, 31, 24, 0.42)";
      context.stroke();

      if (item.atom.element !== "C" && item.atom.element !== "H" && radius >= 10) {
        context.fillStyle = textColorForBackground(color);
        context.font = `700 ${Math.max(8, radius * 0.56)}px "Segoe UI", sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(item.atom.element, item.x, item.y + radius * 0.03);
      }
      context.restore();
    }

    render(time) {
      const context = this.context;
      context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      context.clearRect(0, 0, this.width, this.height);
      if (!this.model) return;

      const projected = this.projectedAtoms(time);
      const byId = new Map(projected.map((item) => [item.atom.id, item]));

      const bonds = this.model.bonds
        .map((bond) => ({
          bond,
          start: byId.get(bond.a),
          end: byId.get(bond.b)
        }))
        .sort((first, second) => {
          const firstDepth = (first.start.rotated.z + first.end.rotated.z) / 2;
          const secondDepth = (second.start.rotated.z + second.end.rotated.z) / 2;
          return firstDepth - secondDepth;
        });

      bonds.forEach((item) => this.drawBond(context, item.start, item.end, item.bond));
      projected
        .slice()
        .sort((first, second) => first.rotated.z - second.rotated.z)
        .forEach((item) => this.drawAtom(context, item));
    }

    frame(now) {
      const deltaSeconds = Math.min(0.05, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;
      if (!this.paused && !this.dragging && !document.hidden) {
        this.yaw += deltaSeconds * this.energy * 0.23;
      }
      if (!document.hidden) this.render(now / 1000);
      requestAnimationFrame(this.frame);
    }
  }

  function setupRange(input, output, formatter, callback) {
    const update = () => {
      const value = Number(input.value);
      const min = Number(input.min);
      const max = Number(input.max);
      const progress = ((value - min) / (max - min)) * 100;
      input.style.setProperty("--range-progress", `${progress}%`);
      output.value = formatter(value);
      output.textContent = formatter(value);
      callback(value);
    };
    input.addEventListener("input", update);
    update();
    return update;
  }

  function showToast(element, message) {
    window.clearTimeout(showToast.timeout);
    element.textContent = message;
    element.classList.add("is-visible");
    showToast.timeout = window.setTimeout(() => {
      element.classList.remove("is-visible");
    }, 2200);
  }

  function fallbackCopy(text) {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const result = document.execCommand("copy");
    field.remove();
    return result;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const authState = await window.ChemAuth.ready;
    if (!authState?.authenticated || !authState.session?.ok) return;

    const form = document.querySelector("#moleculeForm");
    const input = document.querySelector("#moleculeName");
    const clearInput = document.querySelector("#clearInput");
    const errorBox = document.querySelector("#parseError");
    const randomButton = document.querySelector("#randomButton");
    const chips = Array.from(document.querySelectorAll("[data-formula]"));
    const copyLinkButton = document.querySelector("#copyLinkButton");
    const capabilitiesButton = document.querySelector("#capabilitiesButton");
    const capabilitiesDialog = document.querySelector("#capabilitiesDialog");
    const closeCapabilitiesButton = document.querySelector("#closeCapabilitiesButton");
    const themeToggle = document.querySelector("#themeToggle");
    const pauseButton = document.querySelector("#pauseButton");
    const resetViewButton = document.querySelector("#resetViewButton");
    const colorsButton = document.querySelector("#colorsButton");
    const colorPanel = document.querySelector("#colorPanel");
    const closeColorsButton = document.querySelector("#closeColorsButton");
    const resetColorsButton = document.querySelector("#resetColorsButton");
    const colorInputs = Array.from(document.querySelectorAll("[data-atom-color]"));
    const bondColorInputs = Array.from(document.querySelectorAll("[data-bond-color]"));
    const toast = document.querySelector("#toast");
    const viewerStatus = document.querySelector(".viewer-status");
    const viewerStatusText = document.querySelector("#viewerStatusText");
    const renderer = new MoleculeRenderer(
      document.querySelector("#moleculeCanvas"),
      document.querySelector("#canvasStage")
    );

    let currentInput = "";

    function readStorage(key, fallback) {
      try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch (_error) {
        return fallback;
      }
    }

    function writeStorage(key, value) {
      try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch (_error) {
        // Ustawienie nadal działa w bieżącej sesji.
      }
    }

    function currentTheme() {
      return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    }

    function syncThemeControl() {
      const dark = currentTheme() === "dark";
      themeToggle.setAttribute("aria-label", dark ? "Włącz tryb jasny" : "Włącz tryb ciemny");
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor) themeColor.content = dark ? "#090f18" : "#edf2f7";
      renderer.setTheme(dark ? "dark" : "light");
    }

    function syncColorControls() {
      colorInputs.forEach((colorInput) => {
        const element = colorInput.dataset.atomColor;
        const color = renderer.getAtomColor(element);
        colorInput.value = color;
        const legend = document.querySelector(`[data-legend-color="${element}"]`);
        if (legend) legend.style.setProperty("--atom-color", color);
      });
      bondColorInputs.forEach((colorInput) => {
        const order = Number(colorInput.dataset.bondColor);
        const color = renderer.getBondColor(order);
        colorInput.value = color;
        const legend = document.querySelector(`[data-bond-legend="${order}"]`);
        if (legend) legend.style.setProperty("--bond-color", color);
        const preview = document.querySelector(`[data-bond-preview="${order}"]`);
        if (preview) preview.style.setProperty("--preview-color", color);
      });
    }

    function closeColorPanel() {
      colorPanel.hidden = true;
      colorsButton.setAttribute("aria-expanded", "false");
    }

    function setStatus(text, error) {
      viewerStatusText.textContent = text;
      viewerStatus.classList.toggle("is-error", Boolean(error));
    }

    function updateClearButton() {
      clearInput.classList.toggle("is-visible", input.value.length > 0);
    }

    function updateActiveChip(name) {
      const normalized = chem.normalizeName(name);
      chips.forEach((chip) => {
        chip.classList.toggle("is-active", chem.normalizeName(chip.dataset.formula) === normalized);
      });
    }

    function updateUrl(name) {
      const url = new URL(window.location.href);
      url.searchParams.set("formula", name);
      window.history.replaceState({ formula: name }, "", url);
    }

    function updateDetails(model) {
      document.querySelector("#compoundName").textContent = model.displayName;
      document.querySelector("#compoundFormula").innerHTML = model.formulaHtml;
      document.querySelector("#compoundFamily").textContent = model.family;
      document.querySelector("#atomCount").textContent = String(model.atomCount);
      document.querySelector("#bondCount").textContent = String(model.bondCount);
      document.querySelector("#molarMass").textContent = model.molarMass.toFixed(2).replace(".", ",");
      document.querySelector("#viewerTitle").textContent = model.displayName;
      document.querySelector("#studyHint").textContent = studyHintFor(model);
    }

    function studyHintFor(model) {
      if (model.stereochemistry === "cis") {
        return "W izomerze cis wspólne podstawniki leżą po tej samej stronie wiązania C=C.";
      }
      if (model.stereochemistry === "trans") {
        return "W izomerze trans wspólne podstawniki leżą po przeciwnych stronach wiązania C=C.";
      }
      const family = model.family.toLocaleLowerCase("pl-PL");
      if (family.includes("aldehyd")) return "Grupa –CHO leży na końcu łańcucha; jej atom węgla ma lokant 1.";
      if (family.includes("keton")) return "W ketonie grupa C=O znajduje się wewnątrz szkieletu i łączy dwa fragmenty węglowe.";
      if (family.includes("kwas")) return "Grupa karboksylowa –COOH łączy w jednej grupie wiązanie C=O i grupę –OH.";
      if (family.includes("ester")) return "Estry zawierają ugrupowanie –COO– powstające z części kwasowej i alkoholowej.";
      if (family.includes("aminokwas")) return "Aminokwas ma jednocześnie grupę aminową i karboksylową, dlatego jest amfoteryczny.";
      if (family.includes("amina")) return "W aminie atom azotu ma wolną parę elektronową i może przyjąć proton.";
      if (family.includes("alken")) return "Cis/trans występuje tylko wtedy, gdy każdy atom C przy C=C ma dwa różne podstawniki.";
      if (family.includes("alkin")) return "Wiązanie potrójne C≡C jest liniowe; związane z nim atomy tworzą kąt 180°.";
      if (family.includes("alkohol") || family.includes("fenol")) return "Zwróć uwagę, czy grupa –OH jest połączona z węglem alifatycznym, czy z pierścieniem aromatycznym.";
      if (family.includes("benzen") || family.includes("aromatycz")) return "Pierścień benzenowy jest płaski, a jego elektrony π są zdelokalizowane.";
      return "Porównaj wzór sumaryczny, liczbę wiązań i położenie grup funkcyjnych.";
    }

    function displayMolecule(value, options = {}) {
      const name = String(value || "").trim();
      try {
        const model = chem.parseMolecule(name);
        renderer.setModel(model);
        currentInput = name;
        updateDetails(model);
        updateActiveChip(name);
        errorBox.hidden = true;
        errorBox.textContent = "";
        input.removeAttribute("aria-invalid");
        setStatus("Model aktywny", false);
        if (options.updateUrl !== false) updateUrl(name);
        return true;
      } catch (error) {
        const message = error instanceof chem.ChemistryError ? error.message : "Nie udało się zbudować modelu.";
        const hint = error instanceof chem.ChemistryError ? error.hint : "";
        errorBox.textContent = hint ? `${message} ${hint}` : message;
        errorBox.hidden = false;
        input.setAttribute("aria-invalid", "true");
        setStatus("Sprawdź nazwę", true);
        return false;
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      displayMolecule(input.value);
    });

    input.addEventListener("input", updateClearButton);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.value = "";
        updateClearButton();
      }
    });

    clearInput.addEventListener("click", () => {
      input.value = "";
      updateClearButton();
      input.focus();
    });

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        input.value = chip.dataset.formula;
        updateClearButton();
        displayMolecule(input.value);
      });
    });

    capabilitiesButton.addEventListener("click", () => {
      if (typeof capabilitiesDialog.showModal === "function") capabilitiesDialog.showModal();
      else capabilitiesDialog.setAttribute("open", "");
    });

    closeCapabilitiesButton.addEventListener("click", () => capabilitiesDialog.close());
    capabilitiesDialog.addEventListener("click", (event) => {
      if (event.target === capabilitiesDialog) capabilitiesDialog.close();
    });
    document.querySelectorAll("[data-dialog-formula]").forEach((button) => {
      button.addEventListener("click", () => {
        input.value = button.dataset.dialogFormula;
        updateClearButton();
        displayMolecule(input.value);
        capabilitiesDialog.close();
      });
    });

    themeToggle.addEventListener("click", () => {
      const theme = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      writeStorage("chem.theme", theme);
      syncThemeControl();
      syncColorControls();
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== "chem.theme") return;
      syncThemeControl();
      syncColorControls();
    });

    colorsButton.addEventListener("click", () => {
      const opening = colorPanel.hidden;
      colorPanel.hidden = !opening;
      colorsButton.setAttribute("aria-expanded", String(opening));
    });
    closeColorsButton.addEventListener("click", closeColorPanel);
    colorInputs.forEach((colorInput) => {
      colorInput.addEventListener("input", () => {
        const element = colorInput.dataset.atomColor;
        renderer.setAtomColor(element, colorInput.value);
        const storedColors = { ...renderer.atomColors };
        writeStorage("atonom-atom-colors", JSON.stringify(storedColors));
        syncColorControls();
      });
    });
    bondColorInputs.forEach((colorInput) => {
      colorInput.addEventListener("input", () => {
        renderer.setBondColor(colorInput.dataset.bondColor, colorInput.value);
        writeStorage("atonom-bond-colors", JSON.stringify(renderer.bondColors));
        syncColorControls();
      });
    });
    resetColorsButton.addEventListener("click", () => {
      renderer.resetAtomColors();
      renderer.resetBondColors();
      writeStorage("atonom-atom-colors", null);
      writeStorage("atonom-bond-colors", null);
      syncColorControls();
      showToast(toast, "Przywrócono domyślne kolory");
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        !colorPanel.hidden &&
        !colorPanel.contains(event.target) &&
        !colorsButton.contains(event.target)
      ) {
        closeColorPanel();
      }
    });

    randomButton.addEventListener("click", () => {
      const alternatives = RANDOM_EXAMPLES.filter(
        (example) => chem.normalizeName(example) !== chem.normalizeName(currentInput)
      );
      const example = alternatives[Math.floor(Math.random() * alternatives.length)];
      input.value = example;
      updateClearButton();
      displayMolecule(example);
    });

    copyLinkButton.addEventListener("click", async () => {
      const url = new URL(window.location.href);
      url.searchParams.set("formula", currentInput || input.value || "fenol");
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(url.toString());
        } else if (!fallbackCopy(url.toString())) {
          throw new Error("copy-failed");
        }
        showToast(toast, "Link do cząsteczki skopiowany");
      } catch (_error) {
        showToast(toast, "Nie udało się skopiować linku");
      }
    });

    pauseButton.addEventListener("click", () => {
      const paused = pauseButton.getAttribute("aria-pressed") !== "true";
      pauseButton.setAttribute("aria-pressed", String(paused));
      pauseButton.querySelector(".pause-label").textContent = paused ? "Wznów" : "Pauza";
      pauseButton.title = paused ? "Wznów ruch" : "Zatrzymaj ruch";
      renderer.setPaused(paused);
      setStatus(paused ? "Model zatrzymany" : "Model aktywny", false);
    });

    resetViewButton.addEventListener("click", () => renderer.resetView());

    const energyRange = document.querySelector("#energyRange");
    const sizeRange = document.querySelector("#sizeRange");
    const distanceRange = document.querySelector("#distanceRange");

    setupRange(
      energyRange,
      document.querySelector("#energyValue"),
      (value) => `${value}%`,
      (value) => renderer.setEnergy(value / 100)
    );
    setupRange(
      sizeRange,
      document.querySelector("#sizeValue"),
      (value) => `${value}%`,
      (value) => renderer.setAtomScale(value / 100)
    );
    const updateDistanceRange = setupRange(
      distanceRange,
      document.querySelector("#distanceValue"),
      (value) => `${value}%`,
      (value) => renderer.setCameraDistance(value / 100)
    );
    renderer.zoomListener = (distance) => {
      distanceRange.value = String(Math.round(distance * 100));
      updateDistanceRange();
    };

    const storedColors = readStorage("atonom-atom-colors", "");
    if (storedColors) {
      try {
        renderer.setAtomColors(JSON.parse(storedColors));
      } catch (_error) {
        writeStorage("atonom-atom-colors", null);
      }
    }
    const storedBondColors = readStorage("atonom-bond-colors", "");
    if (storedBondColors) {
      try {
        renderer.setBondColors(JSON.parse(storedBondColors));
      } catch (_error) {
        writeStorage("atonom-bond-colors", null);
      }
    }
    syncThemeControl();
    syncColorControls();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      energyRange.value = "0";
      energyRange.dispatchEvent(new Event("input"));
    }

    window.addEventListener("popstate", () => {
      const name = new URLSearchParams(window.location.search).get("formula") || "fenol";
      input.value = name;
      updateClearButton();
      displayMolecule(name, { updateUrl: false });
    });

    document.querySelector("#currentYear").textContent = String(new Date().getFullYear());
    const initialName = new URLSearchParams(window.location.search).get("formula") || "fenol";
    input.value = initialName;
    updateClearButton();
    displayMolecule(initialName, { updateUrl: false });
  });
})();
