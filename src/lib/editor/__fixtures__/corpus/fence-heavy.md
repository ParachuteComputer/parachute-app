# Snippets

Setting up the dev box:

```bash
# This looks like a heading but it's a comment inside a fence
echo "- [ ] not a checkbox"
echo "**not bold**"
echo "[[not a wikilink]]"
```

A JS example, with markdown-looking content inside it:

```js
// [[also not a wikilink]]
const heading = "# not a heading either";
function isDone(task) {
  return /^\s*-\s*\[x\]/i.test(task);
}
```

An indented code block (4+ spaces) — a different node type than a fence,
same rule applies:

    # still not a heading
    - [ ] still not a checkbox
    **still not bold**

Back to real prose: this line has real `inline code` and real **bold**
text and a real [[wikilink]], all outside any fence.
