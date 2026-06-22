#!/bin/bash
# SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
# SPDX-License-Identifier: AGPL-3.0-or-later

set -e
# 旧数据位置
old_data_dir=/lzcapp/run/mnt/home/nextcloud
# 新数据位置
new_data_dir=/lzcapp/var/nextcloud
# 备份数据位置
new_data_dir_re=/lzcapp/var/backup_nextcloud

# 判断目录是否存在且非空
if [ -d "$old_data_dir" ] && [ "$(ls -A "$old_data_dir" 2>/dev/null)" ]; then
    echo "检测到旧数据，开始迁移..."

    mkdir -p "$new_data_dir" "$new_data_dir_re"

    echo "备份数据中..."
    cp -a "$old_data_dir"/. "$new_data_dir_re"/

    echo "迁移数据中..."
    # 移动非隐藏文件
    for f in "$old_data_dir"/*; do
        [ -e "$f" ] || continue  # 如果没有匹配到文件，跳过循环
        mv "$f" "$new_data_dir"/
    done

    # 移动隐藏文件（排除 . 和 ..）
    for f in "$old_data_dir"/.[!.]* "$old_data_dir"/..?*; do
        [ -e "$f" ] || continue
        mv "$f" "$new_data_dir"/
    done

    echo "数据迁移完成"
else
    echo "没有旧数据，跳过迁移..."
fi
