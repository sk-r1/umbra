# Umbra – Decorrelation Stretch für Photoshop (UXP-Plugin)

Wendet einen klassischen **Decorrelation Stretch** (nach Gillespie et al.,
bekannt aus Fernerkundung und Fotografie von Felszeichnungen/"DStretch") auf
eine duplizierte Ebene an: Im Lab-Farbraum werden die a*- und b*-Kanäle
(Farbinformation) per PCA entkorreliert, auf gleiche Varianz gestreckt und
wieder zurücktransformiert. Die Helligkeit (L*) bleibt unangetastet.
Ergebnis: stark verstärkter Farbkontrast, versteckte Farbunterschiede
werden sichtbar.

## Dateien

- `manifest.json` – UXP-Plugin-Manifest (Panel-Eintrag, Host = Photoshop)
- `index.html` – kleines Bedienpanel (Sigma-Regler, Button)
- `main.js` – Algorithmus (Mittelwert, Kovarianz, Jacobi-Eigenzerlegung,
  Stretch-Matrix, Pixel-Transformation) + UXP-`imaging`-API-Aufrufe
- `icons/icon.png` / `icons/icon@2x.png` – Panel-Icon (1× = 23×23 px, 2× = 46×46 px)

## Installation

### Empfohlen: fertiges Plugin (`.ccx`)

