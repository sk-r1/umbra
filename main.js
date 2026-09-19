// Umbra — Decorrelation Stretch plugin for Adobe Photoshop (UXP)
// Copyright (C) 2026 Sönke Kastner. Developed with the assistance of
// Claude (Anthropic).
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

// Umbra — Decorrelation Stretch Plugin für Adobe Photoshop (UXP)
//
// Zwei Methoden:
//
// A) "Lab a/b" (bisherige Methode)
//    Ebene duplizieren -> Dokument nach Lab konvertieren -> 2x2-Stretch
//    nur auf a*/b*. L* bleibt exakt unverändert.
//
// B) "YRE / LRE" (neu, an DStretch für ImageJ angelehnt)
//    Ebene duplizieren -> Dokument bleibt in RGB -> pro Pixel intern nach
//    YUV bzw. Lab konvertieren -> Kanäle mit Multiplikatoren skalieren
//    ("modifizierter Farbraum") -> volle 3x3-Decorrelation-Stretch ->
//    Skalierung rückgängig -> zurück nach RGB.
//
//    Hintergrund: Laut Jon Harmans Algorithmus-Beschreibung sind YDS,
//    YBR, YBK, LDS, LRE keine eigenen Farbräume, sondern Modifikationen
//    von YUV bzw. LAB. Genau dieses Prinzip bildet Methode B nach.
//
//    WICHTIG: Die konkreten Multiplikatoren, die Harman für YRE/LRE
//    verwendet, sind nicht veröffentlicht — die Werte unten sind meine
//    plausiblen Startwerte, keine Originalwerte. Sie sind deshalb im UI
//    frei editierbar (entspricht Harmans YXX/LXX-Modus).

const photoshop = require("photoshop");
const { app, core, imaging, action } = photoshop;
const uxp = require("uxp");
const uxpFs = uxp.storage.localFileSystem;
const uxpFormats = uxp.storage.formats;
const entrypoints = uxp.entrypoints;
const shell = uxp.shell;

// Muss mit manifest.json "id" und dem entrypoints[0].id übereinstimmen —
// wird für das Flyout-Menü (entrypoints.setup()) gebraucht, um den Panel
// später per entrypoints.getPanel() wiederzufinden.
const UMBRA_PANEL_ID = "umbraPanel";

const REPO_URL = "https://github.com/sk-r1/umbra";
const MANUAL_URL_DE = "https://github.com/sk-r1/umbra/blob/main/README.md";
const MANUAL_URL_EN = "https://github.com/sk-r1/umbra/blob/main/README.en.md";

// Fallback-Versionsnummer für den Fall, dass entrypoints.plugin.create()
// nicht wie erwartet feuert (z. B. weil das Panel klassisch über
// index.html+Script statt über die entrypoints-Lifecycle geladen wird —
// siehe Kommentar bei entrypoints.setup() weiter unten). Wird normalerweise
// sofort durch die echte Version aus UxpPluginInfo überschrieben (siehe
// refreshVersionMenuLabel()). MUSS bei einem Versionssprung von Hand mit
// manifest.json "version" synchron gehalten werden, falls der
// Automatismus aus irgendeinem Grund nicht greift.
const FALLBACK_VERSION = "1.2.0";
let pluginVersion = FALLBACK_VERSION;

// Diagnose-Ausgaben (min/max der Rohkanäle) in die DevTools-Konsole.
// Bewusst standardmäßig AUS: die Diagnose macht einen kompletten
// zusätzlichen Durchlauf über alle Pixel und baut große Log-Strings —
// überflüssige Arbeit auf dem ohnehin langsamen Rechenpfad, die kein
// Endnutzer sieht. Zum Debuggen einer echten 8-/16-Bit-Datei hier auf
// true setzen.
const DEBUG = false;

// ---------------------------------------------------------------------
// Mehrsprachigkeit (EN/DE)
//
// Bewusst zwei Buttons statt eines <select>-Dropdowns — ein natives
// <select> hatte in einer früheren Version das komplette Panel lahmgelegt
// (getElementById lieferte null, alles danach wurde nie ausgeführt).
//
// Sprachwahl wird im plugin-eigenen UXP-Datenordner gespeichert
// (dieselbe Speicher-Art wie zuvor schon für Presets verwendet — Teil
// der UXP-Basisplattform, nicht Photoshop-spezifisch geraten). Standard
// beim allerersten Start: Englisch.
//
// Konsolen-Ausgaben (console.log/console.warn) bleiben bewusst
// unübersetzt Deutsch — die sind für Debugging gedacht, nicht für
// Endnutzer der Oberfläche.
// ---------------------------------------------------------------------

const I18N = {
  en: {
    sigmaLabel: "Target contrast (Sigma):",
    preserveMean: "Preserve original mean",
    methodATitle: "Method A — Lab a/b",
    applyBtn: "Apply Lab a/b",
    keepLabText: "Keep result in Lab mode (for channel editing)",
    methodAHint:
      "Converts the document to Lab mode and stretches only a* and b*. Lightness L* is preserved exactly. Normally the document is converted back to RGB afterwards; tick \"Keep result in Lab mode\" to leave it in Lab so you can edit the a*/b*/L channels directly — Method B then needs a manual convert back to RGB first.",
    methodBTitle: "Method B — YRE / LRE",
    // Bewusst gekürzt ("LRE only" statt "only relevant for LRE"): der lange
    // Text (gemessen ~297px) übersteigt die verfügbare Checkbox-Breite
    // (~277px bei 325px-Panel) und brach als einzige Beschriftung auf zwei
    // Zeilen um. Das machte den Method-B-Block höher als im Deutschen und
    // schob das gesamte restliche Layout nach unten (weniger Rand-Abstand
    // unten). Die Kurzform (~238px) passt wie die deutsche in eine Zeile.
    adobeRgbText: "Adobe RGB (1998) instead of sRGB — LRE only",
    yreMultLabel: "Channel multipliers YRE (Y / U / V)",
    lreMultLabel: "Channel multipliers LRE (L / a / b)",
    savePreset: "Save preset…",
    loadPreset: "Load preset…",
    loadedPreset: "Loaded preset:",
    none: "-",
    resetMults: "Reset multipliers",
    applyYreBtn: "Apply YRE (YUV)",
    applyLreBtn: "Apply LRE (Lab)",
    methodBHint:
      "Document stays in RGB. Full 3&times;3 transform in the modified YUV or Lab color space, with red emphasis.<br /><br />Keep Sigma fairly low here (roughly 15&ndash;30): DStretch uses 15 as its default scale. At Sigma 60, many pixels fall outside the value range and get clipped.<br /><br />The ⬆/⬇ buttons next to the multiplier fields save or load a preset (multipliers, Sigma, color profile) as a file.",
    currentlyUsed: "Currently used:",
    profileLreOnly: "Profile (LRE only):",
    invalidNote: "* invalid — using default value",
    statusComputing: "Computing...",
    statusDone: "Done.",
    statusErrorPrefix: "Error: ",
    statusReady: "Ready.",
    statusInitErrorPrefix: "Init error: ",
    statusDuplicating: "Duplicating layer...",
    statusSwitchLab: "Switching color mode to Lab...",
    statusComputingLabAB: "Computing decorrelation stretch (a/b)...",
    statusComputingSpace: (space, sigma, multTxt, profileName) =>
      `Computing ${space} (Sigma ${sigma}, ${multTxt}, profile: ${profileName})...`,
    errNoDocument: "No active document.",
    errNoLayer: "No layer found in the document.",
    errInvalidPresetFile: "File does not contain a valid preset.",
    presetSaved: (name, space) => `Preset "${name}" (${space}) saved.`,
    presetLoaded: (name, space) => `Preset "${name}" (${space}) loaded.`,
    presetSpaceMismatch: (name, fileSpace, targetSpace) =>
      `Note: preset "${name}" was saved for ${fileSpace} but loaded into ${targetSpace} — the channels mean different things there.`,
    presetSaveErrorPrefix: "Error while saving: ",
    presetLoadErrorPrefix: "Error while loading: ",
    sigmaWarning:
      "⚠ High Sigma values (>60) can push many pixels out of range and clip them, especially for Method B.",
    saturationLabel: "Saturation (after stretch):",
    colorBalanceText: "Color balance before stretch (CB)",
    grayscaleText: "Grayscale (convert enhancement to brightness only)",
    statusColorBalance: "Applying color balance (CB)...",
    featherLabelText: "Feather radius (px, if selection active):",
    featherHint:
      "Only applies when a selection is active. Statistics are computed from the selection's content only; the result is masked back onto the layer with the chosen feather.",
    statusSelectionWeights: "Computing weights from selection...",
    statusApplyingMask: "Applying selection as layer mask...",
    statusSwitchRgb: "Converting document back to RGB...",
    errNotRgb:
      "This method needs the document in RGB mode. Please convert it (Image → Mode → RGB Color) and try again.",
    menuReload: "Reload Plugin",
    menuManual: "User Manual",
    menuRepo: "GitHub Repository",
    menuToRgb: "Convert document to RGB",
  },
  de: {
    sigmaLabel: "Ziel-Kontrast (Sigma):",
    preserveMean: "Original-Mittelwert beibehalten",
    methodATitle: "Methode A — Lab a/b",
    applyBtn: "Lab a/b anwenden",
    keepLabText: "Ergebnis in Lab belassen (für Kanal-Bearbeitung)",
    methodAHint:
      "Wandelt das Dokument in den Lab-Modus und streckt nur a* und b*. Die Helligkeit L* bleibt exakt erhalten. Normalerweise wird danach zurück nach RGB gewandelt; mit \"Ergebnis in Lab belassen\" bleibt es in Lab, sodass die a*/b*/L-Kanäle direkt bearbeitbar sind — Methode B braucht dann vorher eine manuelle Rückwandlung nach RGB.",
    methodBTitle: "Methode B — YRE / LRE",
    adobeRgbText: "Adobe RGB (1998) statt sRGB — nur für LRE relevant",
    yreMultLabel: "Kanal-Multiplikatoren YRE (Y / U / V)",
    lreMultLabel: "Kanal-Multiplikatoren LRE (L / a / b)",
    savePreset: "Preset speichern…",
    loadPreset: "Preset laden…",
    loadedPreset: "Geladenes Preset:",
    none: "-",
    resetMults: "Multiplikatoren zurücksetzen",
    applyYreBtn: "YRE anwenden (YUV)",
    applyLreBtn: "LRE anwenden (Lab)",
    methodBHint:
      "Dokument bleibt in RGB. Volle 3&times;3-Transformation im modifizierten YUV- bzw. Lab-Farbraum, mit Rot-Betonung.<br /><br />Sigma hier eher niedrig lassen (ca. 15&ndash;30): DStretch nutzt als Standard-Skala 15. Bei Sigma 60 laufen viele Pixel aus dem Wertebereich und werden abgeschnitten.<br /><br />Die ⬆/⬇-Schaltflächen neben den Multiplikator-Feldern speichern bzw. laden ein Preset (Multiplikatoren, Sigma, Farbprofil) als Datei.",
    currentlyUsed: "Aktuell verwendet:",
    profileLreOnly: "Profil (nur LRE):",
    invalidNote: "* ungültig — Standardwert wird benutzt",
    statusComputing: "Berechne...",
    statusDone: "Fertig.",
    statusErrorPrefix: "Fehler: ",
    statusReady: "Bereit.",
    statusInitErrorPrefix: "Init-Fehler: ",
    statusDuplicating: "Dupliziere Ebene...",
    statusSwitchLab: "Wechsle Farbmodus zu Lab...",
    statusComputingLabAB: "Berechne Decorrelation Stretch (a/b)...",
    statusComputingSpace: (space, sigma, multTxt, profileName) =>
      `Berechne ${space} (Sigma ${sigma}, ${multTxt}, Profil: ${profileName})...`,
    errNoDocument: "Kein aktives Dokument.",
    errNoLayer: "Keine Ebene im Dokument gefunden.",
    errInvalidPresetFile: "Datei enthält kein gültiges Preset.",
    presetSaved: (name, space) => `Preset "${name}" (${space}) gespeichert.`,
    presetLoaded: (name, space) => `Preset "${name}" (${space}) geladen.`,
    presetSpaceMismatch: (name, fileSpace, targetSpace) =>
      `Achtung: Preset "${name}" wurde für ${fileSpace} gespeichert, aber in ${targetSpace} geladen — die Kanäle bedeuten dort etwas anderes.`,
    presetSaveErrorPrefix: "Fehler beim Speichern: ",
    presetLoadErrorPrefix: "Fehler beim Laden: ",
    sigmaWarning:
      "⚠ Hohe Sigma-Werte (>60) treiben viele Pixel aus dem Wertebereich und schneiden sie ab, besonders bei Methode B.",
    saturationLabel: "Sättigung (nach Stretch):",
    colorBalanceText: "Farbausgleich vor Stretch (CB)",
    grayscaleText: "Graustufen (Anreicherung als reine Helligkeit)",
    statusColorBalance: "Wende Farbausgleich an (CB)...",
    featherLabelText: "Federradius (px, wenn Auswahl aktiv):",
    featherHint:
      "Wirkt nur, wenn eine Auswahl aktiv ist. Die Statistik wird nur aus dem Inhalt der Auswahl berechnet; das Ergebnis wird mit der gewählten Federung als Maske zurück auf die Ebene angewendet.",
    statusSelectionWeights: "Berechne Gewichte aus der Auswahl...",
    statusApplyingMask: "Wende Auswahl als Ebenenmaske an...",
    statusSwitchRgb: "Wandle Dokument zurück nach RGB...",
    errNotRgb:
      "Diese Methode benötigt das Dokument im RGB-Modus. Bitte umwandeln (Bild → Modus → RGB-Farbe) und erneut versuchen.",
    menuReload: "Plugin neu laden",
    menuManual: "Anleitung",
    menuRepo: "GitHub-Repository",
    menuToRgb: "Dokument nach RGB wandeln",
  },
};

