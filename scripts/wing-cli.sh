#!/bin/bash
# Command-line control for Wing. Link it onto your PATH:
#   ln -s /Applications/Wing.app/Contents/Resources/bin/wing ~/.local/bin/wing
set -euo pipefail
APP="$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)"

usage() {
  cat <<'HELP'
Usage:
  wing [--space NAME] URL...   Open links, optionally in a named Space
  wing :3000                   Open http://localhost:3000
  wing --debug [PORT]          Start Wing with remote debugging (default 9222)
  wing --help

Remote debugging exposes every profile to local processes. Wing must be fully
quit first, because the setting only applies at launch.
HELP
}
encode() {
  local out="" c i LC_ALL=C
  for ((i = 0; i < ${#1}; i++)); do
    c="${1:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) printf -v c '%%%02X' "'$c"; out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}

space=""
urls=()
while (($#)); do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --debug)
      port="${2:-9222}"
      [[ "$port" =~ ^[0-9]+$ ]] || { echo "wing: invalid port: $port" >&2; exit 2; }
      if pgrep -f "$APP/Contents/MacOS/" >/dev/null; then
        echo "wing: quit Wing first; remote debugging only applies at launch" >&2
        exit 1
      fi
      open "$APP" --args "--remote-debugging-port=$port"
      echo "Remote debugging on http://127.0.0.1:$port"
      exit 0
      ;;
    --space)
      [[ $# -ge 2 ]] || { echo "wing: --space needs a name" >&2; exit 2; }
      space="$2"
      shift
      ;;
    :[0-9]*) urls+=("http://localhost$1") ;;
    http://* | https://*) urls+=("$1") ;;
    localhost* | 127.0.0.1*) urls+=("http://$1") ;;
    -*) echo "wing: unknown option: $1" >&2; exit 2 ;;
    *) urls+=("https://$1") ;;
  esac
  shift
done
if ((${#urls[@]} == 0)); then
  open "$APP"
  exit 0
fi
for url in "${urls[@]}"; do
  open -a "$APP" "wingbrowser://open?url=$(encode "$url")&space=$(encode "$space")"
done
