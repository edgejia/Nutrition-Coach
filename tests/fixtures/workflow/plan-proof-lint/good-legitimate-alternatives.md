<task type="auto">
  <name>Phase 100 legitimate terminal alternatives</name>
  <action>Accept either of two explicitly equivalent terminal statuses.</action>
  <verify>
    <automated>
      # proof-lint: allow-or rationale=both values are canonical terminal alternatives
      # proof-lint: allow-pass-marker rationale=the checker validates terminal status semantics
      rg "status: (passed|human_needed)" verification.md
    </automated>
  </verify>
</task>
