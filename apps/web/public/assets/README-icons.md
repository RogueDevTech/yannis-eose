# PWA & favicon assets

- **Source:** `icon-512-maskable.png` (512×512) — Y monogram, brand blue (#1565C0), maskable safe zone (~80% center).
- **Derived sizes:** 32, 180, and 192 are produced by downscaling the 512 asset (e.g. `sips -z 32 32 icon-512-maskable.png --out favicon-32.png` on macOS).
- **Usage:** Favicon and apple-touch-icon in `app/root.tsx`; manifest icons in `manifest.webmanifest`. In-app logos (sidebar, auth) still use `yannis-logo1.png` / `yannis-logo-white-bg.png`.
