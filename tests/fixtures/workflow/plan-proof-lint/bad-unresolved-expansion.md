<task type="auto">
  <name>Shell expansion cannot choose proof inputs</name>
  <verify>
    rg accepted "$EVIDENCE"
    rg accepted ${EVIDENCE}
    rg accepted $'evidence.md'
    rg accepted docs/*.md
    rg accepted "docs/[ab].md"
    rg accepted docs/{a,b}.md
  </verify>
</task>