1. Auf der [Releases-Seite](https://github.com/sk-r1/umbra/releases) die
   aktuelle Datei `Umbra-x.y.z.ccx` herunterladen (unter „Assets").
2. Doppelklick auf die Datei. Die **Creative Cloud Desktop App** startet
   die Installation. Sie weist darauf hin, dass das Plugin aus einer
   **inoffiziellen Quelle** stammt (es ist nicht im Adobe-Marketplace) —
   das ist normal; mit Bestätigung wird Umbra installiert.
3. Photoshop starten (bzw. neu starten): Das Panel „Umbra" erscheint unter
   Fenster → Plugins.

Falls die Installation fehlschlägt: Umbra vorher im UXP Developer Tool
entladen (falls dort geladen), Photoshop schließen und die `.ccx` erneut
per Doppelklick öffnen.

### Für Entwickler: Testen mit dem UXP Developer Tool

1. **UXP Developer Tool** von Adobe installieren (kostenlos, über die
   Creative Cloud Desktop App oder direkt von Adobes Entwicklerseite).
2. Photoshop → Einstellungen → Plugins → **"Entwicklermodus"** aktivieren.
3. Im UXP Developer Tool: "Add Plugin" → diesen Ordner auswählen
   (`manifest.json` muss direkt darin liegen) → "Load".
   **Wichtig:** Der Unterordner `icons/` muss beim Speichern/Kopieren des
   Projekts erhalten bleiben (Icons liegen unter `icons/icon.png` und
   `icons/icon@2x.png`, passend zu den Pfaden in `manifest.json`). Landen
   die Icon-Dateien versehentlich direkt im Projekt-Hauptverzeichnis statt
   im `icons`-Unterordner, findet Photoshop sie nicht und das Panel-Icon
   bleibt schwarz.
4. Das Panel "Umbra" erscheint in Photoshop unter Fenster → Plugins.

## Zwei Methoden

**Methode A — Lab a/b (bisheriges Verhalten)**
Ebene duplizieren → Dokument nach Lab konvertieren → 2×2-Stretch nur auf
a*/b*. Die Helligkeit L* bleibt exakt unverändert.

**Methode B — YRE / LRE (an DStretch für ImageJ angelehnt)**
Ebene duplizieren → Dokument bleibt in RGB → pro Pixel intern nach YUV
(YRE) bzw. Lab (LRE) konvertieren → Kanäle mit Multiplikatoren skalieren
→ volle 3×3-Decorrelation-Stretch (Karhunen-Loève) → Skalierung
rückgängig → zurück nach RGB.

Laut Jon Harmans Algorithmus-Beschreibung sind YDS, YBR, YBK, LDS und LRE
keine eigenständigen Farbräume, sondern Modifikationen von YUV bzw. LAB;
das Bild wird von RGB in den Farbraum konvertiert, dort werden
Kovarianzmatrix und 3×3-Transformation bestimmt, anschließend geht es
zurück nach RGB. Genau dieses Prinzip bildet Methode B nach.

**Wichtige Einschränkung:** Die konkreten Multiplikatoren, die Harman für
YRE bzw. LRE verwendet, sind nicht veröffentlicht. Die Startwerte im
Plugin (YRE: 1.0 / 0.6 / 1.6 — LRE: 1.0 / 1.6 / 0.6) sind plausible
Schätzwerte, **keine Originalwerte**. Sie sind deshalb im UI frei
editierbar, entsprechend Harmans YXX/LXX-Modus. Das Ergebnis wird dem
Original-DStretch also ähneln, aber nicht damit identisch sein.

**Sigma-Empfehlung für Methode B:** eher niedrig (ca. 15–30; Standardwert
seit 1.2.0: 15). DStretch
nutzt als Standard-Skala 15. Ein Test mit synthetischen, stark
korrelierten Farbdaten ergab bei Sigma 60 rund 21 % abgeschnittene Pixel,
bei Sigma 20 keine.

## Workflow

Ein Klick auf den Button macht:

1. Basis-/Hintergrundebene duplizieren (über `layer.duplicate()`)
2. Bei Methode A: Dokumentmodus auf Lab-Farbe wechseln (gilt fürs ganze
   Dokument – Farbmodus ist keine Ebeneneigenschaft).
   Bei Methode B: kein Moduswechsel, das Dokument bleibt in RGB.
3. Decorrelation Stretch auf die duplizierte Ebene anwenden

Frühere Versionen wandelten die duplizierte Ebene zusätzlich in ein Smart
Object um und bearbeiteten dessen eingebetteten Inhalt separat. Das führte
wiederholt zu "invalid target sheet"-Fehlern und dazu, dass Photoshop das
Bild ein zweites Mal öffnete – dieser Schritt wurde entfernt. Die
duplizierte Ebene ist jetzt eine normale Rasterebene.

## Bit-Tiefe (8-Bit / 16-Bit)

Bilder, die Lightroom Classic über "Bearbeiten in Photoshop" übergibt,
kommen typischerweise als **16-Bit-Datei** an (meist ProPhoto RGB TIFF),
manuell geöffnete Bilder oft als 8-Bit. Das Plugin erkennt die Bit-Tiefe
automatisch anhand des von Photoshop gelieferten Datentyps (`Uint8Array`
vs. `Uint16Array`) und rechnet entsprechend.

**Verlauf beim 16-Bit-Maximalwert (`getMaxValue` in `main.js`):**

1. Erste Version: 32768 (klassische Photoshop-"15-Bit+1"-Konvention).
2. Nach einem Test mit echter 16-Bit-Datei aus Lightroom wirkten Farben
   dunkler/gesättigter — daraufhin fälschlich auf 65535 geändert.
3. Das erzeugte beim Schreiben den harten Fehler *"16 bit value is
   outside the Photoshop range"*.
4. Zurückgesetzt auf **32768** — ein harter Fehler ist ein zuverlässiger
   Beweis für die tatsächliche Photoshop-Grenze, ein optischer Eindruck
   ("wirkt dunkler") dagegen nicht. Ob der ursprüngliche Dunkler/
   Gesättigter-Eindruck bei 32768 einen echten Bug hatte oder einfach das
   korrekte Ergebnis des Stretches auf 16-Bit-Präzision war, ist offen.

Zusätzlich prüft `writeBack()` jetzt vor jedem Schreibvorgang, ob alle
Pixelwerte im gültigen Bereich liegen, und bricht mit einer eigenen,
klaren Fehlermeldung ab statt Photoshops kryptischen Fehler zu
riskieren.

**Falls dir weiterhin ein Farbunterschied zwischen 8-Bit- und
16-Bit-Ergebnissen auffällt:** Das könnte tatsächlich einfach am
höheren Wertebereich/der höheren Präzision der 16-Bit-Daten liegen und
kein Bug sein — am besten an einem konkreten Bild vergleichen und mir
schildern, was genau anders aussieht (z. B. per Screenshot-Beschreibung
oder Angabe, welche Bildbereiche betroffen sind).

## Presets als Dateien (ab v0.12alpha)

YRE und LRE haben je zwei Buttons: "Preset speichern…" und "Preset
laden…". Beide öffnen den nativen Datei-Dialog von Photoshop/UXP
(`localFileSystem.getFileForSaving`/`getFileForOpening`) statt einer
intern verwalteten Liste mit eigenen Preset-Buttons — das hält das
Panel übersichtlicher. Ein Preset ist eine einzelne `.json`-Datei mit
den 3 Kanal-Multiplikatoren, dem aktuellen Sigma und dem gewählten
Farbraum-Profil (auch bei YRE mitgespeichert, auch wenn dort ohne
Wirkung — einheitlicher Datensatz).

Darunter steht eine einfache Anzeige "Geladenes Preset: `<Name>`" (Name
= Dateiname ohne `.json`), bzw. "Geladenes Preset: -", solange noch
nichts geladen/gespeichert wurde.

**Frühere Version (v0.11alpha)** hatte stattdessen eine intern verwaltete
Preset-Liste mit eigenen Lade-/Löschen-Buttons pro Preset, gespeichert im
plugin-eigenen UXP-Datenordner. Das wurde auf Wunsch durch das
schlankere Datei-Dialog-Verfahren ersetzt.

**Ehrlicher Hinweis:** `getFileForSaving`/`getFileForOpening` sind Teil
der UXP-Basisplattform (wie schon `getDataFolder` zuvor) — keine
Photoshop-spezifische Vermutung, aber ebenfalls nicht gegen echtes
Photoshop getestet. Beide Aufrufe sind defensiv in try/catch
eingebettet; bricht der Nutzer den Dialog ab oder schlägt der Zugriff
fehl, bleibt das Plugin nutzbar.

## Multiplikator-Felder schmaler (ab v0.12alpha)

Die 3 Eingabefelder für die Kanal-Multiplikatoren sind jetzt fest 48px
breit statt die volle Panel-Breite zu je einem Drittel auszufüllen.

## Fix: Preset-Anzeige nach "Zurücksetzen" (v0.13alpha)

"Multiplikatoren zurücksetzen" setzte die Werte zurück, ließ aber den
Namen des zuletzt geladenen Presets in der Anzeige stehen — obwohl die
Werte dann nicht mehr dem Preset entsprachen. `resetMults()` setzt jetzt
auch "Geladenes Preset:" für beide Methoden zurück auf "-".

Nach mehreren Rateversuchen zu Photoshops internen 16-Bit-Konventionen
(erst 32768, dann fälschlich 65535, dann zurück zu 32768) schreibt das
Plugin jetzt vor jeder Berechnung die tatsächlichen rohen
Kanal-Wertebereiche in die Konsole — sichtbar im UXP Developer Tool über
"..." → "Show DevTools". Das ersetzt weiteres Raten durch echte
Messwerte:

- Methode A: min/max von L, a\*, b\* sowie die daraus berechnete
  "Mitte laut Rohdaten" von a\*/b\*, im Vergleich zum angenommenen
  Neutralpunkt. Weichen beide bei einem Bild mit bekanntem
  Referenzgrau/-neutral strukturell ab, ist die Neutralpunkt-Annahme der
  Fehler. Bei einem gewöhnlichen Foto ist eine Abweichung dagegen
  normal — Bildinhalt mit warmem oder kühlem Grundton verschiebt den
  a*/b*-Mittelwert ganz regulär vom Neutralpunkt weg.
- Methode B: min/max von R, G, B roh, um zu prüfen, ob `maxValue`
  überhaupt zum tatsächlichen Datenbereich passt.

**Ergebnis der Fehlersuche (geklärt):** Der über mehrere Nachrichten
beobachtete Farbunterschied zwischen 8-Bit- und 16-Bit-Ergebnissen lag
NICHT am Plugin. Ursache war, dass Lightroom (über ein Import-Preset)
und manuelles Öffnen per Camera Raw der Datei unterschiedliche
Kamera-Profile zuwiesen ("Kamera Originalgetreu" vs. "Kamera Standard",
Canon EOS R1) — das sind grundverschiedene Farb-Renderings der
RAW-Rohdaten, bereits bevor das Plugin die Pixel sieht. Eine
Kontrollmessung mit identischem Kameraprofil (nur 8-Bit vs. 16-Bit)
zeigte danach nur noch die erwartete geringe Restabweichung, konsistent
mit echter zusätzlicher 16-Bit-Präzision ("feiner abgestuft"), kein Bug.

Die Diagnose-Logs (siehe unten) und die `getNeutral()`-Korrektur (128
statt 127.5 bei 8-Bit) bleiben trotzdem sinnvoll — sie waren während der
Suche hilfreich und schaden nicht, auch wenn sich die eigentliche
Ursache als plugin-extern herausstellte.

**Zum LRE-Phänomen "Grün wird teilweise, aber nicht vollständig zu
Blau":** Das könnte tatsächlich kein Bug sein. Der Stretch ist ein
statistisches Verfahren (PCA auf der tatsächlichen Bildverteilung) —
16-Bit-Daten enthalten mehr Präzision als 8-Bit, wodurch die berechnete
Kovarianzmatrix und damit die Streck-Transformation numerisch leicht
anders ausfällt. Pixel nahe einer Entscheidungsgrenze im Farbraum können
dadurch unterschiedlich "kippen" — genau das passt zu "einige Bereiche
wechseln, andere nicht". Das wäre dann eine Folge der höheren Präzision,
nicht falscher Werte. Unterscheidbar von einem echten Bug wäre das vor
allem durch die Diagnose-Werte oben.

## Farbprofil (sRGB / Adobe RGB) — betrifft nur Methode B (LRE)

Kameras/RAW-Konverter liefern Bilder oft nicht in sRGB. Bei Nutzung
wurde festgestellt: Lightroom Classic übergibt CR3-Dateien sowohl beim
manuellen Öffnen als auch über "Bearbeiten in Photoshop" durchgängig in
**Adobe RGB (1998)**. Da LRE für die Lab-Umrechnung feste Matrix-
Koeffizienten braucht (RGB<->XYZ), die vom tatsächlichen Farbprofil der
Pixel abhängen, führte eine falsche Annahme (sRGB angenommen, obwohl
Adobe RGB) zu einem systematischen Farbstich (Richtung Blau, erhöhter
Kontrast).

**Lösung:** Ein Umschalter im UI ("Adobe RGB (1998) statt sRGB")
zwischen zwei fest hinterlegten Profilen mit korrekten Matrix-
Koeffizienten (RGB<->XYZ) und der jeweils passenden Gammakurve:

- **sRGB:** übliche piecewise Gammakurve, D65-Weißpunkt.
- **Adobe RGB (1998):** einfache Potenzfunktion mit Gamma 2.2, D65-
  Weißpunkt (beide Profile teilen sich den Weißpunkt — anders als
  z. B. ProPhoto RGB, das D50 nutzt).

Die Matrix-Koeffizienten sind Standardwerte aus der Farbwissenschaft
(u. a. Bruce Lindbloom), keine Photoshop-API-Vermutung — hier ist die
Grundlage deutlich sicherer als bei den zuvor verworfenen
UXP-spezifischen Ansätzen (Profilkonvertierung per `doc.convertProfile`
wurde wieder entfernt). Getestet: Rundtrip-Fehler 0 in beiden Profilen,
beide bilden Weiß korrekt auf L\*=100/a\*=0/b\*=0 ab, und liefern für
dieselbe RGB-Eingabe erwartungsgemäß unterschiedliche Lab-Werte.

**Standard:** Die Checkbox ist ab Werk aktiviert (Adobe RGB), passend
zum bestätigten Lightroom-Workflow. YRE ist von dieser Einstellung nicht
betroffen — die YUV-Umrechnung arbeitet direkt auf den gammakodierten
Werten, ohne Farbraum-Matrix.

## Mehrsprachigkeit EN/DE (ab v0.14alpha)

Zwei Buttons "EN"/"DE" oben im Panel schalten die komplette sichtbare
Oberfläche (Labels, Buttons, Hinweistexte, Status- und Fehlermeldungen)
zwischen Englisch und Deutsch um. Bewusst **kein** `<select>`-Dropdown —
das hatte in einer früheren Version das komplette Panel lahmgelegt. Die
gewählte Sprache wird im plugin-eigenen UXP-Datenordner gespeichert
(derselbe Mechanismus wie zuvor für Presets), Standard beim allerersten
Start ist Englisch.

**Getestet:** Beide Sprachversionen im Wörterbuch enthalten exakt
dieselben 36 Schlüssel (kein Ungleichgewicht, keine leeren Werte), die
Interpolationsfunktionen (z. B. für "Preset X (YRE) gespeichert.") wurden
für beide Sprachen mit Beispielwerten durchgerechnet.

**Bewusst NICHT übersetzt:**
- Konsolen-Ausgaben (`console.log`/`console.warn`) — bleiben Deutsch,
  da sie zum Debuggen gedacht sind, nicht für Endnutzer der Oberfläche.
- Technische Bezeichner wie "Adobe RGB (1998)", "sRGB", die
  Kanalkürzel Y/U/V/L/a/b — identisch in beiden Sprachen.
- Der Plugin-Name "Decorrelation Stretch" selbst.

**Technischer Hinweis:** `initUI()` ist jetzt `async` (muss die
gespeicherte Sprache vor dem Rest der Initialisierung laden). Der
abschließende Aufruf nutzt deshalb `.catch()` auf der zurückgegebenen
Promise statt eines synchronen `try/catch` — ein synchrones `try/catch`
hätte einen Fehler in einer nicht-awaited async-Funktion nicht
abgefangen.

## Layout-Überarbeitung (v0.15alpha)

Mehrere Layout-Korrekturen und -Vereinfachungen:

- **Bug behoben:** Der Text neben den Checkboxen "Original-Mittelwert
  beibehalten" und "Adobe RGB..." rutschte in eine eigene Zeile statt
  neben der Checkbox zu stehen. Ursache: `label { display: block }` ohne
  explizite Ausrichtung der Kind-Elemente. Beide Checkbox-Zeilen nutzen
  jetzt eine eigene `.checkbox-row`-Klasse mit `display: flex;
  align-items: center` — robuster als sich auf den Standard-Inline-Fluss
  zu verlassen.
- Sprach-Buttons (EN/DE) sind jetzt klein und oben rechts positioniert
  (`position: absolute`), statt eine eigene breite Zeile einzunehmen.
- Sigma-Regler ist jetzt fest 110px breit (statt volle Panel-Breite) und
  steht in einer Zeile direkt neben der Beschriftung.
- Die Checkbox "Original-Mittelwert beibehalten" rückt näher an den
  Sigma-Regler (weniger Abstand).
- **Neu:** Warnhinweis unter dem Sigma-Regler, sobald der Wert über 60
  liegt (übersetzt sich automatisch bei Sprachwechsel, falls gerade
  sichtbar).
- Methode B umsortiert: Titel → Adobe-RGB-Checkbox → "YRE anwenden" →
  "LRE anwenden" → Hinweistext → **danach erst** die Eingabefelder für
  die manuellen Multiplikatoren samt Presets (vorher standen die
  Eingabefelder vor den Buttons). Analog zum Aufbau von Methode A.
- Allgemein kompaktere Abstände (Innenabstände, Margins) über das ganze
  Panel, um der wachsenden Höhe entgegenzuwirken.

## Layout-Überarbeitung Teil 2 (v0.16alpha)

**Vermuteter Grund für die Checkbox-Textkollision aus v0.15alpha:** Die
CSS-Eigenschaft `gap` in Flexbox-Containern — vermutlich unterstützt das
in UXP eingebettete Chromium diese (relativ junge) CSS-Funktion in
diesem Kontext nicht zuverlässig. **Konsequenz: `gap` wurde komplett aus
dem Stylesheet entfernt**, überall durch explizite `margin`-Angaben auf
den Kind-Elementen ersetzt (robuster, funktioniert in praktisch jeder
Browser-Engine-Version). Das betrifft nicht nur die Checkboxen, sondern
vorsorglich auch alle anderen Flex-Zeilen (Sigma-Zeile, Multiplikator-
Boxen, Header-Zeile).

**Weitere Änderungen:**
- Sigma-Regler nutzt jetzt `flex: 1` (füllt die verfügbare Breite in
  seiner Zeile, statt einer festen Pixelbreite) — behebt sowohl "zu
  kurz" als auch die Verdeckungsgefahr durch die Sprachauswahl.
- Sprachauswahl ist jetzt **ein einziger Toggle-Button** ("EN/DE") statt
  zwei separater Buttons, eingebettet in eine normale Kopfzeile neben dem
  Panel-Titel (`display:flex; justify-content:space-between`) statt
  `position:absolute`. Das behebt die Verdeckungsgefahr strukturell: die
  Kopfzeile ist jetzt Teil des normalen Layout-Flusses, kein
  freischwebendes Element mehr, das andere Zeilen überlappen könnte.
- Der Hinweistext von Methode B ("Dokument bleibt in RGB...") ist jetzt
  standardmäßig ausgeblendet und erscheint erst nach Klick auf ein
  kleines "?"-Symbol neben der Überschrift "Methode B — YRE / LRE"
  (Klick zum Ein-/Ausblenden, kein Maus-Hover-Tooltip — bewusst
  klickbasiert, da Hover-Verhalten in UXP weniger zuverlässig ist als
  Klick-Events, die im gesamten Plugin sonst durchgehend funktionieren).
  Der Hinweistext von Methode A bleibt unverändert immer sichtbar (nicht
  ausdrücklich angefragt).
- Die "Preset speichern"/"Preset laden"-Buttons stehen jetzt rechts
  neben den Multiplikator-Eingabefeldern, übereinander gestapelt, mit
  Icons (💾↑ für Speichern, 💾↓ für Laden) statt Text — spart deutlich
  Platz. Der volle Text steht weiterhin als Hover-Tooltip
  (`title`-Attribut) zur Verfügung, übersetzt sich mit der
  Sprachumschaltung mit. `title`-Tooltips sind eine sehr grundlegende,
  seit langem stabile Browser-Funktion (anders als `gap`), hier bin ich
  zuversichtlicher, dass sie funktionieren.

## Layout-Überarbeitung Teil 3 (v0.17alpha)

**Tooltip-Mechanismus komplett ersetzt:** Das native `title`-Attribut
zeigte zwei Symptome derselben Ursache — der Tooltip aktualisierte sich
nicht bei Sprachwechsel (blieb Englisch) und erschien beim Hover nicht
zuverlässig. Vermuteter Grund: UXPs eingebetteter Browser rendert native
`title`-Tooltips (abhängig vom Betriebssystem-Tooltip-Mechanismus)
offenbar nicht zuverlässig. Ersetzt durch einen selbstgebauten Tooltip:
ein `<span class="tooltip-text">` pro Button, sichtbar per reinem CSS
(`:hover` + `opacity`/`visibility`), Inhalt per `textContent` gesetzt
(aktualisiert sich garantiert bei jedem Sprachwechsel, da es ein
normaler Textknoten ist statt eines Attributs mit möglicher
Render-Caching-Eigenheit). `:hover` als CSS-Pseudoklasse ist eine sehr
alte, grundlegende CSS-Funktion — hier bin ich zuversichtlicher als bei
`gap` oder nativen `title`-Tooltips.

**Weitere Änderungen:**
- Preset-Buttons (Speichern/Laden) sind jetzt größer (38×26px statt
  30×21px), stehen nebeneinander statt übereinander, und sind farblich
  unterschieden: Speichern in hellem Blau, Laden in einem helleren
  Blau-Cyan-Ton — beide farblich passend zum Rest der Oberfläche.
- Icon und Pfeil (💾/⬆ bzw. 💾/⬇) stehen jetzt in eigenen `<span>`s mit
  explizitem Abstand dazwischen statt direkt aneinanderzukleben.
- Der Sigma-Wert (`#sigmaVal`) ist jetzt fett und in einem helleren Blau
  dargestellt statt in normalem Fließtext-Weiß.
- Der Schieberegler-Ring (Slider-Thumb) ist jetzt deutlich größer,
  heller (helles Blau mit weißem Rand) und wirft einen leichten Schatten
  zur besseren Abhebung vom Hintergrund — über
  `input[type=range]::-webkit-slider-thumb` gestylt (Chromium-spezifisch,
  UXP nutzt Chromium, daher passend).
- Methode A hat jetzt denselben Tooltip-Mechanismus wie Methode B: der
  Hinweistext ist standardmäßig eingeklappt, ein "?"-Symbol neben der
  Überschrift blendet ihn ein/aus. Einheitliches Verhalten für beide
  Methoden.

**Zur Icon-Frage:** Ich bin beim 💾-Symbol (Diskette) geblieben statt
auf ein Festplatten-Symbol zu wechseln — Unicode kennt zwar ein
"HARD DISK"-Zeichen (🖴), das ist aber deutlich seltener in Schriftarten
hinterlegt und könnte als leeres Kästchen erscheinen, während 💾 sehr
breit unterstützt wird und in praktisch jeder Software als
Speichern-Symbol etabliert ist. Falls du trotzdem lieber ein anderes
Symbol hättest, sag mir gerne, welches.

## Layout-Überarbeitung Teil 4 (v0.18alpha)

**Wichtiger Fund:** Das 💾-Disketten-Emoji rendert in UXP als "Zeichen
nicht gefunden"-Box (Rechteck mit X) — meine Annahme, es sei universell
unterstützt, war falsch für diese Umgebung. Komplett entfernt. Die
Speichern-/Laden-Buttons zeigen jetzt nur noch die Pfeile (⬆/⬇), die
offenbar zuverlässig rendern.

**Der eigene Hover-Tooltip aus v0.17alpha ist ebenfalls wieder raus**
(die schwarze Box war zu klein für den Text). Statt die Größe zu
reparieren, folgt die Erklärung jetzt demselben Muster wie Methode
A/B selbst: Der aufklappbare Methode-B-Hinweistext (per "?"-Symbol)
enthält jetzt einen zusätzlichen Satz, der erklärt, was die Pfeile
bedeuten — ein UI-Element weniger, ein Erklärungsweg mehr für das ganze
Panel.

**Weitere Korrekturen:**
- Sigma-Wert-Farbe zurück auf Weiß (Größe/Fettschrift bleiben).
- Slider-Thumb-Styling mit `!important` abgesichert, für den Fall, dass
  eine Spectrum-CSS-Regel mit höherer Spezifität sonst dazwischenfunkt.
  Nicht zu 100 % sicher, ob das die Ursache für den fehlenden Ring war —
  falls der Ring weiterhin nicht sichtbar ist, bitte melden.
- Abstand zwischen den Multiplikator-Eingabefeldern und den
  Speichern/Laden-Buttons von 10px auf 20px vergrößert.

## Layout-Überarbeitung Teil 5 (v0.19alpha)

- **Slider-Ring:** Das komplette Custom-Styling aus v0.17alpha
  (`::-webkit-slider-thumb`) wurde entfernt — brachte den Ring zum
  Verschwinden statt ihn hervorzuheben. Zurück zur nativen
  Browser-Darstellung des Reglers (Stand v0.16alpha und früher).
- **Preset-Icons als echte PNG-Grafiken statt Unicode-Zeichen:**
  `icons/save.png` und `icons/load.png` (klassisches Export-/
  Import-Piktogramm: Pfeil + Ablage-Symbol), programmatisch gezeichnet,
  64×64px, per `<img>`-Tag in die Buttons eingebunden. Das ist
  zuverlässiger als Emoji/Unicode-Zeichen, weil es nicht von der
  Schriftart-Unterstützung des jeweiligen Systems abhängt — dieselbe
  Technik, die schon für das Panel-Icon (`icon.png`) funktioniert hat.
  Die Erklärung der Icons bleibt im aufklappbaren Methode-B-Hinweistext
  (Text spricht weiterhin von "⬆/⬇", was inhaltlich weiter stimmt, auch
  wenn es jetzt Bilder statt Zeichen sind).

## Layout-Überarbeitung Teil 6 (v0.20alpha)

- Preset-Buttons vergrößert (46×36px statt 38×26px, Icon-Bildgröße
  20×20px statt 15×15px), `overflow: visible` ergänzt, damit die
  Piktogramme nicht mehr abgeschnitten werden.
- Abstand zwischen Multiplikator-Feldern und den Buttons von 20px auf
  40px vergrößert (angelehnt an "0,5 cm mehr" — exakte cm-Werte lassen
  sich in UI-Pixeln nicht verlässlich umrechnen, da die tatsächliche
  Bildschirm-DPI/Zoomstufe in Photoshop nicht bekannt ist; 40px ist eine
  plausible Näherung).
- **Sprachauswahl als Flaggen-Icons:** `icons/flag_en.png` (vereinfachte
  US-Flagge) und `icons/flag_de.png` (deutsche Flagge), beide 30×20px,
  programmatisch gezeichnet — dieselbe PNG-Technik wie bei den
  Save/Load-Icons. Der Toggle-Button zeigt die Flagge der aktuell
  aktiven Sprache; ein Klick wechselt Sprache und Flagge gemeinsam.

## Layout-Überarbeitung Teil 7 (v0.21alpha)

Preset-Buttons zeigen jetzt nur noch die Piktogramme selbst, ohne
sichtbaren Button-Rahmen/-Hintergrund (`background: transparent; border:
none;`) — die Icons sind selbsterklärend genug (Pfeil hoch/runter +
Ablage), ein zusätzlicher Kasten drumherum war unnötig. Die
Farbunterscheidung (Speichern = Blau, Laden = Cyan) bleibt als dezenter
Hover-Hinweis erhalten, statt permanent sichtbar zu sein.

## Layout-Überarbeitung Teil 8 (v0.22alpha)

- **Flaggen-Icons komplett neu:** Rund statt rechteckig (per
  kreisförmiger Alpha-Maske direkt in der PNG-Datei zugeschnitten, nicht
  nur per CSS `border-radius` — robuster, falls CSS-Zuschneiden in UXP
  unzuverlässig wäre, siehe die wiederholten `gap`/`appearance`-Lektionen
  in diesem Projekt). **Englisch zeigt jetzt die britische Flagge (Union
  Jack)** statt der US-Flagge — ein runder Ausschnitt der US-Flagge ohne
  den blauen Sternenfeld-Bereich wäre kaum als "USA" erkennbar gewesen,
  während sich das Union-Jack-Kreuzmuster auch im Kreisausschnitt gut
  liest.
- **Möglicher Fix für abgeschnittene Save/Load-Icons:** natives
  Button-Erscheinungsbild explizit deaktiviert
  (`-webkit-appearance: none`) plus `min-width`/`min-height`, damit der
  Browser die Button-Größe nicht eigenmächtig verkleinert. Das ist eine
  begründete Vermutung nach demselben Muster wie beim Slider-Ring-Problem
  (natives UI-Element-Styling überlagert eigene CSS-Vorgaben), aber nicht
  zu 100 % sicher — falls die Icons weiterhin abgeschnitten wirken, wäre
  der nächste Schritt ein Screenshot, um genauer zu sehen, ob es oben,
  seitlich oder rundum ist.

## Layout-Überarbeitung Teil 9 (v0.23alpha)

**Eigentliche Ursache für "Icons zu groß/abgeschnitten" gefunden:** Die
CSS-Eigenschaften `width`/`height` auf `<img>`-Tags wurden offenbar
nicht zuverlässig angewendet — die Bilder rendern in UXP anscheinend in
ihrer tatsächlichen Originalgröße (vorher 48×48 bzw. 64×64px) innerhalb
des kleinen, zugeschnittenen Buttons. Das erklärte beide gemeldeten
Symptome: bei der runden Flagge sah man dadurch nur einen vergrößerten
Mittelausschnitt (bei DE fast nur der rote Mittelstreifen, bei EN nur
das Kreuz im Zentrum — passt genau zu einem auf die Mitte
"reingezoomten" 48px-Bild in einem 24-26px-Fenster), bei den Save/Load-
Icons dasselbe Muster ("abgeschnitten" statt "zu groß", je nach
Blickwinkel dieselbe Ursache).

**Fix:** Zwei Maßnahmen gleichzeitig, um das robust zu lösen:
1. Die PNG-Dateien werden jetzt direkt in der tatsächlichen
   Zielanzeigegröße erzeugt (Flaggen 24×24px, Save/Load 20×20px) — keine
   CSS-Skalierung mehr nötig, das Bild ist bereits exakt richtig groß.
2. Zusätzlich `width`/`height` als HTML-Attribute direkt am `<img>`-Tag
   ergänzt (nicht nur CSS) — das ist ein noch grundlegenderer
   HTML-Mechanismus als CSS-Styling, auf den ich mich hier verlässlicher
   verlassen kann, nach demselben Prinzip wie bei `gap`, `appearance`
   und den nativen Tooltips zuvor: je älter/grundlegender der Mechanismus,
   desto zuverlässiger scheint er in dieser UXP-Umgebung zu funktionieren.

## Neue Funktionen: Sättigung, Graustufen, Farbausgleich (v0.24alpha)

Auf Vorschlag umgesetzt, angelehnt an DStretchs "Adj Col"- und
"CB"-Buttons:

- **Sättigung nach dem Stretch** (Regler, 0.1–2.0, Standard 1.0): Gilt
  für beide Methoden. Skaliert nur die Chroma-Abweichung des
  Stretch-Ergebnisses (a\*/b\* bzw. die beiden Farbkanäle in YRE/LRE),
  nicht den gewählten Farbmittelpunkt und nicht die Helligkeit. Bei
  Werten unter 1.0 wirkt das Ergebnis gedämpfter/natürlicher — genau der
  in der DStretch-Doku beschriebene Effekt ("Reducing the saturation ...
  can tame the sometimes wild colors").
- **Graustufen** (Checkbox, nur Methode B): Wandelt das fertige,
  gestreckte RGB-Ergebnis per Standard-Luminanzformel
  (0.299R+0.587G+0.114B) in reine Helligkeit um — die vom Stretch
  erzeugten Unterschiede werden als Kontrast statt als Farbe sichtbar.
  Bewusst nur für Methode B: Methode A rechnet nie in RGB, ein
  äquivalenter Effekt wäre dort nicht sinnvoll ohne die gesamte
  Pipeline umzubauen.
- **Farbausgleich vor dem Stretch (CB)** (Checkbox, beide Methoden):
  Gray-World-Korrektur — skaliert R, G, B unabhängig so, dass ihre
  Mittelwerte gleich werden, bevor der Stretch berechnet wird. Das
  entfernt einen multiplikativen Farbstich (z. B. rötlicher
  Fels-Hintergrund), der sonst in die Kovarianzmatrix einfließen würde.
  Wichtig: eine reine Verschiebung (wie bei "Original-Mittelwert
  beibehalten") hätte hier keinen Effekt, weil Kovarianz
  verschiebungsinvariant ist — nur eine Skalierung verändert die
  Korrelationsstruktur, die der Stretch danach nutzt. Bei Methode A
  läuft der Ausgleich auf den rohen RGB-Werten, bevor das Dokument nach
  Lab konvertiert wird.

**Getestet:** Gray-World-Faktorberechnung mit synthetischen,
rotstichigen Bilddaten — nach Anwendung der Faktoren sind alle drei
Kanalmittelwerte exakt gleich. Sättigungsskalierung mit Beispielwerten
durchgerechnet — bei Sättigung 0 verschwindet die Farbabweichung
vollständig, der gewählte Mittelpunkt bleibt erhalten.

**Nicht umgesetzt (aus dem Gespräch zu DStretch-Funktionen):** YBK/CRGB
als zusätzliche Farbräume, Cyan-Reduktion, Vorab-Glättung — auf
Wunsch zurückgestellt, siehe Diskussion im Chat-Verlauf.

**Fix (v0.25alpha, nur Teilerfolg):** Der Sättigungs-Regler blieb nach
der ersten Interaktion hängen. Erster Versuch: Umstellung auf
ganzzahlige Basis (10–200, Schritt 5) statt Dezimalwerten — Vermutung
war Fließkomma-Rundung. Half nicht vollständig.

**Eigentliche Ursache (v0.26alpha):** Der Regler ließ sich nur auf sechs
exakt gleich verteilte Werte einrasten (Abstand = 20 % des
Wertebereichs) — das deutet darauf hin, dass UXPs Slider-Element einen
expliziten numerischen `step`-Wert generell nicht respektiert
(unabhängig davon, ob ganzzahlig oder dezimal) und stattdessen in feste
prozentuale Schritte einrastet. Der Sigma-Regler hatte dieses Problem
nie, weil er von Anfang an `step="any"` nutzt (freies, stufenloses
Ziehen) statt eines festen Schrittwerts. Der Sättigungs-Regler läuft
jetzt auf demselben, bereits bewährten Prinzip: `min="0.1" max="2"
step="any"`, direkte Dezimalwerte ohne Ganzzahl-Umweg.

**Neu:** Doppelklick auf den Sättigungs-Regler setzt ihn auf den
Standardwert 1.0 zurück.

**Fix (v0.27alpha):** Der Doppelklick funktionierte nicht — passt ins
bekannte Muster (native Doppelklick-Erkennung auf einem Range-Input
scheint in UXP genauso unzuverlässig zu sein wie zuvor schon `title`-
Tooltips oder `gap`). Ersetzt durch einen expliziten kleinen
"↺"-Button direkt neben dem Regler, nach demselben bewährten
Klick-Prinzip wie "Multiplikatoren zurücksetzen".

## Ebenennamen mit aktiven Optionen (v0.27alpha)

Der Name der erzeugten Ebene enthält jetzt die verwendeten Einstellungen,
z. B. `Hintergrund – LRE (CB, Sat1.0, Si15)`:

- `CB` erscheint nur, wenn Farbausgleich vor Stretch aktiv war
- `SatX.X` ist immer dabei (Sättigung nach Stretch, eine Nachkommastelle)
- `SiXX` ist immer dabei (gerundeter Sigma-Wert)
- `Gray` erscheint nur bei Methode B mit aktivierter Graustufen-Option

Umgesetzt über eine gemeinsame Hilfsfunktion `buildLayerSuffix()`, die
für beide Methoden genutzt wird — für Methode A ohne `Gray` (dort gibt
es diese Option nicht).

## Neu: Auswahl-/Federfunktion (v0.28alpha)

Ist beim Klick auf einen der Anwenden-Buttons eine Auswahl im Dokument
aktiv, werden Mittelwert und Kovarianzmatrix (die Basis für den
Stretch) **nur aus dem ausgewählten Bereich** berechnet, statt aus dem
ganzen Bild — nicht relevante Bildbereiche (z. B. Fels ohne Malerei)
fließen dann nicht mehr in die Statistik ein. Die eigentliche
Transformation wird trotzdem auf alle Pixel angewendet; am Ende sorgt
eine echte Ebenenmaske aus der (gefederten) Auswahl dafür, dass
außerhalb der Auswahl das Original sichtbar bleibt, mit weichem
Übergang.

**Ist keine Auswahl aktiv:** Verhalten exakt wie bisher — vollständig
abwärtskompatibel, mathematisch geprüft (siehe unten).

**Federradius:** Regler im Panel (0–200px, wirkt nur bei aktiver
Auswahl). Wurde bewusst als Regler statt als reine Photoshop-Handbedienung
umgesetzt (Option (b) aus der Absprache), automatisiert den Ablauf.

**Funktionsweise (technisch):**
1. Aktuelle Auswahl erkennen (`doc.selection.bounds`, try/catch).
2. Falls Federradius > 0: Auswahl per `feather`-batchPlay-Aktion federn.
3. Gewichtsfeld berechnen: temporäre Ebene anlegen, außerhalb der
   Auswahl schwarz, innerhalb weiß füllen (Photoshops Fill respektiert
   weiche Auswahlkanten nativ) → Graustufen auslesen → temporäre Ebene
   wieder löschen.
4. Mittelwert/Kovarianz mit diesem Gewichtsfeld berechnen (0 = fließt
   nicht ein, 1 = voll, Zwischenwerte am gefederten Rand anteilig).
5. Stretch-Transformation wie gehabt auf alle Pixel anwenden.
6. Echte Ebenenmaske aus der (gefederten) Auswahl auf die fertige Ebene
   anwenden ("Maske aus Auswahl", `revealSelection`).

**Getestet (Mathematik, nicht Photoshop-Integration):** Die gewichtete
Mittelwert-/Kovarianzberechnung wurde gegen zwei Fälle geprüft — bei
durchgängigem Gewicht 1 liefert sie exakt dieselben Werte wie die
ursprüngliche ungewichtete Berechnung (Abwärtskompatibilität
bestätigt), und bei harten 0/1-Gewichten entspricht sie exakt der
Statistik, die man erhielte, würde man nur den gewichteten Teilbereich
isoliert berechnen (Korrektheit der Gewichtung bestätigt).

**Ehrlicher Hinweis:** Diese Funktion nutzt mehrere batchPlay-Befehle
(`feather`, `inverse`, `fill`, Maske-aus-Auswahl) und DOM-Methoden
(`doc.selection.bounds`, `doc.layers.add()`, `layer.delete()`), die in
diesem Projekt bisher nicht verwendet wurden — anders als z. B.
`layer.duplicate()`, das schon vielfach nachweislich funktioniert hat.
Nach dem bisherigen Muster dieses Projekts ist beim ersten Testlauf mit
einer Korrekturrunde zu rechnen.

**Bewusst nicht umgesetzt:** Der Farbausgleich (CB) bleibt weiterhin
ungewichtet (nutzt immer das ganze Bild), auch wenn eine Auswahl aktiv
ist — das war nicht Teil der Anfrage und hätte den Umfang dieser
Änderung deutlich vergrößert. Bei Bedarf ließe sich das nachrüsten.

**Fix (v0.29alpha):** Beim Testen trat ein Fall auf, bei dem trotz
*keiner* aktiven Auswahl eine (wirkungslose, "leere") Maske auf der
Ergebnisebene erschien — das Bild selbst blieb davon unbeeinträchtigt
und korrekt. Ursache: `hasActiveSelection()` prüfte nur, ob
`doc.selection.bounds` überhaupt einen Wert liefert (`!!bounds`). Ist
gar keine Auswahl aktiv, verhält sich Photoshop aber oft wie "alles
ausgewählt" und liefert trotzdem ein gültiges bounds-Objekt (mit den
Maßen des gesamten Dokuments) zurück, statt einen Fehler zu werfen. Die
Prüfung wertete das fälschlich als "es gibt eine Auswahl" — die daraus
berechnete Gewichtung war dann überall 1 (deshalb blieb der Stretch
korrekt), aber die anschließend erzeugte Maske deckte ebenfalls alles
ab und war dadurch wirkungslos/"leer".

Behoben: `hasActiveSelection()` vergleicht die tatsächlichen Maße der
Auswahl jetzt mit der Dokumentgröße — deckt die "Auswahl" das komplette
Bild ab, wird das wie "keine Auswahl" behandelt (unabhängig davon, ob
es an diesem Photoshop-Verhalten liegt oder der Nutzer tatsächlich
alles markiert hat — eine Maskierung wäre in beiden Fällen ohnehin
wirkungslos). Getestet mit fünf synthetischen Szenarien (Vollbild-
"Auswahl", echte Teilauswahl, werfender Aufruf, UnitValue-artige
Objekte, Nullgröße) — alle liefern das erwartete Ergebnis.

## Spectrum-Umbau (v0.30alpha)

Das Panel wurde auf Adobes Spectrum-Designrichtlinien umgestellt.
**Der vorherige Stand (v0.29alpha) liegt als vollständige Sicherung
vor** — falls der Umbau Probleme macht, ist eine Rückkehr jederzeit
möglich.

**Bedienelemente auf Spectrum Web Components umgestellt:**
- `<input type="checkbox">` → `<sp-checkbox>`
- `<input type="range">` → `<sp-slider>`
- `<input type="text">` → `<sp-textfield>`
- Eigene `<button>`-Elemente → `<sp-action-button quiet>`
- Eigene Trennlinien/Überschriften → `<sp-divider>`, `<sp-heading>`,
  `<sp-body>`
- Die Haupt-Buttons nutzten bereits `<sp-button>` (unverändert)

**Automatische Theme-Anpassung:** Alle zuvor hartcodierten Farben
(überall `rgba(255,255,255,...)`, ausgelegt auf ein dunkles Theme)
laufen jetzt über UXPs Theme-Variablen (`--uxp-host-text-color`,
`--uxp-host-background-color` usw.) mit neutralen Fallback-Werten.
Damit sollte sich das Panel automatisch an alle Photoshop-Themes
anpassen (darkest/dark/medium/lightest) statt nur bei dunklem Theme
lesbar zu sein.

**Manifest:** `featureFlags.enableSWCSupport` aktiviert (laut
Adobe-Doku für Spectrum Web Components erforderlich), `minVersion` von
24.0.0 auf **24.4.0** angehoben — SWC benötigt laut Adobe mindestens
Photoshop 24.4. *Das ist eine Einschränkung: Nutzer mit älterem
Photoshop können das Plugin ab dieser Version nicht mehr laden.*

**Icons:** Auf ausdrücklichen Wunsch unverändert übernommen
(einschließlich des farbigen "DS"-Panel-Icons) — geprüft, alle sechs
Icon-Dateien sind bit-identisch zur Vorversion. Anmerkung: Adobes
Richtlinie empfiehlt für Panel-Icons eigentlich monochrome Varianten
für helle und dunkle Themes; das farbige Icon bleibt hier bewusst
davon ausgenommen.

**Robustheit gegen Spectrum-Eigenheiten:** Zwei neue Hilfsfunktionen
fangen ab, dass Spectrum-Komponenten sich anders verhalten können als
native HTML-Elemente:
- `wireValueEvents()` registriert mehrere Event-Typen gleichzeitig
  (`input`, `change`, `sp-input`, `sp-change`), statt darauf zu wetten,
  welches eine Spectrum-Komponente tatsächlich feuert.
- `isChecked()`/`setChecked()` lesen und setzen Checkbox-Zustände über
  Property *und* HTML-Attribut, da Spectrum-Komponenten ihren Zustand
  je nach Version unterschiedlich spiegeln. Ein still falsch
  ausgelesener Checkbox-Wert wäre hier besonders unangenehm, weil die
  Berechnung dann unbemerkt mit falschen Optionen liefe.

**Ehrlicher Hinweis:** Dies ist der umfangreichste UI-Umbau im
Projekt, und Spectrum Web Components wurden hier zum ersten Mal
über `<sp-button>` hinaus verwendet. Nach dem bisherigen Muster
dieses Projekts (UXP-Eigenheiten bei `gap`, `title`-Tooltips,
Slider-`step`, Emoji-Rendering) ist mit Korrekturrunden zu rechnen.
Falls das Panel gar nicht mehr lädt, ist der erste Verdacht das
`featureFlags`/`minVersion`-Thema im Manifest.

## Umbenennung in "Umbra" und Version 1.0.0 (04.09.2026)

Der Arbeitstitel "D-Stretch" / "DS" war zu nah am Original-DStretch von
Jon Harman und hat den Eindruck erweckt, es handle sich um dessen
Portierung. Das Plugin heißt jetzt durchgehend **Umbra**:

- **Manifest:** `id` = `com.example.umbra`, `name` = `Umbra`,
  Entrypoint-`id` = `umbraPanel`, Panel-Label = `Umbra`.
  Version von `0.34alpha` auf **1.0.0** hochgezogen.
- **Panel:** Überschrift im Kopf des Panels und die Versionsanzeige
  unten sind angepasst.
- **`main.js`:** Alle Konsolen-Ausgaben tragen jetzt das Präfix
  `[Umbra]` statt `[D-Stretch]`.
- **Ebenennamen:** Neue Ebenen heißen jetzt `Umbra …` statt
  `D-Stretch …`. Bereits vorhandene Ebenen in alten Dateien behalten
  ihren Namen.
- **Dateinamen:** Die Spracheinstellung liegt jetzt in
  `umbra-settings.json` (vorher `dstretch-settings.json`), vorgeschlagene
  Preset-Dateinamen heißen `umbra-yre-preset.json` bzw.
  `umbra-lre-preset.json`.
- **Neue Icons:** `icons/icon.png` (23×23) und `icons/icon@2x.png`
  (46×46). **Achtung beim Ersetzen:** UXP findet die hochauflösende
  Variante nur unter dem Namen mit `@2x` – eine Datei namens
  `icon_2x.png` wird ignoriert, und das Panel-Icon bleibt auf
  Retina-/HiDPI-Displays unscharf oder schwarz.

**Was bewusst *nicht* umbenannt wurde:** Erwähnungen von "DStretch"
(ohne Bindestrich) im Text und im Code beziehen sich auf Jon Harmans
Original-Software für ImageJ und auf dessen Algorithmus-Beschreibung –
das sind Quellenangaben und müssen so bleiben. Die älteren
Changelog-Abschnitte oben stehen ebenfalls unverändert als Verlauf.

**Drei Punkte zum Nachziehen (nicht automatisch möglich):**

1. Weil sich die Manifest-`id` geändert hat, betrachtet Photoshop das
   Plugin als ein *neues* Plugin. Im UXP Developer Tool das alte
   "D-Stretch" einmal entladen/entfernen und Umbra neu laden, sonst
   erscheinen beide Panels nebeneinander.
2. Der Projektordner heißt jetzt `Umbra UXP` (vorher `D-Stretch UXP`).
   Weil das UXP Developer Tool Plugins über ihren Ordnerpfad einbindet,
   muss der alte Eintrag dort einmal entfernt und der Ordner unter dem
   neuen Pfad neu hinzugefügt werden.
3. Das gepackte Plugin unter `Plugin/com.example.dstretch_PS.ccx` trägt
   noch den alten Namen – bewusst, denn es enthält auch noch den alten
   Stand *vor* der Umbenennung. Es wird beim nächsten Packen durch eine
   neue Datei ersetzt.

## Flyout-Menü an der Registerkarte (05.09.2026)

Das Panel hat jetzt ein Menü am Hamburger-Icon oben rechts an der
Registerkarte (UXP nennt das "Flyout Menu"), mit vier Einträgen:

- **Plugin neu laden** — lädt das Panel neu (`location.reload()`),
  nützlich nach einem Update ohne das UXP Developer Tool zu bemühen.
- **Anleitung** — öffnet die passende README auf GitHub im
  Standardbrowser (Deutsch/Englisch je nach eingestellter Panel-Sprache).
- **GitHub-Repository** — öffnet das Repo direkt.
- **Version x.x.x** (ausgegraut, nicht klickbar) — liest die Version zur
  Laufzeit aus `UxpPluginInfo` statt sie ein zweites Mal von Hand zu
  pflegen. Nur falls dieser Automatismus aus irgendeinem Grund nicht
  greift, fällt es auf eine Konstante in `main.js` zurück, die dann von
  Hand mit `manifest.json` synchron gehalten werden muss.

Die Versionsanzeige im Panel-Körper selbst ist dafür entfallen (spart
Platz). Die Menü-Beschriftungen wechseln mit der Panel-Sprache mit.

**EHRLICHER HINWEIS:** Das ist die erste Nutzung von
`entrypoints.setup()` in diesem Projekt — bisher initialisiert sich das
Panel immer direkt beim Laden von `index.html`/`main.js`, nicht über die
UXP-Entrypoints-Lifecycle. Beide Mechanismen sollten laut
Adobe-Dokumentation nebeneinander funktionieren, das ist aber nicht
gegen echtes Photoshop getestet. Für `shell.openExternal()` (Anleitung,
Repo-Link) war zusätzlich eine neue Manifest-Berechtigung
(`launchProcess`) nötig.

## Sprachumschaltung ins Flyout-Menü, Logo statt Flagge, Layout-Fix (05.09.2026)

Aufbauend auf dem Flyout-Menü von oben:

- **Sprachumschaltung ins Menü verlegt:** Statt des Flaggen-Toggle-Buttons
  oben rechts stehen jetzt zwei Einträge **Deutsch** / **English** im
  Flyout-Menü; ein Häkchen (`checked`) markiert die aktive Sprache. Die
  Beschriftungen sind Endonyme (jeweils in der eigenen Sprache) und werden
  bewusst nicht übersetzt — übliche Konvention für Sprachwähler.
- **Flaggen im Menü nicht möglich (verifiziert):** UXP-Menüeinträge
  (`UxpMenuItem`) unterstützen laut Adobe-API nur `label`/`enabled`/
  `checked`/Untermenüs — kein Icon oder Bild. Ein Flaggen-Bild neben den
  Menüeinträgen geht daher technisch nicht; das native Häkchen übernimmt
  die Markierung. (Vor dem Bauen gegen die API-Referenz geprüft.)
- **U-Logo oben rechts:** An der Stelle des früheren Flaggen-Toggles steht
  jetzt dezent (60% Deckkraft) das Umbra-Logo (`icons/icon.png`), rein
  dekorativ. Die Flaggen-Dateien (`flag_de.png`/`flag_en.png`) werden nicht
  mehr referenziert, liegen aber noch im `icons/`-Ordner.
- **Layout-Inkonsistenz EN/DE behoben:** Die englische Adobe-RGB-Beschriftung
  ("...instead of sRGB — only relevant for LRE") war mit gemessenen ~297px
  breiter als der verfügbare Checkbox-Platz (~277px bei 325px-Panel) und
  brach als einzige auf zwei Zeilen um. Das machte den Method-B-Block höher
  als im Deutschen und schob das restliche Layout nach unten (weniger
  Rand-Abstand unten). Gekürzt auf "...instead of sRGB — LRE only" (~238px,
  passt wie die deutsche in eine Zeile). Diagnose per Breitenmessung, nicht
  per Vermutung.

## Methode A wandelt zurück nach RGB + Version 1.1.0 (05.09.2026)

**Der Fehler:** Methode A wandelte das Dokument nach Lab (für die
Lab-Kanäle des Stretches), aber nie zurück — das Dokument blieb dauerhaft
im Lab-Modus. Weil der Farbmodus in Photoshop **dokumentweit** gilt (nicht
pro Ebene), hatte das zwei unschöne Folgen:

- Wendete man danach Methode B an (die RGB-Pixel erwartet), wurden die
  Lab-Kanäle als R/G/B fehlinterpretiert → stiller Farbsalat.
- Der normale RGB-Workflow war gebrochen: Export, und vor allem das
  Überblenden einer Methode-A- mit einer Methode-B-Ergebnisebene per
  Deckkraft, ging nicht mehr, weil nie beide zugleich in RGB vorlagen.

**Der Fix (Option „A wandelt zurück"):** Methode A wandelt das Dokument am
Ende standardmäßig zurück nach RGB. Die Umwandlung ist farbmetrisch, also
erscheinungstreu — der eingebackene Stretch bleibt erhalten; nur sehr
stark gestreckte Farben außerhalb des RGB-Farbraums werden an dessen Rand
gekappt (für jede RGB-Nutzung ohnehin unvermeidlich). Damit ist das
Dokument nach A wieder RGB, B funktioniert, und das Überblenden zweier
Ergebnisebenen ist wieder möglich.

**Opt-out-Häkchen „Ergebnis in Lab belassen":** Für die fortgeschrittene
Kanal-Bearbeitung (z. B. den a*-Kanal als eigenes Dokument herausziehen
und mit dem vollen Werkzeugsatz bearbeiten) muss das Ergebnis in Lab
vorliegen. Ist das Häkchen gesetzt, überspringt A die Rückwandlung. Der
Nutzer muss dann selbst nach RGB wandeln, bevor Methode B läuft — vergisst
er es, fängt ihn der RGB-Guard von B mit klarer Meldung ab. Standard: aus
(= zurück nach RGB, der sichere Normalfall).

**Dazu als Absicherung:** Methode B bricht mit klarer Meldung ab, wenn das
Dokument wider Erwarten nicht in RGB ist (statt still falsche Farben zu
erzeugen). Die Modus-Erkennung ist fail-open — sie blockiert nur bei
sicher erkanntem Nicht-RGB-Modus.

**Version:** von 1.0.0 auf **1.1.0** (neue Funktionen seit 1.0.0 —
Flyout-Menü, Sprachwahl im Menü — plus dieser Fix). Die Nummer steht in
`manifest.json` und als `FALLBACK_VERSION` in `main.js`, beide auf 1.1.0.

**Offener Gedanke für später:** Der wirklich saubere Weg wäre, A gar nicht
mehr den Dokument-Modus wechseln zu lassen, sondern — wie Methode B — pro
Pixel intern RGB→Lab→RGB zu rechnen. Dann bliebe das Dokument durchgehend
RGB und keine andere Ebene würde je durch eine Umwandlung angefasst. Das
ist ein größerer Umbau am (verifizierten) Rechenkern und wurde bewusst
zurückgestellt.

## Fehlermeldungen: Warnhinweis, saubere Übersetzung, RGB-Menüpunkt (05.09.2026)

Rund um den RGB-Guard von Methode B, nach erstem Testen:

- **Doppeltes Präfix „Fehler: Error:" behoben.** Beim Durchlauf durch
  `executeAsModal` trägt der gefangene Fehler bereits ein „Error:" im
  Text; unser zusätzliches „Fehler:"-Präfix ergab das Doppel. Eigene,
  übersetzbare Meldungen (z. B. der RGB-Hinweis) werden jetzt über ihren
  Übersetzungsschlüssel angezeigt — ganz ohne Präfix.
- **Rückübersetzung beim Sprachwechsel.** Die Fehlermeldung wurde vorher
  als fertiger Text gespeichert und blieb daher beim Umschalten in der
  alten Sprache. Jetzt merkt sich die Statuszeile bei bekannten Meldungen
  den Schlüssel und übersetzt sie beim Sprachwechsel korrekt mit.
- **Gelber Warnhinweis.** Fehlermeldungen erscheinen jetzt mit einem
  ⚠-Zeichen und in der gelben Warnfarbe (dieselbe wie die Sigma-Warnung),
  klar abgesetzt von normalen Statusmeldungen.
- **Neuer Menüpunkt „Dokument nach RGB wandeln".** Direkt im Flyout-Menü,
  als bequemer Ein-Klick-Weg zurück nach RGB — vor allem, wenn Methode A
  mit „Ergebnis in Lab belassen" das Dokument in Lab hinterlassen hat und
  man es (z. B. vor Methode B) wieder in RGB braucht. Bei bereits
  RGB-Dokumenten ein No-op.

## Sigma-Standardwert 15 + Release-Workflow, Version 1.2.0 (19.09.2026)

Der Standardwert des Sigma-Reglers (Ziel-Kontrast) ist von 25 auf **15**
gesenkt (Slider-Startwert, Reset-Knopf und interner Fallback).

**Begründung (gemessen):** Ein Testbild (blasse Felsmalerei, 24 MP, 8 Bit)
wurde in Photoshop mit Umbra verarbeitet und mit einer unabhängigen
Python-Nachrechnung verglichen: Methode B stimmte exakt (max. 1 Stufe
Abweichung), Methode A auf ±2 bei 97 % der Pixel. Der Rechenkern ist also
korrekt. Anteil der Pixel mit mindestens einem auf 0/255 geklemmten Kanal
bei Methode B: Sigma 25 → ca. 29 %, Sigma 20 → ca. 16 %, Sigma 15 → ca. 6 %,
Sigma 10 → ca. 1 %. Sigma 15 lässt den Effekt kräftig, schneidet aber
deutlich weniger ab. Der Regler (10–100) bleibt unverändert.

**Neu:** `.github/workflows/release.yml` — baut bei einem Versions-Tag
(`v*`) automatisch die installierbare `Umbra-<Version>.ccx` (nur
`manifest.json`, `index.html`, `main.js`, `icons/`) und hängt sie an ein
GitHub-Release. Der Tag muss zur Version in `manifest.json` passen.

**Version:** 1.1.0 → **1.2.0** (`manifest.json` und `FALLBACK_VERSION`).

**Version 1.2.1 (19.09.2026):** Korrektur der `manifest.json`, damit sich die
`.ccx` per Doppelklick installieren lässt (Fehler -4 = Manifest-Parse-Fehler
im Creative-Cloud-Installer). `host` ist jetzt ein Objekt statt einer Liste,
und das nicht dokumentierte Icon-Theme `"all"` entfällt. Das Paket wird
ohne Ordner-Einträge im ZIP gebaut. Am Plugin-Verhalten ändert sich nichts.

## Code-Review-Korrekturen, Version 1.2.2 (23.09.2026)

- **16 Bit, Methode B:** Die Rückumrechnung nach RGB rundete schon auf
  ganze 0..255-Werte. Ein 16-Bit-Dokument bekam dadurch nur 256 Tonwerte
  pro Kanal (faktisch 8 Bit, Gefahr von Tonwertabrissen). Jetzt wird erst
  beim Zurückschreiben gerundet. Bei 8 Bit ist das Ergebnis unverändert
  (geprüft, identisch); nur mit „Graustufen" weichen einzelne Pixel um
  höchstens 1 Stufe ab (genauer).
- **32-Bit-Dokumente** werden mit klarer Meldung abgelehnt. Vorher rundete
  die Rechnung jedes Pixel auf 0 oder 1 (Ergebnis unbrauchbar).
- **Hintergrundebene** wird über Photoshops Ebenen-Eigenschaft gefunden,
  nicht nur über die Namen „Hintergrund"/„Background". In einem Photoshop
  in anderer Sprache hätte ein zweiter Lauf sonst die zuletzt erzeugte
  Ergebnis-Ebene erneut gestreckt.
- **Methode A auf einem Lab-Dokument** (nach „Ergebnis in Lab belassen"):
  Die Umwandlung nach Lab entfällt dann. Mit Farbausgleich (CB) bricht A
  dort ab, weil CB auf R/G/B-Werten rechnet und sonst still L/a/b
  verzerrt hätte. CMYK/Graustufen werden jetzt auch bei A vor dem
  Duplizieren abgelehnt (wie schon bei B).
- **Methode A bei einem Fehler** wandelt das Dokument trotzdem zurück nach
  RGB (sofern „Ergebnis in Lab belassen" aus ist), statt es in Lab
  stehen zu lassen.
- **Ebenen, die nicht an der Dokumentecke beginnen**, werden an ihre
  ursprüngliche Position zurückgeschrieben statt nach links oben
  verschoben. Passt eine Auswahl nicht zur Ebenengröße, bricht Umbra mit
  Meldung ab statt still falsch zu gewichten.
- Veraltete bzw. falsche Code-Kommentare korrigiert.

## Bekannte offene Punkte / nächste Schritte mit Claude Code

Ich habe den Code nicht gegen eine echte Photoshop-Instanz getestet – das
kann ich von hier aus nicht. Die verbleibenden Risikostellen:

- Der 16-Bit-Wertebereich 0–32768 ist jetzt durch einen harten
  Photoshop-Fehler bestätigt (siehe Abschnitt "Bit-Tiefe" oben), nicht
  mehr nur eine Annahme. Ob der frühere "dunkler/gesättigter"-Eindruck
  bei diesem Wert einen echten Bug hatte, ist offen — `writeBack()`
  prüft jetzt zumindest defensiv auf Werte außerhalb des gültigen
  Bereichs.
- `doc.activeLayers = [dupLayer]` (Duplikat als aktive Ebene setzen) und
  `imaging.getPixels`/`putPixels` mit `layerID: layer.id` (gezielt nur die
  duplizierte Ebene lesen/schreiben, statt das ganze Dokument
  zusammenzuführen) sind beide nicht gegen echtes Photoshop verifiziert.
  Falls hier ein Fehler auftritt, ist das der nächste Punkt zum
  Eingrenzen.
- Die Umrechnung der Lab-Rohbytes (`raw - neutral` für a*/b*) ist eine
  gängige Näherung für Photoshops interne Kodierung, aber nicht
  hundertprozentig linear-symmetrisch – bei Bedarf feinjustieren.
- Exakte Signatur von `imaging.getPixels` / `imaging.createImageDataFromBuffer`
  / `imaging.putPixels` kann sich je nach Photoshop-/UXP-Version leicht
  unterscheiden (z. B. Rückgabeform von `getData()`).
- Bei sehr großen Bildern (insbesondere 16-Bit) kann die pixelweise
  Schleife in `main.js` spürbar dauern (kein Multithreading in UXP) –
  ggf. auf Vorschau-Auflösung begrenzen oder Fortschrittsanzeige
  ergänzen.
- `sp-button` benötigt ggf. das Spectrum-UXP-Web-Components-Skript, falls
  es in deiner Photoshop-Version nicht automatisch verfügbar ist.

**Empfehlung:** Öffne diesen Ordner mit Claude Code (`claude` im Terminal
in diesem Verzeichnis starten), lade das Plugin im UXP Developer Tool,
kopiere Fehlermeldungen aus der UXP-Konsole (im Developer Tool: "..." →
"Show DevTools") und lass Claude Code sie direkt beheben. Das ist der
normale iterative Workflow bei UXP-Entwicklung – Photoshop kann ich von
hier aus nicht fernsteuern.

## Lizenz

Umbra steht unter der **GNU General Public License v3.0 (GPL-3.0)**.
Kurz gesagt: Jede/r darf den Code einsehen, nutzen und verändern — aber
Weiterverbreitungen (auch veränderte Forks) müssen ebenfalls unter der
GPL-3.0 offen bleiben. Der vollständige Lizenztext steht in
[`LICENSE`](LICENSE).

Copyright (C) 2026 Sönke Kastner. Entwickelt mit Unterstützung von
Claude (Anthropic).
