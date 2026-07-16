<task type="auto">
  <name>Historical oversized inline reducer</name>
  <action>Validate a generated artifact.</action>
  <verify>
    <automated>
      node --input-type=module --eval 'const fs = await import("node:fs"); const text = fs.readFileSync("artifact.md", "utf8"); const required = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]; for (const marker of required) { if (!text.includes(marker)) throw new Error(`missing ${marker}`); } console.log("ok");'
    </automated>
  </verify>
</task>
