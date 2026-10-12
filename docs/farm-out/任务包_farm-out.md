# Task Package：Farm out（转单）

定稿日期：2026-10-10。Annie 说"动手"后生效。

## Objective
Dispatch 里 staff 可以把第二台巴士设为 Farm out，把整张订单转给合作公司；系统给客人发新的接客通知，并给财务出带金额的转单报表。上线后 staff 不再去 Rezdy 挂 On Hold。

## Business Decisions Locked（Annie 已定，不要重新验证）

### 入口和选客人
1. 是否转单完全由 staff 决定，系统不判断、不提示人数。
2. 现有第二台巴士默认带 Farm out 键；所有能加第二台车的团都有。
3. 客人用现有 Seat guests 分到 Farm out 车；只能整单转。
4. Farm out 车不需要司机和车号，豁免"没司机不让保存"。
5. 撤销：把客人挪回我们的车，或删掉 Farm out 车。

### 每单填什么
6. staff 给每张订单只选一个酒店（接客点）。
7. 发车时间按"团 + 酒店"从下面的时刻表查出；集合时间 = 发车时间 − 10 分钟。两个时间都自动算。
8. staff 可以逐单改时间（对方当天时间与表不同的情况）。
9. 时刻表里没有的团（例如南峡谷）暂时不能转单，页面写明原因"本团还没有设置转单时刻"。以后有了再加。
10. OTA 确认号从订单自动带出；没有 OTA 号的用我们的订单号。
11. 酒店没选时不能发通知，提示写明缺的是哪一项。

### 通知
12. 通知用下面的模板，原文录入 Content Studio，之后由 admin 在 Content Studio 里改。
13. 走短信和邮件两个渠道；每次发送记进 Send Log，失败时写明是短信还是邮件失败及原因。
14. 预计返回时间按团各存一份，自动带出；该团没有就留空。
14a. PLEASE NOTE 注意事项也按团各存一份，自动带出；该团没有就整段不显示（连 "PLEASE NOTE:" 这几个字也不显示）。西峡谷团的初始文字见模板下方。
15. 转单客人不收我们的早班接客短信，只收 Farm out 通知。
16. 通知发出后再撤销，系统不自动补发，只在页面提醒 staff"这位客人已收到转单通知"。
17. 通知里不提合作公司名。

### 其他页面
18. 转单客人出现在 relay 司机手机页，单独一栏标 Farm out；不出现在其他司机页。
19. Forecast、Manifest、Order List 都不改。
20. 没有过渡期：系统不拿 Rezdy 的 ON_HOLD 当转单判断。

### 结算和报表
21. 合作公司是 Settings 里的名单；每家公司按团设结算价，分成人价和儿童价。婴儿不计。
22. 应付对方 = 成人数 × 成人价 + 儿童数 × 儿童价，自动算；staff 可逐单改，记下改的人和时间。
23. 转单记录存我们自己的表；Rezdy 镜像表只读不改。
24. 财务报表是页面加 CSV 导出，按日期范围和合作公司筛选。列：日期、团、订单号、OTA 确认号、客人、成人数、儿童数、转给谁、经手人、客人实付、应付对方、差额（客人实付 − 应付对方）。

## 通知模板（原文，不要改字）

```
Thank you for choosing to join us on our {团名} on {出团日期}!

Please arrive at the {接客地点} by {集合时间} for boarding. The bus will depart at {发车时间} to ensure the tour remains on schedule for all guests; the vehicle cannot wait for late arrivals.

PLEASE NOTE:  {本团注意事项}

Departure Time : {发车时间}
Estimated return time: {预计返回时间}
Location: {接客地点全称}
{接客地点地址}
Google Map Link to your Pick-Up Location : Ensure your mobile device has location permissions set to allow GPS tracking
{地图链接}

If you have any questions please call us at 702-420-3156, thank you!
```

样例取值（西峡谷，Bellagio）：集合 6:40 AM，发车 6:50 AM，返回 5:00- 6:30 PM，接客地点 "Bellagio South Tour Lobby"，全称 "Bellagio Hotel & Casino , Underground South Tour Lobby"，地址 "3600 S Las Vegas Blvd, Las Vegas, NV 89109"，链接 https://goo.gl/maps/SpW2EnpwM55Hvr637

西峡谷团（West Rim）的注意事项初始文字，原文录入：

```
Due to recent safety concerns, backpacks and large bags are not permitted inside the Grand Canyon (You may leave it on the bus while at the Grand Canyon) Hoover Dam security prohibits us from transporting or storing luggage on the bus.
```

其他团暂无注意事项，留空，由 admin 以后补。

## 转单发车时刻表（发车时间；集合时间再减 10 分钟）

