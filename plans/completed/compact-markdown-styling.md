# Compact Markdown Styling Plan

## Goal
Make markdown rendering more compact and efficient with screen real estate. Reduce font sizes and vertical spacing to create a denser, more information-rich display.

## Current State Analysis

The markdown is rendered via `MarkdownRenderer` component using:
- Tailwind's `@tailwindcss/typography` plugin with `prose prose-invert prose-sm` classes
- Custom heading font sizes in `tailwind.config.js`
- Custom `CodeBlock` and `InlineCode` components

**Current heading sizes:**
- h1: 1.25rem (20px)
- h2: 1.125rem (18px)
- h3: 1rem (16px)
- h4: 0.875rem (14px)

**Current issues:**
- `prose-sm` provides base 14px font, but default Tailwind prose margins/line-heights are still relatively generous
- No custom paragraph, list, or blockquote spacing defined
- Code blocks have padding that could be tightened

## Implementation Plan

### 1. Reduce Heading Sizes

Update `tailwind.config.js` typography config:

| Element | Current | Proposed |
|---------|---------|----------|
| h1 | 1.25rem (20px) | 1.125rem (18px) |
| h2 | 1.125rem (18px) | 1rem (16px) |
| h3 | 1rem (16px) | 0.9375rem (15px) |
| h4 | 0.875rem (14px) | 0.875rem (14px) - unchanged |

### 2. Reduce Heading Margins

Add margin overrides to typography config:

```javascript
h1: {
  marginTop: '1em',      // down from 1.5em default
  marginBottom: '0.5em', // down from 0.75em
},
h2: {
  marginTop: '1em',
  marginBottom: '0.5em',
},
h3: {
  marginTop: '0.75em',
  marginBottom: '0.375em',
},
h4: {
  marginTop: '0.75em',
  marginBottom: '0.25em',
},
```

### 3. Reduce Paragraph and List Spacing

Add to typography config:

```javascript
p: {
  marginTop: '0.5em',
  marginBottom: '0.5em',
  lineHeight: '1.5',  // down from ~1.625 in prose-sm
},
ul: {
  marginTop: '0.5em',
  marginBottom: '0.5em',
  paddingLeft: '1.25em', // tighter indent
},
ol: {
  marginTop: '0.5em',
  marginBottom: '0.5em',
  paddingLeft: '1.25em',
},
li: {
  marginTop: '0.25em',
  marginBottom: '0.25em',
},
'li > p': {
  marginTop: '0.25em',
  marginBottom: '0.25em',
},
```

### 4. Reduce Blockquote Spacing

```javascript
blockquote: {
  marginTop: '0.75em',
  marginBottom: '0.75em',
  paddingLeft: '0.75em',
},
```

### 5. Tighten Code Block Styling

Update `code-block.tsx`:
- Header padding: `px-3 py-2` → `px-2 py-1.5`
- Content padding: `p-3` → `p-2`
- Border radius: keep `rounded-lg`

### 6. Tighten Table Styling

Update `markdown-renderer.tsx` table components:
- Cell padding: `px-3 py-2` → `px-2 py-1.5`
- Wrapper margin: `my-4` → `my-2`

### 7. Reduce First/Last Element Margins

Add to typography config to prevent excessive spacing at content boundaries:

```javascript
'> :first-child': {
  marginTop: '0',
},
'> :last-child': {
  marginBottom: '0',
},
```

## Files to Modify

1. **`tailwind.config.js`** - Typography plugin configuration for fonts, margins, line heights
2. **`src/components/thread/code-block.tsx`** - Tighten padding on header and content areas
3. **`src/components/thread/markdown-renderer.tsx`** - Tighten table padding

## Testing Checklist

- [ ] Verify headings are visually distinct but more compact
- [ ] Check paragraph spacing doesn't feel cramped
- [ ] Ensure lists remain readable
- [ ] Test code blocks maintain readability
- [ ] Verify tables are still usable
- [ ] Test with long markdown documents to see density improvement
- [ ] Check nested list indentation still works properly
- [ ] Test blockquotes appearance

## Rollback

All changes are in configuration/styling only. Easy to revert by restoring original values in the three files.
