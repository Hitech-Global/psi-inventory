# TikTok 店铺授权：需要你做什么

## 一句话现状

代码已经全部就绪，**唯一缺的是 TikTok Shop 应用的凭据**。
生产机的 `runtime/.env` 里一个 TikTok 变量都没有 —— 这套配置从来没被正式纳入过。

而且凭据**只能由你本人去 TikTok Shop Partner Center 取**（那是你的开发者账号）。

---

## 一、要配哪四个变量

| 变量 | 是什么 | 去哪取 |
|---|---|---|
| `TIKTOK_APP_KEY` | TikTok Shop 应用的 App Key | Partner Center → My Apps → 你的应用 → App Detail → Basic Information |
| `TIKTOK_APP_SECRET` | 应用密钥（与 App Key 成对） | 同上 |
| `TIKTOK_SERVICE_ID` | 服务标识 | 同上 → 你申请了哪些 API 服务，就有哪些 service_id |
| `TIKTOK_REDIRECT_URL` | 授权回调地址 | 自己定，但**必须与应用后台登记的完全一致** |

建议的回调地址（若应用后台还没登记，就登记这个）：

```
https://analytics.hitechanalysis.top/api/shopee-analytics/tiktok/oauth/callback
```

---

## 二、应用要申请哪些 API 权限

系统会用到的权限（少申请某个，授权能过但那个模块没数据）：

| 权限名 | 用来做什么 |
|---|---|
| Shop Authorized Information | 拿店铺台账（shop_id 与 cipher 的配对） |
| Order Information | 订单与订单明细 |
| Product Basic | 商品与库存 |
| Promotion Information | 促销 |
| Finance Information | 结算收入、佣金、物流（**结算净收益与净 ROAS 靠它**） |
| Return & Refund Basic | 退货退款 |
| TikTok Shop Analytics | 漏斗与流量 |
| Read Seller Affiliate Collaboration | 达人概览（达人联盟） |

`TIKTOK_SERVICE_ID` 填哪个，取决于你申请了哪些服务 —— 通常是这组权限对应的那一个 service_id。

---

## 三、怎么把值填进生产机

生产机路径（Windows）：

```
D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics\deploy\desktop\runtime\.env
```

在文件末尾追加（**用等号，值不要加引号**）：

```
TIKTOK_APP_KEY=你的AppKey
TIKTOK_APP_SECRET=你的AppSecret
TIKTOK_SERVICE_ID=你的ServiceId
TIKTOK_REDIRECT_URL=https://analytics.hitechanalysis.top/api/shopee-analytics/tiktok/oauth/callback
TIKTOK_REGION_GROUP=ROW
```

改完要**重启 app 容器**才会生效（容器读的是启动时的环境变量）：

```powershell
cd D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics\deploy\desktop
docker compose --env-file runtime/.env up -d --force-recreate app
```

> ⚠️ `.env` 整个目录被 gitignore。**密钥不进 Git、不进聊天记录。**

---

## 四、填完怎么确认好了

打开「平台接入」页 → TikTok 那一栏 → 点「授权」：

- **配置齐全** → 跳转到 TikTok 的授权页，同意后回到本站，店铺出现在列表里。
- **配置不齐** → 页面就地列出缺哪几项、去哪取，不再是一个看不懂的错误码。

也可以直接查（需登录）：

```
GET /api/shopee-analytics/tiktok/config
```

它会逐项回「配没配」，**但不会回密钥的值**。

---

## 五、广告线是另一套凭据（别混）

广告线（GMV Max / 整合报表）用的是 **TikTok API for Business** 的应用，与上面**完全独立**：

| 变量 | 去哪取 |
|---|---|
| `TIKTOK_MARKETING_APP_ID` | [TikTok API for Business 开发者门户](https://business-api.tiktok.com/portal) → My Apps |
| `TIKTOK_MARKETING_APP_SECRET` | 同上 |
| `TIKTOK_MARKETING_REDIRECT_URL` | `https://analytics.hitechanalysis.top/api/shopee-analytics/tiktok/marketing/oauth/callback` |

两套的差别（这是整个广告线设计的前提）：

|  | 店铺授权 | 广告授权 |
|---|---|---|
| 凭据 | `TIKTOK_APP_KEY` / `_SECRET` | `TIKTOK_MARKETING_APP_ID` / `_SECRET` |
| 域名 | `open-api.tiktokglobalshop.com` | `business-api.tiktok.com` |
| 鉴权头 | `x-tts-access-token` | `Access-Token` |
| 请求签名 | **要** | **不要** |
| token 有效期 | 7 天 | **24 小时** |

广告线还要在开发者门户申请 **Marketing API** 产品并等审核通过（基础权限通常几个工作日）。

---

## 六、常见问题

**授权页跳回来报「参数无效」**
→ `TIKTOK_REDIRECT_URL` 与应用后台登记的不一致（多个字符不同也不行）。

**授权成功了但页面没有店铺**
→ `TIKTOK_SERVICE_ID` 填的服务不包含「Shop Authorized Information」，或该服务未审核通过。

**报权限不足 / 40101**
→ `TIKTOK_APP_KEY` 与 `TIKTOK_APP_SECRET` 不是同一个应用的（复制串了），或 secret 填错。

**改了 .env 没生效**
→ 没重启 app 容器。环境变量是启动时读的。

**广告接口返回 503 / 提示未配置**
→ 广告线是另一套凭据，还没配 `TIKTOK_MARKETING_APP_ID` 等（见第五节）。