let currentLang = "en";

function t(key, ...args) {
  const entry = I18N[currentLang][key];
  return typeof entry === "function" ? entry(...args) : entry;
}

const LANG_SETTINGS_FILE = "umbra-settings.json";

async function loadLangSetting() {
  try {
    const dataFolder = await uxpFs.getDataFolder();
    let file;
    try {
      file = await dataFolder.getEntry(LANG_SETTINGS_FILE);
    } catch (e) {
      return "en"; // noch keine Einstellungsdatei -> Standard
    }
    const text = await file.read({ format: uxpFormats.utf8 });
    const parsed = JSON.parse(text);
    return parsed.language === "de" ? "de" : "en";
  } catch (err) {
    console.warn("[Umbra] Sprachwahl konnte nicht geladen werden:", err);
    return "en";
  }
}

async function saveLangSetting(lang) {
  try {
    const dataFolder = await uxpFs.getDataFolder();
    const file = await dataFolder.createFile(LANG_SETTINGS_FILE, {
      overwrite: true,
    });
    await file.write(JSON.stringify({ language: lang }, null, 2), {
      format: uxpFormats.utf8,
    });
  } catch (err) {
    console.warn("[Umbra] Sprachwahl konnte nicht gespeichert werden:", err);
  }
}

/**
 * Setzt alle statischen UI-Texte gemäß currentLang. Werte-Anzeigen
 * (Sigma-Zahl, geladener Preset-Name) stehen absichtlich in eigenen
 * <span>-Elementen und werden hier NICHT angefasst.
 */
function applyStaticTranslations() {
  const setText = (id, key) => {
    const el = $(id);
    if (!el) return;
    // Bei sp-checkbox ist der Beschriftungstext der Element-Inhalt.
    // textContent zu setzen ersetzt diesen Inhalt — deshalb den
    // Checked-Zustand vorher sichern und danach wiederherstellen, damit
    // ein Sprachwechsel nicht versehentlich Häkchen zurücksetzt.
    const wasChecked =
      typeof el.checked === "boolean" ? el.checked : undefined;
    el.textContent = t(key);
    if (wasChecked !== undefined) setChecked(el, wasChecked);
  };
  const setHtml = (id, key) => {
    const el = $(id);
    if (el) el.innerHTML = t(key);
  };

  setText("sigmaLabelText", "sigmaLabel");
  setText("preserveMean", "preserveMean");
  setText("saturationLabelText", "saturationLabel");
  setText("colorBalance", "colorBalanceText");
  setText("featherLabelText", "featherLabelText");
  setText("featherHint", "featherHint");
  setText("grayscale", "grayscaleText");
  setText("methodATitle", "methodATitle");
  setText("keepLab", "keepLabText");
  setText("applyBtn", "applyBtn");
  setText("methodAHint", "methodAHint");
  setText("methodBTitle", "methodBTitle");
  setText("adobeRgb", "adobeRgbText");
  setText("yreMultLabel", "yreMultLabel");
  setText("lreMultLabel", "lreMultLabel");
  // Preset-Buttons zeigen Icons (💾⬆ / 💾⬇). Die Übersetzung geht in
  // eigene Tooltip-<span>-Elemente statt in das native title-Attribut —
  // title-Tooltips erwiesen sich in UXP als unzuverlässig (aktualisierten
  // sich nicht bei Sprachwechsel und erschienen nicht immer beim Hover).
  // Speichern/Laden-Buttons zeigen nur noch Pfeile (⬆/⬇) ohne eigenen
  // Tooltip — das Disketten-Emoji rendert in UXP als "Zeichen nicht
  // gefunden"-Box, und der eigene Hover-Tooltip war zu klein für den
  // Text. Erklärung steht stattdessen im aufklappbaren Methode-B-Hinweis.
  setText("yrePresetLabelText", "loadedPreset");
  setText("lrePresetLabelText", "loadedPreset");
  setText("resetMultBtn", "resetMults");
  setText("applyYreBtn", "applyYreBtn");
  setText("applyLreBtn", "applyLreBtn");
  setHtml("methodBHint", "methodBHint");

  const sigmaWarningEl = $("sigmaWarning");
  if (sigmaWarningEl && sigmaWarningEl.classList.contains("visible")) {
    sigmaWarningEl.textContent = t("sigmaWarning");
  }

  // (Früher wurde hier das Flaggen-Icon oben rechts auf die aktive Sprache
  // gesetzt. Die Sprachumschaltung sitzt jetzt im Flyout-Menü; oben rechts
  // steht ein statisches Umbra-Logo. Die aktive Sprache markiert im Menü
  // ein Häkchen, siehe refreshMenuLanguageChecks().)

  updateMultDisplay();
}

async function setLanguage(lang) {
  currentLang = lang === "de" ? "de" : "en";
  applyStaticTranslations();
  // Footer-Statuszeile neu übersetzen (siehe reportStatus/renderStatus
  // weiter unten) — applyStaticTranslations() fasst #status bewusst NICHT
  // an, da dort kein fester Text steht, sondern eine der Statusmeldungen.
  renderStatus();
  refreshMenuLabels();
  refreshMenuLanguageChecks();
  await saveLangSetting(currentLang);
}

// Kanal-Multiplikatoren je Farbraum (eigene Schätzwerte, siehe Hinweis oben)
const PRESETS = {
  YRE: [1.0, 0.6, 1.6],
  LRE: [1.0, 1.6, 0.6],
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = text;
  console.log("[Umbra]", text);
}

/**
 * Merkt sich, WELCHE Statusmeldung zuletzt angezeigt wurde (als
 * Übersetzungsschlüssel + Argumente, nicht als fertigen Text), damit ein
 * Sprachwechsel die Fußzeile neu übersetzen kann. Ohne dieses Gedächtnis
 * bliebe die zuletzt gesetzte Meldung (typischerweise "Fertig."/"Done."
 * oder "Bereit."/"Ready.", da das die häufigsten Ruhezustände sind) nach
 * einem Sprachwechsel in der alten Sprache stehen — genau das wurde
 * beobachtet ("Done." blieb sichtbar, obwohl die restliche UI auf
 * Deutsch umgeschaltet war).
 */
let lastStatusKey = "statusReady";
let lastStatusArgs = [];
let lastStatusSuffix = "";
let lastStatusIsError = false;

function renderStatus() {
  const text = t(lastStatusKey, ...lastStatusArgs) + lastStatusSuffix;
  const el = $("status");
  if (el) el.classList.toggle("status-error", lastStatusIsError);
  // ⚠ als Warnzeichen — dasselbe wie in der Sigma-Warnung, das in UXP
  // zuverlässig rendert; die gelbe Einfärbung kommt aus der CSS-Klasse
  // status-error (siehe index.html).
  setStatus(lastStatusIsError ? "⚠ " + text : text);
}

/** Setzt die Statuszeile über einen Übersetzungsschlüssel (+ optionale
 * Formatierungs-Argumente) statt über fertigen Text, damit renderStatus()
 * sie bei einem Sprachwechsel reproduzieren kann. Normaler Info-Zustand. */
function reportStatus(key, ...args) {
  lastStatusKey = key;
  lastStatusArgs = args;
  lastStatusSuffix = "";
  lastStatusIsError = false;
  renderStatus();
}

/** EIGENE, vollständig übersetzbare Fehlermeldung per Schlüssel (z. B.
 * errNotRgb). Die ganze Meldung ist ein vollständiger Satz und wird bei
 * Sprachwechsel korrekt neu übersetzt. Bewusst OHNE "Fehler:"-Präfix — die
 * Warnwirkung übernehmen das ⚠ und die gelbe Einfärbung; ein zusätzliches
 * Präfix führte sonst zum "Fehler: Error:"-Doppel (das rohe, von
 * executeAsModal umverpackte err trägt bereits ein "Error:"). */
function reportErrorKey(key) {
  lastStatusKey = key;
  lastStatusArgs = [];
  lastStatusSuffix = "";
  lastStatusIsError = true;
  renderStatus();
}

/** Für UNBEKANNTE Laufzeitfehler (Photoshop/JS): übersetzbares Präfix
 * (key) plus ein NICHT übersetzbarer Suffix (die rohe Fehlermeldung,
 * bleibt beim Sprachwechsel stehen — sie ist ja nicht übersetzt). */
function reportStatusError(key, suffix) {
  lastStatusKey = key;
  lastStatusArgs = [];
  lastStatusSuffix = suffix;
  lastStatusIsError = true;
  renderStatus();
}

// Bekannte, vollständig übersetzbare Fehlermeldungen. Wird ein gefangener
// Fehler-Text als eine dieser Meldungen erkannt, zeigen wir ihn über den
// SCHLÜSSEL an (per reportErrorKey -> übersetzt sich mit, kein Doppel-
// präfix) statt über den rohen, an die Ursprungssprache gebundenen Text.
const TRANSLATABLE_ERROR_KEYS = [
  "errNotRgb",
  "errNoDocument",
  "errNoLayer",
  "errInvalidPresetFile",
];

/** Prüft, ob eine (evtl. von executeAsModal umverpackte) Fehlermeldung
 * einer unserer übersetzbaren Meldungen entspricht, und gibt deren
 * Schlüssel zurück (per Enthaltensein, robust gegen ein vorangestelltes
 * "Error:"). Sonst null. */
function errorKeyFromMessage(msg) {
  const m = String(msg || "");
  for (const key of TRANSLATABLE_ERROR_KEYS) {
    for (const lang of Object.keys(I18N)) {
      const translated = I18N[lang][key];
      if (typeof translated === "string" && translated && m.indexOf(translated) !== -1) {
        return key;
      }
    }
  }
  return null;
}

/** Rohe Meldung aus einem gefangenen Fehler, ohne ein von executeAsModal
 * vorangestelltes "Error:". */
function cleanErrMessage(err) {
  const raw = err && err.message ? err.message : String(err);
  return raw.replace(/^Error:\s*/i, "");
}

