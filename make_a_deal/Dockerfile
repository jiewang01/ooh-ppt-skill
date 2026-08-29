FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 依赖层
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# 代码层
COPY . .

# 运行 MCP server（stdio 传输，供 docker -i 使用）
ENTRYPOINT ["python", "mcp_server.py"]
