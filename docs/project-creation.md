# 项目创建

当前试用版已经支持从标准硬件开发流程模板创建新项目。

现有创建流程继续使用
`standard_hardware_development_v0_1` 七阶段模板。本批增量新增公司
S0-S10 生命周期标准及只读预览，但不会改变现有项目创建行为。

## API

```text
POST /projects
```

请求示例：

```json
{
  "name": "智能门锁 V2",
  "productLine": "IoT",
  "userId": "user-project-manager"
}
```

创建后系统会自动生成：

- 项目记录；
- 7 个阶段；
- 7 个阶段门；
- 角色与 Agent 配对；
- 阶段必需工作包；
- 阶段门必需条件；
- 每个工作包关联的交付物模板。

## 公司生命周期标准预览

标准查询 API：

```text
GET /standards/lifecycle-templates
GET /standards/document-definitions
GET /standards/project-types
GET /standards/capability-packs
GET /standards/product-packs
```

`GET /standards/document-definitions` 支持可选查询参数：

```text
phaseKey
sourceCategory
sourceKey
```

项目模板预览 API：

```text
POST /projects/preview
```

请求示例：

```json
{
  "templateKey": "company_product_lifecycle_v1_0",
  "capabilityKeys": [
    "electronic_hardware",
    "embedded_firmware"
  ],
  "productPackKeys": []
}
```

预览结果包括：

- S0-S10 阶段和阶段门；
- 当前项目类型、能力包和产品包带入的文档；
- 必需、条件适用和普通受控文档数量；
- 尚未完成适用性判断的条件文档数量。

`POST /projects/preview` 仅进行内存计算，不创建项目、不修改当前项目，也不写入
JSON store 或 PostgreSQL。它在只读运行模式下仍可使用。

当前前端“项目”页面已增加“公司产品全生命周期标准预览”面板。选择能力包或
产品专用包后可查看阶段和文档数量；原“创建”按钮仍使用现有
`POST /projects` 接口。

## 项目切换

```text
POST /projects/:id/select
```

当前前端“项目管理”页面已经支持：

- 创建新项目；
- 查看项目列表；
- 切换当前项目；
- 导出项目快照 Markdown；
- 复制项目并自动切换到副本；
- 归档项目并保留全部数据；
- 恢复已归档项目。

项目生命周期 API：

```text
POST /projects/:id/clone
POST /projects/:id/archive
POST /projects/:id/restore
GET /projects/:id/snapshot.md
```

## 当前限制

- 还没有真实登录，创建人通过 `userId` 传入；
- 新项目默认从“立项”阶段开始；
- 阶段角色负责人暂时使用演示用户；
- 还没有项目删除功能，归档用于保留数据的下线场景。
- S0-S10 模板当前只用于标准预览，尚未持久化创建项目；
- 项目级文档适用性判定和人工分级调整将在后续批次实现；
- 文档主记录、精确版本签核、阶段基线和增强门禁将在后续批次实现。
