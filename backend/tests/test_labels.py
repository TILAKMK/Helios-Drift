import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock
import datetime
import uuid
from backend.main import app
from backend.database import get_db
from backend.models import GroundTruthLabel

def test_create_label():
    client = TestClient(app)
    mock_session = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_session
    
    db_label = GroundTruthLabel(
        id=42,
        env_id="nie-cs-lab-201",
        device_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        event_type="power_cut",
        severity=3,
        notes="Generator switchover",
        labeled_at=datetime.datetime.now(datetime.timezone.utc)
    )
    
    payload = {
        "env_id": "nie-cs-lab-201",
        "device_id": str(db_label.device_id),
        "session_id": str(db_label.session_id),
        "event_type": "power_cut",
        "severity": 3,
        "notes": "Generator switchover",
        "timestamp": db_label.labeled_at.isoformat(),
        "composite_score_at_time": 0.45
    }
    
    response = client.post("/api/labels", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    
    app.dependency_overrides.pop(get_db, None)

def test_list_labels():
    client = TestClient(app)
    mock_session = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_session
    
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [
        GroundTruthLabel(
            id=1,
            env_id="nie-cs-lab-201",
            device_id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            event_type="fire_drill",
            severity=5,
            labeled_at=datetime.datetime.now(datetime.timezone.utc)
        )
    ]
    mock_session.execute.return_value = mock_result
    
    response = client.get("/api/labels/nie-cs-lab-201")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["event_type"] == "fire_drill"
    
    app.dependency_overrides.pop(get_db, None)

def test_patch_lead_time():
    client = TestClient(app)
    mock_session = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_session
    
    mock_label = GroundTruthLabel(
        id=12,
        env_id="nie-cs-lab-201",
        device_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        event_type="weather_change",
        severity=2,
        labeled_at=datetime.datetime.now(datetime.timezone.utc)
    )
    
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_label
    mock_session.execute.return_value = mock_result
    
    response = client.patch("/api/labels/12/lead-time", json={"lead_time_actual_min": 4.5})
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert mock_label.lead_time_actual_min == 4.5
    
    app.dependency_overrides.pop(get_db, None)

def test_export_labels_csv():
    client = TestClient(app)
    mock_session = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_session
    
    mock_label_result = MagicMock()
    mock_label_result.scalars.return_value.all.return_value = [
        GroundTruthLabel(
            id=1,
            env_id="nie-cs-lab-201",
            device_id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            event_type="false_alarm",
            severity=1,
            labeled_at=datetime.datetime.now(datetime.timezone.utc),
            lead_time_actual_min=1.5
        )
    ]
    
    mock_score_result = MagicMock()
    mock_score_result.scalars.return_value.all.return_value = [0.12, 0.15, 0.18]
    
    mock_session.execute.side_effect = [mock_label_result, mock_score_result]
    
    response = client.get("/api/labels/export/nie-cs-lab-201")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    
    content = response.text
    assert "timestamp" in content
    assert "score_t-29" in content
    assert "score_t-0" in content
    assert "event_in_30min" in content
    assert "minutes_to_event" in content
    assert "event_type" in content
    
    app.dependency_overrides.pop(get_db, None)
