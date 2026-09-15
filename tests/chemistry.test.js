"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ChemistryError,
  ELEMENTS,
  normalizeName,
  parseMolecule
} = require("../public/members/module/atonom/chemistry.js");

const expectedFormulas = {
  fenol: "C6H6O",
  etanol: "C2H6O",
  "propan-2-ol": "C3H8O",
  metanal: "CH2O",
  etanal: "C2H4O",
  "2-metylopropanal": "C4H8O",
  "butan-2-on": "C4H8O",
  "kwas metanowy": "CH2O2",
  "kwas propanowy": "C3H6O2",
  "kwas 2-metylopropanowy": "C4H8O2",
  "etanian etylu": "C4H8O2",
  "metanian metylu": "C2H4O2",
  etyloamina: "C2H7N",
  "propan-2-amina": "C3H9N",
  glicyna: "C2H5NO2",
  alanina: "C3H7NO2",
  "2-chloroetan": "C2H5Cl",
  "2,2-dichloroetan": "C2H4Cl2",
  "2,2-dichloropropanol": "C3H6Cl2O",
  "1,2-dibromoetan": "C2H4Br2",
  "but-2-en": "C4H8",
  "cis-but-2-en": "C4H8",
  "trans-but-2-en": "C4H8",
  "cis-1,2-dichloroeten": "C2H2Cl2",
  "trans-1,2-dichloroeten": "C2H2Cl2",
  "pent-1-yn": "C5H8",
  "2-metylopropan": "C4H10",
  "2,3-dimetylobutan": "C6H14",
  "3-etylo-2-metylopentan": "C8H18",
  cykloheksan: "C6H12",
  "1-chloro-2-fluorobenzen": "C6H4ClF",
  "1,4-dichlorobenzen": "C6H4Cl2",
  etylobenzen: "C8H10",
  toluen: "C7H8",
  anilina: "C6H7N",
  aceton: "C3H6O",
  "kwas octowy": "C2H4O2",
  amoniak: "NH3",
  "dwutlenek węgla": "CO2"
};

test("buduje poprawne wzory sumaryczne dla obsługiwanych polskich nazw", () => {
  Object.entries(expectedFormulas).forEach(([name, formula]) => {
    assert.equal(parseMolecule(name).formula, formula, name);
  });
});

test("akceptuje naturalne warianty zapisu alkoholi i alkenów", () => {
  assert.equal(parseMolecule("2-propanol").formula, "C3H8O");
  assert.equal(parseMolecule("2-buten").formula, "C4H8");
  assert.equal(parseMolecule("PROPANOL").displayName, "propan-1-ol");
});

test("normalizuje spacje, przecinki i różne znaki łącznika", () => {
  assert.equal(
    normalizeName("  2, 2 – dichloropropanol  "),
    "2,2-dichloropropanol"
  );
});

test("każdy wygenerowany atom mieści się w dozwolonej wartościowości", () => {
  Object.keys(expectedFormulas).forEach((name) => {
    const model = parseMolecule(name);
    model.atoms.forEach((atom) => {
      const usedValence = model.bonds.reduce((sum, bond) => {
        return sum + (bond.a === atom.id || bond.b === atom.id ? bond.order : 0);
      }, 0);
      assert.ok(
        usedValence <= ELEMENTS[atom.element].valence,
        `${name}: ${atom.element}${atom.id} ma wartościowość ${usedValence}`
      );
    });
  });
});

test("zgłasza czytelny błąd dla lokantu poza łańcuchem", () => {
  assert.throws(
    () => parseMolecule("7-chloropropan"),
    (error) => error instanceof ChemistryError && /Pozycja 7/.test(error.message)
  );
});

test("zgłasza czytelny błąd dla nieobsługiwanej nazwy", () => {
  assert.throws(
    () => parseMolecule("coś całkiem niechemicznego"),
    (error) => error instanceof ChemistryError && /Nie potrafię/.test(error.message)
  );
});

test("podaje spójną liczbę atomów, wiązań i masę molową", () => {
  const ethanol = parseMolecule("etanol");
  assert.equal(ethanol.atomCount, 9);
  assert.equal(ethanol.bondCount, 8);
  assert.ok(Math.abs(ethanol.molarMass - 46.069) < 0.01);
});

test("układa wspólne podstawniki po właściwej stronie wiązania dla cis i trans", () => {
  function referenceYCoordinates(model) {
    const doubleBond = model.bonds.find((bond) => bond.order === 2);
    return [doubleBond.a, doubleBond.b].map((carbonId) => {
      const reference = model.bonds
        .filter((bond) => bond.a === carbonId || bond.b === carbonId)
        .map((bond) => model.atoms[bond.a === carbonId ? bond.b : bond.a])
        .find((atom) => atom.id !== doubleBond.a && atom.id !== doubleBond.b && atom.element === "C");
      return reference.position.y;
    });
  }

  const cisY = referenceYCoordinates(parseMolecule("cis-but-2-en"));
  const transY = referenceYCoordinates(parseMolecule("trans-but-2-en"));
  assert.ok(cisY[0] * cisY[1] > 0, "podstawniki cis powinny być po tej samej stronie");
  assert.ok(transY[0] * transY[1] < 0, "podstawniki trans powinny być po przeciwnych stronach");
});

test("odrzuca cis/trans dla alkenu bez dwóch różnych podstawników przy każdym C=C", () => {
  assert.throws(
    () => parseMolecule("cis-but-1-en"),
    (error) => error instanceof ChemistryError && /nie wykazuje izomerii cis–trans/.test(error.message)
  );
});