| 酒店 | 地点说明 | West Rim | Lower Antelope | Valley of Fire | Zion | West Rim (Small Group) | Hoover Dam (Small Group) |
|---|---|---|---|---|---|---|---|
| Plaza Hotel | Ride Share Area | 6:20 | 4:50 | 8:40 | 5:50 | 6:10 | 7:10 |
| Strat | Sidedoor facing Las Vegas Blvd | 6:30 | 5:00 | 8:30 | 6:00 | 6:20 | 7:20 |
| Sahara | Las Vegas Blvd Door | 6:40 | 5:10 | 8:30 | 6:10 | 6:30 | 7:30 |
| Excalibur | Rear Rotunda | 6:30 | 5:00 | 7:50 | 6:00 | 7:00 | 8:00 |
| MGM Grand | North Side of the parking garage- Rideshare Exit on Street Level. | 6:30 | 5:00 | 7:50 | 6:00 | 7:00 | 8:00 |
| Venetian | Ground Transportation Area | 6:50 | 5:20 | 8:10 | 6:20 | 6:40 | 7:40 |
| Horseshoe | North Door (Flamingo Rd) | 6:40 | 5:10 | 8:00 | 6:10 | 6:50 | 7:50 |
| Park MGM | Taxi/Ride Share Area | 6:40 | 5:10 | 8:00 | 6:10 | 6:50 | 7:50 |
| Circus Circus | Main Entrance | 6:50 | 5:20 | 8:30 | 6:20 | 6:30 | 7:30 |
| Bellagio | Underground South Tour Lobby（以模板为准，不用原表的 "Underground Bus Pickup Area"） | 6:50 | 5:20 | 8:10 | 6:20 | 6:50 | 7:50 |
| Treasure Island | Bus Pick up Area, Next to Main Entrance | 7:00 | 5:30 | 8:20 | 6:30 | 6:40 | 7:40 |

时刻表做成 Settings 里可维护的数据，不写死在代码里。

## Scope（按顺序，每阶段完成后停下汇报）
- **阶段 1 后端**：合作公司和结算价、转单时刻表、转单记录、金额计算、通知发送、早班短信排除、报表数据。
- **阶段 2 旧 Dispatch 页（Jinja2）**：Farm out 键、每单选酒店和改时间、发通知、撤销；relay 司机手机页的 Farm out 栏；Settings 的合作公司名单和时刻表；Content Studio 模板；报表页。
- **阶段 3 ops 新前端**：同样功能。

## Out of Scope
- Forecast、Manifest、Order List 的任何改动。
- Rezdy 同步层和 ON_HOLD 处理（已另行交给 Max）。
- 往 Rezdy 写任何东西。
- 拆单转（一张订单只转一部分人）。
- 跟合作公司的系统对接。

## 上游依赖
Dispatch 现有的第二台车和 Seat guests 逻辑、"没司机不让保存"校验、早班接客短信的收件人筛选、现有接客点数据（地址、地图链接）、Content Studio 模板机制、Send Log、relay 司机手机页、订单里的 OTA 确认号和实付金额字段。

## 下游影响
早班短信收件人会减少；relay 司机页多一栏；Send Log 多一种发送类型；Settings 多两项（合作公司、转单时刻表）；Content Studio 多一个模板。

## 开工顺序
1. 先读上面每一项上游依赖的现有代码，不凭本文描述设计。
2. 提交表结构 SQL 和设计说明给 Annie 审，通过后再写代码。
3. DDL 由 Annie 在 TablePlus 整文件执行。

## Acceptance Criteria
- 第二台车点 Farm out 后，无司机无车号可以保存。
- 把一张订单分到 Farm out 车，整单过去；试图只转部分人时被拒并说明原因。
- 西峡谷订单选 Bellagio：通知里集合 6:40 AM、发车 6:50 AM，其余字段与样例取值一致。
- staff 改过时间的订单，通知用改后的时间。
- 没选酒店时不能发通知，提示写明缺哪一项；时刻表没有的团不能转单并说明原因。
- 该团没有预计返回时间时，通知里这一项留空，不报错。
- 西峡谷订单的通知带背包和 Hoover Dam 那段；没有注意事项的团（如 Zion），通知里没有 PLEASE NOTE 这一段。
- 通知发出后 Send Log 有记录；人为制造失败时，记录写明渠道和原因。
- 转单客人不在早班接客短信的收件人里；撤销后重新回到收件人里。
- 通知已发的订单被撤销时，页面出现提醒，系统没有自动再发。
- relay 司机手机页在 Farm out 栏看到这些客人；其他司机页看不到。
- 金额按结算价自动算对，婴儿不计；逐单改后报表显示改后的数，并有改动人。
- 报表各列齐全，可按日期范围和合作公司筛选，可导出 CSV。
- Forecast、Manifest、Order List 的显示和人数在转单前后完全一样。
- Rezdy 镜像表无任何写入。

## Required Checks
四关审查；全代码库检查所有涉及第二台车、早班短信、司机页的页面和路由，结果报给 Annie，不自行判定"顺手修"。

## Risk Level
B。涉及给客人发短信和新建表。DDL 执行属于 C，由 Annie 手动执行。

## Stop Conditions
- 需要新的业务决定。
- 必须动 Out of Scope 里的东西才能做下去。
- 现有代码与"上游依赖"的描述对不上。
- 现有接客点数据里缺某个酒店的地址或地图链接。
- 早班短信排除没法在不改 Manifest 的前提下做到。

## Delivery Rule
每阶段自动到 commit，push 前停下等 Annie。