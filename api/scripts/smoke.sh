#!/usr/bin/env bash
# End-to-end smoke test against the local wrangler dev server.
# Exits non-zero on the first failing step.
set -uo pipefail

BASE="http://127.0.0.1:8787"
PASS=0
FAIL=0

ok()   { echo "  ok  - $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL- $1"; FAIL=$((FAIL+1)); }
assert_eq() { local name="$1" a="$2" b="$3"; if [ "$a" = "$b" ]; then ok "$name ($a)"; else fail "$name (got '$a' want '$b')"; fi; }
assert_contains() { local name="$1" hay="$2" needle="$3"; if echo "$hay" | grep -q "$needle"; then ok "$name"; else fail "$name (no '$needle' in '$hay')"; fi; }

echo "== /healthz =="
H=$(curl -fsS "$BASE/healthz")
assert_contains "health ok" "$H" '"status":"ok"'

echo
echo "== signup (user A) =="
EMAIL_A="alice-$(date +%s)@example.com"
EMAIL_B="bob-$(date +%s)@example.com"
R=$(curl -fsS -X POST "$BASE/auth/signup" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL_A\",\"password\":\"password-123\"}")
TOKEN_A=$(echo "$R" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
assert_contains "signup returns token" "$R" '"token":"'
[ -n "$TOKEN_A" ] && ok "token non-empty" || fail "token empty"

echo
echo "== duplicate signup rejected =="
DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/auth/signup" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL_A\",\"password\":\"password-123\"}")
assert_eq "dup → 409" "$DUP" "409"

echo
echo "== signup weak password rejected =="
WP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/auth/signup" -H 'Content-Type: application/json' \
    -d "{\"email\":\"weak-$EMAIL_A\",\"password\":\"short\"}")
assert_eq "weak pw → 400" "$WP" "400"

echo
echo "== missing auth on /auth/me =="
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/auth/me")
assert_eq "no token → 401" "$NOAUTH" "401"

echo
echo "== /auth/me with token =="
ME=$(curl -fsS "$BASE/auth/me" -H "Authorization: Bearer $TOKEN_A")
assert_contains "me returns email" "$ME" "\"email\":\"$EMAIL_A\""

echo
echo "== login (user A) =="
LI=$(curl -fsS -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL_A\",\"password\":\"password-123\"}")
LI_TOKEN=$(echo "$LI" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$LI_TOKEN" ] && ok "login returns token" || fail "login no token"

echo
echo "== login wrong password =="
WP2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL_A\",\"password\":\"WRONG-password\"}")
assert_eq "wrong pw → 401" "$WP2" "401"

echo
echo "== signup (user B) for isolation test =="
RB=$(curl -fsS -X POST "$BASE/auth/signup" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL_B\",\"password\":\"password-456\"}")
TOKEN_B=$(echo "$RB" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN_B" ] && ok "user B token" || fail "user B no token"

echo
echo "== create todo (A) =="
DUE_FUTURE=$(date -u -d "+2 days" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+2d +%Y-%m-%dT%H:%M:%S.000Z)
C=$(curl -fsS -X POST "$BASE/todos" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_A" \
    -d "{\"title\":\"Ship MVP\",\"notes\":\"cloudflare deploy\",\"dueAt\":\"$DUE_FUTURE\",\"priority\":2}")
TODO_A_ID=$(echo "$C" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
assert_contains "create returns id" "$C" '"id":"'
assert_contains "title echoed" "$C" '"title":"Ship MVP"'
assert_contains "status pending" "$C" '"status":"pending"'

echo
echo "== create with empty title rejected =="
ET=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/todos" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_A" \
    -d '{"title":"   "}')
assert_eq "empty title → 400" "$ET" "400"

echo
echo "== create with bad priority rejected =="
BP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/todos" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_A" \
    -d '{"title":"x","priority":7}')
assert_eq "bad priority → 400" "$BP" "400"

echo
echo "== list todos (A) shows it =="
L=$(curl -fsS "$BASE/todos" -H "Authorization: Bearer $TOKEN_A")
assert_contains "list contains title" "$L" '"title":"Ship MVP"'

echo
echo "== isolation: user B cannot see A's todo =="
LB=$(curl -fsS "$BASE/todos" -H "Authorization: Bearer $TOKEN_B")
if echo "$LB" | grep -q "Ship MVP"; then fail "B sees A's todo!"; else ok "B does not see A's todos"; fi

echo
echo "== isolation: user B cannot GET A's todo id → 404 =="
GETB=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/todos/$TODO_A_ID" -H "Authorization: Bearer $TOKEN_B")
assert_eq "B GET A's todo → 404" "$GETB" "404"

echo
echo "== isolation: user B cannot PATCH A's todo → 404 =="
PBB=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/todos/$TODO_A_ID" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_B" \
    -d '{"title":"hacked"}')
