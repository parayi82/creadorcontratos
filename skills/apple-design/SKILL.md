# Apple Design Engineering — Web

Apply these rules before writing any HTML/CSS/JS. They take precedence over generic patterns.
Every principle here traces to Apple's Human Interface Guidelines (HIG) or WWDC design sessions.

## Core philosophy

One clear action per screen. Communicate through motion, not decoration. Every pixel either
communicates or gets out of the way. Simplicity is not the absence of complexity — it's mastery
of what matters. Never add a visual element that doesn't carry meaning.

---

## Color system

Never use literal hex values in component styles — always reference semantic tokens.

```css
:root {
  /* Backgrounds — layered like materials */
  --bg-base:     #f5f5f7;          /* page ground */
  --bg-elevated: #ffffff;          /* card surface */
  --bg-grouped:  #f2f2f7;          /* grouped list bg */
  --bg-overlay:  rgba(255,255,255,0.80); /* vibrancy panel */

  /* Fills — controls and interactive affordances */
  --fill-1: rgba(0,0,0,0.05);
  --fill-2: rgba(0,0,0,0.08);
  --fill-3: rgba(0,0,0,0.12);

  /* Labels — strict hierarchy */
  --label-1: #1d1d1f;
  --label-2: rgba(29,29,31,0.60);
  --label-3: rgba(29,29,31,0.30);
  --label-4: rgba(29,29,31,0.18);

  /* Separators */
  --sep:        rgba(0,0,0,0.08);
  --sep-opaque: #c6c6c8;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg-base:     #000000;
    --bg-elevated: #1c1c1e;
    --bg-grouped:  #000000;
    --bg-overlay:  rgba(28,28,30,0.80);
    --fill-1: rgba(255,255,255,0.05);
    --fill-2: rgba(255,255,255,0.08);
    --fill-3: rgba(255,255,255,0.12);
    --label-1: #f5f5f7;
    --label-2: rgba(245,245,247,0.60);
    --label-3: rgba(245,245,247,0.30);
    --label-4: rgba(245,245,247,0.18);
    --sep:        rgba(255,255,255,0.08);
    --sep-opaque: #38383a;
  }
}
:root[data-theme="dark"] {
  --bg-base:     #000000;
  --bg-elevated: #1c1c1e;
  --bg-grouped:  #000000;
  --bg-overlay:  rgba(28,28,30,0.80);
  --fill-1: rgba(255,255,255,0.05);
  --fill-2: rgba(255,255,255,0.08);
  --fill-3: rgba(255,255,255,0.12);
  --label-1: #f5f5f7;
  --label-2: rgba(245,245,247,0.60);
  --label-3: rgba(245,245,247,0.30);
  --label-4: rgba(245,245,247,0.18);
  --sep:        rgba(255,255,255,0.08);
  --sep-opaque: #38383a;
}
```

### Elevation — blur, not stacked shadows

```css
/* L0 — base (no shadow) */
/* L1 — card: subtle lift */
box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
/* L2 — popover / dropdown */
box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
/* L3 — modal / sheet */
box-shadow: 0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08);

/* Vibrancy / material overlay */
background: rgba(255,255,255,0.72);
backdrop-filter: blur(20px) saturate(180%);
-webkit-backdrop-filter: blur(20px) saturate(180%);
```

---

## Typography

Use system-ui / -apple-system as primary — it resolves to SF Pro on Apple devices.

### Type scale (Dynamic Type adapted for web)

| Role         | Size                      | Weight | Letter-spacing |
|--------------|---------------------------|--------|----------------|
| large-title  | clamp(28px, 4vw, 40px)   | 700    | -0.025em       |
| title-1      | clamp(22px, 2.8vw, 32px) | 700    | -0.020em       |
| title-2      | clamp(18px, 2.2vw, 26px) | 700    | -0.018em       |
| title-3      | clamp(15px, 1.6vw, 20px) | 600    | -0.010em       |
| headline     | 16px                      | 600    | -0.008em       |
| body         | 16px                      | 400    | -0.003em       |
| callout      | 15px                      | 400    | -0.003em       |
| subheadline  | 14px                      | 400    | -0.003em       |
| footnote     | 13px                      | 400    | -0.003em       |
| caption-1    | 12px                      | 400    | 0              |
| caption-2    | 11px                      | 400    | +0.006em       |