/**
 * Liest den Zustand einer Checkbox. Prüft sowohl die JS-Property
 * (.checked) als auch das HTML-Attribut — Spectrum Web Components
 * spiegeln ihren Zustand je nach Version unterschiedlich, und ein
 * still falsch ausgelesener Wert wäre hier besonders unangenehm
 * (die Berechnung liefe dann mit falschen Optionen durch).
 */
function isChecked(el) {
  if (!el) return false;
  if (typeof el.checked === "boolean") return el.checked;
  if (typeof el.hasAttribute === "function") return el.hasAttribute("checked");
  return false;
}

/**
 * Setzt den Zustand einer Checkbox — ebenfalls über Property UND
 * Attribut, aus demselben Grund wie bei isChecked().
 */
function setChecked(el, value) {
  if (!el) return;
  el.checked = !!value;
  if (typeof el.setAttribute === "function") {
    if (value) el.setAttribute("checked", "");
    else el.removeAttribute("checked");
  }
}

/**
 * Liest einen numerischen Wert aus einem Bedienelement. Fällt der Wert
 * ungültig aus (z. B. NaN, wie es bei falsch konfigurierten
 * sp-slider-Elementen vorkam), wird das in der Konsole gemeldet statt
 * still den Standardwert zu nehmen — genau dieser stille Rückfall hatte
 * einen Slider-Fehler zunächst verschleiert (Anzeige zeigte NaN, die
 * Berechnung lief aber unbemerkt mit dem Standardwert weiter).
 */
function readNumeric(id, fallback, minValue) {
  const el = $(id);
  if (!el) {
    console.warn(`[Umbra] Element "${id}" nicht gefunden, nutze ${fallback}`);
    return fallback;
  }
  const v = Number(el.value);
  if (!Number.isFinite(v) || v < minValue) {
    console.warn(
      `[Umbra] Ungültiger Wert von "${id}": ${el.value} — nutze ${fallback}`
    );
    return fallback;
  }
  return v;
}

function getSigma() {
  return readNumeric("sigma", 15, 0.0001);
}

function getPreserveMean() {
  return isChecked($("preserveMean"));
}

function getKeepLab() {
  return isChecked($("keepLab"));
}

function getProfileName() {
  return isChecked($("adobeRgb")) ? "AdobeRGB" : "sRGB";
}

function getSaturation() {
  return readNumeric("saturation", 1, 0);
}

function getGrayscale() {
  return isChecked($("grayscale"));
}

function getColorBalance() {
  return isChecked($("colorBalance"));
}

function getFeatherRadius() {
  return readNumeric("featherRadius", 0, 0);
}

// IDs der Eingabefelder je Farbraum
const MULT_FIELDS = {
  YRE: ["yre1", "yre2", "yre3"],
  LRE: ["lre1", "lre2", "lre3"],
};

const MULT_LABELS = {
  YRE: ["Y", "U", "V"],
  LRE: ["L", "a", "b"],
};

/**
 * Liest die Multiplikatoren eines Farbraums aus dem UI.
 * Ungültige oder leere Eingaben fallen auf den Preset-Wert zurück, damit
 * ein Tippfehler nicht zu einer stillen Fehlberechnung führt. Der
 * Rückgabewert enthält zusätzlich, welche Felder ungültig waren, damit das
 * UI das anzeigen kann.
 */
function readMults(space) {
  const preset = PRESETS[space];
  const values = [];
  const invalid = [];

  MULT_FIELDS[space].forEach((id, idx) => {
    const el = $(id);
    if (!el) {
      values.push(preset[idx]);
      return;
    }
    const raw = String(el.value).trim().replace(",", ".");
    const num = Number(raw);
    if (raw === "" || !Number.isFinite(num) || num === 0) {
      values.push(preset[idx]);
      invalid.push(idx);
    } else {
      values.push(num);
    }
  });

  return { values, invalid };
}

function formatMults(space) {
  const { values, invalid } = readMults(space);
  const labels = MULT_LABELS[space];
  const parts = values.map((v, i) => {
    const txt = `${labels[i]}=${v}`;
    return invalid.includes(i) ? `<span class="bad">${txt}*</span>` : txt;
  });
  return { text: parts.join("  "), hasInvalid: invalid.length > 0 };
}

/**
 * Aktualisiert die Anzeige der aktuell für die Berechnung verwendeten
 * Werte — also genau das, was readMults() liefert, inklusive der
 * Ersatzwerte bei ungültiger Eingabe.
 */
function updateMultDisplay() {
  const el = $("multDisplay");
  if (!el) return;

  const yre = formatMults("YRE");
  const lre = formatMults("LRE");
  const profileLabel = getProfileName() === "AdobeRGB" ? "Adobe RGB (1998)" : "sRGB";

  let html =
    `${t("currentlyUsed")}<br />YRE: ` +
    yre.text +
    "<br />LRE: " +
    lre.text +
    `<br />${t("profileLreOnly")} ` +
    profileLabel;
  if (yre.hasInvalid || lre.hasInvalid) {
    html += `<br /><span class="bad">${t("invalidNote")}</span>`;
  }
  el.innerHTML = html;
}

function resetMults() {
  Object.keys(MULT_FIELDS).forEach((space) => {
    MULT_FIELDS[space].forEach((id, idx) => {
      const el = $(id);
      if (el) el.value = String(PRESETS[space][idx]);
    });
    // Die Multiplikatoren entsprechen jetzt nicht mehr dem geladenen
    // Preset (falls eines geladen war) — Anzeige zurücksetzen.
    setLoadedPresetName(space, null);
  });
  updateMultDisplay();
}

// ---------------------------------------------------------------------
// Presets als einzelne Dateien (Datei-Dialog Speichern/Laden)
//
// Ein Preset enthält die 3 Kanal-Multiplikatoren, das aktuelle Sigma und
// das gewählte Farbraum-Profil (auch bei YRE mitgespeichert, auch wenn
// dort für die Berechnung ohne Wirkung — einheitlicher Datensatz).
// Statt einer intern verwalteten Liste mit eigenen Buttons nutzt das
// Plugin jetzt den nativen Datei-Öffnen/Speichern-Dialog von UXP
// (localFileSystem.getFileForSaving/getFileForOpening) — das ist Teil
// der UXP-Basisplattform, keine Photoshop-spezifische Vermutung. Beide
// Aufrufe sind defensiv in try/catch eingebettet: Bricht der Nutzer den
// Dialog ab oder schlägt der Zugriff fehl, bleibt das Plugin nutzbar,
// es gibt lediglich eine Statusmeldung bzw. Konsolen-Warnung.
// ---------------------------------------------------------------------

function setLoadedPresetName(space, name) {
  const el = $(space === "YRE" ? "yreLoadedPresetName" : "lreLoadedPresetName");
  if (el) el.textContent = name || "-";
}

async function savePresetToFile(space) {
  try {
    const data = {
      space,
      mults: readMults(space).values,
      sigma: getSigma(),
      profile: getProfileName(),
    };
    const suggestedName = `umbra-${space.toLowerCase()}-preset.json`;
    const file = await uxpFs.getFileForSaving(suggestedName, {
      types: ["json"],
    });
    if (!file) {
      return; // Nutzer hat den Dialog abgebrochen
    }
    await file.write(JSON.stringify(data, null, 2), {
      format: uxpFormats.utf8,
    });
    const displayName = String(file.name || suggestedName).replace(
      /\.json$/i,
      ""
    );
    setLoadedPresetName(space, displayName);
    reportStatus("presetSaved", displayName, space);
  } catch (err) {
    console.warn("[Umbra] Preset speichern fehlgeschlagen:", err);
    reportStatusError(
      "presetSaveErrorPrefix",
      err && err.message ? err.message : String(err)
    );
  }
}

async function loadPresetFromFile(space) {
  try {
    const file = await uxpFs.getFileForOpening({ types: ["json"] });
    if (!file) {
      return; // Nutzer hat den Dialog abgebrochen
    }
    const text = await file.read({ format: uxpFormats.utf8 });
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.mults) || data.mults.length !== 3) {
      throw new Error(t("errInvalidPresetFile"));
    }

    MULT_FIELDS[space].forEach((id, idx) => {
      const el = $(id);
      if (el) el.value = String(data.mults[idx]);
    });

    const sigmaSlider = $("sigma");
    if (sigmaSlider && typeof data.sigma === "number") {
      sigmaSlider.value = String(data.sigma);
      // Zahlanzeige UND die >60-Warnung gemeinsam nachziehen — sonst bleibt
      // die Warnung nach dem Laden eines Presets mit hohem Sigma veraltet.
      refreshSigmaUI();
    }

    const adobeRgbCheckbox = $("adobeRgb");
    if (adobeRgbCheckbox && data.profile) {
      setChecked(adobeRgbCheckbox, data.profile === "AdobeRGB");
    }

    updateMultDisplay();
    const displayName = String(file.name || "Preset").replace(/\.json$/i, "");
    setLoadedPresetName(space, displayName);
    // Das Preset speichert, für welchen Farbraum es gedacht war. Wird ein
    // YRE-Preset in die LRE-Felder geladen (oder umgekehrt), sind die
    // Multiplikatoren zwar formal gültig, bedeuten aber andere Kanäle
    // (Y/U/V vs. L/a/b) — deshalb klar darauf hinweisen statt still zu
    // übernehmen.
    if (data.space && data.space !== space) {
      reportStatus("presetSpaceMismatch", displayName, data.space, space);
    } else {
      reportStatus("presetLoaded", displayName, space);
    }
  } catch (err) {
    console.warn("[Umbra] Preset laden fehlgeschlagen:", err);
    reportStatusError(
      "presetLoadErrorPrefix",
      err && err.message ? err.message : String(err)
    );
  }
}

/**
 * Hängt einen Klick-Handler an einen Button. Fehlt der Button (z. B. weil
 * UXP ein Element nicht unterstützt), wird das nur geloggt statt eine
 * Exception zu werfen — sonst reißt ein einzelnes Element die komplette
 * Initialisierung mit und ALLE Bedienelemente bleiben tot.
 */
/**
 * Registriert einen Wert-Änderungs-Handler auf einem Bedienelement.
 * Bewusst mehrere Event-Typen gleichzeitig: native Elemente feuern
 * "input"/"change", Spectrum Web Components teils zusätzlich eigene
 * Events. Mehrfaches Feuern ist unkritisch (die Handler sind
 * idempotent — sie setzen nur eine Anzeige), ein fehlendes Event wäre
 * dagegen ein stiller Fehler. Nach den Erfahrungen in diesem Projekt
 * (Slider-step-Werte wurden ignoriert, title-Tooltips funktionierten
 * nicht) ist "alle plausiblen Events registrieren" die robustere Wahl.
 */
function wireValueEvents(el, handler) {
  if (!el) return;
  ["input", "change", "sp-input", "sp-change"].forEach((evt) => {
    el.addEventListener(evt, handler);
  });
}

function wireButton(id, workFn, commandName) {
  const btn = $(id);
  if (!btn) {
    console.warn("[Umbra] Button nicht gefunden:", id);
    return;
  }
  btn.addEventListener("click", async () => {
    try {
      reportStatus("statusComputing");
      await core.executeAsModal(workFn, { commandName });
      reportStatus("statusDone");
    } catch (err) {
      console.error(err);
      // Eigene, übersetzbare Meldung (z. B. errNotRgb)? Dann per Schlüssel
      // anzeigen — übersetzt sich bei Sprachwechsel mit, ohne "Fehler:
      // Error:"-Doppelpräfix. Sonst die rohe Meldung mit übersetzbarem
      // Präfix (das rohe "Error:" wird dabei entfernt).
      const key = errorKeyFromMessage(err && err.message ? err.message : String(err));
      if (key) {
        reportErrorKey(key);
      } else {
        reportStatusError("statusErrorPrefix", cleanErrMessage(err));
      }
    }
  });
}

/**
 * Aktualisiert die Sigma-Zahlanzeige und die >60-Warnung anhand des
 * aktuellen Slider-Werts. Bewusst auf Modul-Ebene statt als Closure in
 * initUI(), damit auch das Laden eines Presets (loadPresetFromFile) die
 * Warnung korrekt nachziehen kann.
 */
