# PRISM Design System Audit

Review of the Automation Console UI against Zoom's PRISM Design System guidelines.

---

## Summary

The app makes a good effort at PRISM alignment — it uses semantic token names (`--text-text-neutral`, `--fill-fill-primary`, etc.), follows the general layout patterns (topbar + left nav + content area), and uses rounded corners and spacing consistent with PRISM. However, there are significant gaps in token coverage, component patterns, typography, spacing, and interaction states.

**Overall PRISM compliance: ~55%** — the structure is right but the details need work.

---

## 🔴 Critical Issues

### 1. Missing PRISM Token File

```html
<link rel="stylesheet" href="/prism/tokens.css" />
```

This file doesn't exist in the project. The app relies on CSS variables that are **never defined** — they only work because the dark mode override block defines fallback values. In light mode, all token values are undefined (browsers use initial values or fallbacks).

**Fix:** Either:
- Bundle the actual PRISM tokens CSS from Zoom's design system package
- Or create a `public/prism/tokens.css` file that defines all light-mode token values

### 2. Font Family is Wrong

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

PRISM uses **Lato** as the primary typeface for Zoom web products, with system-ui as fallback:
```css
font-family: "Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

**Fix:** Import Lato from Google Fonts or the Zoom CDN and update the font stack.

### 3. Hardcoded Colors in Dark Mode

The dark mode block defines raw hex values (`#1a1a2e`, `#16213e`, etc.) that don't match PRISM's dark theme palette. PRISM dark mode uses specific grays from the neutral scale, not custom blues.

**Fix:** Use PRISM's actual dark mode token values:
- Background: `#1b1b1b` (not `#1a1a2e`)
- Surface: `#2c2c2c` (not `#16213e`)
- Text: `#e3e3e3` (not `#e8e8e8`)

---

## 🟡 Component Pattern Issues

### 4. Buttons Don't Follow PRISM Variants

PRISM defines button variants: **Primary**, **Secondary**, **Tertiary**, **Ghost**, **Danger**. Each has specific sizing, padding, and border-radius rules.

Current issues:
- `border-radius: 12px` — PRISM buttons use **8px** radius (not 12px)
- Missing **Secondary** button style (outlined with primary color border)
- No **hover/active/focus** state tokens — using `opacity: 0.9` instead of proper state tokens
- Button height `32px` is correct for "small" but PRISM default is **36px**

**Fix:**
```css
.primary-button {
  height: 36px;
  border-radius: 8px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 14px;
}
.primary-button:hover {
  background: var(--fill-fill-primary-hover);
}
.primary-button:active {
  background: var(--fill-fill-primary-pressed);
}
```

### 5. Panel/Card Border Radius Too Large

```css
.panel { border-radius: 16px; }
```

PRISM uses **12px** for cards/panels and **8px** for smaller containers. 16px is reserved for modals/dialogs only.

**Fix:** `border-radius: 12px` for panels, `8px` for inner containers.

### 6. Input Fields Missing PRISM Styling

Current inputs have minimal styling. PRISM inputs should have:
- Height: **36px** (default) or **32px** (compact)
- Border-radius: **8px**
- Border: `1px solid var(--border-border-neutral)`
- Focus state: `2px solid var(--border-border-primary)` with no outline-offset
- Placeholder color: `var(--text-text-placeholder)`
- Background: `var(--fill-fill-input)` or `var(--background-bg-default)`

### 7. Toggle/Checkbox Not PRISM-Styled

The app uses native `<input type="checkbox">` elements. PRISM has custom toggle and checkbox components with specific dimensions, colors, and animations.

**Fix:** Create styled toggle and checkbox components matching PRISM specs:
- Toggle: 40×20px track, 16px knob, primary color when on
- Checkbox: 16×16px, 4px radius, checkmark icon, primary fill when checked

---

## 🟡 Typography Issues

### 8. Font Weights Don't Match PRISM Scale

The app uses weights like `510`, `590`, `650`, `750`. PRISM uses standard weights:
- **400** — Regular (body text)
- **600** — Semibold (labels, emphasis)
- **700** — Bold (headings)

Non-standard weights like 510/590/650 only work with variable fonts. If Lato isn't loaded as a variable font, these render as the nearest standard weight anyway.

**Fix:** Standardize to 400/600/700.

### 9. Heading Sizes Don't Follow PRISM Type Scale

PRISM type scale:
- **H1**: 24px / 32px line-height
- **H2**: 20px / 28px line-height
- **H3**: 16px / 24px line-height
- **Body**: 14px / 20px line-height
- **Caption**: 12px / 16px line-height

Current:
- H1: 22px (should be 24px)
- H2: 18px (should be 20px)
- Panel header H2: 18px ✓ (close enough)

