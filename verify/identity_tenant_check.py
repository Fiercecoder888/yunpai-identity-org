"""多租户隔离 + 厂长注册 端到端实测（纯 stdlib，无第三方依赖）。"""
import json
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://127.0.0.1:19012"
results = []


def make_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def call(opener, method, path, body=None, tenant=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if tenant:
        req.add_header("X-Yunpai-Tenant-ID", tenant)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with opener.open(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            return exc.code, raw
        # FastAPI 把 HTTPException(detail) 包一层 detail
        if isinstance(parsed, dict) and isinstance(parsed.get("detail"), dict):
            return exc.code, parsed["detail"]
        return exc.code, parsed


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("[PASS] " if ok else "[FAIL] ") + name + ("  :: " + detail if detail else ""))


# ---------------------------------------------------------------- 租户 A = default
opA, _ = make_opener()

st, body = call(opA, "GET", "/api/auth/bootstrap-status")
check("A1 default 空库 needs_bootstrap=true", st == 200 and body.get("needs_bootstrap") is True and body.get("user_count") == 0, f"status={st} body={body}")

st, body = call(opA, "GET", "/api/auth/config")
check("A2 /auth/config 是账号密码+用户隔离模式",
      st == 200 and body.get("auth_mode") == "authenticated_isolated" and body.get("capabilities", {}).get("user_isolation") is True,
      f"status={st} auth_mode={body.get('auth_mode')}")

st, body = call(opA, "POST", "/api/auth/register-admin",
                {"company_name": "云湃测试一厂", "user_id": "bossA", "password": "passw0rdA!", "display_name": "张厂长"})
check("A3 厂长注册成功（租户 default）",
      st == 200 and body.get("user_id") == "bossA" and body.get("tenant_id") == "default" and len(body.get("permissions") or []) >= 10,
      f"status={st} roles={body.get('roles')} perms={len(body.get('permissions') or [])}")

st, body = call(opA, "GET", "/api/auth/me")
check("A4 注册后自动登录 /auth/me 通过",
      st == 200 and body.get("principal", {}).get("actor") == "bossA" and body.get("principal", {}).get("tenant_id") == "default",
      f"status={st} actor={body.get('principal', {}).get('actor')}")

st, body = call(opA, "POST", "/api/auth/register-admin",
                {"company_name": "重复注册", "user_id": "bossA2", "password": "passw0rdA!"})
check("A5 同租户二次注册被拦（409 ALREADY_BOOTSTRAPPED）",
      st == 409 and (body.get("code") if isinstance(body, dict) else "") == "ALREADY_BOOTSTRAPPED", f"status={st} body={body}")

st, body = call(opA, "POST", "/api/identity/org", {"org_id": "dept-asm", "name": "装配车间", "org_type": "dept", "parent_id": "company"})
check("A6 租户A 建部门成功", st == 200, f"status={st} body={body}")

st, orgA = call(opA, "GET", "/api/identity/org")
namesA = sorted(n.get("name") for n in orgA.get("org", []))
check("A7 租户A 组织树 = 公司+装配车间", namesA == ["云湃测试一厂", "装配车间"], f"names={namesA}")

st, usersA = call(opA, "GET", "/api/identity/users")
idsA = sorted(u.get("user_id") for u in usersA.get("users", []))
check("A8 租户A 账号列表 = [bossA]", idsA == ["bossA"], f"ids={idsA}")

# ---------------------------------------------------------------- 租户 B = tenant-b
opB, _ = make_opener()

st, body = call(opB, "GET", "/api/auth/bootstrap-status", tenant="tenant-b")
check("B1 tenant-b 独立空库 needs_bootstrap=true", st == 200 and body.get("needs_bootstrap") is True and body.get("tenant_id") == "tenant-b", f"status={st} body={body}")

st, body = call(opB, "POST", "/api/auth/register-admin",
                {"tenant_id": "tenant-b", "company_name": "云湃测试二厂", "user_id": "bossB", "password": "passw0rdB!"},
                tenant="tenant-b")
check("B2 tenant-b 独立注册厂长成功",
      st == 200 and body.get("tenant_id") == "tenant-b" and body.get("user_id") == "bossB", f"status={st} body_tenant={body.get('tenant_id') if isinstance(body, dict) else body}")

st, body = call(opB, "GET", "/api/auth/me", tenant="tenant-b")
check("B3 tenant-b 会话落 tenant-b", st == 200 and body.get("principal", {}).get("tenant_id") == "tenant-b", f"status={st} principal={body.get('principal') if isinstance(body, dict) else body}")

st, orgB = call(opB, "GET", "/api/identity/org", tenant="tenant-b")
namesB = sorted(n.get("name") for n in orgB.get("org", []))
check("B4 租户B 组织树只看到自己的公司（看不到装配车间）", namesB == ["云湃测试二厂"], f"names={namesB}")

st, usersB = call(opB, "GET", "/api/identity/users", tenant="tenant-b")
idsB = sorted(u.get("user_id") for u in usersB.get("users", []))
check("B5 租户B 账号列表只看到 bossB（看不到 bossA）", idsB == ["bossB"], f"ids={idsB}")

# ---------------------------------------------------------------- 交叉越权
st, body = call(opA, "GET", "/api/identity/users", tenant="tenant-b")
names_cross = sorted(u.get("user_id") for u in body.get("users", [])) if isinstance(body, dict) else []
check("X1 租户A 会话 + tenant-b 头 → 会话租户优先，绝不返回 tenant-b 数据",
      st == 200 and body.get("tenant_id") == "default" and names_cross == ["bossA"],
      f"status={st} tenant={body.get('tenant_id') if isinstance(body, dict) else body} users={names_cross}")

st, body = call(opB, "GET", "/api/identity/org", tenant="default")
names_cross2 = sorted(n.get("name") for n in body.get("org", [])) if isinstance(body, dict) else []
check("X2 租户B 会话 + default 头 → 只返回 tenant-b 自己的组织",
      st == 200 and body.get("tenant_id") == "tenant-b" and names_cross2 == ["云湃测试二厂"],
      f"status={st} tenant={body.get('tenant_id') if isinstance(body, dict) else body} org={names_cross2}")

opX, _ = make_opener()
st, body = call(opX, "POST", "/api/auth/login", {"user_id": "bossA", "password": "passw0rdA!"}, tenant="tenant-b")
code = body.get("code") if isinstance(body, dict) else body
check("X3 租户A 账号在 tenant-b 登录被拒（401）", st == 401 and code == "INVALID_CREDENTIALS", f"status={st} code={code}")

st, body = call(opX, "POST", "/api/auth/login", {"user_id": "bossA", "password": "passw0rdA!"}, tenant="default")
check("X4 租户A 账号在 default 登录成功", st == 200 and body.get("tenant_id") == "default", f"status={st}")

# ---------------------------------------------------------------- 无会话访问
opN, _ = make_opener()
st, body = call(opN, "GET", "/api/auth/me")
check("N1 无会话 /auth/me → 401", st == 401, f"status={st}")
st, body = call(opN, "GET", "/api/identity/users")
check("N2 无会话 /identity/users → 401", st == 401, f"status={st}")

# ---------------------------------------------------------------- 汇总
passed = sum(1 for _, ok, _ in results if ok)
print("")
print(f"==== {passed}/{len(results)} passed ====")
