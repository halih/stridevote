# StrideVote brand assets

Canvassing app for progressive campaigns.
Name system: **StrideTheVote** (formal) → **stride.vote** (domain) → **StrideVote** (app name).

## Files

### App icon
- `stridevote-icon.svg` — master icon, rounded-square housing (Democratic blue, white walker)
- `stridevote-icon-square.svg` — square-corner variant for platforms that apply their own mask (iOS)
- `stridevote-icon-{1024,512,180,120,60,29}.png` — rendered sizes covering App Store art, iPhone home screen (@2x/@3x), spotlight, and settings

### Wordmark lockups (icon + text)
- `lockup-stridethevote.svg` / `-dark.svg` — full formal name
- `lockup-stride-dot-vote.svg` / `-dark.svg` — domain form
- `lockup-stridevote.svg` / `-dark.svg` — app name (primary lockup)

Light variants are for white/light backgrounds; dark variants for dark backgrounds.
Note: lockups use a system font stack (Helvetica Neue/Arial). For final production,
have a designer set the wordmark in your chosen brand typeface and convert text to outlines.

### Animation
- `stridevote-animation.html` — self-contained splash animation:
  StrideTheVote → stride.vote → StrideVote, then holds on the app name.
  Respects prefers-reduced-motion (jumps straight to the final state).
  A loop mode is included but commented out in the script.

## Palette
| Role | Hex |
|---|---|
| Housing / primary blue | `#185FA5` |
| Accent (Vote, dot) | `#378ADD` |
| Accent light ("The") | `#85B7EB` |
| Ink (light bg text) | `#1F2733` |
| Dark-bg accent | `#5FA8E8` |
| Walker | `#FFFFFF` |

## Provenance
The walker silhouette was vectorized from a pedestrian-crossing pictogram
(a standardized public traffic symbol), mirrored to walk rightward.
The specific rendering here is original to this brand.

## Suggested next steps
- Register stridevote.com/.org/.app (checked available July 2026) alongside stride.vote
- USPTO search for "StrideVote" in software / political-services classes
- Designer pass: smooth the traced path, set wordmark in brand typeface