function refreshSigmaUI() {
  const sigmaSlider = $("sigma");
  const sigmaVal = $("sigmaVal");
  const sigmaWarningEl = $("sigmaWarning");
  if (!sigmaSlider || !sigmaVal) return;
  const v = Number(sigmaSlider.value);
  sigmaVal.textContent = String(Math.round(v));
  if (sigmaWarningEl) {
    if (v > 60) {
      sigmaWarningEl.textContent = t("sigmaWarning");
      sigmaWarningEl.classList.add("visible");
    } else {
      sigmaWarningEl.classList.remove("visible");
    }
  }
}

async function initUI() {
  currentLang = await loadLangSetting();
  applyStaticTranslations();
  // Das Flyout-Menü wurde bereits weiter unten (synchron, vor initUI())
  // mit den Standardwerten auf Englisch aufgebaut, weil currentLang zu
  // diesem frühen Zeitpunkt noch nicht aus den gespeicherten
  // Einstellungen geladen war. Hier — sobald die echte Sprache feststeht
  // — die Menü-Beschriftungen einmalig nachziehen, damit ein
  // gespeichertes "de" auch beim allerersten Öffnen des Menüs sofort
  // korrekt erscheint statt erst nach dem nächsten manuellen Umschalten.
  refreshMenuLabels();
  // Häkchen im Sprach-Menü auf die gespeicherte Startsprache setzen.
  refreshMenuLanguageChecks();

  // (Der frühere Flaggen-Toggle-Button oben rechts entfällt — die
  // Sprachumschaltung läuft jetzt über das Flyout-Menü, siehe
  // invokeMenuItem() für die "langDe"/"langEn"-Einträge.)

  // Hilfe-Buttons: Klick blendet den zugehörigen Hinweistext ein/aus.
  // Gemeinsame Schleife statt drei fast identischer Blöcke.
  [
    ["methodAHelpBtn", "methodAHint"],
    ["methodBHelpBtn", "methodBHint"],
    ["featherHelpBtn", "featherHint"],
  ].forEach(([btnId, hintId]) => {
    const btn = $(btnId);
    const hint = $(hintId);
    if (btn && hint) {
      btn.addEventListener("click", () => hint.classList.toggle("visible"));
    } else {
      console.warn(
        `[Umbra] Hilfe-Button/-Hinweis nicht gefunden: ${btnId}/${hintId}`
      );
    }
  });

  const sigmaSlider = $("sigma");
  const sigmaVal = $("sigmaVal");
  if (sigmaSlider && sigmaVal) {
    wireValueEvents(sigmaSlider, refreshSigmaUI);
    refreshSigmaUI();

    const sigmaResetBtn = $("sigmaResetBtn");
    if (sigmaResetBtn) {
      sigmaResetBtn.addEventListener("click", () => {
        sigmaSlider.value = 15;
        refreshSigmaUI();
      });
    }
  } else {
    console.warn("[Umbra] Slider oder Wertanzeige nicht gefunden.");
  }

  const saturationSlider = $("saturation");
  const saturationVal = $("saturationVal");
  if (saturationSlider && saturationVal) {
    const updateSat = () => {
      saturationVal.textContent = Number(saturationSlider.value).toFixed(2);
    };
    wireValueEvents(saturationSlider, updateSat);
    updateSat();

    const saturationResetBtn = $("saturationResetBtn");
    if (saturationResetBtn) {
      saturationResetBtn.addEventListener("click", () => {
        saturationSlider.value = 1;
        updateSat();
      });
    }
  } else {
    console.warn("[Umbra] Sättigungs-Regler oder Wertanzeige nicht gefunden.");
  }

  const featherSlider = $("featherRadius");
  const featherVal = $("featherVal");
  if (featherSlider && featherVal) {
    const updateFeather = () => {
      featherVal.textContent = String(Math.round(Number(featherSlider.value)));
    };
    wireValueEvents(featherSlider, updateFeather);
    updateFeather();
  } else {
    console.warn("[Umbra] Feder-Regler oder Wertanzeige nicht gefunden.");
  }

  // Multiplikator-Felder: Anzeige bei jeder Eingabe aktualisieren
  Object.keys(MULT_FIELDS).forEach((space) => {
    MULT_FIELDS[space].forEach((id) => {
      const el = $(id);
      if (el) {
        wireValueEvents(el, updateMultDisplay);
      } else {
        console.warn("[Umbra] Multiplikator-Feld nicht gefunden:", id);
      }
    });
  });

  const resetBtn = $("resetMultBtn");
  if (resetBtn) resetBtn.addEventListener("click", resetMults);

  const adobeRgbCheckbox = $("adobeRgb");
  if (adobeRgbCheckbox) {
    wireValueEvents(adobeRgbCheckbox, updateMultDisplay);
  }

  updateMultDisplay();

  const yreSaveBtn = $("yreSavePresetBtn");
  if (yreSaveBtn) {
    yreSaveBtn.addEventListener("click", () => savePresetToFile("YRE"));
  }
  const yreLoadBtn = $("yreLoadPresetBtn");
  if (yreLoadBtn) {
    yreLoadBtn.addEventListener("click", () => loadPresetFromFile("YRE"));
  }
  const lreSaveBtn = $("lreSavePresetBtn");
  if (lreSaveBtn) {
    lreSaveBtn.addEventListener("click", () => savePresetToFile("LRE"));
  }
  const lreLoadBtn = $("lreLoadPresetBtn");
  if (lreLoadBtn) {
    lreLoadBtn.addEventListener("click", () => loadPresetFromFile("LRE"));
  }

  wireButton(
    "applyBtn",
    () =>
      runLabAbWorkflow(
        getSigma(),
        getPreserveMean(),
        reportStatus,
        getSaturation(),
        getColorBalance(),
        getFeatherRadius(),
        getKeepLab()
      ),
    "Decorrelation Stretch (Lab a/b)"
  );

  wireButton(
    "applyYreBtn",
    () =>
      runReWorkflow(
        "YRE",
        readMults("YRE").values,
        getSigma(),
        getPreserveMean(),
        reportStatus,
        getProfileName(),
        getSaturation(),
        getGrayscale(),
        getColorBalance(),
        getFeatherRadius()
      ),
    "Decorrelation Stretch (YRE)"
  );

  wireButton(
    "applyLreBtn",
    () =>
      runReWorkflow(
        "LRE",
        readMults("LRE").values,
        getSigma(),
        getPreserveMean(),
        reportStatus,
        getProfileName(),
        getSaturation(),
        getGrayscale(),
        getColorBalance(),
        getFeatherRadius()
      ),
    "Decorrelation Stretch (LRE)"
  );

  reportStatus("statusReady");
}

// ---------------------------------------------------------------------
// Flyout-Menü (Registerkarten-Menü) — Reload, Anleitung, Repo-Link,
// Version.
//
// EHRLICHER HINWEIS: Dies ist ein Stück UXP-Panel-Chrome
// (entrypoints.setup), das bisher in diesem Projekt nicht verwendet
// wurde — main.js initialisiert sein UI seit jeher direkt beim Laden
// (initUI() unten), nicht über die entrypoints-Lifecycle
// (create/show/hide/destroy). Beide Mechanismen sollten laut
// Adobe-Dokumentation nebeneinander funktionieren (das Panel bleibt bei
// index.html + eigenem Skript, entrypoints.setup() wird nur zusätzlich
// für das Menü genutzt, mit einem leeren show()), aber das ist nicht
// gegen echtes Photoshop getestet — nach dem bisherigen Muster dieses
// Projekts ist beim ersten Testlauf mit einer Korrekturrunde zu rechnen.
// Deshalb hier bewusst defensiv: entrypoints.setup() UND jeder Zugriff
// auf das Menü danach sind in try/catch eingebettet, damit ein Problem
// hier nicht das ganze Panel mit runterreißt.
// ---------------------------------------------------------------------

function invokeMenuItem(id) {
  switch (id) {
    case "langDe":
      setLanguage("de");
      break;
    case "langEn":
      setLanguage("en");
      break;
    case "menuReload":
      location.reload();
      break;
    case "menuManual":
      shell
        .openExternal(currentLang === "de" ? MANUAL_URL_DE : MANUAL_URL_EN)
        .catch((err) => console.warn("[Umbra] Anleitung konnte nicht geöffnet werden:", err));
      break;
    case "menuRepo":
      shell
        .openExternal(REPO_URL)
        .catch((err) => console.warn("[Umbra] Repository konnte nicht geöffnet werden:", err));
      break;
    case "menuToRgb":
      convertDocumentToRgb();
      break;
    // "menuVersion" ist enabled:false und damit nicht klickbar — kein
    // Fall nötig.
  }
}

/**
 * Wandelt das aktive Dokument nach RGB — bequemer Weg direkt aus dem
 * Panel-Menü, vor allem für den Fall, dass Methode A mit gesetztem
 * "Ergebnis in Lab belassen" das Dokument in Lab hinterlassen hat und man
 * es (z. B. vor Methode B) wieder nach RGB braucht. Ist das Dokument schon
 * RGB, ist die Umwandlung ein No-op. Der Dokument-Zugriff läuft über
 * executeAsModal (von Photoshop verlangt).
 */
function convertDocumentToRgb() {
  if (!app.activeDocument) {
    reportErrorKey("errNoDocument");
    return;
  }
  core
    .executeAsModal(
      () =>
        action.batchPlay(
          [{ _obj: "convertMode", to: { _class: "RGBColorMode" } }],
          {}
        ),
      { commandName: "Convert document to RGB" }
    )
    .then(() => reportStatus("statusDone"))
    .catch((err) => {
      console.warn("[Umbra] RGB-Umwandlung fehlgeschlagen:", err);
      reportStatusError("statusErrorPrefix", cleanErrMessage(err));
    });
}

/**
 * Setzt das Häkchen (checked) im Sprach-Menü auf die aktive Sprache.
 *
 * HINWEIS zur Flaggen-Frage: UXP-Menüeinträge (UxpMenuItem) unterstützen
 * laut Adobe-API nur label/enabled/checked/submenu — KEIN Icon/Bild. Ein
 * Flaggen-Bild neben den Einträgen ist daher im Flyout-Menü technisch
 * nicht möglich; das native Häkchen markiert stattdessen die aktive
 * Sprache. Die Beschriftungen "Deutsch"/"English" bleiben bewusst in der
 * jeweils eigenen Sprache (Endonyme) — sie werden NICHT übersetzt, das
 * ist die übliche Konvention für Sprachwähler.
 */
function refreshMenuLanguageChecks() {
  try {
    const panel = entrypoints.getPanel(UMBRA_PANEL_ID);
    if (!panel) return;
    const items = panel.menuItems;
    const de = items.getItem("langDe");
    const en = items.getItem("langEn");
    if (de) de.checked = currentLang === "de";
    if (en) en.checked = currentLang === "en";
  } catch (err) {
    console.warn("[Umbra] Sprach-Häkchen im Menü konnte nicht gesetzt werden:", err);
  }
}

/**
 * Zieht die sprachabhängigen Menü-Beschriftungen (Reload/Anleitung/Repo)
 * auf den aktuellen currentLang nach — genutzt sowohl beim ersten Start
 * (initUI(), sobald die gespeicherte Sprache geladen ist) als auch bei
 * jedem manuellen Sprachwechsel (setLanguage()). "menuVersion" wird hier
 * NICHT angefasst: "Version" heißt in beiden Sprachen gleich, die Zahl
 * pflegt refreshVersionMenuLabel() separat.
 */
function refreshMenuLabels() {
  try {
    const panel = entrypoints.getPanel(UMBRA_PANEL_ID);
    if (!panel) return;
    const items = panel.menuItems;
    ["menuReload", "menuManual", "menuRepo", "menuToRgb"].forEach((id) => {
      const item = items.getItem(id);
      if (item) item.label = t(id);
    });
  } catch (err) {
    console.warn("[Umbra] Flyout-Menü konnte nicht aktualisiert werden:", err);
  }
}

