# 颜色老化数据管理系统

一个基于 FastAPI + SQLite 的颜色老化测试数据管理应用，支持样品管理、测量记录、照片上传、导入导出和趋势图展示。

## 功能概览

- 样品管理：新增、编辑、删除、搜索
- 测量管理：单条新增、批量新增、编辑、删除
- 照片管理：上传、查看、删除
- 数据导入：支持 `.xlsx` / `.xls` / `.csv`
- 数据导出：按样品或全量导出 Excel
- 前端页面：内置静态页面，直接从根路径访问

## 技术栈

- FastAPI
- SQLAlchemy
- SQLite
- Uvicorn
- 原生 HTML/CSS/JS（位于 `static/`）

## 运行环境

- Python 3.10+
- Windows / macOS / Linux

## 快速开始（Windows PowerShell）

1. 进入项目目录

```powershell
cd "c:\Users\A7N6PZZ\OneDrive - 3M\Documents\5. Lab & Field Test\color_data"
```

2. 创建并激活虚拟环境

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

3. 安装依赖

```powershell
pip install -r requirements.txt
```

4. 启动服务（任选一种）

```powershell
python main.py
```

或

```powershell
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

5. 打开浏览器

- 应用首页：http://127.0.0.1:8000/
- OpenAPI 文档：http://127.0.0.1:8000/docs

## 目录结构

```text
color_data/
  main.py                # FastAPI 应用入口
  database.py            # 数据库连接与会话
  models.py              # SQLAlchemy 模型
  schemas.py             # Pydantic 模型
  crud.py                # 业务逻辑与数据库操作
  requirements.txt       # Python 依赖
  static/                # 前端静态资源
  uploads/               # 上传文件目录
  .gitignore
  README.md
```

## 数据库说明

- 使用 SQLite，本地数据库文件默认：`color_data.db`
- 应用启动时会自动创建表和必要目录（如 `uploads/`）

## 常用接口（示例）

- `GET /api/samples`：获取样品列表
- `POST /api/samples`：创建样品
- `GET /api/samples/{sample_id}/measurements`：获取样品测量记录
- `POST /api/samples/{sample_id}/measurements`：新增测量记录
- `POST /api/import`：导入数据文件
- `GET /api/export`：导出 Excel

## 常见问题

1. 端口被占用

```powershell
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

2. 页面打不开

- 确认终端中服务正在运行
- 访问 `http://127.0.0.1:8000/`
- 尝试强制刷新（Ctrl + F5）

## 许可证

内部项目，按团队规范使用。
