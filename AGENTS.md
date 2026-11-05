# AI dotfiles

- This is the `ai` submodule of the linux-rise dotfiles: the contents of `dot-config/` are symlinked into `~/.config/`, and those of `dot-local/` into `~/.local/`.
- Shared prompts and skills live in `dot-config/agents/`. Both OpenCode (`commands`, `skills`) and Pi (`prompts`, `skills`) link to those directories; edit the shared source, never a consumer symlink.
- `dot-config/opencode/opencode.json` and `dot-config/pi-agent/settings.json` both target the local llama.cpp server at `127.0.0.1:12741`. `dot-local/bin/llama-fzf` launches it on that port.
- Theme files under `dot-config/{opencode,pi-agent}/themes/` are symlinks into the sibling `colorschemes` submodule's generated `build/active/` output. 
- Do not add Pi runtime state (`auth.json`, model store, sessions, local npm installation) or OpenCode local state/credentials (`service.json`, dependency installs, lockfiles): they are intentionally ignored by `dot-config/.gitignore`.
- `.examples/` is an ignored local reference catalog. For work based on its plugins, tools, or other examples, analyze the relevant examples first, then build this repository's own implementation and DO NOT modify or commit the examples.

## Verification

- After JSON changes, run `jq empty` on each edited JSON file.
- Check shared-directory and theme symlinks with `find dot-config -type l -exec test -e {} \; -print` before finishing.
