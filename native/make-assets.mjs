// Generates the source images @capacitor/assets needs, from the Totem brand
// emblem, so the native app icons + splash match the web app.
//
//   node make-assets.mjs   (then: npx capacitor-assets generate)
//
// Brand: white totem emblem centred on deep navy #0A1C2C.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "assets");
const NAVY = "#0A1C2C";
const EMBLEM = join(ROOT, "totem-icon-white.png"); // white emblem, transparent bg

const navyBg = (size) => ({
  create: { width: size, height: size, channels: 4, background: NAVY },
});

// Places the emblem, scaled so its HEIGHT is `frac` of the canvas, centred.
async function emblemOn(size, frac, background) {
  const targetH = Math.round(size * frac);
  const emblem = await sharp(EMBLEM)
    .resize({ height: targetH, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const base = background === "transparent"
    ? sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    : sharp(navyBg(size));
  return base.composite([{ input: emblem, gravity: "centre" }]).png().toBuffer();
}

await mkdir(OUT, { recursive: true });

// iOS + fallback icon: emblem ~58% height on navy, 1024².
await sharp(await emblemOn(1024, 0.58, NAVY)).toFile(join(OUT, "icon-only.png"));

// Android adaptive icon: foreground (emblem within the ~66% safe zone, so ~46%
// of full canvas to survive the circular/rounded mask) on transparent, plus a
// solid navy background.
await sharp(await emblemOn(1024, 0.46, "transparent")).toFile(join(OUT, "icon-foreground.png"));
await sharp(navyBg(1024)).png().toFile(join(OUT, "icon-background.png"));

// Splash (light + dark both navy — the emblem is white, reads on navy in either
// device theme): emblem ~16% of the 2732² canvas, centred.
await sharp(await emblemOn(2732, 0.16, NAVY)).toFile(join(OUT, "splash.png"));
await sharp(await emblemOn(2732, 0.16, NAVY)).toFile(join(OUT, "splash-dark.png"));

console.log("Wrote source assets to native/assets/: icon-only, icon-foreground, icon-background, splash, splash-dark");
