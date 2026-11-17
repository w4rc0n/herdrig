# Herdrig logo

Amber palette. Light versions are for light backgrounds, dark versions for dark ones.

| File | Use |
|---|---|
| `herdrig-logo-light.svg`, `herdrig-logo-dark.svg` | Mark and wordmark for the README header. Transparent background: the gaps in the chain show whatever page is behind them. |
| `herdrig-icon-light.svg`, `herdrig-icon-dark.svg` | Full mark on a square, for 128 px and up (avatars, herdr.dev, docs). |
| `herdrig-icon-small-light.svg`, `herdrig-icon-small-dark.svg` | Simplified mark for 64 px and below (favicons, tab icons). The full mark's detail turns to mush at these sizes. |
| `png/herdrig-icon-{light,dark}-{512,256}.png` | Full mark. |
| `png/herdrig-icon-{light,dark}-{64,32}.png` | Simplified mark. |
| `png/herdrig-social-{dark,light}.png` | 1280 x 640 GitHub social preview. Upload one in the repo's Settings, General, Social preview. |

## README header

Put this where the `# Herdrig` heading is, or above it. GitHub shows the dark file to readers using a dark theme.

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/herdrig-logo-dark.svg">
    <img src="assets/logo/herdrig-logo-light.svg" alt="Herdrig" width="420">
  </picture>
</p>
```

## Colours

| | Light | Dark |
|---|---|---|
| Background | `#FBF8F2` | `#0E0F11` |
| Chain | `#B86A00` | `#FFB84D` |
| Hammer and wordmark | `#1A1A1A` | `#E6E7E4` |
| Secondary text | `#5E5A55` | `#9A9C98` |

The herdr tile always keeps its own colours, `#D9DAD8` and `#303438`.

## Type

The wordmark is Space Grotesk Bold and the social preview tagline is JetBrains Mono Medium, both drawn as outlines so nothing depends on installed fonts.

See [ATTRIBUTION.md](ATTRIBUTION.md) for the third-party logos inside the mark.
