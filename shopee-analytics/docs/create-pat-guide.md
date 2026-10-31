# 创建 Fine-grained PAT —— 逐步操作指引

> 目标：拿到一枚能推送到 `Hitech-Global/psi-inventory` 的令牌。
> 全程令牌不经过聊天记录：生成后点「Copy token」，由脚本从剪贴板读取并立即清空。

---

## 第 1 步：打开创建页

浏览器访问：

```
https://github.com/settings/personal-access-tokens/new
```

> 若这是你第一次为该仓库建令牌，也可以从
> `https://github.com/settings/personal-access-tokens` → 左侧 **Fine-grained tokens** → **Generate new token**
> 进入。

---

## 第 2 步：填 Token name 与 Expiration

| 字段 | 填什么 |
|---|---|
| **Token name** | `workbuddy-push`（随意，能认出来即可） |
| **Expiration** | 建议 **30 days**（下拉可选） |

---

## 第 3 步：改 Resource owner（**最关键**）

页面顶部 **Resource owner** 默认是 `martin0000118-dev` —— **必须改成 `Hitech-Global`**。

理由：GitHub 官方规则 —— *「令牌只能修改所选 resource owner 名下的资源」*。
`Hitech-Global` 是仓库真正的 owner（PR #5 的作者是 `Hitech-Global <hitechjames@163.com>`），
而 `martin0000118-dev` 只是 collaborator。选错主体，仓库访问权限就落在错误的一侧。

> ⚠️ 下拉里如果**没有** `Hitech-Global`，说明当前登录的账号不是 `Hitech-Global`。
> 那就先退出，换成 `Hitech-Global` 账号登录（PR #5 就是用这个账号提交的）。

---

## 第 4 步：Repository access 选 All repositories

在下拉里选 **All repositories**。

> ❌ 不要选 **Public repositories** —— 那一行下面写着 *read-only access*，
> 只读令牌能通过 API 校验却无法 push，这正是上次失败的直接原因。
>
> ⚠️ 如果列表里出现 **Only select repositories**，选它更好（只授权这一个仓库），
> 然后只勾 `psi-inventory`。看不到这个选项也没关系，All repositories 同样可用。

---

## 第 5 步：填 Repository permissions

向下滚动到 **Repository permissions** 区域（注意不是上面的 Account permissions），
点 **Add permissions**，逐项添加：

| 权限 | 下拉选择 |
|---|---|
| **Contents** | **Read and write** |
| **Workflows** | **Read and write** |
| **Pull requests** | **Read and write** |

> ⚠️ **Workflows 一定要加。** 本次要推的提交里有一个改了
> `.github/workflows/shopee-analytics-ci.yml`，缺这项权限时 GitHub 会直接拒推：
> `refusing to allow a Personal Access Token to create or update workflow ... without 'workflow' scope`
>
> 如果某个权限在 Repository permissions 里找不到，就退到 **Account permissions** 里加同名项。

---

## 第 6 步：生成并复制

1. 页面底部点 **Generate token**
2. **令牌只显示这一次**（刷新页面就再也看不到）
3. 点 **Copy token**（或手动全选复制）

---

## 第 7 步：存进 Keychain

**不要粘贴到聊天里。** 回到终端执行：

```bash
cd /Users/wwt46/WorkBuddy/2026-10-30-14-22-28
bash scripts/save-github-pat-from-clipboard.sh
```

脚本会：

1. 从剪贴板读取令牌 → **立刻清空剪贴板**
2. 校验格式（`ghp_`/`github_pat_` 等前缀）
3. 校验 GitHub 是否接受（`GET /user`）
4. 校验对 `psi-inventory` 是否有写权限（`GET /repos` 的 `permissions.push`）
5. 校验 git 推送链路（dry-run push）

**任一关不过会自动从 Keychain 清理并说明原因**，不会留下半成品凭证。
全过则提示下一步。

---

## 第 8 步：推送

```bash
bash scripts/push-with-pat.sh
```

---

## 附：只想确认缺哪一项时

```bash
bash scripts/diagnose-github-pat.sh
```

它会直接告诉你：

| 输出 | 含义 |
|---|---|
| `令牌未被接受` | 令牌本身无效 |
| `令牌看不到该仓库` | Repository access 没勾选它 |
| `只有读权限` | Contents / Workflows 还是只读 |
| `受组织 SAML 保护` | 需要点 Authorize |
| `具备写权限` | 令牌没问题，问题在 git 传输层 |

---

## 收尾

令牌用完后，建议到
`https://github.com/settings/personal-access-tokens` 点令牌右侧的 **Revoke** 删掉。
如果之前那枚明文进过截图的还没删，**一并 revoke**。

需要临时停用而不删除的话，也可以用令牌页面的 **Disable** 按钮。