Rules:
- All headings: `text-wrap: balance`
- All-caps labels: `letter-spacing: 0.08em–0.12em` and `font-weight: 600`
- Tabular data: `font-variant-numeric: tabular-nums`
- Body copy max-width: 65ch (optical line length)
- Never use `font-weight: 800` or `900` for body text — reserve bold for navigation and number displays

---

## Motion & Animation

### The four Apple easing curves

```css
:root {
  /* Standard — smooth deceleration. Use for most transitions. */
  --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

  /* Spring — slight overshoot then settle. Use for entrances and expansions. */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Decelerate — element arriving on screen. */
  --ease-decel: cubic-bezier(0.0, 0.0, 0.2, 1.0);

  /* Accelerate — element leaving screen. */
  --ease-accel: cubic-bezier(0.4, 0.0, 1.0, 1.0);
}
```

### Duration tokens (never use arbitrary milliseconds)

```css
:root {
  --dur-instant:  0.10s;  /* state toggle, immediate tactile feedback */
  --dur-quick:    0.18s;  /* hover color, border, fill */
  --dur-std:      0.28s;  /* drawer open, tab switch, accordion */
  --dur-reveal:   0.42s;  /* scroll reveals, card entrances */
  --dur-long:     0.65s;  /* page transitions, complex spring sequences */
}
```

### Rules
- **Enter with `--ease-decel`, exit with `--ease-accel`.** An arriving element decelerates (has mass); a dismissed element accelerates (is pulled away).
- **Spring on expand.** Anything that grows — card lifting on hover, modal opening, button scaling up — uses `--ease-spring`. The slight overshoot is the Apple signature.
- **Stagger siblings at 60ms intervals, max 3 siblings.** More than 3 staggered items reads as laggy; group them instead.
- **Scale on active.** `.element:active { transform: scale(0.97); transition-duration: var(--dur-instant); }` — the press-down tells the user a tap registered.
- **Reveal: translateY(14px) → translateY(0).** Not 20–30px — Apple's reveals are subtle, not dramatic.
- Always wrap decorative animation in `@media (prefers-reduced-motion: reduce)`.

---

## Corner Radius — proportional rule

The radius must scale with the element's height. Using the same radius for a chip and a full-page modal is the most common design mistake.

| Element height | Radius    | Example                      |
|----------------|-----------|------------------------------|
| < 32px         | 6–8px     | chips, tags, micro buttons   |
| 32–48px        | 10–12px   | inputs, small cards          |
| 48–80px        | 14–16px   | standard cards, nav items    |
| 80–160px       | 20–24px   | large cards, info panels     |
| > 160px        | 28–36px   | modals, hero cards, sections |
| pill/CTA       | 9999px    | always — no exceptions       |

---

## Spacing — 4pt grid

All margin/padding/gap values must be multiples of 4px.

Most common: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 120px

- Component internal padding: 16–24px
- Between related elements (label → input): 8px  
- Between distinct groups: 24–32px
- Section vertical padding: 80–120px (desktop), 60–80px (mobile)
- Max content width: 1160px
- Mobile gutter: 20px (matches iOS safeAreaInsetLeft/Right)

---

## Materials (blur / vibrancy)

Translucency is purposeful — it shows context behind and creates depth cues.

```css
/* Regular material — nav bars, sidebars, floating panels */
.material {
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.20);
}

/* Thin — floating tooltips, hover cards */
.material-thin {
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(12px) saturate(140%);
}

/* Dark variant */
.material-dark {
  background: rgba(28,28,30,0.72);
  backdrop-filter: blur(20px) saturate(180%);
}
```

