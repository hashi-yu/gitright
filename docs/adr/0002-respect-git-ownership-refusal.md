---
status: accepted
---

# Respect Git's repository ownership refusal

When Git reports dubious repository ownership, GitRight surfaces the error and does not add, override, or disable `safe.directory`, either persistently or per command. This preserves Git's ownership trust boundary and GitRight's read-only security model at the cost of requiring users to resolve intentional shared-repository trust outside GitRight.
