## 2024-03-28 - Icon-Only Buttons
**Learning:** Icon-only buttons or buttons that contain visually hidden text (like an "x" for dismissing a banner) require `aria-label` attributes for accessibility. While `title` tooltips provide visual clues, they are not universally or reliably announced by all screen readers.
**Action:** Always verify icon-only buttons (`<button>`) contain an `aria-label` when the inner content is merely an icon or a visually decorative element.