---

## Interactive Controls

### Buttons — minimum 44×44px touch target (Apple HIG requirement)

```css
.btn {
  min-height: 44px;
  padding: 0 20px;
  border-radius: 9999px;               /* pill — always */
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  border: none;
  transition:
    background var(--dur-quick) var(--ease),
    transform   var(--dur-quick) var(--ease),
    box-shadow  var(--dur-quick) var(--ease);
}
.btn:hover {
  transform: translateY(-1px);
}
.btn:active {
  transform: scale(0.97) translateY(0);
  transition-duration: var(--dur-instant);
}
```

### Inputs — always 44px height, 16px font (prevents iOS auto-zoom)

```css
input, select, textarea {
  min-height: 44px;
  border-radius: 10px;
  border: 1.5px solid var(--sep-opaque);
  font-size: 16px;                     /* 16px prevents iOS zoom */
  padding: 0 14px;
  transition:
    border-color var(--dur-quick) var(--ease),
    box-shadow   var(--dur-quick) var(--ease);
}
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(0,113,227,0.18);
  outline: none;
}
```

---

## Scroll Reveal Pattern

```css
.reveal {
  opacity: 0;
  transform: translateY(14px);        /* subtle — not dramatic */
  transition:
    opacity   var(--dur-reveal) var(--ease-decel),
    transform var(--dur-reveal) var(--ease-decel);
  will-change: transform, opacity;
}
.reveal.in {
  opacity: 1;
  transform: translateY(0);
}
/* Stagger — only up to 3 siblings */
.reveal:nth-child(2) { transition-delay: 60ms; }
.reveal:nth-child(3) { transition-delay: 120ms; }

@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1 !important; transform: none !important; }
}
```

Use `IntersectionObserver` with `threshold: 0.1` and `rootMargin: '0px 0px -8% 0px'`.

---

## Card Interaction System

Cards lift with spring physics on hover and scale slightly for depth. The scale on active state (click/tap) gives tactile feedback.

```css
.card {
  transition:
    transform   0.4s var(--ease-spring),   /* spring on hover entrance */
    box-shadow  0.4s var(--ease),           /* shadow follows easing */
    border-color var(--dur-quick) var(--ease);
}
.card:hover {
  transform: translateY(-5px) scale(1.008);
  box-shadow: 0 20px 44px -16px rgba(0,0,0,0.22);
}
.card:active {
  transform: translateY(-2px) scale(1.002);
  transition-duration: var(--dur-instant);
}
```

---

## FAQ / Accordion — smooth height animation

Use `max-height` transition to avoid `display: none ↔ block` which cannot animate.

```css
.faq-answer {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition:
    max-height var(--dur-std) var(--ease),
    opacity    var(--dur-std) var(--ease),
    padding    var(--dur-std) var(--ease);
  padding: 0 20px;
}
.faq-item.open .faq-answer {
  max-height: 400px;  /* generous ceiling */
  opacity: 1;
  padding: 0 20px 18px;
}
```

---

## Pre-shipping Checklist

- [ ] Every interactive element: min 44×44px touch target
- [ ] All transitions use `--dur-*` and `--ease-*` tokens
- [ ] Corner radius matches element height range
- [ ] All spacing is on the 4pt grid
- [ ] Colors from semantic tokens — no literal hex in components
- [ ] `text-wrap: balance` on all headings
- [ ] `prefers-reduced-motion` respected
- [ ] Dark mode verified with `[data-theme="dark"]` stamp
- [ ] Focus state visible for keyboard users
- [ ] Active state `scale(0.97)` on every clickable element
- [ ] No arbitrary `cubic-bezier` values — use `--ease-*` tokens
- [ ] Body text capped at 65ch
- [ ] Mobile gutter ≥ 20px
