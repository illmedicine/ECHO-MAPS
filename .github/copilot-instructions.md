# Copilot Workspace Instructions — ECHO-MAPS (Echo Vue by Illy Robotics)

## Release Summary Directive

Whenever the user asks for a release summary, changelog, "what's been fixed", "what changed", or any similar request for a summary of recent work:

1. **Present the full response in chat** as normal.
2. **Automatically write the raw markdown output** to the file `.illy/latest_release.md` at the workspace root, overwriting any previous content. Create the `.illy/` directory if it does not exist.
3. The file must include a YAML frontmatter block with `date`, `commit`, and `branch` fields, followed by the full summary content.
4. Do NOT ask for confirmation before writing the file — this is a standing instruction.
