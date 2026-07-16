<task type="auto">
  <name>Search commands cannot launch helpers</name>
  <verify>
    rg --pre rm accepted evidence.md
    rg --hostname-bin=rm accepted evidence.md
    rg --pre-glob '*.md' accepted evidence.md
  </verify>
</task>
