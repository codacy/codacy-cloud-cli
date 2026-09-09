---
"@codacy/codacy-cloud-cli": minor
---

New `-k, --matches-stack [value]` filter on `codacy patterns`, which narrows a tool's code patterns to those that do (or don't) match the repository's detected stack.

It's a tri-state flag, the same shape as `issues --false-positives`:

```bash
codacy patterns eslint9 --matches-stack          # only patterns matching the repo stack
codacy patterns eslint9 --matches-stack true     # same
codacy patterns eslint9 --matches-stack false    # only patterns that don't match
codacy patterns eslint9                          # unfiltered
```

The filter applies in bulk mode too, so `--enable-all` / `--disable-all` can be scoped to the stack:

```bash
codacy patterns eslint9 --disable-all --matches-stack false
```

The summary printed after a bulk update still reports counts for the whole tool, not just the updated subset.

Only `true` and `false` are accepted as values. Because Commander's optional-value syntax consumes the next token, a lax parser would let `codacy patterns gh org repo --matches-stack eslint` silently swallow the tool name and then fail with a confusing positional-count error; the flag now rejects non-boolean values with a message that says what to do instead.
