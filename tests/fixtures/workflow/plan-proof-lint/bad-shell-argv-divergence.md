<task type="auto">
  <name>Shell argv divergence regression</name>
  <action>Inspect accepted evidence without changing it.</action>
  <verify>
    <automated>
      $(printf rm) -rf accepted-evidence
      find . "$(printf %s -delete)"
      find . -\delete
      sort -\o accepted-evidence.md input.md
      sed -n "1w accepted-evidence.md" input.md
    </automated>
  </verify>
</task>
