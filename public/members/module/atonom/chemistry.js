(function (globalScope) {
  "use strict";

  const ELEMENTS = Object.freeze({
    H: { name: "wodór", valence: 1, mass: 1.008, color: "#f8fafc", radius: 0.62 },
    C: { name: "węgiel", valence: 4, mass: 12.011, color: "#334155", radius: 0.92 },
    N: { name: "azot", valence: 3, mass: 14.007, color: "#3b82f6", radius: 0.9 },
    O: { name: "tlen", valence: 2, mass: 15.999, color: "#ef4444", radius: 0.88 },
    F: { name: "fluor", valence: 1, mass: 18.998, color: "#a3e635", radius: 0.86 },
    Cl: { name: "chlor", valence: 1, mass: 35.45, color: "#22c55e", radius: 1.02 },
    Br: { name: "brom", valence: 1, mass: 79.904, color: "#9a5b45", radius: 1.08 },
    I: { name: "jod", valence: 1, mass: 126.904, color: "#8b5cf6", radius: 1.14 }
  });

  const ROOTS = Object.freeze({
    met: 1,
    et: 2,
    prop: 3,
    but: 4,
    pent: 5,
    heks: 6,
    hept: 7,
    okt: 8,
    non: 9,
    dek: 10,
    undek: 11,
    dodek: 12
  });

  const ROOT_NAMES = Object.keys(ROOTS).sort((a, b) => b.length - a.length);

  const SUBSTITUENTS = Object.freeze({
    fluoro: { type: "halogen", element: "F" },
    chloro: { type: "halogen", element: "Cl" },
    bromo: { type: "halogen", element: "Br" },
    jodo: { type: "halogen", element: "I" },
    metylo: { type: "alkyl", carbons: 1 },
    etylo: { type: "alkyl", carbons: 2 },
    propylo: { type: "alkyl", carbons: 3 },
    butylo: { type: "alkyl", carbons: 4 }
  });

  const MULTIPLIERS = Object.freeze({
    "": 1,
    di: 2,
    tri: 3,
    tetra: 4
  });

  class ChemistryError extends Error {
    constructor(message, hint) {
      super(message);
      this.name = "ChemistryError";
      this.hint = hint || "";
    }
  }

  function vector(x = 0, y = 0, z = 0) {
    return { x, y, z };
  }

  function add(a, b) {
    return vector(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  function subtract(a, b) {
    return vector(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function scale(a, amount) {
    return vector(a.x * amount, a.y * amount, a.z * amount);
  }

  function length(a) {
    return Math.hypot(a.x, a.y, a.z);
  }

  function normalizeVector(a) {
    const magnitude = length(a);
    return magnitude < 0.0001 ? vector(1, 0, 0) : scale(a, 1 / magnitude);
  }

  function cross(a, b) {
    return vector(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }

  class MoleculeBuilder {
    constructor() {
      this.atoms = [];
      this.bonds = [];
    }

    addAtom(element, position, role) {
      if (!ELEMENTS[element]) {
        throw new ChemistryError(`Nieznany pierwiastek: ${element}.`);
      }
      const atom = {
        id: this.atoms.length,
        element,
        position: position || vector(),
        role: role || ""
      };
      this.atoms.push(atom);
      return atom;
    }

    addBond(atomA, atomB, order = 1) {
      if (!atomA || !atomB) {
        throw new ChemistryError("Nie udało się połączyć atomów.");
      }
      this.bonds.push({
        id: this.bonds.length,
        a: atomA.id,
        b: atomB.id,
        order
      });
      return this;
    }

    bondOrderFor(atomId) {
      return this.bonds.reduce((total, bond) => {
        return total + (bond.a === atomId || bond.b === atomId ? bond.order : 0);
      }, 0);
    }

    neighborsFor(atomId) {
      return this.bonds
        .filter((bond) => bond.a === atomId || bond.b === atomId)
        .map((bond) => this.atoms[bond.a === atomId ? bond.b : bond.a]);
    }

    addHydrogens() {
      const heavyAtoms = this.atoms.slice();

      heavyAtoms.forEach((atom) => {
        if (atom.element === "H") return;

        const valence = ELEMENTS[atom.element].valence;
        const usedValence = this.bondOrderFor(atom.id);
        const missing = valence - usedValence;

        if (missing < 0) {
          throw new ChemistryError(
            `Atom ${atom.element} ma za dużo wiązań w podanej strukturze.`,
            "Sprawdź lokanty podstawników i grup funkcyjnych."
          );
        }

        const neighbors = this.neighborsFor(atom.id);
        let away = vector(0, 0, 0);
        neighbors.forEach((neighbor) => {
          away = add(away, normalizeVector(subtract(atom.position, neighbor.position)));
        });
        if (length(away) < 0.1) {
          away = vector(
            Math.cos(atom.id * 1.71),
            Math.sin(atom.id * 1.71),
            atom.id % 2 ? 0.45 : -0.45
          );
        }
        away = normalizeVector(away);

        let helper = Math.abs(away.z) < 0.82 ? vector(0, 0, 1) : vector(0, 1, 0);
        let tangent = normalizeVector(cross(away, helper));
        let bitangent = normalizeVector(cross(away, tangent));

        for (let index = 0; index < missing; index += 1) {
          const angle = (Math.PI * 2 * index) / Math.max(missing, 1) + atom.id * 0.71;
          const spread = missing === 1 ? 0.12 : 0.72;
          let direction = add(
            scale(away, missing === 1 ? 1 : 0.68),
            add(
              scale(tangent, Math.cos(angle) * spread),
              scale(bitangent, Math.sin(angle) * spread)
            )
          );
          direction = normalizeVector(direction);
          const bondLength = atom.element === "O" || atom.element === "N" ? 0.92 : 1.04;
          const hydrogen = this.addAtom(
            "H",
            add(atom.position, scale(direction, bondLength)),
            "hydrogen"
          );
          this.addBond(atom, hydrogen, 1);
        }
      });

      return this;
    }

    result(meta) {
      const counts = {};
      let mass = 0;

      this.atoms.forEach((atom) => {
        counts[atom.element] = (counts[atom.element] || 0) + 1;
        mass += ELEMENTS[atom.element].mass;
      });

      const formulaOrder = [];
      if (counts.C) formulaOrder.push("C");
      if (counts.H) formulaOrder.push("H");
      Object.keys(counts)
        .filter((symbol) => symbol !== "C" && symbol !== "H")
        .sort()
        .forEach((symbol) => formulaOrder.push(symbol));

      const generatedFormula = formulaOrder
        .map((symbol) => `${symbol}${counts[symbol] > 1 ? counts[symbol] : ""}`)
        .join("");
      const formula = meta.formulaOverride || generatedFormula;

      return {
        ...meta,
        atoms: this.atoms,
        bonds: this.bonds,
        counts,
        formula,
        formulaHtml: formula.replace(/(\d+)/g, "<sub>$1</sub>"),
        molarMass: mass,
        atomCount: this.atoms.length,
        bondCount: this.bonds.length
      };
    }
  }

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase("pl-PL")
      .trim()
      .replace(/[‐‑‒–—−]/g, "-")
      .replace(/\s*,\s*/g, ",")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ");
  }

  function locantsFrom(text) {
    return text.split(",").map((part) => Number.parseInt(part, 10));
  }

  function validateLocants(locants, carbonCount, label) {
    locants.forEach((locant) => {
      if (!Number.isInteger(locant) || locant < 1 || locant > carbonCount) {
        throw new ChemistryError(
          `Pozycja ${locant} nie istnieje w łańcuchu mającym ${carbonCount} ${carbonCount === 1 ? "atom węgla" : "atomy węgla"}.`,
          `Sprawdź numer przed członem „${label}”.`
        );
      }
    });
  }

  function chainCoordinates(count, cyclic) {
    if (cyclic) {
      const radius = Math.max(1.35, count * 0.27);
      return Array.from({ length: count }, (_, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
        return vector(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          index % 2 ? 0.08 : -0.08
        );
      });
    }

    return Array.from({ length: count }, (_, index) => {
      return vector(
        (index - (count - 1) / 2) * 1.42,
        (index % 2 === 0 ? 0.28 : -0.28) - (count === 1 ? 0.28 : 0),
        (index % 3 - 1) * 0.04
      );
    });
  }

  function buildCarbonParent(builder, carbonCount, options) {
    const cyclic = Boolean(options.cyclic);
    const positions = chainCoordinates(carbonCount, cyclic);
    const carbons = positions.map((position) => builder.addAtom("C", position, cyclic ? "ring" : "parent"));
    const multipleBonds = options.multipleBonds || [];

    for (let index = 1; index < carbons.length; index += 1) {
      const bondPosition = index;
      const multiple = multipleBonds.find((item) => item.position === bondPosition);
      builder.addBond(carbons[index - 1], carbons[index], multiple ? multiple.order : 1);
    }

    if (cyclic) {
      const closingPosition = carbonCount;
      const multiple = multipleBonds.find((item) => item.position === closingPosition);
      builder.addBond(carbons[carbons.length - 1], carbons[0], multiple ? multiple.order : 1);
    }

    return carbons;
  }

  function outwardDirection(parentAtoms, parentIndex, branchIndex) {
    const parent = parentAtoms[parentIndex];
    let direction;

    if (parent.role === "ring") {
      const center = parentAtoms.reduce(
        (sum, atom) => add(sum, scale(atom.position, 1 / parentAtoms.length)),
        vector()
      );
      direction = normalizeVector(subtract(parent.position, center));
    } else if (parentAtoms.length === 1) {
      direction = vector(0, 1, 0);
    } else if (parentIndex === 0) {
      direction = normalizeVector(subtract(parent.position, parentAtoms[1].position));
    } else if (parentIndex === parentAtoms.length - 1) {
      direction = normalizeVector(subtract(parent.position, parentAtoms[parentIndex - 1].position));
    } else {
      const fromPrevious = normalizeVector(subtract(parent.position, parentAtoms[parentIndex - 1].position));
      const fromNext = normalizeVector(subtract(parent.position, parentAtoms[parentIndex + 1].position));
      direction = normalizeVector(add(fromPrevious, fromNext));
      if (length(add(fromPrevious, fromNext)) < 0.15) {
        direction = vector(0, parentIndex % 2 ? -1 : 1, 0);
      }
    }

    const angle = branchIndex * 2.18 + parentIndex * 0.37;
    return normalizeVector(
      add(
        scale(direction, 0.78),
        vector(0, Math.cos(angle) * 0.42, Math.sin(angle) * 0.66)
      )
    );
  }

  function addSubstituent(builder, parentAtoms, parentIndex, substituent, branchIndex) {
    const parent = parentAtoms[parentIndex];
    const direction = outwardDirection(parentAtoms, parentIndex, branchIndex);

    if (substituent.type === "halogen") {
      const atom = builder.addAtom(
        substituent.element,
        add(parent.position, scale(direction, 1.36)),
        "substituent"
      );
      builder.addBond(parent, atom, 1);
      return;
    }

    let previous = parent;
    let currentPosition = parent.position;
    let currentDirection = direction;

    for (let index = 0; index < substituent.carbons; index += 1) {
      currentPosition = add(currentPosition, scale(currentDirection, 1.39));
      const carbon = builder.addAtom("C", currentPosition, "branch");
      builder.addBond(previous, carbon, 1);
      previous = carbon;
      currentDirection = normalizeVector(
        add(currentDirection, vector(0.08, index % 2 ? -0.38 : 0.38, index % 2 ? 0.22 : -0.22))
      );
    }
  }

  function addHydroxyGroup(builder, parentAtoms, parentIndex, branchIndex) {
    const parent = parentAtoms[parentIndex];
    const direction = outwardDirection(parentAtoms, parentIndex, branchIndex + 1.2);
    const oxygen = builder.addAtom(
      "O",
      add(parent.position, scale(direction, 1.28)),
      "functional"
    );
    builder.addBond(parent, oxygen, 1);
  }

  function addCarbonyl(builder, parentAtoms, parentIndex) {
    const parent = parentAtoms[parentIndex];
    const direction = outwardDirection(parentAtoms, parentIndex, 2.4);
    const oxygen = builder.addAtom(
      "O",
      add(parent.position, scale(direction, 1.2)),
      "functional"
    );
    builder.addBond(parent, oxygen, 2);
  }

  function addAminoGroup(builder, parentAtoms, parentIndex, branchIndex) {
    const parent = parentAtoms[parentIndex];
    const direction = outwardDirection(parentAtoms, parentIndex, branchIndex + 0.6);
    const nitrogen = builder.addAtom(
      "N",
      add(parent.position, scale(direction, 1.28)),
      "functional"
    );
    builder.addBond(parent, nitrogen, 1);
  }

  function addCarboxylGroup(builder, carbon, parentAtoms) {
    const parentIndex = parentAtoms.indexOf(carbon);
    const direction = outwardDirection(parentAtoms, parentIndex, 0);
    let perpendicular = normalizeVector(cross(direction, vector(0, 0, 1)));
    if (length(perpendicular) < 0.1) perpendicular = vector(0, 1, 0);

    const oxygenDouble = builder.addAtom(
      "O",
      add(carbon.position, scale(normalizeVector(add(scale(direction, 0.25), perpendicular)), 1.2)),
      "functional"
    );
    const oxygenHydroxy = builder.addAtom(
      "O",
      add(carbon.position, scale(normalizeVector(add(scale(direction, 0.25), scale(perpendicular, -1))), 1.28)),
      "functional"
    );
    builder.addBond(carbon, oxygenDouble, 2);
    builder.addBond(carbon, oxygenHydroxy, 1);
    return { oxygenDouble, oxygenHydroxy };
  }

  function parseTail(tail, carbonCount, cyclic) {
    if (tail === "an") {
      return { saturation: "alkane", multipleBonds: [], hydroxy: [], carbonyl: [] };
    }

    if (tail === "anol") {
      return { saturation: "alkane", multipleBonds: [], hydroxy: [1], carbonyl: [] };
    }

    if (tail === "anal") {
      return {
        saturation: "alkane",
        multipleBonds: [],
        hydroxy: [],
        carbonyl: [1],
        aldehyde: true
      };
    }

    let match = tail.match(/^an-(\d+(?:,\d+)*)-(ol|diol|triol)$/);
    if (match) {
      const positions = locantsFrom(match[1]);
      const expected = match[2] === "ol" ? 1 : match[2] === "diol" ? 2 : 3;
      if (positions.length !== expected) {
        throw new ChemistryError(
          `Końcówka „${match[2]}” wymaga ${expected} ${expected === 1 ? "pozycji" : "pozycji"}, a podano ${positions.length}.`
        );
      }
      validateLocants(positions, carbonCount, match[2]);
      return { saturation: "alkane", multipleBonds: [], hydroxy: positions, carbonyl: [] };
    }

    match = tail.match(/^an-(\d+)-on$/);
    if (match) {
      const position = Number.parseInt(match[1], 10);
      validateLocants([position], carbonCount, "on");
      return { saturation: "alkane", multipleBonds: [], hydroxy: [], carbonyl: [position] };
    }

    if (tail === "anamina") {
      return {
        saturation: "alkane",
        multipleBonds: [],
        hydroxy: [],
        carbonyl: [],
        amino: [1]
      };
    }

    match = tail.match(/^an-(\d+)-amina$/);
    if (match) {
      const position = Number.parseInt(match[1], 10);
      validateLocants([position], carbonCount, "amina");
      return {
        saturation: "alkane",
        multipleBonds: [],
        hydroxy: [],
        carbonyl: [],
        amino: [position]
      };
    }

    if (tail === "en" || tail === "yn") {
      if (carbonCount < 2) {
        throw new ChemistryError("Wiązanie wielokrotne wymaga co najmniej dwóch atomów węgla.");
      }
      return {
        saturation: tail === "en" ? "alkene" : "alkyne",
        multipleBonds: [{ position: 1, order: tail === "en" ? 2 : 3 }],
        hydroxy: [],
        carbonyl: []
      };
    }

    match = tail.match(/^a?-(\d+(?:,\d+)*)-(?:(di|tri))?(en|yn)$/);
    if (match) {
      const positions = locantsFrom(match[1]);
      const multiplier = match[2] || "";
      const expected = multiplier === "di" ? 2 : multiplier === "tri" ? 3 : 1;
      if (positions.length !== expected) {
        throw new ChemistryError(
          `Człon „${multiplier}${match[3]}” wymaga ${expected} lokantów, a podano ${positions.length}.`
        );
      }
      const maxBondPosition = cyclic ? carbonCount : carbonCount - 1;
      positions.forEach((position) => {
        if (position < 1 || position > maxBondPosition) {
          throw new ChemistryError(
            `Wiązanie od pozycji ${position} wychodzi poza łańcuch.`,
            `Dla tego związku pozycja wiązania może wynosić najwyżej ${maxBondPosition}.`
          );
        }
      });
      return {
        saturation: match[3] === "en" ? "alkene" : "alkyne",
        multipleBonds: positions.map((position) => ({
          position,
          order: match[3] === "en" ? 2 : 3
        })),
        hydroxy: [],
        carbonyl: []
      };
    }

    return null;
  }

  function preprocessNaturalName(name) {
    for (const root of ROOT_NAMES) {
      let match = name.match(new RegExp(`^(\\d+)-${root}anol$`));
      if (match) return `${root}an-${match[1]}-ol`;

      match = name.match(new RegExp(`^(\\d+(?:,\\d+)*)-${root}(en|yn)$`));
      if (match) {
        const multiplier = match[1].includes(",") ? "di" : "";
        return `${root}-${match[1]}-${multiplier}${match[2]}`;
      }
    }
    return name;
  }

  function findParent(name) {
    for (const root of ROOT_NAMES) {
      const candidates = [
        { token: `cyklo${root}`, cyclic: true },
        { token: root, cyclic: false }
      ];

      for (const candidate of candidates) {
        const index = name.lastIndexOf(candidate.token);
        if (index < 0) continue;
        const tail = name.slice(index + candidate.token.length);
        const carbonCount = ROOTS[root];
        if (candidate.cyclic && carbonCount < 3) continue;
        const parsedTail = parseTail(tail, carbonCount, candidate.cyclic);
        if (!parsedTail) continue;

        return {
          prefixText: name.slice(0, index).replace(/-$/, ""),
          root,
          carbonCount,
          cyclic: candidate.cyclic,
          ...parsedTail
        };
      }
    }
    return null;
  }

  function parsePrefixGroups(prefixText, carbonCount) {
    if (!prefixText) return [];

    const groups = [];
    let remaining = prefixText.replace(/^-|-$/g, "");
    const withLocants = /^(\d+(?:,\d+)*)-(di|tri|tetra)?(fluoro|chloro|bromo|jodo|metylo|etylo|propylo|butylo)(?:-|$)/;
    const withoutLocants = /^(di|tri|tetra)?(fluoro|chloro|bromo|jodo|metylo|etylo|propylo|butylo)(?:-|$)/;

    while (remaining) {
      let match = remaining.match(withLocants);
      let locants;
      let multiplier;
      let name;

      if (match) {
        locants = locantsFrom(match[1]);
        multiplier = match[2] || "";
        name = match[3];
      } else {
        match = remaining.match(withoutLocants);
        if (!match) {
          throw new ChemistryError(
            `Nie rozumiem fragmentu „${remaining}”.`,
            "Przykład zapisu: 3-etylo-2-metylopentan."
          );
        }
        multiplier = match[1] || "";
        name = match[2];
        const count = MULTIPLIERS[multiplier];
        locants = Array.from({ length: count }, () => 1);
      }

      const expected = MULTIPLIERS[multiplier];
      if (locants.length !== expected) {
        const expectedWord = expected === 2 ? "di" : expected === 3 ? "tri" : expected === 4 ? "tetra" : "pojedynczy";
        throw new ChemistryError(
          `Liczba pozycji (${locants.length}) nie pasuje do członu „${multiplier || "pojedynczego"}${name}”.`,
          `Dla „${expectedWord}” podaj ${expected} pozycje.`
        );
      }

      validateLocants(locants, carbonCount, name);
      groups.push({ name, locants, substituent: SUBSTITUENTS[name] });
      remaining = remaining.slice(match[0].length);
    }

    return groups;
  }

  function multiplierFor(count) {
    return count === 2 ? "di" : count === 3 ? "tri" : count === 4 ? "tetra" : "";
  }

  function parentDisplayName(parsed) {
    const base = `${parsed.cyclic ? "cyklo" : ""}${parsed.root}`;

    if (parsed.aldehyde) {
      return `${base}anal`;
    }

    if (parsed.carbonyl.length) {
      return `${base}an-${parsed.carbonyl.join(",")}-on`;
    }

    if (parsed.amino && parsed.amino.length) {
      return `${base}an-${parsed.amino.join(",")}-amina`;
    }

    if (parsed.multipleBonds.length) {
      const positions = parsed.multipleBonds.map((bond) => bond.position);
      const suffix = parsed.saturation === "alkene" ? "en" : "yn";
      return `${base}-${positions.join(",")}-${multiplierFor(positions.length)}${suffix}`;
    }

    if (parsed.hydroxy.length) {
      return `${base}an-${parsed.hydroxy.join(",")}-${multiplierFor(parsed.hydroxy.length)}ol`;
    }

    return `${base}an`;
  }

  function familyName(parsed) {
    if (parsed.aldehyde) return "aldehyd";
    if (parsed.carbonyl.length) return "keton";
    if (parsed.amino && parsed.amino.length) return "amina";
    if (parsed.hydroxy.length) return parsed.hydroxy.length > 1 ? "polialkohol" : "alkohol";
    if (parsed.multipleBonds.length) return parsed.saturation === "alkene" ? "alken" : "alkin";
    if (parsed.cyclic) return "cykloalkan";
    return "alkan";
  }

  function buildGeneric(name) {
    const preparedName = preprocessNaturalName(name);
    const parsed = findParent(preparedName);

    if (!parsed) {
      throw new ChemistryError(
        `Nie potrafię jeszcze zbudować związku „${name}”.`,
        "Spróbuj np. „fenol”, „2-chloroetan”, „propan-2-ol” albo „2,3-dimetylobutan”."
      );
    }

    const prefixGroups = parsePrefixGroups(parsed.prefixText, parsed.carbonCount);
    const builder = new MoleculeBuilder();
    const parentAtoms = buildCarbonParent(builder, parsed.carbonCount, parsed);
    const branchCounter = new Map();

    prefixGroups.forEach((group) => {
      group.locants.forEach((locant) => {
        const parentIndex = locant - 1;
        const count = branchCounter.get(parentIndex) || 0;
        addSubstituent(builder, parentAtoms, parentIndex, group.substituent, count);
        branchCounter.set(parentIndex, count + 1);
      });
    });

    parsed.hydroxy.forEach((locant) => {
      const parentIndex = locant - 1;
      const count = branchCounter.get(parentIndex) || 0;
      addHydroxyGroup(builder, parentAtoms, parentIndex, count);
      branchCounter.set(parentIndex, count + 1);
    });

    parsed.carbonyl.forEach((locant) => addCarbonyl(builder, parentAtoms, locant - 1));
    (parsed.amino || []).forEach((locant) => {
      const parentIndex = locant - 1;
      const count = branchCounter.get(parentIndex) || 0;
      addAminoGroup(builder, parentAtoms, parentIndex, count);
      branchCounter.set(parentIndex, count + 1);
    });

    builder.addHydrogens();

    const prefixDisplay = prefixGroups
      .map((group) => `${group.locants.join(",")}-${multiplierFor(group.locants.length)}${group.name}`)
      .join("-");
    const displayName = `${prefixDisplay}${prefixDisplay ? "" : ""}${parentDisplayName(parsed)}`;

    return builder.result({
      inputName: name,
      displayName,
      family: familyName(parsed),
      parser: "systematic"
    });
  }

  function buildAromatic(displayName, family, substituent) {
    const builder = new MoleculeBuilder();
    const carbons = buildCarbonParent(builder, 6, {
      cyclic: true,
      multipleBonds: [
        { position: 1, order: 2 },
        { position: 3, order: 2 },
        { position: 5, order: 2 }
      ]
    });

    if (substituent === "hydroxy") {
      addHydroxyGroup(builder, carbons, 0, 0);
    } else if (substituent === "methyl") {
      addSubstituent(builder, carbons, 0, SUBSTITUENTS.metylo, 0);
    } else if (substituent === "amino") {
      const direction = outwardDirection(carbons, 0, 0);
      const nitrogen = builder.addAtom(
        "N",
        add(carbons[0].position, scale(direction, 1.28)),
        "functional"
      );
      builder.addBond(carbons[0], nitrogen, 1);
    }

    builder.addHydrogens();
    return builder.result({
      inputName: displayName,
      displayName,
      family,
      parser: "common"
    });
  }

  function buildSubstitutedBenzene(name) {
    const prefixText = name.slice(0, -"benzen".length).replace(/-$/, "");
    if (!prefixText) return buildAromatic("benzen", "węglowodór aromatyczny");

    const prefixGroups = parsePrefixGroups(prefixText, 6);
    const builder = new MoleculeBuilder();
    const carbons = buildCarbonParent(builder, 6, {
      cyclic: true,
      multipleBonds: [
        { position: 1, order: 2 },
        { position: 3, order: 2 },
        { position: 5, order: 2 }
      ]
    });
    const branchCounter = new Map();

    prefixGroups.forEach((group) => {
      group.locants.forEach((locant) => {
        const parentIndex = locant - 1;
        const count = branchCounter.get(parentIndex) || 0;
        addSubstituent(builder, carbons, parentIndex, group.substituent, count);
        branchCounter.set(parentIndex, count + 1);
      });
    });

    builder.addHydrogens();
    const prefixDisplay = prefixGroups
      .map((group) => `${group.locants.join(",")}-${multiplierFor(group.locants.length)}${group.name}`)
      .join("-");

    return builder.result({
      inputName: name,
      displayName: `${prefixDisplay}benzen`,
      family: "pochodna benzenu",
      parser: "aromatic"
    });
  }

  function buildAcetone(inputName) {
    const builder = new MoleculeBuilder();
    const carbons = buildCarbonParent(builder, 3, { cyclic: false, multipleBonds: [] });
    addCarbonyl(builder, carbons, 1);
    builder.addHydrogens();
    return builder.result({
      inputName,
      displayName: "aceton (propan-2-on)",
      family: "keton",
      parser: "common"
    });
  }

  function buildAceticAcid(inputName) {
    const builder = new MoleculeBuilder();
    const carbons = buildCarbonParent(builder, 2, { cyclic: false, multipleBonds: [] });
    const carbonylDirection = vector(0.15, 0.78, 0.62);
    const hydroxylDirection = vector(0.15, -0.78, -0.48);
    const oxygenDouble = builder.addAtom(
      "O",
      add(carbons[1].position, scale(normalizeVector(carbonylDirection), 1.2)),
      "functional"
    );
    const oxygenHydroxy = builder.addAtom(
      "O",
      add(carbons[1].position, scale(normalizeVector(hydroxylDirection), 1.28)),
      "functional"
    );
    builder.addBond(carbons[1], oxygenDouble, 2);
    builder.addBond(carbons[1], oxygenHydroxy, 1);
    builder.addHydrogens();
    return builder.result({
      inputName,
      displayName: "kwas octowy (kwas etanowy)",
      family: "kwas karboksylowy",
      parser: "common"
    });
  }

  function buildCarboxylicAcid(inputName) {
    const body = inputName.slice("kwas ".length);
    let parsed = null;

    for (const root of ROOT_NAMES) {
      const token = `${root}anowy`;
      const index = body.lastIndexOf(token);
      if (index < 0 || index + token.length !== body.length) continue;
      parsed = {
        root,
        carbonCount: ROOTS[root],
        prefixText: body.slice(0, index).replace(/-$/, "")
      };
      break;
    }

    if (!parsed) {
      throw new ChemistryError(
        `Nie rozumiem nazwy kwasu „${inputName}”.`,
        "Spróbuj np. „kwas propanowy” albo „kwas 2-metylopropanowy”."
      );
    }

    const prefixGroups = parsePrefixGroups(parsed.prefixText, parsed.carbonCount);
    const builder = new MoleculeBuilder();
    const parentAtoms = buildCarbonParent(builder, parsed.carbonCount, {
      cyclic: false,
      multipleBonds: []
    });
    const branchCounter = new Map();

    prefixGroups.forEach((group) => {
      group.locants.forEach((locant) => {
        const parentIndex = locant - 1;
        const count = branchCounter.get(parentIndex) || 0;
        addSubstituent(builder, parentAtoms, parentIndex, group.substituent, count);
        branchCounter.set(parentIndex, count + 1);
      });
    });

    addCarboxylGroup(builder, parentAtoms[0], parentAtoms);
    builder.addHydrogens();

    const prefixDisplay = prefixGroups
      .map((group) => `${group.locants.join(",")}-${multiplierFor(group.locants.length)}${group.name}`)
      .join("-");

    return builder.result({
      inputName,
      displayName: `kwas ${prefixDisplay}${parsed.root}anowy`,
      family: "kwas karboksylowy",
      parser: "carboxylic-acid"
    });
  }

  function buildEster(inputName, acidCarbons, alkylCarbons, displayName) {
    const builder = new MoleculeBuilder();
    const acidChain = buildCarbonParent(builder, acidCarbons, {
      cyclic: false,
      multipleBonds: []
    });
    const { oxygenHydroxy } = addCarboxylGroup(builder, acidChain[0], acidChain);
    const away = normalizeVector(subtract(oxygenHydroxy.position, acidChain[0].position));

    let previous = oxygenHydroxy;
    let position = oxygenHydroxy.position;
    let direction = away;
    for (let index = 0; index < alkylCarbons; index += 1) {
      position = add(position, scale(direction, 1.36));
      const carbon = builder.addAtom("C", position, "ester-alkyl");
      builder.addBond(previous, carbon, 1);
      previous = carbon;
      direction = normalizeVector(
        add(direction, vector(0, index % 2 ? -0.28 : 0.28, index % 2 ? 0.22 : -0.22))
      );
    }

    builder.addHydrogens();
    return builder.result({
      inputName,
      displayName,
      family: "ester",
      parser: "ester"
    });
  }

  function parseEster(inputName) {
    const commonAcids = {
      mrówczan: { carbons: 1, systematic: "metanian" },
      octan: { carbons: 2, systematic: "etanian" }
    };
    const alkylNames = {
      metylu: 1,
      etylu: 2,
      propylu: 3,
      butylu: 4
    };
    const parts = inputName.split(" ");
    if (parts.length !== 2 || !alkylNames[parts[1]]) return null;

    let acidCarbons;
    let acidDisplay = parts[0];
    if (commonAcids[parts[0]]) {
      acidCarbons = commonAcids[parts[0]].carbons;
      acidDisplay = commonAcids[parts[0]].systematic;
    } else {
      for (const root of ROOT_NAMES) {
        if (parts[0] === `${root}anian`) {
          acidCarbons = ROOTS[root];
          break;
        }
      }
    }
    if (!acidCarbons) return null;

    return buildEster(
      inputName,
      acidCarbons,
      alkylNames[parts[1]],
      `${acidDisplay} ${parts[1]}`
    );
  }

  function buildAminoAcid(inputName, kind) {
    const builder = new MoleculeBuilder();
    const alpha = builder.addAtom("C", vector(-0.45, 0, 0), "alpha-carbon");
    const carboxyl = builder.addAtom("C", vector(0.95, 0.08, 0), "carboxyl");
    const nitrogen = builder.addAtom("N", vector(-1.25, 0.95, 0.25), "amino");
    const oxygenDouble = builder.addAtom("O", vector(1.76, 0.92, 0.12), "functional");
    const oxygenHydroxy = builder.addAtom("O", vector(1.72, -0.88, -0.12), "functional");

    builder.addBond(alpha, carboxyl, 1);
    builder.addBond(alpha, nitrogen, 1);
    builder.addBond(carboxyl, oxygenDouble, 2);
    builder.addBond(carboxyl, oxygenHydroxy, 1);

    if (kind === "alanine") {
      const methyl = builder.addAtom("C", vector(-1.05, -1.2, -0.42), "side-chain");
      builder.addBond(alpha, methyl, 1);
    }

    builder.addHydrogens();
    return builder.result({
      inputName,
      displayName: kind === "alanine"
        ? "alanina (kwas 2-aminopropanowy)"
        : "glicyna (kwas aminoetanowy)",
      family: "aminokwas",
      parser: "amino-acid"
    });
  }

  function buildCommonAmine(inputName, carbonCount) {
    const root = Object.keys(ROOTS).find((name) => ROOTS[name] === carbonCount);
    const model = buildGeneric(`${root}anamina`);
    model.inputName = inputName;
    model.displayName = inputName;
    return model;
  }

  function neighborRecords(model, atomId, excludedId) {
    return model.bonds
      .filter((bond) => bond.a === atomId || bond.b === atomId)
      .map((bond) => ({
        bond,
        atom: model.atoms[bond.a === atomId ? bond.b : bond.a]
      }))
      .filter((record) => record.atom.id !== excludedId);
  }

  function branchSignature(model, atomId, blockedIds, visited = new Set()) {
    const atom = model.atoms[atomId];
    if (!atom) return "";
    visited.add(atomId);
    const childSignatures = neighborRecords(model, atomId, -1)
      .filter((record) => !blockedIds.has(record.atom.id) && !visited.has(record.atom.id))
      .map((record) => `${record.bond.order}${branchSignature(model, record.atom.id, blockedIds, new Set(visited))}`)
      .sort();
    return `${atom.element}[${childSignatures.join("|")}]`;
  }

  function moveBranch(model, rootId, blockedIds, target) {
    const root = model.atoms[rootId];
    const delta = subtract(target, root.position);
    const queue = [rootId];
    const visited = new Set(blockedIds);

    while (queue.length) {
      const atomId = queue.shift();
      if (visited.has(atomId)) continue;
      visited.add(atomId);
      const atom = model.atoms[atomId];
      atom.position = add(atom.position, delta);
      neighborRecords(model, atomId, -1).forEach((record) => {
        if (!visited.has(record.atom.id)) queue.push(record.atom.id);
      });
    }
  }

  function applyCisTransGeometry(model, descriptor) {
    const doubleBonds = model.bonds.filter((bond) => {
      return bond.order === 2 &&
        model.atoms[bond.a].element === "C" &&
        model.atoms[bond.b].element === "C";
    });

    if (doubleBonds.length !== 1 || model.family === "cykloalkan") {
      throw new ChemistryError(
        `Deskryptor „${descriptor}” wymaga jednego odpowiedniego wiązania C=C.`,
        "Na początek użyj np. „cis-but-2-en” albo „trans-1,2-dichloroeten”."
      );
    }

    const doubleBond = doubleBonds[0];
    const leftGroups = neighborRecords(model, doubleBond.a, doubleBond.b);
    const rightGroups = neighborRecords(model, doubleBond.b, doubleBond.a);
    if (leftGroups.length !== 2 || rightGroups.length !== 2) {
      throw new ChemistryError("Nie można jednoznacznie wyznaczyć konfiguracji tego alkenu.");
    }

    const blocked = new Set([doubleBond.a, doubleBond.b]);
    const decorate = (record) => ({
      ...record,
      signature: branchSignature(model, record.atom.id, blocked)
    });
    const left = leftGroups.map(decorate);
    const right = rightGroups.map(decorate);

    if (left[0].signature === left[1].signature || right[0].signature === right[1].signature) {
      throw new ChemistryError(
        `Związek „${model.displayName}” nie wykazuje izomerii cis–trans.`,
        "Każdy atom węgla przy wiązaniu podwójnym musi mieć dwa różne podstawniki."
      );
    }

    let referencePair = null;
    for (const leftGroup of left) {
      for (const rightGroup of right) {
        if (leftGroup.signature === rightGroup.signature) {
          const candidate = { left: leftGroup, right: rightGroup };
          if (!referencePair || leftGroup.atom.element !== "H") referencePair = candidate;
        }
      }
    }
    if (!referencePair) {
      throw new ChemistryError(
        "Dla tego alkenu zapis cis/trans byłby niejednoznaczny.",
        "W takiej sytuacji stosuje się deskryptory E/Z."
      );
    }

    const leftAtom = model.atoms[doubleBond.a];
    const rightAtom = model.atoms[doubleBond.b];
    leftAtom.position = vector(-0.72, 0, 0);
    rightAtom.position = vector(0.72, 0, 0);
    const sameSide = descriptor === "cis";

    left.forEach((group) => {
      const reference = group.atom.id === referencePair.left.atom.id;
      const side = reference ? 1 : -1;
      moveBranch(
        model,
        group.atom.id,
        blocked,
        vector(-1.92, side * 1.02, reference ? 0.08 : -0.08)
      );
    });
    right.forEach((group) => {
      const reference = group.atom.id === referencePair.right.atom.id;
      const referenceSide = sameSide ? 1 : -1;
      const side = reference ? referenceSide : -referenceSide;
      moveBranch(
        model,
        group.atom.id,
        blocked,
        vector(1.92, side * 1.02, reference ? -0.08 : 0.08)
      );
    });

    model.stereochemistry = descriptor;
    model.displayName = `${descriptor}-${model.displayName}`;
    model.family = `${model.family} · izomer ${descriptor}`;
    return model;
  }

  function buildSmallInorganic(inputName, kind) {
    const builder = new MoleculeBuilder();

    if (kind === "water") {
      const oxygen = builder.addAtom("O", vector(0, 0, 0), "functional");
      const h1 = builder.addAtom("H", vector(-0.78, 0.62, 0), "hydrogen");
      const h2 = builder.addAtom("H", vector(0.78, 0.62, 0), "hydrogen");
      builder.addBond(oxygen, h1, 1).addBond(oxygen, h2, 1);
      return builder.result({
        inputName,
        displayName: "woda",
        family: "tlenek",
        parser: "common"
      });
    }

    if (kind === "ammonia") {
      const nitrogen = builder.addAtom("N", vector(0, 0, 0.18), "functional");
      [
        vector(-0.86, 0.42, -0.3),
        vector(0.86, 0.42, -0.3),
        vector(0, -0.92, -0.3)
      ].forEach((position) => {
        const hydrogen = builder.addAtom("H", position, "hydrogen");
        builder.addBond(nitrogen, hydrogen, 1);
      });
      return builder.result({
        inputName,
        displayName: "amoniak",
        family: "wodorek",
        parser: "common",
        formulaOverride: "NH3"
      });
    }

    const carbon = builder.addAtom("C", vector(0, 0, 0), "parent");
    const oxygen1 = builder.addAtom("O", vector(-1.2, 0, 0), "functional");
    const oxygen2 = builder.addAtom("O", vector(1.2, 0, 0), "functional");
    builder.addBond(carbon, oxygen1, 2).addBond(carbon, oxygen2, 2);
    return builder.result({
      inputName,
      displayName: "dwutlenek węgla",
      family: "tlenek",
      parser: "common"
    });
  }

  function parseMolecule(value) {
    const normalizedName = normalizeName(value);
    if (!normalizedName) {
      throw new ChemistryError(
        "Wpisz nazwę związku.",
        "Możesz zacząć od „fenol” albo wybrać przykład poniżej."
      );
    }

    let name = normalizedName;
    let stereoDescriptor = null;
    const stereoMatch = name.match(/^(cis|trans)-(.+)$/);
    if (stereoMatch) {
      stereoDescriptor = stereoMatch[1];
      name = stereoMatch[2];
    }

    const finish = (model) => {
      model.inputName = normalizedName;
      return stereoDescriptor ? applyCisTransGeometry(model, stereoDescriptor) : model;
    };

    if (name === "fenol" || name === "hydroksybenzen") {
      return finish(buildAromatic("fenol", "fenol", "hydroxy"));
    }
    if (name === "benzen") {
      return finish(buildAromatic("benzen", "węglowodór aromatyczny"));
    }
    if (name === "toluen" || name === "metylobenzen") {
      return finish(buildAromatic("toluen (metylobenzen)", "węglowodór aromatyczny", "methyl"));
    }
    if (name === "anilina" || name === "aminobenzen") {
      return finish(buildAromatic("anilina (aminobenzen)", "amina aromatyczna", "amino"));
    }
    if (name.endsWith("benzen")) {
      return finish(buildSubstitutedBenzene(name));
    }
    if (name === "aceton" || name === "propan-2-on" || name === "propanon") {
      return finish(buildAcetone(name));
    }
    if (name === "kwas octowy" || name === "kwas etanowy") {
      return finish(buildAceticAcid(name));
    }
    if (name === "kwas mrówkowy") {
      const acid = buildCarboxylicAcid("kwas metanowy");
      acid.displayName = "kwas mrówkowy (kwas metanowy)";
      return finish(acid);
    }
    if (name === "glicyna" || name === "kwas aminoetanowy") {
      return finish(buildAminoAcid(name, "glycine"));
    }
    if (name === "alanina" || name === "kwas 2-aminopropanowy") {
      return finish(buildAminoAcid(name, "alanine"));
    }
    if (name.startsWith("kwas ") && name.endsWith("anowy")) {
      return finish(buildCarboxylicAcid(name));
    }

    const ester = parseEster(name);
    if (ester) return finish(ester);

    const commonAmines = {
      metyloamina: 1,
      etyloamina: 2,
      propyloamina: 3,
      butyloamina: 4
    };
    if (commonAmines[name]) {
      return finish(buildCommonAmine(name, commonAmines[name]));
    }
    if (name === "woda") {
      return finish(buildSmallInorganic(name, "water"));
    }
    if (name === "amoniak") {
      return finish(buildSmallInorganic(name, "ammonia"));
    }
    if (name === "dwutlenek węgla" || name === "ditlenek węgla") {
      return finish(buildSmallInorganic(name, "carbonDioxide"));
    }

    return finish(buildGeneric(name));
  }

  const api = Object.freeze({
    ELEMENTS,
    ChemistryError,
    normalizeName,
    parseMolecule
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.AtonomChem = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