assert_eq "B PATCH A's todo → 404" "$PBB" "404"

echo
echo "== isolation: user B cannot DELETE A's todo → 404 =="
DBB=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/todos/$TODO_A_ID" -H "Authorization: Bearer $TOKEN_B")
assert_eq "B DELETE A's todo → 404" "$DBB" "404"

echo
echo "== bucket query: today / upcoming =="
# create one overdue and one unscheduled
DUE_PAST=$(date -u -d "-1 day" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v-1d +%Y-%m-%dT%H:%M:%S.000Z)
curl -fsS -X POST "$BASE/todos" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_A" \
  -d "{\"title\":\"Past due\",\"dueAt\":\"$DUE_PAST\"}" >/dev/null
curl -fsS -X POST "$BASE/todos" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_A" \
  -d '{"title":"No date task"}' >/dev/null
UP=$(curl -fsS "$BASE/todos?bucket=upcoming" -H "Authorization: Bearer $TOKEN_A")
assert_contains "upcoming contains Ship MVP" "$UP" '"title":"Ship MVP"'
if echo "$UP" | grep -q "Past due"; then fail "upcoming wrongly includes Past due"; else ok "upcoming excludes Past due"; fi
if echo "$UP" | grep -q "No date task"; then fail "upcoming includes No date"; else ok "upcoming excludes No date"; fi
OV=$(curl -fsS "$BASE/todos?bucket=overdue" -H "Authorization: Bearer $TOKEN_A")
assert_contains "overdue contains Past due" "$OV" '"title":"Past due"'
UN=$(curl -fsS "$BASE/todos?bucket=unscheduled" -H "Authorization: Bearer $TOKEN_A")
assert_contains "unscheduled contains No date task" "$UN" '"title":"No date task"'

echo
echo "== patch todo (A) =="
P=$(curl -fsS -X PATCH "$BASE/todos/$TODO_A_ID" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_A" \
    -d '{"title":"Ship MVP (revised)","priority":0}')
assert_contains "patch updated title" "$P" '"title":"Ship MVP (revised)"'
assert_contains "patch updated priority" "$P" '"priority":0'

echo
echo "== complete todo (A) =="
CP=$(curl -fsS -X POST "$BASE/todos/$TODO_A_ID/complete" -H "Authorization: Bearer $TOKEN_A")
assert_contains "completed status" "$CP" '"status":"completed"'
assert_contains "completedAt set" "$CP" '"completedAt":"'

echo
echo "== reopen todo (A) =="
RO=$(curl -fsS -X POST "$BASE/todos/$TODO_A_ID/reopen" -H "Authorization: Bearer $TOKEN_A")
assert_contains "reopened status" "$RO" '"status":"pending"'
assert_contains "completedAt cleared" "$RO" '"completedAt":null'

echo
echo "== delete todo (A) =="
DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/todos/$TODO_A_ID" -H "Authorization: Bearer $TOKEN_A")
assert_eq "delete → 204" "$DEL" "204"
# Verify it's gone from list
LA=$(curl -fsS "$BASE/todos" -H "Authorization: Bearer $TOKEN_A")
if echo "$LA" | grep -q "$TODO_A_ID"; then fail "deleted todo still in list"; else ok "deleted todo removed from list"; fi
# Re-delete should be 404 (using B's token to test the not-found path)
DEL2=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/todos/$TODO_A_ID" -H "Authorization: Bearer $TOKEN_B")
assert_eq "re-delete (B) → 404" "$DEL2" "404"

echo
echo "== logout (just smoke check) =="
LO=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/auth/logout" -H "Authorization: Bearer $TOKEN_A")
assert_eq "logout → 204" "$LO" "204"

echo
echo "=================================================="
echo "  PASS=$PASS  FAIL=$FAIL"
echo "=================================================="
[ "$FAIL" -eq 0 ]
