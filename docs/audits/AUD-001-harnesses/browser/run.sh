#!/bin/bash
# AUD-001's browser smoke: index.html beside a profile's page files, in one real browser through
# WebDriver. Exits 0 when the page ends with DONE and no line says FAIL.
#
# Usage: run.sh <pages-folder> <serve-program> <webdriver-program> <browser-program> <chrome|firefox> <work-folder>
set -euo pipefail

pages="$1" serve="$2" driver="$3" browser="$4" kind="$5" work="$6"
here="${0%/*}"
mkdir -p "$work/$kind"
cp -r "$pages"/. "$work/$kind/"
cp "$here/index.html" "$work/$kind/"

"$serve" "$work/$kind" 18451 &
server="$!"
if [ "$kind" = chrome ]; then
  "$driver" --port=18452 > "$work/$kind-driver.log" 2>&1 &
  options="\"goog:chromeOptions\":{\"binary\":\"$browser\",\"args\":[\"--headless=new\",\"--no-sandbox\"]}"
else
  "$driver" --port 18452 > "$work/$kind-driver.log" 2>&1 &
  options="\"moz:firefoxOptions\":{\"binary\":\"$browser\",\"args\":[\"-headless\"]}"
fi
webdriver="$!"
trap 'kill "$server" "$webdriver" 2> /dev/null || true' EXIT

base=http://127.0.0.1:18452
for ((try = 0; try < 40; try++)); do
  curl --silent --fail "$base/status" > /dev/null && break
  sleep 0.5
done
json='Content-Type: application/json'
read -r session < <(curl --silent --fail -H "$json" -d "{\"capabilities\":{\"alwaysMatch\":{$options}}}" "$base/session" |
  sed -E 's/.*"sessionId":"([^"]+)".*/\1/') || true
curl --silent --fail -H "$json" -d '{"url":"http://127.0.0.1:18451/"}' "$base/session/$session/url" > /dev/null

script='{"script":"return document.getElementById(\"result\").textContent","args":[]}'
text=
for ((try = 0; try < 600; try++)); do
  read -r text < <(curl --silent --max-time 120 -H "$json" -d "$script" "$base/session/$session/execute/sync") || true
  case "$text" in *DONE*) break ;; esac
  sleep 1
done
curl --silent --request DELETE "$base/session/$session" > /dev/null || true
printf '%s\n' "$text" | sed 's/\\n/\n/g'
case "$text" in
  *DONE*FAIL* | *FAIL*DONE*) exit 1 ;;
  *DONE*) exit 0 ;;
  *) exit 1 ;;
esac