/** Zieht die Versionsanzeige im Menü auf die echte Plugin-Version aus
 * UxpPluginInfo nach, sobald entrypoints.plugin.create() gefeuert hat
 * (siehe Kommentar bei FALLBACK_VERSION oben). */
function refreshVersionMenuLabel() {
  try {
    const panel = entrypoints.getPanel(UMBRA_PANEL_ID);
    const item = panel && panel.menuItems && panel.menuItems.getItem("menuVersion");
    if (item) item.label = `Version ${pluginVersion}`;
  } catch (err) {
    console.warn("[Umbra] Versionsanzeige im Menü konnte nicht aktualisiert werden:", err);
  }
}

try {
  entrypoints.setup({
    plugin: {
      create() {
        // 'this' ist laut Doku ein UxpPluginInfo-Objekt mit .version.
        pluginVersion = (this && this.version) || FALLBACK_VERSION;
        refreshVersionMenuLabel();
      },
    },
    panels: {
      [UMBRA_PANEL_ID]: {
        // Leeres show(): die eigentliche UI-Initialisierung läuft
        // unverändert über initUI() unten, nicht über diese Lifecycle.
        show() {},
        invokeMenu(id) {
          invokeMenuItem(id);
        },
        menuItems: [
          // Sprachwahl: Endonyme (immer in der eigenen Sprache), das
          // Häkchen (checked) markiert die aktive. currentLang ist hier
          // noch der Modul-Default ("en"); refreshMenuLanguageChecks() in
          // initUI() setzt das Häkchen sofort auf die gespeicherte Sprache.
          { id: "langDe", label: "Deutsch", checked: false },
          { id: "langEn", label: "English", checked: true },
          "-",
          // currentLang ist an dieser Stelle noch der Modul-Default
          // ("en"), da initUI() (das die gespeicherte Sprache lädt) erst
          // weiter unten läuft — refreshMenuLabels() in initUI() zieht
          // die Beschriftungen sofort danach auf die richtige Sprache
          // nach, siehe dortigen Kommentar.
          { id: "menuReload", label: t("menuReload") },
          { id: "menuManual", label: t("menuManual") },
          { id: "menuRepo", label: t("menuRepo") },
          "-",
          { id: "menuToRgb", label: t("menuToRgb") },
          "-",
          { id: "menuVersion", label: `Version ${pluginVersion}`, enabled: false },
          "-",
        ],
      },
    },
  });
} catch (err) {
  console.warn("[Umbra] Flyout-Menü konnte nicht eingerichtet werden:", err);
}

initUI().catch((err) => {
  console.error("[Umbra] Initialisierung fehlgeschlagen:", err);
  reportStatusError(
    "statusInitErrorPrefix",
    err && err.message ? err.message : String(err)
  );
});

// ---------------------------------------------------------------------
// Gemeinsame Hilfsfunktion: Basisebene duplizieren
// ---------------------------------------------------------------------

/**
 * Baut einen Ebenennamen-Suffix, der die aktiven Optionen zusammenfasst,
 * z. B. "LRE (CB, Sat1.0, Si15)" — hilft, die Ebene später
 * wiederzuerkennen, ohne im Statusfeld nachschauen zu müssen.
 */
function buildLayerSuffix(baseLabel, sigma, saturation, colorBalance, grayscale) {
  const opts = [];
  if (colorBalance) opts.push("CB");
  opts.push(`Sat${Number(saturation).toFixed(1)}`);
  opts.push(`Si${Math.round(sigma)}`);
  if (grayscale) opts.push("Gray");
  return opts.length ? `${baseLabel} (${opts.join(", ")})` : baseLabel;
}

async function duplicateBaseLayer(doc, suffix, report) {
  const baseLayer =
    doc.layers.find(
      (l) => l.name === "Hintergrund" || l.name === "Background"
    ) ||
    doc.activeLayers[0] ||
    doc.layers[0];
  if (!baseLayer) throw new Error(t("errNoLayer"));

  report && report("statusDuplicating");
  const dupLayer = await baseLayer.duplicate();
  dupLayer.name = `${baseLayer.name} – ${suffix}`;
  doc.activeLayers = [dupLayer];
  return dupLayer;
}

// ---------------------------------------------------------------------
// Auswahl-/Feder-Unterstützung
//
// Ist beim Klick eine Auswahl aktiv, sollen Mittelwert und
// Kovarianzmatrix NUR aus dem ausgewählten Bereich berechnet werden
// (mit weichem Übergang bei gefederter Auswahl), während die eigentliche
// Stretch-Transformation weiterhin auf alle Pixel angewendet wird — am
// Ende sorgt eine echte Ebenenmaske aus der (gefederten) Auswahl dafür,
// dass außerhalb der Auswahl das Original durchscheint.
//
// EHRLICHER HINWEIS: Diese Funktionen nutzen mehrere batchPlay-Befehle
// (feather, inverse, fill, Maske aus Auswahl) und DOM-Methoden
// (doc.selection.bounds, doc.layers.add, layer.delete), die in diesem
// Projekt bisher nicht verwendet wurden und daher nicht mit derselben
// Zuversicht wie z. B. layer.duplicate() vorhergesagt werden können.
// Nach dem bisherigen Muster dieses Projekts ist beim ersten Testlauf
// mit einer Korrekturrunde zu rechnen.
// ---------------------------------------------------------------------

/**
 * Hilfsfunktion: extrahiert eine Zahl aus einem bounds-Wert, unabhängig
 * davon, ob UXP eine reine Zahl oder ein UnitValue-artiges Objekt mit
 * .value liefert (in diesem Projekt bisher nicht verwendete API, daher
 * bewusst defensiv für beide möglichen Formen geschrieben).
 */
function toNum(v) {
  if (typeof v === "number") return v;
  if (v && typeof v.value === "number") return v.value;
  return Number(v);
}

/**
 * Prüft, ob eine "echte", eingrenzende Auswahl aktiv ist. Bewusst NICHT
 * nur "gibt es ein bounds-Objekt" (`!!bounds`) — ist gar keine Auswahl
 * aktiv, verhält sich Photoshop oft wie "alles ausgewählt" und liefert
 * trotzdem ein gültiges bounds-Objekt zurück, das die volle
 * Dokumentgröße abdeckt. Das wurde beim Testen tatsächlich beobachtet
 * (führte zu einer wirkungslosen, "leeren" Maske). Deckt die Auswahl das
 * komplette Dokument ab, wird das deshalb wie "keine Auswahl" behandelt
 * — eine Maskierung wäre dort ohnehin wirkungslos.
 */
async function hasActiveSelection(doc) {
  try {
    const bounds = doc.selection.bounds;
    if (!bounds) return false;

    let left, top, right, bottom;
    if (Array.isArray(bounds)) {
      [left, top, right, bottom] = bounds.map(toNum);
    } else {
      left = toNum(bounds.left);
      top = toNum(bounds.top);
      right = toNum(bounds.right);
      bottom = toNum(bounds.bottom);
    }
    if (![left, top, right, bottom].every(Number.isFinite)) return false;

    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return false;

    const docWidth = toNum(doc.width);
    const docHeight = toNum(doc.height);
    if (
      Number.isFinite(docWidth) &&
      Number.isFinite(docHeight) &&
      width >= docWidth &&
      height >= docHeight
    ) {
      return false; // deckt das ganze Dokument ab -> wie "keine Auswahl"
    }

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Berechnet ein Gewichtsfeld (0..1 pro Pixel) aus der aktuellen Auswahl,
 * inklusive Federung. Vorgehen: Auswahl federn (falls Radius > 0),
 * temporäre Ebene anlegen, außerhalb der Auswahl schwarz und innerhalb
 * weiß füllen (Photoshops Fill respektiert weiche Auswahlkanten nativ),
 * die entstandenen Graustufen als Gewicht auslesen, temporäre Ebene
 * wieder löschen. Die Auswahl selbst bleibt danach aktiv (gefedert), da
 * sie am Ende noch für die eigentliche Ebenenmaske gebraucht wird.
 */
async function buildSelectionWeights(doc, featherRadius) {
  if (featherRadius > 0) {
    await action.batchPlay(
      [{ _obj: "feather", radius: { _unit: "pixelsUnit", _value: featherRadius } }],
      {}
    );
  }

  const tempLayer = await doc.layers.add();

  // Außerhalb der Auswahl schwarz füllen
  await action.batchPlay([{ _obj: "inverse" }], {});
  await action.batchPlay(
    [
      {
        _obj: "fill",
        using: { _enum: "fillContents", _value: "black" },
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" },
      },
    ],
    {}
  );
  // Zurück zur ursprünglichen (gefederten) Auswahl, weiß füllen
  await action.batchPlay([{ _obj: "inverse" }], {});
  await action.batchPlay(
    [
      {
        _obj: "fill",
        using: { _enum: "fillContents", _value: "white" },
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" },
      },
    ],
    {}
  );

  const pixelData = await imaging.getPixels({
    documentID: doc.id,
    layerID: tempLayer.id,
  });
  const { imageData } = pixelData;
  const { width, height, components } = imageData;
  const raw = await imageData.getData({ chunky: true });
  const maxValue = getMaxValue(raw);
  const pixelCount = width * height;

  const weights = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    weights[i] = raw[i * components] / maxValue;
  }
  imageData.dispose();

  try {
    await tempLayer.delete();
  } catch (e) {
    console.warn("[Umbra] Temporäre Ebene konnte nicht gelöscht werden:", e);
  }

  return weights;
}

/**
 * Fügt der Ebene eine echte Maske aus der aktuell aktiven (bereits
 * gefederten) Auswahl hinzu, damit außerhalb der Auswahl das Original
 * sichtbar bleibt, mit weichem Übergang.
 */
async function applySelectionAsMask(doc, layer) {
  doc.activeLayers = [layer];
  await action.batchPlay(
    [
      {
        _obj: "make",
        new: { _class: "channel" },
        at: { _ref: "channel", _enum: "channel", _value: "mask" },
        using: { _enum: "userMaskEnabled", _value: "revealSelection" },
      },
    ],
    {}
  );
}

// ---------------------------------------------------------------------
// Gewichtete Statistik (gemeinsam für Methode A [2 Kanäle] und B [3])
//
// Beide Methoden brauchen denselben Ablauf — gewichteter Mittelwert,
// dann gewichtete Kovarianzmatrix auf den zentrierten Werten —, nur mit
// unterschiedlicher Kanalzahl. Ursprünglich als zwei fast identische
// Kopien in applyStretchToLayerLab (2 Kanäle) und applyStretchToLayerRe
// (3 Kanäle) geschrieben; hier zusammengeführt, NACHDEM beide Kopien
// bereits denselben Fix (sumW>0-Schutz gegen die NaN-Kaskade bei leerer
// Auswahl) unabhängig voneinander brauchten — genau die Sorte doppelter
// Pflegeaufwand, die diese Zusammenführung vermeiden soll.
// ---------------------------------------------------------------------

/**
 * Gewichteter Mittelwert über N Kanäle. `channels` ist ein Array von N
 * gleich langen Float32Arrays (ein Array pro Kanal), `weights` entweder
 * null (jedes Pixel zählt gleich mit Gewicht 1) oder ein Float32Array
 * derselben Länge. Wirft bei nicht positiver Gewichtssumme (leere/winzige
 * Auswahl, oder ein Längen-Mismatch von weights, der sumW zu NaN macht)
 * einen klaren Fehler, statt eine NaN-Kaskade bis in die geschriebenen
 * Pixel durchzureichen — `!(sumW > 0)` fängt 0, negativ UND NaN zugleich
 * ab.
 */
function weightedMean(channels, weights, pixelCount) {
  const n = channels.length;
  const mean = new Array(n).fill(0);
  let sumW = 0;
  for (let i = 0; i < pixelCount; i++) {
    const w = weights ? weights[i] : 1;
    sumW += w;
    for (let k = 0; k < n; k++) mean[k] += w * channels[k][i];
  }
  if (!(sumW > 0)) {
    throw new Error(
      `Interner Fehler: Die Auswahl-Gewichte ergeben keine gültige Summe (sumW=${sumW}). Ist die Auswahl leer oder zu klein?`
    );
  }
  for (let k = 0; k < n; k++) mean[k] /= sumW;
  return { mean, sumW };
}

/**
 * Gewichtete symmetrische NxN-Kovarianzmatrix über N Kanäle. `mean` und
 * `sumW` kommen von weightedMean() für dieselben `channels`/`weights`.
 * Bessel-Korrektur (sumW-1) nur bei ausreichender effektiver Stichprobe
 * (sumW>1), sonst wäre der Divisor 0 oder negativ — siehe weightedMean().
 * Rückgabe zeilenweise (cov[i][j]), symmetrisch befüllt.
 */
function weightedCovariance(channels, mean, weights, pixelCount, sumW) {
  const n = channels.length;
  const cov = Array.from({ length: n }, () => new Array(n).fill(0));
  const d = new Array(n);
  for (let i = 0; i < pixelCount; i++) {
    const w = weights ? weights[i] : 1;
    for (let k = 0; k < n; k++) d[k] = channels[k][i] - mean[k];
    for (let a = 0; a < n; a++) {
      for (let b = a; b < n; b++) cov[a][b] += w * d[a] * d[b];
    }
  }
  const div = sumW > 1 ? sumW - 1 : sumW;
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      cov[a][b] /= div;
      cov[b][a] = cov[a][b];
    }
  }
  return cov;
}

