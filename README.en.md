# Umbra – Decorrelation Stretch for Photoshop (UXP plugin)

**Version 1.0.0.** Previously developed under the working title
"D-Stretch"; the plugin is now called **Umbra**. It is still software
built for one photographer's own use and then shared for testing, so
expect rough edges. See "Known limitations" below before reporting
something as broken — it might already be a known issue.

Applies a classic **Decorrelation Stretch** (Gillespie et al., well
known from remote sensing and rock-art photography — see
[dstretch.com](https://www.dstretch.com)) to a duplicated layer. The
goal: pull apart colors that are highly correlated in the original photo
(e.g. faint red pigment on similarly-colored rock) so subtle color
differences become visible.

For the fuller, blow-by-blow development history (every bug found and
how it was fixed, in German) see `README.md` in this same folder — this
English file is a cleaner, testing-focused summary instead of a literal
translation.

## Installation

1. Install Adobe's **UXP Developer Tool** (free, via Creative Cloud
   Desktop or Adobe's developer site).
2. In Photoshop: Preferences → Plugins → enable **"Developer Mode"**.
3. In UXP Developer Tool: "Add Plugin" → select this folder (the one
   containing `manifest.json` directly) → "Load".
   **Important:** keep the `icons/` subfolder intact when copying the
   project — the panel icon lives at `icons/icon.png` (23×23) with the
   HiDPI version at `icons/icon@2x.png` (46×46; the `@2x` spelling is
   required — UXP ignores a file called `icon_2x.png`). If the icon files
   end up in the project's root instead of inside `icons/`, Photoshop
   won't find them and the panel icon stays blank/black.
4. The "Umbra" panel appears in Photoshop under Window → Plugins.

The UI language (English / German) is switched from the panel's flyout
menu (the hamburger icon on the tab): pick **Deutsch** or **English**, a
checkmark shows the active one.

## Two methods

**Method A — Lab a/b**
Duplicates the layer → converts the document to Lab mode → stretches
only the a\*/b\* (color) channels in a 2×2 transform → converts the
document back to RGB. Lightness (L\*) is left completely untouched. The
Lab conversion is just an internal step; by default the document is
returned to RGB so Method B, exporting, and blending layers keep working
(color mode is a document-wide property, not per-layer).

There is an opt-out: the **"Keep result in Lab mode"** checkbox leaves
the document in Lab so you can edit the individual a\*/b\*/L channels
directly (e.g. copy the a\* channel into its own document and work on it
with any tool). With it ticked, you must convert back to RGB yourself
before running Method B — if you forget, Method B stops with a clear
message rather than producing garbage.

**Method B — YRE / LRE** (modeled after DStretch for ImageJ)
Duplicates the layer → document stays in RGB → internally converts each
pixel to YUV (YRE) or Lab (LRE) → scales channels by user-editable
multipliers → full 3×3 decorrelation stretch (Karhunen–Loève) → undoes
the channel scaling → converts back to RGB.

**Important caveat:** the exact channel multipliers Jon Harman uses for
YRE/LRE in the original DStretch are not published anywhere I could
find. The plugin's starting values (YRE: 1.0/0.6/1.6, LRE: 1.0/1.6/0.6)
are reasonable guesses, **not the original values** — that's why
they're freely editable in the UI. Results will resemble original
DStretch output but won't be identical.

Recommended Sigma for Method B: keep it fairly low (roughly 15–30).
DStretch's own default is 15; at Sigma 60 many pixels tend to clip out
of range.

## Additional controls

- **Saturation (after stretch)** — slider, 0.1–2.0, default 1.0. Scales
  only the color intensity of the result (not the chosen color center,
  not brightness). Lower values tame the sometimes very vivid colors a
  strong stretch can produce.
- **Grayscale** — checkbox, Method B only. Converts the finished,
  stretched RGB result to pure brightness (standard luminance
  weighting), so the contrast the stretch found shows up as brightness
  differences instead of color.
- **Color balance before stretch (CB)** — checkbox, both methods. A
  gray-world correction applied to R/G/B *before* the stretch is
  computed, to reduce interference from a colored background (e.g.
  reddish rock) skewing the result.
- **Preserve original mean** — checkbox. Off by default. When off, the
  stretch also recenters the color result onto neutral, which tends to
  remove an overall color cast along with boosting contrast.

## Panel flyout menu

The hamburger icon on the panel's tab (UXP's "flyout menu") has four
entries: **Reload Plugin** (reloads the panel — handy after an update
without going through the UXP Developer Tool), **User Manual** (opens
the matching README on GitHub, German or English depending on the
panel's current language), **GitHub Repository**, and a greyed-out
**Version x.x.x** line. The version number itself now lives only in
`manifest.json` — the menu reads it at runtime instead of duplicating
it. This is the project's first use of UXP's `entrypoints.setup()`
lifecycle (previously the panel only ever initialized directly via
`index.html`/`main.js`); expect a correction round after the first real
test, per this project's usual pattern with UXP-specific assumptions.

## Presets

Each of YRE and LRE has "Save preset…" / "Load preset…" icon buttons
(floppy-disk-with-arrow icons) that open a native file save/open
dialog. A preset is a small `.json` file storing that method's 3 channel
multipliers, the current Sigma, and the selected color profile. YRE and
LRE presets are independent of each other.

## Layer naming

The duplicated layer's name records what was used to produce it, e.g.:

    Background – LRE (CB, Sat1.0, Si15)
    Background – Umbra (Sat1.0, Si25)     ← Method A

Method A layers are prefixed `Umbra`, Method B layers `YRE` or `LRE`.
`CB` appears only if color balance was on; `SatX.X` and `SiXX` (Sigma)
are always included; `Gray` appears only for Method B with grayscale
on.

## Color profile (sRGB / Adobe RGB) — Method B (LRE) only

LRE's Lab math needs to know the actual color primaries of your RGB
data to be colorimetrically correct — a checkbox lets you pick sRGB or
Adobe RGB (1998). Both share the same white point (D65), only the
primaries and gamma curve differ, so this is a real, not cosmetic,
difference. If your source is neither (e.g. ProPhoto RGB), results in
LRE specifically may show a color cast; Method A is unaffected, since
Photoshop's own color management handles the Lab conversion there.

## 8-bit / 16-bit

Images from Lightroom's "Edit in Photoshop" typically arrive as
**16-bit** files; manually opened images are often 8-bit. The plugin
detects this automatically from the pixel data type Photoshop returns
and adjusts its math accordingly — no action needed from you.

## Known limitations

None of this has been tested against a real Photoshop instance by the
developer (Claude) directly — only by the original author, on Windows,
with current Photoshop/OS versions. That's a large part of *why*
testing on other setups is valuable. Specific open questions:

- **Untested OS/Photoshop-version combinations.** Several UI bugs found
  during development turned out to be quirks of the specific embedded
  Chromium build UXP uses on this one setup (e.g. the CSS `gap`
  property silently not working, native `title` tooltips not updating,
  an emoji rendering as a "missing glyph" box, range-slider `step`
  values being ignored). A different Photoshop version, OS, or display
  scaling could plausibly surface new, different quirks of the same
  general kind.
- **16-bit value range (0–32768).** Confirmed by a hard Photoshop write
  error during development, so fairly solid — but only tested with one
  camera's files (Canon EOS R1 via Lightroom/Camera Raw).
- **`imaging.getPixels`/`putPixels` exact API behavior** can vary
  slightly by Photoshop/UXP version (e.g. the shape of
  `getData()`'s return value).
- **Performance** on very large images (especially 16-bit) may be slow
  — the pixel loop runs single-threaded, with no progress bar yet.
- **`sp-button`** (the Spectrum UI component used for the main action
  buttons) may need Adobe's Spectrum web-components script available;
  should be automatic in current Photoshop, untested on older versions.

## Reporting issues

The single most useful thing you can do when something looks wrong:
open the UXP Developer Tool's console (the "..." menu → "Show
DevTools") and copy any red error text, plus a description of exactly
what you clicked and what you expected vs. what happened. Screenshots
help a lot for anything visual (layout, icons, colors).

## License

Umbra is licensed under the **GNU General Public License v3.0
(GPL-3.0)**. In short: anyone may view, use, and modify the code — but
redistributions (including modified forks) must also remain open under
GPL-3.0. The full license text is in [`LICENSE`](LICENSE).

Copyright (C) 2026 Sönke Kastner. Developed with the assistance of
Claude (Anthropic).
