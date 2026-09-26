import sharp from "sharp";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StickyNote } from "lucide-react";

// A full-bleed square with the glyph inside the central safe zone, so the same
// artwork works as a normal icon and as a maskable (cropped) home-screen icon.
async function icon(size, file) {
  const glyph = Math.round(size * 0.64);
  const svg = renderToStaticMarkup(
    React.createElement(StickyNote, {
      size: glyph,
      color: "#654e08",
      strokeWidth: 1.3,
    }),
  );
  const offset = Math.round((size - glyph) / 2);
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#f5ce55" },
  })
    .composite([{ input: Buffer.from(svg), left: offset, top: offset }])
    .png()
    .toFile(file);
}

await icon(180, "public/icon.png");
await icon(192, "public/icon-192.png");
await icon(512, "public/icon-512.png");
