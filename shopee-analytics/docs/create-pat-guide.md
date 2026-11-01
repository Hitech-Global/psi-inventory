# 创建 PAT —— 两种方案的操作指引

> 目标：拿到一枚能推送到 `Hitech-Global/psi-inventory` 的令牌。
> 全程令牌不经过聊天记录：生成后点「Copy token」，由脚本从剪贴板读取并立即清空。

---

## 背景：为什么先试 classic

`Hitech-Global` 是**个人账号**（实测 `orgs/Hitech-Global` → 404，`users/Hitech-Global` → 200），
而 `martin0000118-dev` **不属于任何组织**。

Fine-grained PAT 的 Resource owner 下拉框只列出「你自己」+「你所属的组织」，
所以 `Hitech-Global` **不会出现在那个下拉框里**，且令牌也无法操作非自己 owner 名下的仓库。

Classic PAT 的语义不同：它授权的是**该账号可访问的所有仓库**，不按 resource owner 划分，
因此匹配当前身份（martin 是该仓库的 collaborator，实测 `push: true`）。

---

## 方案 A：Classic PAT（推荐先试）

### 第 1 步：打开页面

```
https://github.com/settings/tokens/new
```

### 第 2 步：填写

| 字段 | 填什么 |
|---|---|
| **Note** | `workbuddy-push` |
| **Expiration** | **30 days**（classic 最长可到 1 年，但别留太久） |

### 第 3 步：勾选 scope（关键）

在 **Select permissions** 里勾选：

| Scope | 说明 |
|---|---|
| ☑️ **repo** | **读写所有仓库** —— 覆盖私有仓库的读写，这是能推送的前提 |
| ☑️ **workflow** | 增改 `.github/workflows/` 下的文件 —— 本次要推的提交里有改 CI workflow 的 |

> ⚠️ **`repo` 和 `workflow` 两个都必须勾。**
> 漏 `repo` → 推不动分支；漏 `workflow` → GitHub 直接拒推：
> `refusing to allow a Personal Access Token to create or update workflow ... without 'workflow' scope`
>
> 其余 scope（`read:org`、`gist` 等）按需，当前任务不需要。

### 第 4 步：生成并复制

1. 页面底部点 **Generate token**
2. **令牌只显示这一次**
3. 点 **Copy token**

### 第 5 步：存进 Keychain

```bash
cd /Users/wwt46/WorkBuddy/2026-10-30-14-22-28
bash scripts/save-github-pat-from-clipboard.sh
```

脚本会读剪贴板 → **立刻清空剪贴板** → 校验格式 → 校验 GitHub 接受 →
**打印实际授予的 scope** → 校验对仓库有写权限 → dry-run 推送。
任一关失败自动清理 Keychain 并说明原因。

### 第 6 步：推送

```bash
bash scripts/push-with-pat.sh
```

---

## 方案 B：Fine-grained PAT（若 A 不行）

```
https://github.com/settings/personal-access-tokens/new
```

| 字段 | 填什么 |
|---|---|
| Token name | `workbuddy-push` |
| Expiration | 30 days |
| **Resource owner** | 保持默认（只有你自己可选） |
| **Repository access** | **All repositories**（❌ 不是 Public repositories —— 那只有读权限） |
| **Repository permissions** | Contents / **Workflows** / Pull requests 全部 **Read and write** |

> ⚠️ **方案 B 有个结构性限制**：令牌只能改自己 owner 名下的仓库。
> `psi-inventory` 属于 `Hitech-Global`，所以 B 大概率仍然推不动。
> 若脚本报"只有读权限"，请直接回到方案 A，或走方案 C。

---

## 方案 C：换账号 / 提升权限

若 A、B 都不行：

- **用 `Hitech-Global` 账号登录**再建令牌 —— Resource owner 自然就是仓库 owner，
  All repositories 才真正覆盖 `psi-inventory`。注意：仓库的 718 个历史提交都由该账号提交。
- 或请 owner 在 `Settings → Collaborators` 给 `martin0000118-dev` 加 **Write** 权限
  （若目前只是 Read）。这对 collaborator 身份下的 classic PAT 有帮助。

---

## 只想确认缺哪一项

```bash
bash scripts/diagnose-github-pat.sh
```

| 输出 | 含义 |
|---|---|
| `令牌未被接受` | 令牌本身无效 |
| `令牌看不到该仓库` | 缺 `repo` scope，或 fine-grained 没选该仓库 |
| `只有读权限` | `repo` scope 没勾，或 fine-grained 权限还是只读 |
| `受组织 SAML 保护` | 需要点 Authorize（个人账号一般不涉及） |
| `具备写权限` | 令牌没问题，问题在 git 传输层 |

---

## 收尾

用完后到 `https://github.com/settings/tokens` 点令牌右侧 **Revoke** 删除。
之前那枚明文进过截图的 classic/fine-grained 令牌**一并 revoke**。
