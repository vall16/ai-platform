@echo off
set "PGPASSWORD=sa"
"C:\Program Files\PostgreSQL\15\bin\psql.exe" -h localhost -U postgres -d ai_platform -f "C:\Users\crist\ai-platform\.qwen\tmp\check_tables.sql"