// ---------------------------------------------------------------------
// Methode A: Lab a/b (bisheriges Verhalten, unverändert)
// ---------------------------------------------------------------------

async function runLabAbWorkflow(
  targetSigma,
  preserveMean,
  report,
  saturation,
  colorBalance,
  featherRadius,
  keepLab
) {
  const doc = app.activeDocument;
  if (!doc) throw new Error(t("errNoDocument"));

  // "Lab a/b" bewusst wie "YRE"/"LRE" bei Methode B: ein fester, nicht
  // übersetzter technischer Bezeichner (steht so auch unübersetzt in der
  // deutschen UI-Überschrift "Methode A — Lab a/b"), keine Marke des
  // Plugins selbst — der Ebenenname soll die verwendete Methode zeigen,
  // nicht das Plugin, das sie erzeugt hat.
  const layerSuffix = buildLayerSuffix(
    "Lab a/b",
    targetSigma,
    saturation,
    colorBalance,
    false
  );
  const dupLayer = await duplicateBaseLayer(doc, layerSuffix, report);

  const useSelection = await hasActiveSelection(doc);
  let weights = null;
  if (useSelection) {
    report && report("statusSelectionWeights");
    weights = await buildSelectionWeights(doc, featherRadius);
  }

  // CB-Farbausgleich (Gray-World) MUSS vor der Lab-Moduskonvertierung
  // passieren — er korrigiert die rohen RGB-Werte, nicht die Lab-Werte.
  if (colorBalance) {
    report && report("statusColorBalance");
    await applyGrayWorldBalance(doc, dupLayer);
  }

  report && report("statusSwitchLab");
  await action.batchPlay(
    [{ _obj: "convertMode", to: { _class: "labColorMode" } }],
    {}
  );

  report && report("statusComputingLabAB");
  await applyStretchToLayerLab(
    doc,
    dupLayer,
    targetSigma,
    preserveMean,
    saturation,
    weights
  );

  if (useSelection) {
    report && report("statusApplyingMask");
    await applySelectionAsMask(doc, dupLayer);
  }

  // Dokument-Modus wiederherstellen. Methode A hat oben das GESAMTE
  // Dokument nach Lab gewandelt (der Stretch braucht die Lab-Kanäle).
  // Ohne Rückwandlung bliebe das Dokument dauerhaft in Lab — Folgen:
  // Methode B (erwartet RGB) interpretierte die Lab-Pixel als RGB und
  // lieferte Farbsalat, und der normale RGB-Workflow (Export, Ebenen per
  // Deckkraft überblenden) war gebrochen, weil der Farbmodus dokumentweit
  // gilt, nicht pro Ebene. Daher standardmäßig zurück nach RGB. Die
  // Umwandlung ist farbmetrisch, also erscheinungstreu — der eingebackene
  // Stretch bleibt erhalten; nur sehr stark gestreckte Farben außerhalb
  // des RGB-Farbraums werden an dessen Rand gekappt (für jede RGB-Nutzung
  // ohnehin unvermeidlich).
  //
  // Ausnahme (keepLab): Für die fortgeschrittene Kanal-Bearbeitung (z. B.
  // den a*-Kanal als eigenes Dokument herausziehen und mit dem vollen
  // Werkzeugsatz bearbeiten) muss das Ergebnis IN Lab vorliegen — dann
  // überspringen wir die Rückwandlung bewusst. Der Nutzer muss dann selbst
  // nach RGB wandeln, bevor Methode B läuft; falls er es vergisst, fängt
  // ihn der RGB-Guard am Anfang von runReWorkflow mit klarer Meldung ab.
  if (!keepLab) {
    report && report("statusSwitchRgb");
    await action.batchPlay(
      [{ _obj: "convertMode", to: { _class: "RGBColorMode" } }],
      {}
    );
  }
}

/**
 * Gray-World-Farbausgleich (CB): skaliert R, G, B unabhängig so, dass
 * ihre Mittelwerte gleich werden — entfernt einen multiplikativen
 * Farbstich (z. B. rötlicher Fels-Hintergrund), bevor der eigentliche
 * Stretch berechnet wird. Eine reine Verschiebung (Addition) hätte hier
 * keinen Effekt auf die Kovarianzmatrix — nur eine Skalierung verändert
 * tatsächlich die Korrelationsstruktur, die der Stretch danach nutzt.
 */
async function applyGrayWorldBalance(doc, layer) {
  const pixelData = await imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
  });
  const { imageData } = pixelData;
  const { width, height, components } = imageData;
  const raw = await imageData.getData({ chunky: true });
  const pixelCount = width * height;
  const maxValue = getMaxValue(raw);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * components;
    sumR += raw[o];
    sumG += raw[o + 1];
    sumB += raw[o + 2];
  }
  const meanR = sumR / pixelCount;
  const meanG = sumG / pixelCount;
  const meanB = sumB / pixelCount;
  const gray = (meanR + meanG + meanB) / 3;

  const factorR = meanR > 1e-6 ? gray / meanR : 1;
  const factorG = meanG > 1e-6 ? gray / meanG : 1;
  const factorB = meanB > 1e-6 ? gray / meanB : 1;

  const outData = new raw.constructor(raw.length);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * components;
    outData[o] = clampTo(Math.round(raw[o] * factorR), maxValue);
    outData[o + 1] = clampTo(Math.round(raw[o + 1] * factorG), maxValue);
    outData[o + 2] = clampTo(Math.round(raw[o + 2] * factorB), maxValue);
    if (components >= 4) outData[o + 3] = raw[o + 3];
  }

  await writeBack(doc, layer, imageData, outData, width, height, components);
}

async function applyStretchToLayerLab(
  doc,
  layer,
  targetSigma,
  preserveMean,
  saturation,
  weights
) {
  const pixelData = await imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
  });
  const { imageData } = pixelData;
  const { width, height, components } = imageData;

  const raw = await imageData.getData({ chunky: true });
  const hasAlpha = components >= 4;
  const pixelCount = width * height;

  // Bit-Tiefe aus dem tatsächlichen Datentyp ableiten (siehe getMaxValue).
  // "Lightroom -> In Photoshop bearbeiten" liefert typischerweise
  // 16-Bit-Daten (Uint16Array), manuelles Öffnen oft 8-Bit (Uint8Array).
  const maxValue = getMaxValue(raw);
  const neutral = getNeutral(maxValue);

  // Diagnose: tatsächliche Wertebereiche der Rohdaten in die Konsole
  // schreiben (UXP Developer Tool -> "..." -> "Show DevTools"). Damit
  // lässt sich prüfen, ob "neutral = maxValue/2" wirklich stimmt, statt
  // das nur zu vermuten — z. B. sollte der Mittelwert von L bei einem
  // halbwegs ausgewogenen Foto ungefähr in der Bildmitte liegen, und
  // min/max von a*/b* sollten grob symmetrisch um den angenommenen
  // Neutralpunkt liegen.
  if (DEBUG) {
    let lMin = Infinity, lMax = -Infinity, aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (let i = 0; i < pixelCount; i++) {
      const o = i * components;
      if (raw[o] < lMin) lMin = raw[o];
      if (raw[o] > lMax) lMax = raw[o];
      if (raw[o + 1] < aMin) aMin = raw[o + 1];
      if (raw[o + 1] > aMax) aMax = raw[o + 1];
      if (raw[o + 2] < bMin) bMin = raw[o + 2];
      if (raw[o + 2] > bMax) bMax = raw[o + 2];
    }
    console.log(
      `[Umbra] Diagnose Methode A: Datentyp=${raw.constructor.name} maxValue=${maxValue} angenommener neutral=${neutral}\n` +
      `  L-Kanal roh: min=${lMin} max=${lMax}\n` +
      `  a-Kanal roh: min=${aMin} max=${aMax} (Mitte laut Rohdaten: ${((aMin+aMax)/2).toFixed(1)}, angenommen: ${neutral})\n` +
      `  b-Kanal roh: min=${bMin} max=${bMax} (Mitte laut Rohdaten: ${((bMin+bMax)/2).toFixed(1)}, angenommen: ${neutral})`
    );
  }

  const A = new Float32Array(pixelCount);
  const B = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * components;
    A[i] = raw[o + 1] - neutral;
    B[i] = raw[o + 2] - neutral;
  }

  const { mean, sumW } = weightedMean([A, B], weights, pixelCount);
  const [meanA, meanB] = mean;
  const cov = weightedCovariance([A, B], mean, weights, pixelCount, sumW);
  const [[caa, cab], [, cbb]] = cov;

  // Ziel-Sigma ist für 8-Bit-Bilder kalibriert (Slider 10–100). Bei
  // größerem Wertebereich (16-Bit) proportional mitskalieren, sonst wäre
  // der Stretch bei 16-Bit praktisch unsichtbar klein.
  const scaledSigma = targetSigma * (maxValue / 255);

  const T = buildStretchMatrix2x2(caa, cab, cbb, scaledSigma);

  const outData = new raw.constructor(raw.length);
  const outMeanA = preserveMean ? meanA : 0;
  const outMeanB = preserveMean ? meanB : 0;

  for (let i = 0; i < pixelCount; i++) {
    const da = A[i] - meanA;
    const db = B[i] - meanB;
    // Sättigung skaliert nur die Chroma-Abweichung (das eigentliche
    // Stretch-Ergebnis), nicht den gewählten Farbmittelpunkt — sonst
    // würde ein reduzierter Sättigungswert auch den Farbstich
    // verschieben statt nur die Farbintensität zu dämpfen.
    const newA = outMeanA + (T[0][0] * da + T[0][1] * db) * saturation;
    const newB = outMeanB + (T[1][0] * da + T[1][1] * db) * saturation;

    const o = i * components;
    outData[o] = raw[o];
    outData[o + 1] = clampTo(Math.round(newA + neutral), maxValue);
    outData[o + 2] = clampTo(Math.round(newB + neutral), maxValue);
    if (hasAlpha) outData[o + 3] = raw[o + 3];
  }

  await writeBack(doc, layer, imageData, outData, width, height, components);
}

// ---------------------------------------------------------------------
// Methode B: YRE / LRE (modifizierter YUV- bzw. Lab-Farbraum)
// ---------------------------------------------------------------------

