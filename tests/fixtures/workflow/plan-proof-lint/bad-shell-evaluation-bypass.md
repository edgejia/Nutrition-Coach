<task type="auto">
  <name>Historical shell read-only allowlist bypasses</name>
  <action>Inspect accepted evidence without changing files, Git configuration, or command resolution.</action>
  <verify>
    <automated>
      PATH=tests/fixtures/malicious rg 'accepted' evidence.md
      echo accepted >"$ARTIFACT"
      diff <(rm -f evidence.md) expected.md
      echo `rm -f accepted-evidence.md`
      git remote set-url origin https://example.invalid/repository.git
      sort -o accepted-evidence.md accepted-evidence.md
    </automated>
  </verify>
</task>
