#!/bin/bash

# Настройки
PROJECT_DIR="/root/fantasy-mvp"
DB_FILE="$PROJECT_DIR/data/fantasy.db"
BACKUP_DIR="$PROJECT_DIR/backups"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/fantasy_$DATE.db"
MAX_BACKUPS=14  # Хранить последние 14 бэкапов

echo "🔄 Начало резервного копирования..."
echo "📁 База данных: $DB_FILE"
echo "💾 Бэкап: $BACKUP_FILE"

# Проверяем, существует ли БД
if [ ! -f "$DB_FILE" ]; then
    echo " Ошибка: файл базы данных не найден!"
    exit 1
fi

# Создаём папку бэкапов если нет
mkdir -p "$BACKUP_DIR"

# Делаем бэкап через sqlite3 (консистентный снимок)
sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"

if [ $? -eq 0 ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ Бэкап успешно создан! Размер: $SIZE"
else
    echo "❌ Ошибка при создании бэкапа!"
    exit 1
fi

# Удаляем старые бэкапы (оставляем только MAX_BACKUPS последних)
echo "🗑️ Удаление старых бэкапов (оставляем $MAX_BACKUPS)..."
ls -t "$BACKUP_DIR"/fantasy_*.db | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -v

echo "📊 Текущие бэкапы:"
ls -lh "$BACKUP_DIR"/fantasy_*.db | awk '{print $9, $5}'

echo "✅ Резервное копирование завершено!"