async function runReWorkflow(
  space,
  mults,
  targetSigma,
  preserveMean,
  report,
  profileName,
  saturation,
  grayscale,
  colorBalance,
  featherRadius
) {
  const doc = app.activeDocument;
  if (!doc) throw new Error(t("errNoDocument"));

  // Methode B rechnet direkt auf den Pixeln als R/G/B. Ist das Dokument
  // NICHT in RGB (z. B. weil eine ältere Plugin-Version Methode A ohne
  // Rückwandlung in Lab hinterlassen hat, oder weil der Modus von Hand
  // umgestellt wurde), würden die Kanäle fehlinterpretiert -> stille
  // Falschfarben statt eines Fehlers. Lieber klar abbrechen.
  //
  // Bewusst fail-open und POSITIV auf bekannte Nicht-RGB-Modi geprüft
  // (statt "enthält kein RGB"): document.mode ist zwar dokumentiert als
  // String wie "RGBColorMode"/"labColorMode", aber es gibt Forenberichte
  // über abweichendes Verhalten. So bricht B nur ab, wenn ein Nicht-RGB-
  // Modus SICHER erkannt wird; bei unerwartetem Wert läuft es wie bisher
  // weiter (kein neuer Blocker durch eine unsichere Modus-Erkennung).
  try {
    const mode = String((doc && doc.mode) || "").toLowerCase();
    const nonRgb = ["lab", "cmyk", "gray", "index", "bitmap", "duotone", "multichannel"];
    if (nonRgb.some((m) => mode.indexOf(m) !== -1)) {
      throw new Error(t("errNotRgb"));
    }
  } catch (e) {
    if (e && e.message === t("errNotRgb")) throw e;
    // Modus nicht sicher lesbar -> nicht blockieren.
  }

  const labels = MULT_LABELS[space];
  const multTxt = mults.map((v, i) => `${labels[i]}=${v}`).join(" ");

  // Kein Moduswechsel: Dokument bleibt in RGB, die Farbraum-Umrechnung
  // passiert intern pro Pixel (wie in DStretch).
  const layerSuffix = buildLayerSuffix(
    space,
    targetSigma,
    saturation,
    colorBalance,
    grayscale
  );
  const dupLayer = await duplicateBaseLayer(doc, layerSuffix, report);

  const useSelection = await hasActiveSelection(doc);
  let weights = null;
  if (useSelection) {
    report && report("statusSelectionWeights");
    weights = await buildSelectionWeights(doc, featherRadius);
  }

  if (colorBalance) {
    report && report("statusColorBalance");
    await applyGrayWorldBalance(doc, dupLayer);
  }

  report &&
    report(
      "statusComputingSpace",
      space,
      Math.round(targetSigma),
      multTxt,
      profileName
    );
  await applyStretchToLayerRe(
    doc,
    dupLayer,
    space,
    mults,
    targetSigma,
    preserveMean,
    profileName,
    saturation,
    grayscale,
    weights
  );

  if (useSelection) {
    report && report("statusApplyingMask");
    await applySelectionAsMask(doc, dupLayer);
  }
}

async function applyStretchToLayerRe(
  doc,
  layer,
  space,
  mults,
  targetSigma,
  preserveMean,
  profileName,
  saturation,
  grayscale,
  weights
) {
  const pixelData = await imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
  });
  const { imageData } = pixelData;
  const { width, height, components } = imageData;

  const raw = await imageData.getData({ chunky: true });
  const hasAlpha = components >= 4;
  const pixelCount = width * height;

  // Bit-Tiefe erkennen (siehe getMaxValue-Kommentar bei Methode A).
  const maxValue = getMaxValue(raw);
  const toEightBit = maxValue === 255 ? 1 : 255 / maxValue;
  const fromEightBit = maxValue === 255 ? 1 : maxValue / 255;

  // Diagnose (siehe ausführlicher Kommentar bei Methode A) — hier für die
  // rohen R/G/B-Werte, bevor irgendeine Farbraum-Umrechnung passiert.
  if (DEBUG) {
    let rMin = Infinity, rMax = -Infinity, gMin = Infinity, gMax = -Infinity, bMin2 = Infinity, bMax2 = -Infinity;
    for (let i = 0; i < pixelCount; i++) {
      const o = i * components;
      if (raw[o] < rMin) rMin = raw[o];
      if (raw[o] > rMax) rMax = raw[o];
      if (raw[o + 1] < gMin) gMin = raw[o + 1];
      if (raw[o + 1] > gMax) gMax = raw[o + 1];
      if (raw[o + 2] < bMin2) bMin2 = raw[o + 2];
      if (raw[o + 2] > bMax2) bMax2 = raw[o + 2];
    }
    console.log(
      `[Umbra] Diagnose Methode B (${space}): Datentyp=${raw.constructor.name} maxValue=${maxValue} toEightBit=${toEightBit.toFixed(6)}\n` +
      `  R roh: min=${rMin} max=${rMax}\n  G roh: min=${gMin} max=${gMax}\n  B roh: min=${bMin2} max=${bMax2}\n` +
      `  (Falls max hier deutlich über ${maxValue} liegt, ist die maxValue-Annahme falsch.)`
    );
  }

  const profile = PROFILES[profileName] || PROFILES.sRGB;

  // YRE nutzt eine einfache lineare YUV-Matrix direkt auf den
  // gamma-kodierten Werten (wie klassisches Video-YUV) — dort spielt das
  // gewählte RGB-Profil keine Rolle, nur LRE braucht es für die
  // physikalisch korrekte RGB<->XYZ<->Lab-Umrechnung.
  const toSpace =
    space === "YRE" ? rgbToYuv : (r, g, b) => rgbToLab(r, g, b, profile);
  const fromSpace =
    space === "YRE" ? yuvToRgb : (L, a, b) => labToRgb(L, a, b, profile);

  // --- 1) Auf 0..255 normalisieren, in den Farbraum konvertieren,
  //         Kanäle skalieren. Die Farbraum-Formeln (Gammakorrektur etc.)
  //         sind für den 0..255-Bereich geschrieben; die eigentliche
  //         Rechengenauigkeit bleibt durch die Float32-Zwischenwerte
  //         erhalten, es geht nur die letzte Nachkommastelle der
  //         16-Bit-Auflösung verloren. ---
  const C0 = new Float32Array(pixelCount);
  const C1 = new Float32Array(pixelCount);
  const C2 = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * components;
    const c = toSpace(
      raw[o] * toEightBit,
      raw[o + 1] * toEightBit,
      raw[o + 2] * toEightBit
    );
    C0[i] = c[0] * mults[0];
    C1[i] = c[1] * mults[1];
    C2[i] = c[2] * mults[2];
  }

  // --- 2) Mittelwerte + 3) Kovarianzmatrix (beide gewichtet, falls eine
  //         Auswahl aktiv war) — siehe weightedMean()/weightedCovariance()
  //         weiter oben, gemeinsam mit Methode A genutzt. ---
  const { mean, sumW } = weightedMean([C0, C1, C2], weights, pixelCount);
  const cov = weightedCovariance([C0, C1, C2], mean, weights, pixelCount, sumW);

  // --- 4) Karhunen-Loeve: Eigenzerlegung + Stretch-Matrix ---
  // (Der Stretch selbst rechnet immer auf der 0..255-Skala, unabhängig
  // von der Bit-Tiefe des Dokuments — daher hier KEINE Sigma-Skalierung
  // nötig, anders als bei Methode A, wo a*/b* direkt aus den Rohbytes
  // gelesen werden.)
  const { eigenvalues, eigenvectors } = jacobiEigen3x3(cov);
  const T = buildStretchMatrix3x3(eigenvectors, eigenvalues, targetSigma);

  // --- 5) Anwenden, Skalierung rückgängig, zurück nach RGB, zurück auf
  //         native Bit-Tiefe ---
  // Der Helligkeits-Mittelwert (Kanal 0) wird immer beibehalten, sonst
  // kippt das Bild insgesamt ins Schwarze. Die Checkbox steuert nur die
  // beiden Farbkanäle.
  const outMean = [
    mean[0],
    preserveMean ? mean[1] : 0,
    preserveMean ? mean[2] : 0,
  ];

  const outData = new raw.constructor(raw.length);
  for (let i = 0; i < pixelCount; i++) {
    const d0 = C0[i] - mean[0];
    const d1 = C1[i] - mean[1];
    const d2 = C2[i] - mean[2];

    const s0 = outMean[0] + T[0][0] * d0 + T[0][1] * d1 + T[0][2] * d2;
    // Sättigung skaliert nur die beiden Chroma-Kanäle (1,2), nicht den
    // Helligkeitskanal (0) — sonst würde reduzierte Sättigung auch die
    // Helligkeit verändern statt nur die Farbintensität zu dämpfen.
    const s1 =
      outMean[1] + (T[1][0] * d0 + T[1][1] * d1 + T[1][2] * d2) * saturation;
    const s2 =
      outMean[2] + (T[2][0] * d0 + T[2][1] * d1 + T[2][2] * d2) * saturation;

    // Kanal-Skalierung rückgängig machen (0..255-Skala)
    const rgb = fromSpace(s0 / mults[0], s1 / mults[1], s2 / mults[2]);

    // Graustufen-Option: das fertige, gestreckte RGB-Ergebnis in
    // Helligkeit umwandeln (Standard-Luminanzgewichtung) — zeigt die vom
    // Stretch erzeugten Unterschiede als Helligkeitskontrast statt als
    // Farbe. Bewusst NACH dem Stretch, nicht als "kein Farbraum"-Modus,
    // damit die eigentliche Stretch-Berechnung unverändert bleibt.
    let outR = rgb[0];
    let outG = rgb[1];
    let outB = rgb[2];
    if (grayscale) {
      const lum = Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
      outR = outG = outB = clamp255(lum);
    }

    const o = i * components;
    outData[o] = clampTo(Math.round(outR * fromEightBit), maxValue);
    outData[o + 1] = clampTo(Math.round(outG * fromEightBit), maxValue);
    outData[o + 2] = clampTo(Math.round(outB * fromEightBit), maxValue);
    if (hasAlpha) outData[o + 3] = raw[o + 3];
  }

  await writeBack(doc, layer, imageData, outData, width, height, components);
}

// ---------------------------------------------------------------------
// Gemeinsames Zurückschreiben
// ---------------------------------------------------------------------