### 10. Letter-Spacing

PRISM uses `letter-spacing: -0.01em` for headings and `0` for body text. The app doesn't set letter-spacing at all.

---

## 🟡 Spacing & Layout Issues

### 11. Spacing Doesn't Use PRISM Scale

PRISM spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px.

The app mostly follows this but has some off-scale values:
- `padding: 7px 8px` — should be `8px`
- `gap: 6px` — should be `4px` or `8px`
- `padding: 10px 12px` — should be `12px`

### 12. Content Area Padding

```css
.content-area { padding: 20px 24px 24px; }
```

PRISM recommends **24px** uniform padding for content areas, or **32px** for wider layouts.

### 13. Left Nav Width

```css
.left-nav { width: 280px; }
```

PRISM's standard left navigation is **240px** (collapsed) or **280px** (expanded). The current 280px is acceptable but should have a collapsed state for smaller viewports.

---

## 🟡 Interaction State Issues

### 14. Missing Hover/Active/Focus States

Many interactive elements lack proper state styling:
- `.primary-button:hover` — not defined (relies on browser default)
- `.tertiary-button:hover` — not defined
- Table rows — no hover state
- Workflow items — have hover but no active/pressed state

PRISM requires all interactive elements to have: **default → hover → active → focus → disabled** states.

### 15. Focus Ring Style

```css
button:focus-visible { outline: 2px solid var(--border-border-primary); outline-offset: 2px; }
```

PRISM uses a **box-shadow** focus ring instead of outline for better visual integration:
```css
button:focus-visible {
  box-shadow: 0 0 0 2px var(--background-bg-default), 0 0 0 4px var(--border-border-primary);
  outline: none;
}
```

---

## 🔵 Nice-to-Have Improvements

### 16. Status Badges Should Use PRISM Chip Component

The `.status-badge` class approximates PRISM's Chip/Tag component but doesn't match exactly:
- PRISM chips: height 24px, border-radius 12px, font-size 12px, font-weight 600
- Should use `var(--fill-fill-subtler-{color})` background with `var(--text-text-{color})` text

### 17. Table Should Follow PRISM Data Table Pattern

PRISM data tables have:
- Header row: `background: var(--fill-fill-subtler-neutral)`, font-weight 600
- Row height: 48px (default) or 40px (compact)
- Row hover: `var(--state-state-subtle-neutral-hover)`
- Row borders: only bottom border, not full grid
- Checkbox column: 48px width, centered

### 18. Toast Notifications Should Use PRISM Alert Pattern

PRISM alerts/toasts:
- Border-radius: 8px
- Left border: 4px (matches current ✓)
- Icon: 20px, specific per type
- Close button: 24×24px ghost button
- Shadow: `0 4px 12px rgba(0, 0, 0, 0.08)` (lighter than current)
- Max-width: 480px

### 19. Dialog Should Use PRISM Modal Pattern

PRISM modals:
- Border-radius: 12px (not 16px)
- Padding: 24px
- Title: 20px semibold
- Backdrop: `rgba(0, 0, 0, 0.5)` (not 0.4)
- Close button in top-right corner
- Action buttons right-aligned with 8px gap ✓

### 20. Topbar Should Match Zoom Workplace Header

The topbar is close but:
- Height should be **56px** (not 60px)
- Logo should use the official Zoom wordmark SVG (not text "zoom")
- Search bar should have a search icon + placeholder text + keyboard shortcut hint
- Avatar should show user initials in the correct PRISM avatar component style

---

## Recommended Priority Order

1. **Create `public/prism/tokens.css`** with all light-mode token values (blocks everything else)
2. **Fix button border-radius** (12px → 8px) and height (32px → 36px)
3. **Fix panel border-radius** (16px → 12px)
4. **Add Lato font** import
5. **Fix heading sizes** to match type scale
6. **Add proper hover/active states** to all interactive elements
7. **Fix focus ring** to use box-shadow pattern
8. **Standardize spacing** to PRISM 4px grid
9. **Style inputs** with proper PRISM field component pattern
10. **Fix dark mode** to use actual PRISM dark palette

---

## Quick Reference: PRISM Token Naming Convention

```
--{category}-{property}-{variant}-{state}

Categories: background, text, fill, border, icon, state
Properties: bg, text, fill, border, icon, state
Variants: neutral, primary, success, error, warning, inverse
States: hover, pressed, disabled, focus
Modifiers: stronger, subtle, subtler
```

Examples:
- `--text-text-stronger-neutral` — strongest neutral text (headings)
- `--fill-fill-subtler-primary` — very light primary fill (selected states)
- `--state-state-subtle-neutral-hover` — hover state for neutral elements
