---
title: Edge cases
tags: [edge, test]
---

# Heading right after frontmatter

Some intro text, followed by a paragraph immediately underlined by a
line of dashes
---

That underlined paragraph is a Setext heading, not a divider — the dashes
are its underline, not a horizontal rule.

Here's an actual horizontal rule, properly blank-line-separated on both
sides:

---

Nested lists:

- Top level item
  - Nested item one
  - Nested item two
    - Doubly nested item
- Another top-level item with a task
  - [ ] Nested todo
  1. Nested ordered item
  2. Another nested ordered item

A table, out of scope for decoration — renders raw, undamaged:

| Name | Role     |
| ---- | -------- |
| Ada  | Engineer |
| Issa | Poet     |

Text right after the table, to make sure nothing bleeds across the
boundary.
