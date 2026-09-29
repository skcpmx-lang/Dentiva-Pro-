/**
 * Generates the application icon and the branding assets used by the installer, the window and the
 * printed documents. Run with `npm run icons`.
 *
 * The mark is drawn from vectors so every size is crisp: a rounded square in the Dentiva Pro teal with a
 * stylised tooth glyph. Outputs:
 *   build/icon.png, build/icon.ico, build/icons/<size>.png   (installer / shortcuts / linux)
 *   assets/branding/logo.png, logo-256.png, logo-64.png       (shipped inside the app)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The master artwork, drawn at 1024×1024 so downscaling stays sharp. */
function markSvg(size = 1024) {
  const radius = size * 0.22
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#12869c"/>
      <stop offset="100%" stop-color="#0b5f70"/>
    </linearGradient>
    <linearGradient id="tooth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e6f4f7"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="${radius}" fill="url(#bg)"/>
  <rect x="32" y="32" width="960" height="960" rx="${radius}" fill="none" stroke="#0a5260" stroke-width="16" opacity="0.35"/>
  <path d="M512 214c-52 0-88 26-138 26-52 0-96-24-134 12-46 43-52 128-34 220 14 74 38 132 60 196 18 52 30 106 60 130 34 27 62-6 76-60 12-46 18-92 46-116 14-12 34-12 48 0 28 24 34 70 46 116 14 54 42 87 76 60 30-24 42-78 60-130 22-64 46-122 60-196 18-92 12-177-34-220-38-36-82-12-134-12-50 0-86-26-138-26z" fill="url(#tooth)"/>
  <path d="M420 386c46 0 76 22 92 52 16-30 46-52 92-52 62 0 104 44 104 104 0 82-64 148-196 148" fill="none" stroke="#12869c" stroke-width="34" stroke-linecap="round" opacity="0.85"/>
  <circle cx="372" cy="330" r="26" fill="#12869c" opacity="0.55"/>
</svg>`
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

async function main() {
  const buildDir = join(root, 'build')
  const iconsDir = join(buildDir, 'icons')
  const brandingDir = join(root, 'assets', 'branding')
  const svgBuffer = Buffer.from(markSvg(1024))

  mkdirSync(iconsDir, { recursive: true })
  mkdirSync(brandingDir, { recursive: true })

  // Master PNG (electron-builder wants a 512×512 or larger source).
  const master = await sharp(svgBuffer).resize(1024, 1024).png().toBuffer()
  writeFileSync(join(buildDir, 'icon.png'), master)

  const pngForIco = []
  for (const size of sizes) {
    const buffer = await sharp(svgBuffer).resize(size, size).png().toBuffer()
    writeFileSync(join(iconsDir, `${size}x${size}.png`), buffer)
    if (size <= 256) pngForIco.push(buffer)
    if (size === 512) writeFileSync(join(brandingDir, 'logo.png'), buffer)
    if (size === 256) writeFileSync(join(brandingDir, 'logo-256.png'), buffer)
    if (size === 64) writeFileSync(join(brandingDir, 'logo-64.png'), buffer)
  }

  writeFileSync(join(buildDir, 'icon.ico'), await pngToIco(pngForIco))
  writeFileSync(join(brandingDir, 'logo.svg'), markSvg(1024))

  process.stdout.write(
    `Icons written: build/icon.png, build/icon.ico, build/icons/*.png and assets/branding/*\n`
  )
}

main().catch((error) => {
  process.stderr.write(`Icon generation failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
