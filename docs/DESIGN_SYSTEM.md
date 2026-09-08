# Minecraft Server Hub design system

The two user-supplied mockups are the accepted visual specification. The dark mockup is the primary composition and the light mockup is the same component system under light tokens.

## Layout

- 72 px title bar, 400 px navigation rail at the 1536 px reference width, fluid detail canvas.
- Server detail uses an open header, one tab rail, four equal metric panels, and a single log panel.
- At widths below 900 px the rail becomes an overlay controlled from the title bar. Primary actions remain visible.

## Tokens

- Dark background `#0b1218`, surface `#151e25`, raised surface `#1b252d`, border `#34414a`.
- Light background `#f7f9fa`, surface `#ffffff`, raised surface `#f4f7f8`, border `#d5dde2`.
- Success `#45d268`, danger `#ef4545`, warning `#f0bf2c`.
- UI font: `Yu Gothic UI`, `Noto Sans JP`, `Segoe UI`, sans-serif.
- Console font: `Cascadia Mono`, `Consolas`, monospace.
- Radius family: 8 px controls, 12 px panels, 16 px large surfaces.

## Interaction contract

- Green means running or successful, red is reserved for destructive operations, yellow means user action is required.
- All icon-only controls have Japanese accessible names, visible focus rings, and 44 px minimum targets.
- Motion is limited to status transitions and panel entry; `prefers-reduced-motion` disables it.
- The original voxel island is decorative only and never contains UI text.
