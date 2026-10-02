import { writeFileSync } from "node:fs";
import sharp from "sharp";

// A checklist card with a folded corner, centered on the canvas and turned by
// `rotate` degrees. `checked` lists which of its three rows are ticked; a card
// with `rows: false` is a plain note.
function card({
  w,
  h,
  dx,
  dy,
  rotate,
  fill,
  fold,
  box,
  check,
  line,
  checked = [],
  rows = true,
}) {
  const x = 256 - w / 2 + dx;
  const y = 256 - h / 2 + dy;
  const r = w * 0.12;
  const f = w * 0.2;
  const size = w * 0.15;
  const list = [0.42, 0.34, 0.4].map((length, i) => {
    const cy = y + h * 0.3 + i * h * 0.24;
    const bx = x + w * 0.17;
    const done = checked.includes(i);
    return `
      <rect x="${bx}" y="${cy - size / 2}" width="${size}" height="${size}" rx="${size * 0.28}"
        fill="${done ? box : "none"}" stroke="${box}" stroke-width="${done ? 0 : w * 0.028}"/>
      ${done ? `<path d="M${bx + size * 0.25} ${cy + size * 0.02} l${size * 0.18} ${size * 0.18} l${size * 0.34} -${size * 0.36}" fill="none" stroke="${check}" stroke-width="${w * 0.032}" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      <rect x="${bx + size + w * 0.1}" y="${cy - w * 0.022}" width="${length * w}" height="${w * 0.044}" rx="${w * 0.022}" fill="${line}" opacity="${done ? 0.45 : 0.9}"/>`;
  });
  return `<g transform="rotate(${rotate} ${256 + dx} ${256 + dy})">
    <path d="M${x + r} ${y} H${x + w - f} L${x + w} ${y + f} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z" fill="${fill}"/>
    <path d="M${x + w - f} ${y} V${y + f * 0.72} Q${x + w - f} ${y + f} ${x + w - f * 0.72} ${y + f} H${x + w} Z" fill="${fold}"/>
    ${rows ? list.join("") : ""}
  </g>`;
}

// The app's charcoal canvas and mint accent: a dark checklist over a yellow
// note. The artwork fills the square but stays inside the central safe zone, so
// it works as a normal icon and as a maskable (cropped) home-screen icon.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="canvas" cx="50%" cy="15%" r="90%">
      <stop offset="0" stop-color="#2b3036"/>
      <stop offset="1" stop-color="#141619"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#canvas)"/>
  ${card({ w: 226, h: 270, dx: -18, dy: -12, rotate: -9, fill: "#f0d087", fold: "#c9a95e", rows: false })}
  ${card({ w: 226, h: 270, dx: 10, dy: 10, rotate: 4, fill: "#2e343a", fold: "#48515b", box: "#8ecfba", check: "#17191c", line: "#d3d9e0", checked: [0] })}
</svg>`;

// Browser tabs show the icon at 16-32 px, where the tilted cards blur, so the
// favicon is a single yellow note filling the square, its corner turned down,
// with a bold check, drawn on a 32 px grid.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M4 0 H22 L32 10 V28 Q32 32 28 32 H4 Q0 32 0 28 V4 Q0 0 4 0 Z" fill="#f5ce55"/>
  <path d="M22 0 V8 Q22 10 24 10 H32 Z" fill="#b8912a"/>
  <path d="M6.5 18.5 l6 6 l10.5 -12" fill="none" stroke="#2e343a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

async function icon(size, file, source = svg) {
  await sharp(Buffer.from(source)).resize(size).png().toFile(file);
}

writeFileSync("public/favicon.svg", favicon);
await icon(32, "public/favicon-32.png", favicon);
await icon(180, "public/icon.png");
await icon(192, "public/icon-192.png");
await icon(512, "public/icon-512.png");
