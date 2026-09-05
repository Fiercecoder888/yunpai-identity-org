from yunpai_langgraph.m0_backend import M0Store


def test_39092_m0_backend_publishes_and_reads_back(tmp_path):
    store = M0Store(tmp_path / "m0.sqlite")
    batch = store.ingest(
        [{"filename": "order.json", "entity_type": "order", "order_id": "SO-39092", "product_code": "W-H909"}],
        tenant_id="tenant-39092",
        task_id="task-1",
    )
    result = store.publish(
        batch["batch_id"],
        actor="reviewer-1",
        human_override=True,
        reason="人工确认原始订单有效",
    )
    assert result["status"] == "published"
    assert result["approved_candidates"] == 1
    assert result["ledger_count"] == 1
    assert result["outbox_count"] == 1
    assert result["entities"][0]["canonical_key"] == "W-H909"
