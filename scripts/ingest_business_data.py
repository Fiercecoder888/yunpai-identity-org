from __future__ import annotations

import argparse
import json

from yunpai_langgraph.business_catalog import catalog_summary, ingest_tree


def main() -> None:
    parser = argparse.ArgumentParser(description="识别云湃业务资料并写入可追溯候选库")
    parser.add_argument("--root", required=True, help="业务数据根目录")
    parser.add_argument("--db", default="runtime/yunpai-business-catalog.sqlite", help="候选库路径")
    parser.add_argument("--limit", type=int, default=None, help="仅处理前 N 个文件，用于试运行")
    args = parser.parse_args()
    result = ingest_tree(args.root, args.db, limit=args.limit)
    result["summary"] = catalog_summary(args.db)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
