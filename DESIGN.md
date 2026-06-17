# Stats Panel Design Contract

## Sources

- Notion design reference: https://raw.githubusercontent.com/VoltAgent/awesome-design-md/refs/heads/main/design-md/notion/DESIGN.md
- Notion appearance behavior: https://www.notion.com/help/account-settings
- Notion color reference for dark mode: https://matthiasfrank.de/en/notion-colors/
- Radix Primitives: https://www.radix-ui.com/primitives

## Direction

Stats Panel should feel like a compact Notion workspace panel adapted for live telemetry. The dashboard keeps its existing three-column information architecture and metric density, but uses Notion-style surfaces, warm text colors, restrained borders, and small editorial controls instead of the previous dark gradient treatment.

## Tokens

- Typography: Inter / Notion Sans style fallback stack, 400 body, 500 controls, 600 section headings.
- Radius: 8px for buttons and inputs, 12px for dashboard/settings cards, full radius only for status badges and switch thumbs.
- Light canvas: `#ffffff`.
- Light surface: `#f6f5f4`.
- Light text: `#37352f`, with `#5d5b54` and `#787671` for secondary labels.
- Hairlines: `#e5e3df`, `#ede9e4`, and `#c8c4be`.
- Primary action: Notion purple `#5645d4`, pressed `#4534b3`.
- Dark canvas: `#191919`.
- Dark surface: `#202020` / `#252525`.
- Dark text: `#d4d4d4`, with muted text around `#9b9b9b`.

## Appearance

Settings expose `Light`, `Dark`, and `Auto`. `Auto` persists as `system` and follows `prefers-color-scheme`. Old preferences without an appearance field default to `system`.

## Components

- Use Radix Primitives for switches, sliders, checkboxes, toggle groups, and tooltips.
- Use lucide-react for icons.
- Do not add Tailwind, shadcn, Mantine, Chakra, or another styled component system.
- Buttons and controls should be rectangular, 8px rounded, and text should never overflow its control.
- Cards are individual panels only. Avoid nested cards and decorative gradients.

## Metric Colors

- CPU: Notion teal `#2a9d99`.
- Memory: Notion yellow/brown family `#c29343`.
- GPU: Notion blue `#337ea9`.
- Network: Notion green `#448361`.
- Disk: Notion red `#d44c47`.

Dark mode uses the corresponding brighter Notion dark-mode icon/text variants for legibility.