async function writeBack(
  doc,
  layer,
  imageData,
  outData,
  width,
  height,
  components
) {
  // Sicherheitsnetz: Sollte trotz clampTo() irgendwo ein Wert außerhalb
  // des gültigen Bereichs stehen (z. B. durch einen Rechenfehler), lieber
  // hier mit einer klaren eigenen Meldung abbrechen als Photoshops
  // kryptischen "outside the Photoshop range"-Fehler zu riskieren.
  const maxValue = getMaxValue(outData);
  let outOfRange = 0;
  for (let i = 0; i < outData.length; i++) {
    const val = outData[i];
    // Number.isFinite() zuerst: NaN/Infinity bestehen sonst BEIDE
    // Vergleiche (NaN < 0 und NaN > maxValue sind je false) und würden
    // ungeprüft durchrutschen — genau der Wert, den dieses Netz abfangen
    // soll. Bei Float32-Ebenen (32 Bit) bliebe das NaN erhalten und ginge
    // direkt an Photoshop; bei Uint8/Uint16 wird es beim Schreiben ins
    // TypedArray zwar zu 0, aber ein klarer Fehler ist besser als eine
    // still geschwärzte Ebene.
    if (!Number.isFinite(val) || val < 0 || val > maxValue) outOfRange++;
  }
  if (outOfRange > 0) {
    throw new Error(
      `Interner Fehler: ${outOfRange} Pixelwerte ungültig oder außerhalb des gültigen Bereichs (0-${maxValue}) vor dem Schreiben gefunden.`
    );
  }

  const newImageData = await imaging.createImageDataFromBuffer(outData, {
    width,
    height,
    components,
    colorSpace: imageData.colorSpace,
  });

  await imaging.putPixels({
    documentID: doc.id,
    layerID: layer.id,
    imageData: newImageData,
  });

  newImageData.dispose();
  imageData.dispose();
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Ermittelt den nativen Maximalwert der Pixeldaten anhand des tatsächlich
 * von getData() gelieferten TypedArray-Typs — nicht anhand einer
 * Annahme. Damit funktioniert der Code unabhängig davon, ob Photoshop das
 * Bild in 8-Bit oder 16-Bit pro Kanal liefert (z. B. bei Bildern, die über
 * Lightrooms "Bearbeiten in Photoshop" als 16-Bit-Datei übergeben werden).
 *
 * Verlauf zu diesem Wert (damit die Historie nachvollziehbar bleibt):
 * Erst 32768 angenommen (klassische Photoshop-"15-Bit+1"-Konvention) ->
 * nach einem Test mit echter 16-Bit-Datei wirkten Farben dunkler/
 * gesättigter, daraufhin fälschlich auf 65535 geändert -> das erzeugte
 * beim Schreiben den harten Fehler "16 bit value is outside the
 * Photoshop range". Ein harter Fehler ist ein zuverlässigerer Beweis als
 * ein optischer Eindruck: 32768 ist die tatsächliche Grenze, die
 * Photoshop beim Schreiben akzeptiert. Der "dunkler/gesättigter"-Eindruck
 * von vorhin war entweder eine andere Ursache oder schlicht das korrekte
 * Ergebnis des Stretches auf echten 16-Bit-Daten — das ist an dieser
 * Stelle offen, aber der Absturz hat Vorrang und ist jetzt behoben.
 */
function getMaxValue(raw) {
  if (raw instanceof Uint16Array) return 32768;
  if (raw instanceof Float32Array) return 1;
  return 255; // Uint8Array / Uint8ClampedArray
}

/**
 * Neutralpunkt (Mitte) für a* und b*. Bewusst NICHT einfach maxValue/2, denn
 * für 8-Bit (maxValue=255, ungerade) wäre das 127.5 — der tatsächliche,
 * in praktisch jeder Bildsoftware inklusive Photoshop verwendete
 * Standard-Neutralwert für 8-Bit-Lab ist 128 (ganzzahlig). Für 16-Bit ist
 * maxValue=32768 gerade, daher fällt maxValue/2=16384 hier mit keiner
 * bekannten abweichenden Konvention zusammen.
 */
function getNeutral(maxValue) {
  if (maxValue === 255) return 128;
  return maxValue / 2;
}

function clampTo(v, maxValue) {
  return v < 0 ? 0 : v > maxValue ? maxValue : v;
}

// ---------------------------------------------------------------------
// Lineare Algebra
// ---------------------------------------------------------------------

function buildStretchMatrix2x2(caa, cab, cbb, targetSigma) {
  const trace = caa + cbb;
  const det = caa * cbb - cab * cab;
  const disc = Math.sqrt(Math.max((trace * trace) / 4 - det, 0));

  const lambda1 = trace / 2 + disc;
  const lambda2 = trace / 2 - disc;

  // Sind die beiden Eigenwerte (fast) gleich, ist die Kovarianzmatrix
  // (fast) ein Vielfaches der Einheitsmatrix — die Eigenrichtungen sind
  // dann nicht eindeutig, und JEDE orthonormale Basis ist korrekt (der
  // Fehler ist O(disc/trace)). In diesem Fall MUSS die achsenparallele
  // Basis [1,0]/[0,1] direkt gesetzt werden, aus zwei Gründen:
  //  1. Bei exakt gleicher Varianz (caa≈cbb, cab≈0) liefert der Tie-Break
  //     in eigenvector2x2() für BEIDE Eigenwerte denselben Vektor [0,1] —
  //     die Stretch-Matrix verlöre dann die a*-Achse komplett, der
  //     a*-Kanal würde flachgedrückt statt gestreckt.
  //  2. Bei fast gleicher Varianz mit winzigem (aber nicht null) cab teilt
  //     die Eigenvektor-Formel `(λ-caa)/cab` "fast null durch fast null"
  //     und liefert numerischen Müll (nahezu parallele Vektoren).
  // Die Prüfung ist deshalb bewusst RELATIV (disc gegen die Spur), nicht
  // gegen eine feste absolute Schwelle für cab. Sind die Eigenwerte klar
  // getrennt, ist die Formel gut konditioniert und wird genutzt.
  let eig1, eig2;
  const nearlyIsotropic = disc <= 1e-6 * Math.max(Math.abs(trace), 1);
  if (nearlyIsotropic || Math.abs(cab) <= 1e-9) {
    if (caa >= cbb) {
      eig1 = [1, 0];
      eig2 = [0, 1];
    } else {
      eig1 = [0, 1];
      eig2 = [1, 0];
    }
  } else {
    eig1 = eigenvector2x2(caa, cab, cbb, lambda1);
    eig2 = eigenvector2x2(caa, cab, cbb, lambda2);
  }

  const scale1 = lambda1 > 1e-6 ? targetSigma / Math.sqrt(lambda1) : 0;
  const scale2 = lambda2 > 1e-6 ? targetSigma / Math.sqrt(lambda2) : 0;

  const T = [
    [0, 0],
    [0, 0],
  ];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      T[i][j] = eig1[i] * scale1 * eig1[j] + eig2[i] * scale2 * eig2[j];
    }
  }
  return T;
}

function eigenvector2x2(caa, cab, cbb, lambda) {
  if (Math.abs(cab) > 1e-9) {
    const vx = 1;
    const vy = (lambda - caa) / cab;
    const norm = Math.hypot(vx, vy) || 1;
    return [vx / norm, vy / norm];
  }
  return Math.abs(lambda - caa) < Math.abs(lambda - cbb) ? [1, 0] : [0, 1];
}

/**
 * T = E * diag(targetSigma / sqrt(lambda_i)) * E^T
 * E wird zeilenweise übergeben (E[i] = i-ter Eigenvektor).
 */
function buildStretchMatrix3x3(E, eigenvalues, targetSigma) {
  const scale = eigenvalues.map((lambda) =>
    lambda > 1e-6 ? targetSigma / Math.sqrt(lambda) : 0
  );

  const T = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += E[k][i] * scale[k] * E[k][j];
      T[i][j] = sum;
    }
  }
  return T;
}

/**
 * Zyklisches Jacobi-Verfahren für symmetrische 3x3-Matrizen.
 * Rückgabe: eigenvalues[3], eigenvectors[3][3] (zeilenweise).
 */
function jacobiEigen3x3(matrix, maxIterations = 50) {
  const a = [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < maxIterations; iter++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-9) break;

    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-12) continue;

      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t =
        (theta >= 0 ? 1 : -1) /
        (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      const app = a[p][p];
      const aqq = a[q][q];
      const apq = a[p][q];

      a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
      a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
      a[p][q] = 0;
      a[q][p] = 0;

      for (let k = 0; k < 3; k++) {
        if (k !== p && k !== q) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[p][k] = a[k][p];
          a[k][q] = s * akp + c * akq;
          a[q][k] = a[k][q];
        }
      }

      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }

  return {
    eigenvalues: [a[0][0], a[1][1], a[2][2]],
    eigenvectors: [
      [v[0][0], v[1][0], v[2][0]],
      [v[0][1], v[1][1], v[2][1]],
      [v[0][2], v[1][2], v[2][2]],
    ],
  };
}

// ---------------------------------------------------------------------
// Farbraum-Konvertierungen (Eingang/Ausgang: RGB 0..255, gammakodiert)
// ---------------------------------------------------------------------

// YUV nach BT.601 — arbeitet direkt auf gammakodierten Werten (wie
// klassisches Video-YUV), keine Profil-Abhängigkeit.
function rgbToYuv(r, g, b) {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    -0.14713 * r - 0.28886 * g + 0.436 * b,
    0.615 * r - 0.51499 * g - 0.10001 * b,
  ];
}

function yuvToRgb(y, u, v) {
  return [
    clamp255(Math.round(y + 1.13983 * v)),
    clamp255(Math.round(y - 0.39465 * u - 0.5806 * v)),
    clamp255(Math.round(y + 2.03211 * u)),
  ];
}

// --- RGB-Profile für die Lab-Umrechnung (LRE) ---
//
// Beide Profile hier nutzen D65 als Referenzweiß (sRGB UND Adobe RGB
// (1998) tun das — anders als z. B. ProPhoto RGB, das D50 nutzt). Es
// unterscheiden sich nur die Primärfarben (RGB<->XYZ-Matrix) und die
// Gammakurve.
//
// Adobe RGB nutzt eine einfache Potenzfunktion mit Gamma 2.2 (die exakte
// Spezifikation nennt 563/256 ≈ 2.19921875 — 2.2 ist die praktisch
// überall verwendete Vereinfachung, auch in Photoshop selbst). Die
// Matrix-Koeffizienten sind Standardwerte aus der Farbwissenschaft
// (u. a. Bruce Lindbloom), keine Photoshop-API-Vermutung — hier bin ich
// deutlich sicherer als bei den bisherigen UXP-spezifischen Annahmen.

const D65 = { x: 0.95047, y: 1.0, z: 1.08883 };
const DELTA = 6 / 29;

function srgbToLinear(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  const val = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return clamp255(Math.round(val * 255));
}

function adobeRgbToLinear(c) {
  return Math.pow(c / 255, 2.2);
}
function linearToAdobeRgb(c) {
  return clamp255(Math.round(Math.pow(Math.max(c, 0), 1 / 2.2) * 255));
}

const PROFILES = {
  sRGB: {
    toLinear: srgbToLinear,
    fromLinear: linearToSrgb,
    // RGB(linear) -> XYZ, sRGB/D65 (Standardmatrix)
    M: [
      [0.4124564, 0.3575761, 0.1804375],
      [0.2126729, 0.7151522, 0.072175],
      [0.0193339, 0.119192, 0.9503041],
    ],
    // XYZ -> RGB(linear), sRGB/D65 (Standardmatrix)
    Minv: [
      [3.2404542, -1.5371385, -0.4985314],
      [-0.969266, 1.8760108, 0.041556],
      [0.0556434, -0.2040259, 1.0572252],
    ],
  },
  AdobeRGB: {
    toLinear: adobeRgbToLinear,
    fromLinear: linearToAdobeRgb,
    // RGB(linear) -> XYZ, Adobe RGB (1998)/D65 (Standardmatrix)
    M: [
      [0.5767309, 0.185554, 0.1881852],
      [0.2973769, 0.6273491, 0.0752741],
      [0.0270343, 0.0706872, 0.9911085],
    ],
    // XYZ -> RGB(linear), Adobe RGB (1998)/D65 (Standardmatrix)
    Minv: [
      [2.041369, -0.5649464, -0.3446944],
      [-0.969266, 1.8760108, 0.041556],
      [0.0134474, -0.1183897, 1.0154096],
    ],
  },
};

function labF(t) {
  return t > DELTA * DELTA * DELTA
    ? Math.cbrt(t)
    : t / (3 * DELTA * DELTA) + 4 / 29;
}
function labFInv(t) {
  return t > DELTA ? t * t * t : 3 * DELTA * DELTA * (t - 4 / 29);
}

function rgbToLab(r, g, b, profile) {
  const rl = profile.toLinear(r);
  const gl = profile.toLinear(g);
  const bl = profile.toLinear(b);
  const M = profile.M;

  const x = (M[0][0] * rl + M[0][1] * gl + M[0][2] * bl) / D65.x;
  const y = (M[1][0] * rl + M[1][1] * gl + M[1][2] * bl) / D65.y;
  const z = (M[2][0] * rl + M[2][1] * gl + M[2][2] * bl) / D65.z;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L, a, bb, profile) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;

  const x = D65.x * labFInv(fx);
  const y = D65.y * labFInv(fy);
  const z = D65.z * labFInv(fz);

  const Minv = profile.Minv;
  const rl = Minv[0][0] * x + Minv[0][1] * y + Minv[0][2] * z;
  const gl = Minv[1][0] * x + Minv[1][1] * y + Minv[1][2] * z;
  const bl = Minv[2][0] * x + Minv[2][1] * y + Minv[2][2] * z;

  return [profile.fromLinear(rl), profile.fromLinear(gl), profile.fromLinear(bl)];
}
